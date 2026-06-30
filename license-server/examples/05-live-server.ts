/**
 * Demo 5 — End-to-end against the real license server (auto-guard).
 *
 * This is the production path: with `A11YDOCS_LICENSE_KEY` set (and a server URL
 * baked in at build time, or `A11YDOCS_LICENSE_SERVER` provided), the library
 * installs its auto-guard on first generation — no client code required. It
 * leases pages from POST /v1/authorize, debits as you generate, and flushes
 * reconciled usage to POST /v1/usage. Job context is attached for telemetry.
 *
 * Setup:
 *   1. Start the API:        (in apps/api)  npm run dev
 *   2. Create a license and copy its key — via the portal trial, or the admin
 *      "Create license" action. Then:
 *
 *   A11YDOCS_LICENSE_SERVER=http://localhost:8787 \
 *   A11YDOCS_LICENSE_KEY=<your-key> \
 *   npx tsx examples/05-live-server.ts
 *
 * Watch it in the operator dashboard (Recent telemetry) and on the org portal
 * (Page usage, Recent activity). Generate enough pages to cross 90/95/100% and
 * you will see the usage alerts queued and, at 100%, generation hard-blocked.
 */
import { checkout, setJobContext, shutdownAutoGuard } from "../../src/license-guard.js";
import { banner, buildSampleDoc, save } from "./_shared.js";

const key = process.env.A11YDOCS_LICENSE_KEY;
const server = process.env.A11YDOCS_LICENSE_SERVER;
if (!key) {
  console.error("Set A11YDOCS_LICENSE_KEY (and A11YDOCS_LICENSE_SERVER) first. See the header of this file.");
  process.exit(1);
}

banner(`Demo 5: live metering against ${server ?? "(baked server URL)"}`);

// Attach job metadata — surfaces in the telemetry tables as job id / description.
setJobContext({ id: `demo-${Date.now()}`, description: "License demo batch" });

const BATCHES = Number(process.env.DEMO_BATCHES ?? 500);
const PAGES_PER_BATCH = Number(process.env.DEMO_PAGES ?? 5000);

let generated = 0;
for (let i = 1; i <= BATCHES; i++) {
  try {
    // Pre-authorize the batch synchronously with the server. The server charges
    // the pages now and rejects here once the limit is reached (hard block).
    const remaining = await checkout(PAGES_PER_BATCH);
    console.log(`Batch ${i}: authorized ${PAGES_PER_BATCH} page(s); lease now ${remaining}.`);

    const doc = buildSampleDoc(`Live batch ${i}`, PAGES_PER_BATCH);
    const bytes = doc.toUint8Array();
    generated += PAGES_PER_BATCH;
    await save(`05-live-batch-${i}.pdf`, bytes);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.log(`Batch ${i} blocked by the server: [${e.code}] ${e.message}`);
    break;
  }
}

console.log(`\nGenerated ${generated} page(s). Flushing usage to the server...`);
// Flush any buffered usage and tear down the background timer before exit.
shutdownAutoGuard();
// Give the final flush a moment to reach the server.
await new Promise((r) => setTimeout(r, 1500));
console.log("Done. Check the dashboard / portal for telemetry and usage.");
