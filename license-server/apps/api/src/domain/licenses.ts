import { eq, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { hashKey } from "./keys.js";
import { apiTelemetry, licenses, usageEvents, type License } from "../db/schema.js";
import { evaluateLicensePolicy } from "./policy.js";

export interface AuthorizeResult {
  granted: number;
  remaining: number;
  resetAt: string | null;
  watermark: boolean;
  status: License["status"];
  hardBlockAt: string | null;
}

/** A typed HTTP error so route handlers can map to status codes. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

/** ISO reset timestamp for a window, or null for lifetime. */
export function windowResetAt(window: License["window"], from: Date): string | null {
  if (window === "lifetime") return null;
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  if (window === "day") {
    d.setUTCDate(d.getUTCDate() + 1);
  } else {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d.toISOString();
}

/** True when `startedAt` falls before the current window boundary. */
function windowExpired(window: License["window"], startedAt: Date, now: Date): boolean {
  if (window === "lifetime") return false;
  const sameMonth = startedAt.getUTCFullYear() === now.getUTCFullYear() && startedAt.getUTCMonth() === now.getUTCMonth();
  if (window === "month") return !sameMonth;
  return !sameMonth || startedAt.getUTCDate() !== now.getUTCDate();
}

/**
 * Checks whether the license is allowed to generate and syncs status/window.
 * Does NOT increment `usedUnits` — that is done by `recordUsage` on actual
 * consumption. Returns the granted amount (always `requested` when allowed).
 */
export async function authorize(
  key: string,
  requested: number,
  options: { jobId?: string | undefined; jobDescription?: string | undefined; endpoint?: string; meta?: TelemetryMeta } = {},
): Promise<AuthorizeResult> {
  const keyHash = hashKey(key);
  // The transaction returns an outcome rather than throwing on a block: throwing
  // inside the transaction would roll back the very telemetry/status writes we
  // make for a blocked request. We commit those, then throw outside.
  const outcome = await db.transaction(async (tx): Promise<
    { blocked: true; reason: string; status: License["status"]; hardBlockAt: string | null; remaining: number } | (AuthorizeResult & { blocked: false })
  > => {
    const [lic] = await tx.select().from(licenses).where(eq(licenses.keyHash, keyHash)).for("update");
    if (!lic) throw new HttpError(404, "unknown_license");

    const now = new Date();
    let used = lic.usedUnits;
    let startedAt = lic.windowStartedAt;
    let firstOverageAt = lic.firstOverageAt;
    let status = lic.status;
    if (windowExpired(lic.window, startedAt, now)) {
      used = 0;
      startedAt = now;
      firstOverageAt = null;
      status = lic.trialEndsAt && lic.trialEndsAt.getTime() > now.getTime() ? "trial" : "none";
    }

    const decision = evaluateLicensePolicy({
      license: { ...lic, usedUnits: used, firstOverageAt, status },
      now,
      gracePeriodDays: lic.gracePeriodDays,
    });
    if (!decision.allowed) {
      await recordTelemetry(tx, lic, {
        endpoint: options.endpoint ?? "/v1/authorize",
        pages: requested,
        status: "blocked",
        jobId: options.jobId,
        jobDescription: options.jobDescription,
        meta: { ...options.meta, errorCode: decision.reason },
      });
      await tx.update(licenses).set({ status: decision.status, firstOverageAt: decision.firstOverageAt }).where(eq(licenses.id, lic.id));
      return {
        blocked: true,
        reason: decision.reason ?? "hard_blocked",
        status: decision.status,
        hardBlockAt: decision.hardBlockAt?.toISOString() ?? null,
        remaining: lic.limitUnits - used,
      };
    }

    // Grant without reserving — billing happens on actual consumption via /v1/usage.
    const granted = Math.max(0, requested);
    await tx
      .update(licenses)
      .set({
        windowStartedAt: startedAt,
        status: decision.status,
        firstOverageAt: decision.firstOverageAt,
      })
      .where(eq(licenses.id, lic.id));
    if (granted > 0) {
      await tx.insert(usageEvents).values({
        licenseId: lic.id,
        kind: "authorize",
        units: granted,
        pages: granted,
        endpoint: options.endpoint ?? "/v1/authorize",
        status: decision.watermark ? "watermarked" : "success",
        jobId: options.jobId,
        jobDescription: options.jobDescription,
      });
    }
    await recordTelemetry(tx, lic, {
      endpoint: options.endpoint ?? "/v1/authorize",
      pages: granted,
      status: decision.watermark ? "watermarked" : "success",
      jobId: options.jobId,
      jobDescription: options.jobDescription,
      meta: options.meta,
    });

    return {
      blocked: false,
      granted,
      remaining: lic.limitUnits - used,
      resetAt: windowResetAt(lic.window, startedAt),
      watermark: decision.watermark,
      status: decision.status,
      hardBlockAt: decision.hardBlockAt?.toISOString() ?? null,
    };
  });

  if (outcome.blocked) {
    throw new HttpError(403, outcome.reason, {
      remaining: outcome.remaining,
      hardBlockAt: outcome.hardBlockAt,
      status: outcome.status,
    });
  }
  const { blocked: _blocked, ...result } = outcome;
  return result;
}

/**
 * Records reconciled client-reported usage and increments the billing counter.
 * Captures both dimensions so reports can show e.g. "200 PDFs, 5200 pages".
 */
export async function recordUsage(
  key: string,
  usage: { documents: number; pages: number },
  options: {
    jobId?: string | undefined;
    jobDescription?: string | undefined;
    status?: "success" | "fail" | "watermarked" | "blocked";
    endpoint?: string;
    meta?: TelemetryMeta;
  } = {},
): Promise<void> {
  const lic = await getLicense(key);
  if (!lic) throw new HttpError(404, "unknown_license");

  await db.update(licenses).set({ usedUnits: sql`used_units + ${usage.pages}` }).where(eq(licenses.id, lic.id));

  const [updated] = await db.select().from(licenses).where(eq(licenses.id, lic.id));
  if (updated) {
    const now = new Date();
    const decision = evaluateLicensePolicy({
      license: updated,
      now,
      gracePeriodDays: lic.gracePeriodDays,
    });
    await db
      .update(licenses)
      .set({ status: decision.status, firstOverageAt: decision.firstOverageAt })
      .where(eq(licenses.id, lic.id));
  }

  await db.insert(usageEvents).values({
    licenseId: lic.id,
    kind: "usage",
    units: 0,
    documents: usage.documents,
    pages: usage.pages,
    endpoint: options.endpoint ?? "/v1/usage",
    status: options.status ?? "success",
    jobId: options.jobId,
    jobDescription: options.jobDescription,
  });
  await db.insert(apiTelemetry).values({
    licenseId: lic.id,
    accountId: lic.accountId,
    endpoint: options.endpoint ?? "/v1/usage",
    pages: usage.pages,
    status: options.status ?? "success",
    jobId: options.jobId,
    jobDescription: options.jobDescription,
    libVersion: options.meta?.libVersion,
    nodeVersion: options.meta?.nodeVersion,
    platform: options.meta?.platform,
    tagged: options.meta?.tagged,
    language: options.meta?.language,
    conformance: options.meta?.conformance,
    errorCode: options.meta?.errorCode,
  });
}

/** Looks up a licence by its (plaintext) key, hashing it for the lookup. */
export async function getLicense(key: string): Promise<License | undefined> {
  const [lic] = await db.select().from(licenses).where(eq(licenses.keyHash, hashKey(key)));
  return lic;
}

/** Client + runtime metadata captured from the library, stored on telemetry. */
export interface TelemetryMeta {
  libVersion?: string | undefined;
  nodeVersion?: string | undefined;
  platform?: string | undefined;
  tagged?: boolean | undefined;
  language?: string | undefined;
  conformance?: string | undefined;
  errorCode?: string | undefined;
}

async function recordTelemetry(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  lic: License,
  event: {
    endpoint: string;
    pages: number;
    status: "success" | "fail" | "watermarked" | "blocked";
    jobId?: string | undefined;
    jobDescription?: string | undefined;
    meta?: TelemetryMeta | undefined;
  },
): Promise<void> {
  await tx.insert(apiTelemetry).values({
    licenseId: lic.id,
    accountId: lic.accountId,
    endpoint: event.endpoint,
    pages: event.pages,
    status: event.status,
    jobId: event.jobId,
    jobDescription: event.jobDescription,
    libVersion: event.meta?.libVersion,
    nodeVersion: event.meta?.nodeVersion,
    platform: event.meta?.platform,
    tagged: event.meta?.tagged,
    language: event.meta?.language,
    conformance: event.meta?.conformance,
    errorCode: event.meta?.errorCode,
  });
}

