import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, extractPages, mergeDocuments } from "../src/index.js";

function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.slice(0, 16));
}

test("extractPages preserves source PDF version", () => {
  const src = createDocument({ objectStreams: true });
  src.addPage({ size: "A4" }).text("p1", { x: 10, y: 10 });
  src.addPage({ size: "A4" }).text("p2", { x: 10, y: 10 });
  const srcBytes = src.toUint8Array();
  assert.match(header(srcBytes), /^%PDF-1\.5/);

  const out = extractPages(srcBytes, [0]);
  assert.match(header(out), /^%PDF-1\.5/);
});

test("mergeDocuments uses max source version", () => {
  const a = createDocument();
  a.addPage({ size: "A4" }).text("a", { x: 10, y: 10 });
  const b = createDocument({ objectStreams: true });
  b.addPage({ size: "A4" }).text("b", { x: 10, y: 10 });

  const merged = mergeDocuments([a.toUint8Array(), b.toUint8Array()]);
  assert.match(header(merged), /^%PDF-1\.5/);
});
