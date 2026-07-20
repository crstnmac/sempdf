/**
 * Demo 3 — Page metering and the hard block at the limit.
 *
 * Installs a custom guard with a fixed page quota to demonstrate the server's
 * enforcement model locally and deterministically (no running server needed).
 * It mirrors production policy: pages are charged per generation, and once the
 * limit is reached generation is hard-blocked — there is no grace period.
 *
 * Note: guards installed via the public setLicenseGuard() are UNVERIFIED, so
 * every page this demo produces is stamped "UNLICENSED - EVALUATION ONLY".
 * Watermark-free output requires the server-backed auto-guard (demo 5) or a
 * server-signed install proof (setLicenseGuardWithProof).
 *
 * Run:  npx tsx examples/03-custom-guard-quota.ts
 */
import {
  licenseQuotaError,
  setLicenseGuard,
  type GenerationUsage,
} from "../../src/license-guard.js";
import { banner, buildSampleDoc, save } from "./_shared.js";

const PAGE_LIMIT = 10;
let used = 0;

// A minimal stand-in for the real auto-guard: charge pages up front, block at
// 100%. The run that crosses the limit completes (it is checked pre-charge);
// the next run is rejected — exactly the reserve-as-charge behavior.
setLicenseGuard({
  consume(usage: GenerationUsage) {
    if (used >= PAGE_LIMIT) {
      throw licenseQuotaError(`Page limit reached: ${used}/${PAGE_LIMIT} used.`, {
        remaining: Math.max(0, PAGE_LIMIT - used),
      });
    }
    used += usage.pages;
    console.log(`  charged ${usage.pages} page(s); meter now ${used}/${PAGE_LIMIT}`);
  },
});

banner(`Demo 3: metering against a ${PAGE_LIMIT}-page limit`);

for (let attempt = 1; attempt <= 5; attempt++) {
  const doc = buildSampleDoc(`Metered batch ${attempt}`, 3);
  try {
    const bytes = doc.toUint8Array();
    await save(`03-batch-${attempt}.pdf`, bytes);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.log(`Attempt ${attempt} blocked: [${e.code}] ${e.message}`);
    break;
  }
}
