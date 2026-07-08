import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { HTTPException } from "hono/http-exception";

import { auth } from "./auth.js";
import { env } from "./env.js";
import { pool } from "./db/client.js";
import { machine } from "./routes/machine.js";
import { adminRoutes } from "./routes/admin.js";
import { portalRoutes } from "./routes/portal.js";
import { machineRateLimit } from "./middleware/rate-limit.js";
import { requestLogger } from "./observability/logging.js";
import { renderPrometheus, sweepFreshness } from "./observability/metrics.js";

/** Assembles the Hono application: health, better-auth, machine + admin + portal routes. */
export const app = new Hono();

// --- App-level middleware (order matters) -------------------------------------
// 1. request-id: read or generate `x-request-id`, expose on context + response.
app.use("*", requestId());
// 2. structured request logging + in-process metrics (never logs bodies/keys).
app.use("*", requestLogger);
// 3. security headers globally. HSTS is only meaningful behind TLS, so it is
//    gated by HSTS_ENABLED (set it true only when TLS terminates upstream).
app.use(
  "*",
  secureHeaders({
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: env.hstsEnabled ? "max-age=31536000; includeSubDomains" : false,
  }),
);

// --- Liveness / readiness / metrics (NO rate-limit, NO body guards) -----------
// Liveness: process is up. No DB dependency on purpose.
app.get("/healthz", (c) => c.json({ ok: true }));

// Readiness: only 200 when the DB is reachable. Load balancers should health-
// check THIS endpoint (not /healthz) so an instance with a dead DB is drained.
app.get("/readyz", async (c) => {
  try {
    await pool.query("SELECT 1");
  } catch {
    return c.json({ ready: false, db: "down" }, 503);
  }
  // Surface notification-sweep freshness so a wedged cron is visible. Staleness
  // does not fail readiness (the API still serves), it is reported for alerting.
  const sweep = await sweepFreshness();
  const sweepStale =
    env.sweepStaleSeconds > 0 && sweep.ageSeconds !== null && sweep.ageSeconds > env.sweepStaleSeconds;
  return c.json({
    ready: true,
    db: "up",
    sweep: { ageSeconds: sweep.ageSeconds, stale: sweepStale },
  });
});

// Prometheus metrics: pool stats, request counters/latency, sweep freshness.
// Optionally guarded by METRICS_TOKEN so operational internals aren't public.
app.get("/metrics", async (c) => {
  if (env.metricsToken) {
    const presented = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const expected = env.metricsToken;
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  c.header("Content-Type", "text/plain; version=0.0.4");
  return c.body(await renderPrometheus());
});

// better-auth handles all of /api/auth/** (sign-in, sessions, organization,
// admin). The dashboard talks to these routes. CORS for these is handled by
// better-auth's own trustedOrigins logic — we do not wrap them.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// --- Machine routes (server-to-server) ----------------------------------------
// Body size + per-request timeout guards, then the rate limiter. These are
// server-to-server (no browser), so no CORS is applied. 413 on oversize body,
// 504 on timeout, 429 when rate-limited.
app.use(
  "/v1/*",
  bodyLimit({
    maxSize: env.limits.maxBodyBytes,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
);
app.use(
  "/v1/*",
  timeout(env.limits.requestTimeoutMs, () => new HTTPException(504, { message: "request_timeout" })),
);
app.use("/v1/*", machineRateLimit);

// --- Dashboard routes (browser, credentialed) ---------------------------------
// CORS scoped to the trusted origins (NOT wildcard, credentials enabled) for the
// admin + portal routes the dashboard fetches with cookies. The `/v1/*` middleware
// above also matches these paths; the rate limiter keys on Bearer-or-IP, which is
// harmless for cookie-authenticated dashboard calls.
const dashboardCors = cors({
  origin: env.trustedOrigins,
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
});
app.use("/v1/admin/*", dashboardCors);
app.use("/v1/portal/*", dashboardCors);

app.route("/v1", machine);
app.route("/v1/admin", adminRoutes);
app.route("/v1/portal", portalRoutes);
