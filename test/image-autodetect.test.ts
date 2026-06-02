import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, PdfEngineError, PdfErrorCode } from "../src/index.js";

// A 1x1 PNG, inlined so the test has no filesystem dependency (matches the
// convention in images.test.ts and works regardless of cwd / build output dir).
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC";

function tinyPngBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));
}

test("auto-detects a PNG and embeds it as an image XObject", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.image(tinyPngBytes(), { x: 56, y: 600, width: 120, height: 60, altText: "logo" });

  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  assert.match(text, /^%PDF/);
  // Object dictionary entries are not compressed and remain visible.
  assert.match(text, /\/Subtype \/Image/);
});

test("unknown raster format throws UNSUPPORTED_IMAGE_FORMAT", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });

  assert.throws(
    () =>
      page.image(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), {
        x: 1,
        y: 1,
        width: 10,
        height: 10,
      }),
    (error: unknown) =>
      error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT,
  );
});

test("image() is chainable and returns the page instance", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });

  const returned = page.image(tinyPngBytes(), { x: 56, y: 600, width: 120, height: 60 });
  assert.equal(returned, page);
});
