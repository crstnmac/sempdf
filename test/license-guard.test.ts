import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, PdfErrorCode } from "../src/index.js";
import { setLicenseGuard, licenseQuotaError, isLicenseDevBypass, type LicenseGuard } from "../src/license-guard.js";

function genOnePdf(): void {
  const doc = createDocument({ title: "t" });
  doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  doc.toUint8Array();
}

/** Runs `fn` with the dev bypass forced off, then restores the env. */
function withBypassOff<T>(fn: () => T): T {
  const prev = process.env.SEMPDF_LICENSE_DEV;
  delete process.env.SEMPDF_LICENSE_DEV;
  try {
    return fn();
  } finally {
    if (prev !== undefined) process.env.SEMPDF_LICENSE_DEV = prev;
  }
}

test.afterEach(() => setLicenseGuard(undefined));

test("dev bypass allows generation without a guard", () => {
  // The test suite runs with SEMPDF_LICENSE_DEV=1.
  assert.equal(isLicenseDevBypass(), true);
  genOnePdf();
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

test("a guard can request a visible watermark on generated pages", () => {
  setLicenseGuard({ consume: () => ({ watermarkText: "Trial Mode" }) });
  const doc = createDocument({ title: "t", compress: false });
  doc.addPage({ size: "A4" }).text("customer content", { x: 24, y: 700 });
  const pdf = new TextDecoder("latin1").decode(doc.toUint8Array());
  assert.match(pdf, /Trial Mode/);
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
