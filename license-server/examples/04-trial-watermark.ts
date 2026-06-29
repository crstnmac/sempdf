/**
 * Demo 4 — Trial watermark (driven by the license, not by app code).
 *
 * Nothing here sets a watermark. On a TRIAL license the server's authorize
 * response carries `watermark: true` and the watermark text; the library's
 * auto-guard applies it, so every generated page is stamped automatically. This
 * is the real path — the watermark comes from the license, not from the caller.
 *
 * Setup: start the API (apps/api: npm run dev) and use a TRIAL license key
 * (sign up on the portal — it auto-provisions a trial). Then:
 *
 *   A11YDOCS_LICENSE_SERVER=http://localhost:8787 \
 *   A11YDOCS_LICENSE_KEY=<trial-key> \
 *   npx tsx examples/04-trial-watermark.ts
 *
 * Open examples/out/04-trial-watermark.pdf — every page is watermarked.
 */
import { checkout, shutdownAutoGuard } from "../../src/license-guard.js";
import { banner, buildSampleDoc, save } from "./_shared.js";

const key = process.env.A11YDOCS_LICENSE_KEY;
if (!key) {
  console.error("Set A11YDOCS_LICENSE_KEY to a TRIAL key (and A11YDOCS_LICENSE_SERVER). See the header.");
  process.exit(1);
}

banner("Demo 4: trial watermark applied from the license");

// Pre-authorize with the server; on a trial it responds watermark:true and the
// auto-guard records the watermark for the library to stamp.
await checkout(3);

const doc = buildSampleDoc("Trial Output", 3);
const bytes = doc.toUint8Array();
console.log("Generated. If the key is a trial, every page is watermarked by the license.");
await save("04-trial-watermark.pdf", bytes);

shutdownAutoGuard();
await new Promise((r) => setTimeout(r, 1000));
