import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db/client.js";
import { generateKey, hashKey, keyPrefix } from "./keys.js";
import { apiKeys, apiTelemetry, licenses, requestNonces, type HostMeta, type License } from "../db/schema.js";
import { evaluateLicensePolicy } from "./policy.js";
import { queueUsageNotifications } from "./notifications.js";
import { deliverPendingNotifications } from "./delivery.js";

export interface AuthorizeResult {
  granted: number;
  remaining: number;
  resetAt: string | null;
  watermark: boolean;
  status: License["status"];
  hardBlockAt: string | null;
  /** True when this is an idempotent replay of a prior identical-nonce charge. */
  replayed?: boolean;
}

/** A unique-violation thrown by Postgres (duplicate (license_id, nonce)). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** How stale an api_keys.lastUsedAt may get before authorize rewrites it. */
const LAST_USED_THROTTLE_MS = 60_000;

/** A typed HTTP error so route handlers can map to status codes. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

/**
 * ISO reset timestamp for a window, or null for lifetime. Annual plans reset on
 * the yearly anniversary of `from` (the current window's start).
 */
export function windowResetAt(window: License["window"], from: Date): string | null {
  if (window === "lifetime") return null;
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

/** True when `startedAt` is more than one year before `now` (annual rollover). */
function windowExpired(window: License["window"], startedAt: Date, now: Date): boolean {
  if (window === "lifetime") return false;
  const anniversary = new Date(startedAt);
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
  return now.getTime() >= anniversary.getTime();
}

/**
 * Checks whether the license is allowed to generate and syncs status/window.
 * Does NOT increment `usedUnits` — that is done by `recordUsage` on actual
 * consumption. Returns the granted amount (always `requested` when allowed).
 */
export async function authorize(
  key: string,
  requested: number,
  options: { nonce?: string; jobId?: string | undefined; jobDescription?: string | undefined; endpoint?: string; meta?: TelemetryMeta } = {},
): Promise<AuthorizeResult> {
  const keyHash = hashKey(key);
  const nonce = options.nonce ?? "";
  // Count of usage alerts queued this charge, so we can flush them immediately
  // (outside the transaction, once the rows are committed and visible).
  let queuedAlerts = 0;
  // The transaction returns an outcome rather than throwing on a block: throwing
  // inside the transaction would roll back the very telemetry/status writes we
  // make for a blocked request. We commit those, then throw outside.
  const outcome = await db.transaction(async (tx): Promise<
    | { blocked: true; reason: string; status: License["status"]; hardBlockAt: string | null; remaining: number }
    | { blocked: false; replay: AuthorizeResult }
    | (AuthorizeResult & { blocked: false; replay?: undefined })
  > => {
    const [apiKey] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));
    if (!apiKey) throw new HttpError(404, "unknown_license");
    const [lic] = await tx.select().from(licenses).where(eq(licenses.id, apiKey.licenseId)).for("update");
    if (!lic) throw new HttpError(404, "unknown_license");

    // Idempotency: a client retry resends the same nonce. If we've already
    // charged for it, replay the stored grant WITHOUT charging again. The license
    // row is locked FOR UPDATE above, so a concurrent first-attempt for the same
    // (license, nonce) is serialized behind us — either it committed first (we
    // see its row here) or it waits and then hits the UNIQUE constraint below.
    if (nonce) {
      const [prior] = await tx
        .select({ grant: requestNonces.grant })
        .from(requestNonces)
        .where(and(eq(requestNonces.licenseId, lic.id), eq(requestNonces.nonce, nonce)));
      if (prior) {
        return { blocked: false, replay: { ...(JSON.parse(prior.grant) as AuthorizeResult), replayed: true } };
      }
    }

    const now = new Date();
    // Throttle lastUsedAt writes. A write on every authorize is pure WAL +
    // row-lock churn for a value only used for "last seen" display, which does
    // not need second precision. Update at most once per minute per key — drops
    // ~99% of these writes under sustained load.
    if (!apiKey.lastUsedAt || now.getTime() - apiKey.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      await tx.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, apiKey.id));
    }
    let used = lic.usedUnits;
    let bonus = lic.bonusUnits;
    let startedAt = lic.windowStartedAt;
    let firstOverageAt = lic.firstOverageAt;
    let status = lic.status;
    if (windowExpired(lic.window, startedAt, now)) {
      used = 0;
      bonus = 0; // one-time bonus pages expire at the window boundary
      startedAt = now;
      firstOverageAt = null;
      status = lic.trialEndsAt && lic.trialEndsAt.getTime() > now.getTime() ? "trial" : "none";
    }

    // Effective allowance = recurring limit + this window's one-time bonus.
    const effectiveLimit = lic.limitUnits + bonus;
    const decision = evaluateLicensePolicy({
      license: { ...lic, usedUnits: used, limitUnits: effectiveLimit, firstOverageAt, status },
      now,
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
      await tx.update(licenses).set({ status: decision.status, firstOverageAt: decision.firstOverageAt, bonusUnits: bonus }).where(eq(licenses.id, lic.id));
      return {
        blocked: true,
        reason: decision.reason ?? "hard_blocked",
        status: decision.status,
        hardBlockAt: decision.hardBlockAt?.toISOString() ?? null,
        remaining: effectiveLimit - used,
      };
    }

    // Reserve-as-charge: debit the granted block now so the server enforces the
    // limit on its own, without depending on the client to flush /v1/usage. The
    // decision above was computed on the pre-charge `used`, so the run that tips
    // over the limit still completes; the NEXT authorize sees `used >= limit` and
    // is hard-blocked.
    const granted = Math.max(0, requested);
    const prevUsed = used;
    const nextUsed = used + granted;
    await tx
      .update(licenses)
      .set({
        windowStartedAt: startedAt,
        usedUnits: nextUsed,
        bonusUnits: bonus,
        status: decision.status,
        firstOverageAt: decision.firstOverageAt,
      })
      .where(eq(licenses.id, lic.id));
    await recordTelemetry(tx, lic, {
      endpoint: options.endpoint ?? "/v1/authorize",
      pages: granted,
      status: decision.watermark ? "watermarked" : "success",
      jobId: options.jobId,
      jobDescription: options.jobDescription,
      meta: options.meta,
    });
    // Proactive alerts when this charge crosses 90% / 95% / 100%.
    queuedAlerts = await queueUsageNotifications(tx, lic, { prevUsed, nextUsed, limit: effectiveLimit });

    const result: AuthorizeResult = {
      granted,
      remaining: effectiveLimit - nextUsed,
      resetAt: windowResetAt(lic.window, startedAt),
      watermark: decision.watermark,
      status: decision.status,
      hardBlockAt: decision.hardBlockAt?.toISOString() ?? null,
    };

    // Claim the nonce so a retry replays this grant instead of re-charging. The
    // INSERT shares this transaction with the charge above, so the nonce row and
    // the usedUnits increment commit atomically — a crash mid-charge leaves
    // neither. A racing duplicate raises a UNIQUE violation (23505); we catch it
    // and replay the now-committed sibling grant.
    if (nonce) {
      try {
        await tx
          .insert(requestNonces)
          .values({ licenseId: lic.id, apiKeyId: apiKey.id, nonce, grant: JSON.stringify(result) });
      } catch (err) {
        if (isUniqueViolation(err)) {
          const [prior] = await tx
            .select({ grant: requestNonces.grant })
            .from(requestNonces)
            .where(and(eq(requestNonces.licenseId, lic.id), eq(requestNonces.nonce, nonce)));
          if (prior) return { blocked: false, replay: { ...(JSON.parse(prior.grant) as AuthorizeResult), replayed: true } };
        }
        throw err;
      }
    }

    return { blocked: false, ...result };
  });

  // Usage alerts (90/95/100%) are time-sensitive, so flush them now instead of
  // waiting for the next sweep. Fire-and-forget: delivery must never block or
  // fail the authorize response; the sweep remains the backstop for retries.
  if (queuedAlerts > 0) {
    void deliverPendingNotifications().catch((err) =>
      console.error(`[notifications] immediate delivery failed: ${err instanceof Error ? err.message : err}`),
    );
  }

  if (outcome.blocked) {
    throw new HttpError(403, outcome.reason, {
      remaining: outcome.remaining,
      hardBlockAt: outcome.hardBlockAt,
      status: outcome.status,
    });
  }
  // Idempotent replay: return the previously-stored grant verbatim (no re-charge).
  if (outcome.replay) return outcome.replay;
  const { blocked: _blocked, replay: _replay, ...result } = outcome;
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

  // Audit/reconcile only. Consumption is charged at /v1/authorize (reserve-as-
  // charge), so we do NOT increment `usedUnits` here — that would double-count.
  // We still re-evaluate status so trial expiry / overage is reflected.
  const now = new Date();
  const decision = evaluateLicensePolicy({
    license: { ...lic, limitUnits: lic.limitUnits + lic.bonusUnits },
    now,
  });
  // Skip the write when nothing changed — the common case. recordUsage is the
  // /v1/usage path (audit-only, charged at authorize), so on a healthy license
  // status + firstOverageAt are almost always already correct; writing them
  // every call was a needless UPDATE (lock + WAL) on the hottest reconcile path.
  if (decision.status !== lic.status || !sameInstant(decision.firstOverageAt, lic.firstOverageAt)) {
    await db
      .update(licenses)
      .set({ status: decision.status, firstOverageAt: decision.firstOverageAt })
      .where(eq(licenses.id, lic.id));
  }

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
    host: options.meta?.host,
  });
}

