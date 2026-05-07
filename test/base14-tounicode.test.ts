import test from "node:test";
import assert from "node:assert/strict";

import { createDocument } from "../src/index.js";

test("tagged document emits ToUnicode CMap for built-in fonts", () => {
  const doc = createDocument({ tagged: true });
  doc.addPage({ size: "A4" }).text("hi", { x: 10, y: 10, tag: "P" });
  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/BaseFont \/Helvetica\b[\s\S]*?\/ToUnicode \d+ 0 R/);
  assert.match(text, /beginbfrange/);
  assert.match(text, /<20> <7E> <0020>/);
});

test("non-tagged document does NOT emit ToUnicode for built-in fonts", () => {
  const doc = createDocument();
  doc.addPage({ size: "A4" }).text("hi", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/BaseFont \/Helvetica\b/);
  assert.equal(/\/BaseFont \/Helvetica\b[\s\S]{0,80}\/ToUnicode/.test(text), false);
});
