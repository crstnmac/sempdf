/**
 * Demo 1 — Secure by default.
 *
 * With no license guard installed, no `ZEROPDF_LICENSE_KEY`, and the dev bypass
 * off, the library REFUSES to generate. This is the fail-closed posture: an
 * unlicensed deployment produces no PDFs, it does not silently fall back.
 *
 * Run:  npx tsx examples/01-no-license.ts
 */
import { banner, buildSampleDoc } from "./_shared.js";

// Make sure nothing in the ambient environment accidentally licenses this run.
delete process.env.ZEROPDF_LICENSE_KEY;
delete process.env.ZEROPDF_LICENSE_SERVER;
delete process.env.ZEROPDF_LICENSE_DEV;

banner("Demo 1: generation is blocked without a license");

const doc = buildSampleDoc("Should never be written", 1);
try {
  doc.toUint8Array();
  console.error("UNEXPECTED: generation succeeded without a license!");
  process.exit(1);
} catch (err) {
  const e = err as { code?: string; message?: string };
  console.log("Blocked as expected.");
  console.log(`  code:    ${e.code ?? "(none)"}`);
  console.log(`  message: ${e.message}`);
}
