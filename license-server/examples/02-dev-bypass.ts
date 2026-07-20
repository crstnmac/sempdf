/**
 * Demo 2 — Development bypass.
 *
 * Setting `SEMPDF_LICENSE_DEV=1` disables enforcement so developers can work
 * locally without a license key or a running license server. This is the ONLY
 * way to generate without a guard; it is meant for development/CI, never prod.
 * Output is still stamped "DEVELOPMENT - NOT FOR DISTRIBUTION" on every page —
 * the bypass removes metering, not the watermark.
 *
 * Run:  SEMPDF_LICENSE_DEV=1 npx tsx examples/02-dev-bypass.ts
 *   (or just `npx tsx examples/02-dev-bypass.ts` — this file sets it itself)
 */
import { banner, buildSampleDoc, save } from "./_shared.js";

process.env.SEMPDF_LICENSE_DEV = "1";
delete process.env.SEMPDF_LICENSE_KEY;

banner("Demo 2: SEMPDF_LICENSE_DEV bypass");

const doc = buildSampleDoc("Dev Bypass", 2);
const bytes = doc.toUint8Array();
console.log('Generated with the dev bypass (no metering; pages carry the "DEVELOPMENT - NOT FOR DISTRIBUTION" watermark).');
await save("02-dev-bypass.pdf", bytes);
