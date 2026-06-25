import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { hashKey } from "./keys.js";
import { apiTelemetry, licenses, notificationEvents, notificationSettings, usageEvents, type License } from "../db/schema.js";
import { evaluateLicensePolicy, notificationEventsForUsage, type NotificationEventType } from "./policy.js";

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
 * Atomically reserves up to `requested` units for `key`. Rolls the usage window
 * when due, then check-and-increments under a row lock so concurrent requests
 * cannot exceed the quota. Returns `{ granted: 0 }` when over quota; throws
 * {@link HttpError} for unknown/inactive/expired licenses.
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

    const beforeDecision = evaluateLicensePolicy({
      license: { ...lic, usedUnits: used, firstOverageAt, status },
      now,
      gracePeriodDays: lic.gracePeriodDays,
      isExistingJob: options.isExistingJob === true,
    });
    if (!beforeDecision.allowed) {
      await recordTelemetry(tx, lic, {
        endpoint: options.endpoint ?? "/v1/authorize",
        pages: requested,
        status: "blocked",
        jobId: options.jobId,
        jobDescription: options.jobDescription,
      });
      await tx.update(licenses).set({ status: beforeDecision.status, firstOverageAt: beforeDecision.firstOverageAt }).where(eq(licenses.id, lic.id));
      throw new HttpError(403, beforeDecision.reason ?? "hard_blocked", {
        remaining: Math.max(0, lic.limitUnits - used),
        hardBlockAt: beforeDecision.hardBlockAt?.toISOString() ?? null,
        watermark: beforeDecision.watermark,
        status: beforeDecision.status,
      });
    }

    const granted = Math.max(0, requested);
    const newUsed = used + granted;
    const wasOverLimit = used > lic.limitUnits || beforeDecision.status === "grace_period";
    const afterDecision = evaluateLicensePolicy({
      license: { ...lic, usedUnits: newUsed, firstOverageAt: beforeDecision.firstOverageAt, status: beforeDecision.status },
      now,
      gracePeriodDays: lic.gracePeriodDays,
      isExistingJob: options.isExistingJob === true,
    });
    const events = notificationEventsForUsage({
      previousUsedPages: used,
      nextUsedPages: newUsed,
      pageLimit: lic.limitUnits,
      wasOverLimit,
      isOverLimit: newUsed > lic.limitUnits || afterDecision.status === "grace_period",
    });

    await tx
      .update(licenses)
      .set({
        usedUnits: newUsed,
        windowStartedAt: startedAt,
        status: afterDecision.status,
        firstOverageAt: afterDecision.firstOverageAt,
      })
      .where(eq(licenses.id, lic.id));
    if (granted > 0) {
      await tx.insert(usageEvents).values({
        licenseId: lic.id,
        kind: "authorize",
        units: granted,
        pages: granted,
        endpoint: options.endpoint ?? "/v1/authorize",
        status: beforeDecision.watermark ? "watermarked" : "success",
        jobId: options.jobId,
        jobDescription: options.jobDescription,
      });
    }
    await recordTelemetry(tx, lic, {
      endpoint: options.endpoint ?? "/v1/authorize",
      pages: granted,
      status: beforeDecision.watermark ? "watermarked" : "success",
      jobId: options.jobId,
      jobDescription: options.jobDescription,
    });
    await enqueueNotifications(tx, lic, events, {
      usedPages: newUsed,
      pageLimit: lic.limitUnits,
      hardBlockAt: afterDecision.hardBlockAt?.toISOString() ?? null,
    });

    return {
      granted,
      remaining: Math.max(0, lic.limitUnits - newUsed),
      resetAt: windowResetAt(lic.window, startedAt),
      watermark: beforeDecision.watermark,
      status: afterDecision.status,
      hardBlockAt: afterDecision.hardBlockAt?.toISOString() ?? null,
    };
  });
}

/**
 * Records reconciled client-reported usage (audit only; the enforced counter
 * moves on authorize). Captures both dimensions so reports can show e.g.
 * "200 PDFs, 5200 pages".
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

async function enqueueNotifications(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  lic: License,
  events: NotificationEventType[],
  payload: { usedPages: number; pageLimit: number; hardBlockAt: string | null },
): Promise<void> {
  if (events.length === 0) return;
  const [settings] = await tx.select().from(notificationSettings).where(eq(notificationSettings.accountId, lic.accountId));
  if (!settings) return;
  const rows = [];
  for (const type of events) {
    if ((type === "usage_80_percent" || type === "usage_100_percent") && !settings.usageAlertsEnabled) continue;
    if (type === "overage_started" && !settings.overageAlertsEnabled) continue;
    const body = JSON.stringify({ type, accountId: lic.accountId, licenseId: lic.id, ...payload });
    if (settings.emailTo) rows.push({ accountId: lic.accountId, licenseId: lic.id, type, channel: "email" as const, payload: body });
    if (settings.webhookUrl) rows.push({ accountId: lic.accountId, licenseId: lic.id, type, channel: "webhook" as const, payload: body });
  }
  if (rows.length > 0) await tx.insert(notificationEvents).values(rows);
}
