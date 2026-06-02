import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, PAGE_SIZES, PdfEngineError, PdfErrorCode } from "../src/index.js";

const A4 = PAGE_SIZES.A4;
const A4_HEIGHT = Math.max(A4.width, A4.height);

function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function extractBaselineY(content: string): number {
  const match = /1 0 0 1 [\d.]+ ([\d.]+) Tm/.exec(content);
  assert.ok(match, `expected a Tm operator in content: ${content.slice(0, 200)}`);
  return Number(match[1]);
}

function extractRect(content: string): { x: number; y: number; w: number; h: number } {
  const match = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/.exec(content);
  assert.ok(match, `expected an re operator in content: ${content.slice(0, 200)}`);
  return { x: Number(match[1]), y: Number(match[2]), w: Number(match[3]), h: Number(match[4]) };
}

test("top-left origin flips the text baseline y for the same given y", () => {
  const bottomDoc = createDocument({ compress: false });
  bottomDoc.addPage({ size: "A4" }).text("Origin", { x: 50, y: 50, fontSize: 12 });
  const bottomText = latin1(bottomDoc.toUint8Array());

  const topDoc = createDocument({ compress: false });
  topDoc.addPage({ size: "A4", origin: "top-left" }).text("Origin", { x: 50, y: 50, fontSize: 12 });
  const topText = latin1(topDoc.toUint8Array());

  const bottomBaseline = extractBaselineY(bottomText);
  const topBaseline = extractBaselineY(topText);

  // Default origin keeps the baseline at the given y.
  assert.ok(Math.abs(bottomBaseline - 50) < 0.5, `bottom-left baseline ${bottomBaseline} should be ~50`);
  // Top-left flips: baseline grows downward from the top, so y -> pageHeight - y.
  assert.ok(
    Math.abs(topBaseline - (A4_HEIGHT - 50)) < 0.5,
    `top-left baseline ${topBaseline} should be ~${A4_HEIGHT - 50}`,
  );
  // For A4 with y=50 this is ~791.89.
  assert.ok(Math.abs(topBaseline - 791.89) < 0.5, `top-left baseline ${topBaseline} should be ~791.89`);

  assert.match(bottomText, /^%PDF/);
  assert.match(topText, /^%PDF/);
});

test("top-left rect treats y as the top edge and emits a flipped bottom-left corner", () => {
  const x = 40;
  const y = 60;
  const w = 100;
  const h = 30;

  const topDoc = createDocument({ compress: false });
  topDoc.addPage({ size: "A4", origin: "top-left" }).rect(x, y, w, h);
  const topRect = extractRect(latin1(topDoc.toUint8Array()));

  const bottomDoc = createDocument({ compress: false });
  bottomDoc.addPage({ size: "A4" }).rect(x, y, w, h);
  const bottomRect = extractRect(latin1(bottomDoc.toUint8Array()));

  // x, width and height are unchanged; only the PDF y (bottom-left corner) flips.
  assert.equal(topRect.x, x);
  assert.equal(topRect.w, w);
  assert.equal(topRect.h, h);
  // y is the TOP edge, so the emitted bottom-left corner is pageHeight - y - h.
  assert.ok(
    Math.abs(topRect.y - (A4_HEIGHT - y - h)) < 0.5,
    `top-left rect y ${topRect.y} should be ~${A4_HEIGHT - y - h}`,
  );

  // The default origin leaves the rect coordinates untouched.
  assert.equal(bottomRect.y, y);

  assert.match(latin1(topDoc.toUint8Array()), /^%PDF/);
});

test("top-left origin produces a valid PDF and leaves bottom-left as the default", () => {
  const doc = createDocument();
  doc.addPage({ size: "A4", origin: "top-left" }).text("Top", { x: 50, y: 50 });
  doc.addPage({ size: "A4" }).text("Bottom", { x: 50, y: 50 });

  const bytes = doc.toUint8Array();
  assert.match(latin1(bytes), /^%PDF/);

  // Sanity: the helpers and error types stay importable alongside this suite.
  assert.equal(typeof PdfEngineError, "function");
  assert.equal(typeof PdfErrorCode.INVALID_FONT, "string");
});
