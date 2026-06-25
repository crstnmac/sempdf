import { Hono } from "hono";
import type { Context } from "hono";

import { authorize, recordUsage, getLicense, HttpError } from "../domain/licenses.js";
import { signAuthorize, publicKeyPem } from "../domain/signing.js";

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

/** Public key clients configure as `publicKeyPem` to verify signed responses. */
machine.get("/public-key", (c) => c.text(publicKeyPem()));

/**
 * Reserve quota. Bearer key + body { requested, nonce }. Atomic
 * check-and-increment. 200 -> signed grant; 402 -> over quota.
 */
machine.post("/authorize", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = keyFromRequest(c, body);
  const requested = Math.max(0, Math.floor(Number(body.requested ?? 0)));
  const nonce = String(body.nonce ?? "");
  const jobId = body.jobId === undefined ? c.req.header("x-job-id") : String(body.jobId);
  const jobDescription = body.jobDescription === undefined ? c.req.header("x-job-description") : String(body.jobDescription);
  const isExistingJob = body.isExistingJob === true || c.req.header("x-existing-job") === "true";
  if (!key || !nonce || requested <= 0) return c.json({ error: "bad_request" }, 400);

  try {
    const result = await authorize(key, requested, { isExistingJob, jobId, jobDescription, endpoint: "/v1/authorize" });
    const signature = signAuthorize({ key, granted: result.granted, remaining: result.remaining, resetAt: result.resetAt, nonce });
    return c.json({
      granted: result.granted,
      remaining: result.remaining,
      resetAt: result.resetAt,
      nonce,
      signature,
      watermark: result.watermark,
      watermarkText: result.watermark ? result.status === "trial" ? "Trial Mode" : "Over Limit" : null,
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
  const jobId = body.jobId === undefined ? c.req.header("x-job-id") : String(body.jobId);
  const jobDescription = body.jobDescription === undefined ? c.req.header("x-job-description") : String(body.jobDescription);
  const status = body.status === "fail" || body.status === "watermarked" || body.status === "blocked" ? body.status : "success";
  if (!key || (documents <= 0 && pages <= 0)) return c.json({ error: "bad_request" }, 400);
  try {
    await recordUsage(key, { documents, pages }, { jobId, jobDescription, status, endpoint: "/v1/usage" });
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
    keyPrefix: lic.keyPrefix,
    metric: lic.metric,
    window: lic.window,
    limit: lic.limitUnits,
    used: lic.usedUnits,
    remaining: Math.max(0, lic.limitUnits - lic.usedUnits),
    status: lic.status,
    firstOverageAt: lic.firstOverageAt,
    trialStartedAt: lic.trialStartedAt,
    trialEndsAt: lic.trialEndsAt,
    gracePeriodDays: lic.gracePeriodDays,
    failMode: lic.failMode,
    active: lic.active,
    expiresAt: lic.expiresAt,
  });
});
