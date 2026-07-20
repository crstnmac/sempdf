import type { MiddlewareHandler } from "hono";

import { decInFlight, incInFlight, recordRequest } from "./metrics.js";

/**
 * Lightweight structured request logging (JSON lines) + in-process metrics.
 *
 * SECRETS: this logger NEVER touches the request body, the Authorization header,
 * or query strings — only method, path, status, duration, and the request id are
 * emitted. The license key (Bearer) and any signing material therefore never
 * reach the logs. Keep it that way when extending the log shape.
 */
// Hit every 30s (Prometheus scrape) / by the LB + uptime monitor — internal
// plumbing, not an application event. Excluded so the log stream stays
// readable; /metrics' own values are already captured in Prometheus, and a
// dead scrape target is caught by the `up{job="license-api"}` alert, not by
// eyeballing this log line.
const UNLOGGED_PATHS = new Set(["/metrics", "/healthz", "/readyz"]);

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  incInFlight();
  try {
    await next();
  } finally {
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    decInFlight();
    const status = c.res.status;
    recordRequest(status, durationMs);
    if (UNLOGGED_PATHS.has(c.req.path)) return;
    // path (not url) avoids logging query strings, which could carry identifiers.
    const line = {
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      msg: "request",
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs,
      requestId: c.get("requestId"),
    };
    console.log(JSON.stringify(line));
  }
};
