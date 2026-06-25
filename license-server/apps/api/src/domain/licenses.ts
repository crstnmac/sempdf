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
function windowResetAt(window: License["window"], from: Date): string | null {
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
  options: { isExistingJob?: boolean; jobId?: string | undefined; jobDescription?: string | undefined; endpoint?: string } = {},
): Promise<AuthorizeResult> {
  const keyHash = hashKey(key);
  return db.transaction(async (tx) => {
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
      isExistingJob: options.isExistingJob === true,
    });
    if (!decision.allowed) {
      await recordTelemetry(tx, lic, {
        endpoint: options.endpoint ?? "/v1/authorize",
        pages: requested,
        status: "blocked",
        jobId: options.jobId,
        jobDescription: options.jobDescription,
      });
      await tx.update(licenses).set({ status: decision.status, firstOverageAt: decision.firstOverageAt }).where(eq(licenses.id, lic.id));
      throw new HttpError(403, decision.reason ?? "hard_blocked", {
        remaining: Math.max(0, lic.limitUnits - used),
        hardBlockAt: decision.hardBlockAt?.toISOString() ?? null,
        watermark: decision.watermark,
        status: decision.status,
      });
    }

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
    });

    return {
      granted,
      remaining: Math.max(0, lic.limitUnits - used),
      resetAt: windowResetAt(lic.window, startedAt),
      watermark: decision.watermark,
      status: decision.status,
      hardBlockAt: decision.hardBlockAt?.toISOString() ?? null,
    };
  });
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
      isExistingJob: false,
    });
    await db.update(licenses)
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
  });
}

/** Looks up a licence by its (plaintext) key, hashing it for the lookup. */
export async function getLicense(key: string): Promise<License | undefined> {
  const [lic] = await db.select().from(licenses).where(eq(licenses.keyHash, hashKey(key)));
  return lic;
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
  });
}

