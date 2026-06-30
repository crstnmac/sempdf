import { Hono } from "hono";
import type { Context } from "hono";

import { authorize, recordUsage, getLicense, HttpError, type TelemetryMeta } from "../domain/licenses.js";
import { signAuthorize, publicKeyBundle } from "../domain/signing.js";
import { TRIAL_WATERMARK_TEXT } from "../domain/policy.js";
import { env } from "../env.js";

/**
 * Machine-facing endpoints, authenticated by the licence key (not better-auth).
 * The key is read from `Authorization: Bearer <key>`.
 */
export const machine = new Hono();

/**
 * Reads the licence key from `Authorization: Bearer <key>`, falling back to a
 * `key` body field for compatibility. Prefer the header so the key never lands
 * in request-body logs.
 */
function keyFromRequest(c: Context, body: { key?: unknown }): string {
  const header = c.req.header("authorization");
  if (header) return header.replace(/^Bearer\s+/i, "").trim();
  return String(body.key ?? "");
}

/**
 * Extracts job identifiers and client/runtime telemetry metadata. Supports the
 * baked-in auto-guard (fields under `body.meta`), the manual client (top-level
 * `jobId`/`jobDescription`), and `X-Job-*` headers.
 */
function readMeta(
  c: Context,
  body: Record<string, unknown>,
): { jobId: string | undefined; jobDescription: string | undefined; meta: TelemetryMeta } {
  const m = (typeof body.meta === "object" && body.meta ? body.meta : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
  const jobId = str(body.jobId) ?? c.req.header("x-job-id") ?? str(m.jobId);
  const jobDescription =
    str(body.jobDescription) ?? c.req.header("x-job-description") ?? str(m.jobDescription);
  return {
    jobId,
    jobDescription,
    meta: {
      libVersion: str(m.libVersion),
      nodeVersion: str(m.nodeVersion),
      platform: str(m.platform),
      tagged: typeof m.tagged === "boolean" ? m.tagged : undefined,
      language: str(m.language),
      conformance: str(m.conformance),
      errorCode: str(m.errorCode),
    },
  };
}

/**
 * Public keys clients use to verify signed responses. Returns a JSON bundle:
 * `{ kid, publicKeyPem, keys: [{ kid, publicKeyPem }, ...] }`. A client reads the
 * `kid` from an authorize response and verifies against the matching entry in
 * `keys` (supports key rotation). `publicKeyPem`/`kid` at the top level name the
 * current primary key for clients that pin a single key.
 */
machine.get("/public-key", (c) => c.json(publicKeyBundle()));

/**
 * Reserve quota. Bearer key + body { requested, nonce }. Atomic
 * check-and-increment. 200 -> signed grant; 402 -> over quota.
 */
machine.post("/authorize", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = keyFromRequest(c, body);
  const requested = Math.max(0, Math.floor(Number(body.requested ?? 0)));
  const nonce = String(body.nonce ?? "");
  const { jobId, jobDescription, meta } = readMeta(c, body);
  if (!key || !nonce || requested <= 0) return c.json({ error: "bad_request" }, 400);
  // Cap the per-call charge so a single request cannot debit an arbitrary amount.
  if (requested > env.maxRequestedPerCall) {
    return c.json({ error: "bad_request", reason: "requested_exceeds_max", max: env.maxRequestedPerCall }, 400);
  }

  try {
    const result = await authorize(key, requested, { nonce, jobId, jobDescription, endpoint: "/v1/authorize", meta });
    const { signature, kid } = signAuthorize({ key, granted: result.granted, remaining: result.remaining, resetAt: result.resetAt, nonce });
    return c.json({
      granted: result.granted,
      remaining: result.remaining,
      resetAt: result.resetAt,
      nonce,
      kid,
      signature,
      watermark: result.watermark,
      watermarkText: result.watermark ? TRIAL_WATERMARK_TEXT : null,
      status: result.status,
      hardBlockAt: result.hardBlockAt,
    });
  } catch (err) {
    if (err instanceof HttpError) return c.json({ error: err.message, ...err.details }, err.status as 400);
    console.error("authorize error", err);
    return c.json({ error: "internal" }, 500);
  }
});

/** Reconcile actual client usage. Bearer key + body { documents, pages }. Audit only. */
machine.post("/usage", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = keyFromRequest(c, body);
  const documents = Math.max(0, Math.floor(Number(body.documents ?? 0)));
  const pages = Math.max(0, Math.floor(Number(body.pages ?? 0)));
  const { jobId, jobDescription, meta } = readMeta(c, body);
  const status = body.status === "fail" || body.status === "watermarked" || body.status === "blocked" ? body.status : "success";
  if (!key || (documents <= 0 && pages <= 0)) return c.json({ error: "bad_request" }, 400);
  try {
    await recordUsage(key, { documents, pages }, { jobId, jobDescription, status, endpoint: "/v1/usage", meta });
  } catch (err) {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    throw err;
  }
  return c.json({ ok: true });
});

/** Licence status for the presented key (Bearer). Never returns the key. */
machine.get("/license", async (c) => {
  const key = keyFromRequest(c, {});
  if (!key) return c.json({ error: "bad_request" }, 400);
  const lic = await getLicense(key);
  if (!lic) return c.json({ error: "unknown_license" }, 404);
  return c.json({
    id: lic.id,
    metric: lic.metric,
    window: lic.window,
    limit: lic.limitUnits + lic.bonusUnits,
    used: lic.usedUnits,
    remaining: lic.limitUnits + lic.bonusUnits - lic.usedUnits,
    status: lic.status,
    firstOverageAt: lic.firstOverageAt,
    trialStartedAt: lic.trialStartedAt,
    trialEndsAt: lic.trialEndsAt,
    active: lic.active,
    expiresAt: lic.expiresAt,
  });
});
