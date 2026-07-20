/**
 * Demo 5 — Zero-config licensing: only `SEMPDF_LICENSE_KEY`.
 *
 * No licensing code at all. Set the key and generate — the library's async
 * output methods authorize with the license server, meter the pages, and flush
 * usage on their own. Once the limit is reached the same call throws
 * `LICENSE_QUOTA_EXCEEDED` — the hard block, straight from the server.
 * (Release builds have the server URL baked in; running from this monorepo's
 * source there is no baked URL, so export SEMPDF_LICENSE_SERVER too.)
 *
 * Setup: start the API (apps/api: npm run dev) and create a license + key from
 * the admin dashboard or POST /v1/admin/customers (no self-serve signup). Then:
 *
 *   SEMPDF_LICENSE_KEY=<your-key> npx tsx examples/05-live-server.ts
 *
 * Watch usage and telemetry land in the dashboard / portal.
 */
import { banner, buildSampleDoc, save } from "./_shared.js";

if (!process.env.SEMPDF_LICENSE_KEY) {
  console.error("Set SEMPDF_LICENSE_KEY first. See the header of this file.");
  process.exit(1);
}

banner("Demo 5: zero-config metering against the license server");

const doc = buildSampleDoc("Live Server Output", 30);

try {
  // toUint8ArrayAsync() authorizes, meters and flushes usage automatically.
  await save("05-live-server.pdf", await doc.toUint8ArrayAsync());
  console.log("Generated 30 page(s) — metered by the server, no guard code involved.");
} catch (err) {
  const e = err as { code?: string; message?: string };
  console.log(`Blocked by the server: [${e.code}] ${e.message}`);
}
