import test from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "../src/index.js";

test("measureText returns positive width and font-size height", () => {
  const doc = createDocument();
  const metrics = doc.measureText("Hello", { fontSize: 24 });
  assert.ok(metrics.width > 0);
  assert.equal(metrics.height, 24);
});

test("measureText: longer text is wider; bold is at least as wide as regular", () => {
  const doc = createDocument();
  const short = doc.measureText("Hi", { fontSize: 18 });
  const long = doc.measureText("Hello, world!", { fontSize: 18 });
  assert.ok(long.width > short.width);

  const regular = doc.measureText("Heading", { fontSize: 18 });
  const bold = doc.measureText("Heading", { fontSize: 18, bold: true });
  assert.ok(bold.width >= regular.width);
});

test("measureTextBlock wraps long text across multiple lines", () => {
  const doc = createDocument();
  const longString =
    "The quick brown fox jumps over the lazy dog while measuring wrapped text";
  const metrics = doc.measureTextBlock(longString, {
    width: 120,
    fontSize: 12,
    lineHeight: 14
  });
  assert.ok(metrics.lineCount > 1);
  assert.equal(metrics.height, metrics.lineCount * 14);
  assert.ok(metrics.width > 0);
  // Allow a small slop because a single unbreakable word can exceed the width.
  assert.ok(metrics.width <= 120 * 1.5);
});

test("measureRichText measures a single-line styled paragraph", () => {
  const doc = createDocument();
  const metrics = doc.measureRichText(
    [{ text: "A " }, { text: "B", bold: true }],
    { width: 300, fontSize: 12 }
  );
  assert.equal(metrics.lineCount, 1);
  assert.ok(metrics.height > 0);
  assert.ok(metrics.width > 0);
});

test("measurement does not mutate the document", () => {
  const doc = createDocument();
  doc.measureText("Hello", { fontSize: 24 });
  doc.measureTextBlock("Some longer wrapped text here please", {
    width: 80,
    fontSize: 12,
    lineHeight: 14
  });
  doc.measureRichText([{ text: "A " }, { text: "B", bold: true }], {
    width: 300,
    fontSize: 12
  });

  // The document is still usable after measuring.
  const page = doc.addPage();
  page.text("Drawn after measuring", { x: 36, y: 700 });
  const bytes = doc.toUint8Array();
  assert.ok(bytes.length > 0);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^%PDF-/);
});
