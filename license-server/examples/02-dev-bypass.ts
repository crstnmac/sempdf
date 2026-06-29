/**
 * Demo 2 — Development bypass.
 *
 * Setting `A11YDOCS_LICENSE_DEV=1` disables enforcement so developers can work
 * locally without a license key or a running license server. This is the ONLY
 * way to generate without a guard; it is meant for development/CI, never prod.
 *
 * Run:  A11YDOCS_LICENSE_DEV=1 npx tsx examples/02-dev-bypass.ts
 *   (or just `npx tsx examples/02-dev-bypass.ts` — this file sets it itself)
 */
import { banner, buildSampleDoc, save } from "./_shared.js";

process.env.A11YDOCS_LICENSE_DEV = "1";
delete process.env.A11YDOCS_LICENSE_KEY;

banner("Demo 2: A11YDOCS_LICENSE_DEV bypass");

const doc = buildSampleDoc("Dev Bypass", 2);
const bytes = doc.toUint8Array();
console.log("Generated with the dev bypass (no metering, no watermark).");
await save("02-dev-bypass.pdf", bytes);
