import type { Context, MiddlewareHandler } from "hono";

import { env } from "../env.js";
import { recordRateLimited } from "../observability/metrics.js";

/**
 * In-memory sliding-window rate limiter for the machine routes, keyed by
 * (api-key + client IP). Returns 429 with a `Retry-After` header when exceeded.
 *
 * SINGLE-INSTANCE ONLY: counters live in this process's memory. With more than
 * one API instance behind the load balancer, each instance enforces the limit
 * independently, so the effective global limit is N × the configured limit.
 * For correct multi-instance limiting, move this to a shared store (e.g. Redis
 * with a sliding-window or token-bucket script) — see
 * docs/infrastructure-recommendation.md.
 */

interface Window {
  /** Timestamps (ms) of requests still within the current window. */
  hits: number[];
}

const windows = new Map<string, Window>();

/** Periodically drop empty/expired windows so the map does not grow unbounded. */
let lastSweep = 0;
function sweepExpired(now: number): void {
  if (now - lastSweep < env.rateLimit.windowMs) return;
  lastSweep = now;
  const cutoff = now - env.rateLimit.windowMs;
  for (const [k, w] of windows) {
    w.hits = w.hits.filter((t) => t > cutoff);
    if (w.hits.length === 0) windows.delete(k);
  }
}

/** Best-effort client IP from common proxy headers, falling back to a constant. */
function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "unknown";
}

/** Identifies the caller for rate-limiting: api-key (from Bearer) + client IP. */
function rateKey(c: Context): string {
  const auth = c.req.header("authorization");
  const key = auth ? auth.replace(/^Bearer\s+/i, "").trim() : "anon";
  // The Bearer key is a secret; hashing keeps it out of the in-memory map's keys.
  // A cheap, non-cryptographic fold is enough here (collisions only over-share a
  // bucket, never leak the key).
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `${h}:${clientIp(c)}`;
}

export const machineRateLimit: MiddlewareHandler = async (c, next) => {
  if (!env.rateLimit.enabled) return next();

  const now = Date.now();
  sweepExpired(now);
  const cutoff = now - env.rateLimit.windowMs;
  const k = rateKey(c);
  let w = windows.get(k);
  if (!w) {
    w = { hits: [] };
    windows.set(k, w);
  }
  w.hits = w.hits.filter((t) => t > cutoff);

  if (w.hits.length >= env.rateLimit.max) {
    recordRateLimited();
    const oldest = w.hits[0]!;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + env.rateLimit.windowMs - now) / 1000));
    c.header("Retry-After", String(retryAfterSec));
    return c.json({ error: "rate_limited" }, 429);
  }

  w.hits.push(now);
  return next();
};
