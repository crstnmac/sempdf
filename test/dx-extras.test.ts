import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, PAGE_SIZES } from "../src/index.js";

test("createDocument shapeDefaults apply to page shape helpers and are overridable", () => {
  const doc = createDocument({ compress: false, shapeDefaults: { stroke: "blue", lineWidth: 3 } });
  const page = doc.addPage({ size: "A4" });
  page.rect(50, 600, 100, 40); // inherits blue + width 3
  page.rect(50, 500, 100, 40, { stroke: "red" }); // overrides color, keeps width 3

  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  assert.match(text, /0 0 1 RG/); // default blue stroke
  assert.match(text, /3 w/); // default line width
  assert.match(text, /1 0 0 RG/); // per-call red override
});

test("top-left origin flips annotation rectangles", () => {
  const height = PAGE_SIZES.A4.height;
  const doc = createDocument();
  const page = doc.addPage({ size: "A4", origin: "top-left" });
  page.link("https://example.com", { x: 50, y: 100, width: 80, height: 20, borderWidth: 0 });

  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  const match = /\/Rect \[\s*([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)\s*\]/.exec(text);
  assert.ok(match, "expected a /Rect on the link annotation");
  const x0 = Number(match![1]);
  const y0 = Number(match![2]);
  const x1 = Number(match![3]);
  const y1 = Number(match![4]);
  assert.equal(x0, 50);
  assert.equal(x1, 130);
  // y given is the top edge (100 from the top); PDF bottom = height - 100 - 20.
  assert.ok(Math.abs(y0 - (height - 100 - 20)) < 0.5, `bottom y ${y0}`);
  assert.ok(Math.abs(y1 - (height - 100)) < 0.5, `top y ${y1}`);
});

test("placeText returns width/height and a next-line endY", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "A4" });
  const result = page.placeText("Hello", { x: 56, y: 700, fontSize: 24 });

  assert.ok(result.width > 0);
  assert.equal(result.height, 24);
  assert.equal(result.endY, 700 - 24);
});

test("placeTextBlock returns block metrics and supports manual stacking", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "A4" });
  const a = page.placeTextBlock("A paragraph long enough to wrap onto more than one line here.", {
    x: 56,
    y: 760,
    width: 180,
    fontSize: 12,
    lineHeight: 16,
  });

  assert.ok(a.lineCount > 1);
  assert.equal(a.height, a.lineCount * 16);
  assert.equal(a.endY, 760 - a.height);
  assert.ok(a.width > 0, `expected a positive measured width, got ${a.width}`);
  assert.ok(a.width <= 200, `measured width must stay inside the box, got ${a.width}`);

  // Stacking the next block at the returned endY stays below the first.
  const b = page.placeTextBlock("Second.", { x: 56, y: a.endY - 8, width: 180, fontSize: 12, lineHeight: 16 });
  assert.ok(b.endY < a.endY);
});

test("top-left origin shifts placeTextBlock endY downward", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "A4", origin: "top-left" });
  const result = page.placeTextBlock("Top-left flowing copy that wraps for the test.", {
    x: 56,
    y: 56,
    width: 180,
    fontSize: 12,
    lineHeight: 16,
  });
  // y grows downward, so the block bottom is below the start.
  assert.equal(result.endY, 56 + result.height);
});
