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

test("retrying the same document after a rejected attempt re-checks the guard (no free bypass)", () => {
  // A prior version marked the document "finalized" before the guard ran, so
  // a rejected first call (quota exceeded, blocked license) left the
  // document able to serialize on retry with NO further guard check at all —
  // free, unmetered, unwatermarked output. The guard must run again on every
  // retry until one actually succeeds.
  let calls = 0;
  setLicenseGuard({
    consume() {
      calls++;
      if (calls === 1) throw licenseQuotaError("blocked");
    },
  });
  const doc = createDocument({ title: "t" });
  doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  assert.throws(() => doc.toUint8Array(), (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED);
  doc.toUint8Array(); // second attempt: guard allows it now
  assert.equal(calls, 2);
});

test("writeTo: retrying after a rejected attempt re-checks the guard (no free bypass)", async () => {
  let calls = 0;
  setLicenseGuard({
    consume() {
      calls++;
      if (calls === 1) throw licenseQuotaError("blocked");
    },
  });
  const doc = createDocument({ title: "t" });
  doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  const chunks: Uint8Array[] = [];
  const sink = { write: async (c: Uint8Array) => { chunks.push(c); }, close: async () => {} };
  await assert.rejects(() => doc.writeTo(sink), (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED);
  await doc.writeTo(sink); // second attempt: guard allows it now
  assert.equal(calls, 2);
  assert.ok(chunks.length > 0);
});

test("a sync output method cannot interleave with an in-flight writeTo() on the same document", async () => {
  // writeTo() is async: it stays un-finalized across an await gap (license
  // authorization) before it actually charges the guard. A prior version let
  // toUint8Array()/toArrayBuffer()/toBlob() run freely during that gap, each
  // fully serializing and charging independently — one logical document,
  // billed twice. The reentrancy guard writeTo() already used against itself
  // must also block the synchronous methods.
  let calls = 0;
  setLicenseGuard({ consume() { calls++; } });
  const doc = createDocument({ title: "t" });
  doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  const sink = { write: async () => {}, close: async () => {} };

  const writePromise = doc.writeTo(sink); // not awaited — still mid-flight
  assert.throws(
    () => doc.toUint8Array(),
    (e: unknown) => (e as { code?: string }).code === PdfErrorCode.INVALID_OPERATION,
  );
  await writePromise;
  assert.equal(calls, 1);
});

test("watermark reuses an embedded font so conformance profiles stay valid", async () => {
  const { readFile } = await import("node:fs/promises");
  // Resolved from the repo root: the compiled test runs from dist/test, where
  // an import.meta.url-relative path would miss the fonts/ directory.
  const bytes = new Uint8Array(await readFile("fonts/liberation/LiberationSans-Regular.ttf"));
  setLicenseGuard({ consume() {} }); // unverified guard → forced UNLICENSED watermark

  // PDF/UA-1 requires embedded fonts for all visible text; the watermark must
  // not reintroduce a built-in font and fail validation.
  const doc = createDocument({ title: "t", language: "en-US", conformance: "pdfua-1", compress: false });
  const sans = doc.registerFontFamily("Sans", { regular: bytes });
  doc.addPage({ size: "A4" }).text("customer content", { x: 24, y: 700, font: sans, tag: "P" });
  const pdf = new TextDecoder("latin1").decode(doc.toUint8Array());
  assert.doesNotMatch(pdf, /Helvetica-Bold/);

  // Without any embedded font the watermark still falls back to Helvetica-Bold.
  const plain = createDocument({ title: "t", compress: false });
  plain.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  assert.match(new TextDecoder("latin1").decode(plain.toUint8Array()), /Helvetica-Bold/);
});
