import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, color, rgb, PdfEngineError, PdfErrorCode } from "../src/index.js";

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

test("named colors resolve to RGB color objects", () => {
  assert.deepEqual(color("red"), { kind: "rgb", r: 1, g: 0, b: 0 });
  assert.deepEqual(color("white"), { kind: "rgb", r: 1, g: 1, b: 1 });

  const navy = color("navy");
  assert.equal(navy.kind, "rgb");
  assert.equal(navy.r, 0);
  assert.equal(navy.g, 0);
  assert.ok(Math.abs(navy.b - 128 / 255) < 1e-9, `navy blue channel was ${navy.b}`);
});

test("hex strings parse to RGB color objects", () => {
  const short = color("#0a7");
  const long = color("#00aa77");
  assert.equal(short.kind, "rgb");
  assert.deepEqual(short, long);
  assert.equal(short.r, 0);
  assert.ok(Math.abs(short.g - 0xaa / 255) < 1e-9);
  assert.ok(Math.abs(short.b - 0x77 / 255) < 1e-9);
});

test("unknown color names throw INVALID_COLOR", () => {
  assert.throws(
    () => color("notacolor"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COLOR,
  );
});

test("named color string used directly in text emits the fill color", () => {
  const doc = createDocument({ compress: false });
  const page = doc.addPage({ size: "Letter" });
  page.text("x", { x: 56, y: 700, color: "red" });

  const text = decodeLatin1(doc.toUint8Array());
  assert.match(text, /%PDF/);
  assert.match(text, /1 0 0 rg/);
});

test("named color string used directly in a shape fill emits the navy color", () => {
  const doc = createDocument({ compress: false });
  const page = doc.addPage({ size: "Letter" });
  page.rect(56, 600, 100, 40, { fill: "navy" });

  const text = decodeLatin1(doc.toUint8Array());
  assert.match(text, /%PDF/);
  // navy blue channel = 128/255 -> 0.501961 after PDF number formatting.
  assert.match(text, /0 0 0\.501961 rg/);
});

test("rgb() and color() agree for primary colors", () => {
  assert.deepEqual(color("red"), rgb(1, 0, 0));
});
