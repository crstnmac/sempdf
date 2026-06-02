import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, rgb } from "../src/index.js";

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

test("shape helpers are chainable and return the page instance", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });

  assert.equal(page.rect(36, 700, 100, 40), page);
  assert.equal(page.line(36, 690, 200, 690), page);
  assert.equal(page.circle(100, 600, 30), page);
  assert.equal(page.ellipse(200, 600, 40, 20), page);

  // Chained calls keep returning the same page instance.
  const chained = page
    .rect(36, 500, 50, 50)
    .line(36, 480, 100, 480)
    .circle(150, 500, 20)
    .ellipse(220, 500, 30, 15);
  assert.equal(chained, page);
});

test("rect with fill emits a rectangle, fill operator, and fill color", () => {
  const doc = createDocument({ compress: false });
  const page = doc.addPage({ size: "Letter" });
  page.rect(36, 700, 120, 60, { fill: rgb(1, 1, 0) });

  const text = decodeLatin1(doc.toUint8Array());
  assert.match(text, /%PDF/);
  // Rectangle path operator.
  assert.match(text, /\bre\b/);
  // Fill paint operator.
  assert.match(text, /\bf\b/);
  // Yellow fill color (non-stroking RGB).
  assert.match(text, /1 1 0 rg/);
});

test("rect with stroke emits stroke color, line width, and stroke operator", () => {
  const doc = createDocument({ compress: false });
  const page = doc.addPage({ size: "Letter" });
  page.rect(36, 600, 120, 60, { stroke: rgb(1, 0, 0), lineWidth: 2 });

  const text = decodeLatin1(doc.toUint8Array());
  assert.match(text, /%PDF/);
  assert.match(text, /\bre\b/);
  // Stroke color (stroking RGB).
  assert.match(text, /1 0 0 RG/);
  // Line width.
  assert.match(text, /\b2 w\b/);
  // Stroke paint operator.
  assert.match(text, /\bS\b/);
});

test("line with stroke styling emits path and stroke operators", () => {
  const doc = createDocument({ compress: false });
  const page = doc.addPage({ size: "Letter" });
  page.line(36, 500, 300, 500, { stroke: rgb(1, 0, 0), lineWidth: 2 });

  const text = decodeLatin1(doc.toUint8Array());
  assert.match(text, /%PDF/);
  // moveTo / lineTo operators.
  assert.match(text, /\bm\b/);
  assert.match(text, /\bl\b/);
  assert.match(text, /1 0 0 RG/);
  assert.match(text, /\b2 w\b/);
  assert.match(text, /\bS\b/);
});

test("circle and ellipse emit cubic-Bezier curve operators and a valid PDF", () => {
  const circleDoc = createDocument({ compress: false });
  circleDoc.addPage({ size: "Letter" }).circle(150, 500, 40, { stroke: rgb(0, 0, 1) });
  const circleText = decodeLatin1(circleDoc.toUint8Array());
  assert.match(circleText, /%PDF/);
  assert.match(circleText, /\bc\b/);

  const ellipseDoc = createDocument({ compress: false });
  ellipseDoc.addPage({ size: "Letter" }).ellipse(150, 500, 60, 30, { fill: rgb(0, 1, 0) });
  const ellipseText = decodeLatin1(ellipseDoc.toUint8Array());
  assert.match(ellipseText, /%PDF/);
  assert.match(ellipseText, /\bc\b/);
});

test("fill plus stroke infers the fill-stroke paint operator", () => {
  const doc = createDocument({ compress: false });
  const page = doc.addPage({ size: "Letter" });
  page.rect(36, 400, 120, 60, { fill: rgb(1, 1, 0), stroke: rgb(1, 0, 0), lineWidth: 1 });

  const text = decodeLatin1(doc.toUint8Array());
  assert.match(text, /%PDF/);
  assert.match(text, /\bre\b/);
  assert.match(text, /1 1 0 rg/);
  assert.match(text, /1 0 0 RG/);
  // fillStroke paints with B (or close-and-fill-stroke b).
  assert.match(text, /\b[Bb]\b/);
});
