import { serve } from "@hono/node-server";

import { app } from "./app.js";
import { assertRequiredSecrets, env } from "./env.js";
import { pool } from "./db/client.js";

// Fail fast at boot if a required secret is missing, with a clear message,
// rather than failing the first request that needs it.
assertRequiredSecrets();

// Entry point: start the HTTP server and capture the handle for graceful shutdown.
const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(JSON.stringify({ level: "info", msg: "listening", port: info.port }));
});

/**
 * Graceful shutdown: stop accepting new connections, let in-flight requests
 * drain briefly, close the DB pool, then exit. A hard timeout forces exit so a
 * stuck connection can never block the deploy/rollout indefinitely.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: "info", msg: "shutdown", signal }));

  const forceExit = setTimeout(() => {
    console.error(JSON.stringify({ level: "error", msg: "shutdown_forced_timeout" }));
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  // Stop accepting new connections; the callback fires once in-flight requests
  // (tracked by the node-server) have finished.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end().catch((err) =>
    console.error(JSON.stringify({ level: "error", msg: "pool_end_failed", error: String(err) })),
  );

  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