/** True when two nullable timestamps represent the same instant (or both null). */
function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/**
 * Looks up a licence by one of its (plaintext) API keys, via the api_keys table.
 * Single round trip: join api_keys → licenses instead of two sequential SELECTs,
 * halving DB latency and pool occupancy on /v1/license and /v1/usage.
 */
export async function getLicense(key: string): Promise<License | undefined> {
  const [row] = await db
    .select({ lic: licenses })
    .from(apiKeys)
    .innerJoin(licenses, eq(licenses.id, apiKeys.licenseId))
    .where(and(eq(apiKeys.keyHash, hashKey(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  return row?.lic;
}

/**
 * Issues a new API key for a license and returns the plaintext key ONCE (only
 * the hash is stored). Used by trial provisioning, operator issuance, and the
 * customer portal's "create key" action.
 */
export async function createApiKey(
  licenseId: string,
  name: string,
): Promise<{ id: string; name: string; keyPrefix: string; key: string }> {
  const key = generateKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ licenseId, name: name.trim() || "Default", keyHash: hashKey(key), keyPrefix: keyPrefix(key) })
    .returning();
  if (!row) throw new HttpError(500, "key_creation_failed");
  return { id: row.id, name: row.name, keyPrefix: row.keyPrefix, key };
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
  host?: HostMeta | undefined;
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
    host: event.meta?.host,
  });
}

