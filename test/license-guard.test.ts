import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, PdfErrorCode } from "../src/index.js";
import { setLicenseGuard, licenseQuotaError, isLicenseDevBypass, type LicenseGuard } from "../src/license-guard.js";
import { setVerifiedLicenseGuard } from "../src/internal/license-guard.js";

function genOnePdf(): void {
  const doc = createDocument({ title: "t" });
  doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  doc.toUint8Array();
}

function pdfText(): string {
  const doc = createDocument({ title: "t", compress: false });
  doc.addPage({ size: "A4" }).text("customer content", { x: 24, y: 700 });
  return new TextDecoder("latin1").decode(doc.toUint8Array());
}

/** Runs `fn` with the dev bypass forced off, then restores the env. */
function withBypassOff<T>(fn: () => T): T {
  const prev = process.env.ZEROPDF_LICENSE_DEV;
  delete process.env.ZEROPDF_LICENSE_DEV;
  try {
    return fn();
  } finally {
    if (prev !== undefined) process.env.ZEROPDF_LICENSE_DEV = prev;
  }
}

test.afterEach(() => setLicenseGuard(undefined));

test("dev bypass allows generation without a guard, with a DEVELOPMENT watermark", () => {
  // The suite runs with ZEROPDF_LICENSE_DEV=1 but preloads a verified guard
  // (license-setup.ts); clear it to exercise the bare bypass.
  setLicenseGuard(undefined);
  assert.equal(isLicenseDevBypass(), true);
  assert.match(pdfText(), /DEVELOPMENT/);
});

test("secure by default: no guard and bypass off throws LICENSE_REQUIRED", () => {
  withBypassOff(() => {
    assert.equal(isLicenseDevBypass(), false);
    assert.throws(genOnePdf, (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_REQUIRED);
  });
});

test("an installed guard receives documents and pages, once per document", () => {
  let documents = 0;
  let pages = 0;
  setLicenseGuard({ consume: (u) => { documents += u.documents; pages += u.pages; } });
  withBypassOff(() => {
    // Two documents of 1 and 3 pages.
    const a = createDocument({ title: "a" });
    a.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
    a.toUint8Array();
    const b = createDocument({ title: "b" });
    for (let i = 0; i < 3; i += 1) b.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
    b.toUint8Array();
  });
  assert.equal(documents, 2);
  assert.equal(pages, 4);
});

test("a throwing guard blocks generation", () => {
  let budget = 1;
  const guard: LicenseGuard = {
    consume: (u) => {
      if (budget < u.documents) throw licenseQuotaError("out of budget");
      budget -= u.documents;
    },
  };
  setLicenseGuard(guard);
  genOnePdf();
  assert.throws(genOnePdf, (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED);
});

test("an unverified guard is always stamped UNLICENSED, even with custom text", () => {
  // Public setLicenseGuard() is the unverified path: the guard's own watermark
  // text is overridden by the fixed unlicensed mark so a permissive guard
  // cannot produce clean (or blank-marked) output.
  setLicenseGuard({ consume: () => ({ watermarkText: "Trial Mode" }) });
  const pdf = pdfText();
  assert.match(pdf, /UNLICENSED/);
  assert.doesNotMatch(pdf, /Trial Mode/);
});

test("a permissive unverified guard (playground-style) is watermarked", () => {
  setLicenseGuard({ consume() {} });
  assert.match(pdfText(), /UNLICENSED/);
});

test("a verified guard controls its own watermark", () => {
  // Server-backed path: custom watermark (trial/over-limit) passes through…
  setVerifiedLicenseGuard({ consume: () => ({ watermarkText: "Trial Mode" }) });
  const trial = pdfText();
  assert.match(trial, /Trial Mode/);
  assert.doesNotMatch(trial, /UNLICENSED/);
  // …and a fully licensed run is clean.
  setVerifiedLicenseGuard({ consume() {} });
  assert.doesNotMatch(pdfText(), /UNLICENSED|DEVELOPMENT|Trial Mode/);
});

test("re-serializing the same document does not double-count", () => {
  let documents = 0;
  setLicenseGuard({ consume: (u) => { documents += u.documents; } });
  const doc = createDocument({ title: "t" });
  doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  doc.toUint8Array();
  doc.toUint8Array(); // cached; no new serialize
  assert.equal(documents, 1);
});
