import test from "node:test";
import assert from "node:assert/strict";

import { createDocument } from "../src/index.js";
import { liberationFixture } from "./font-preset.js";

/**
 * A character outside WinAnsi: the built-in fonts cannot encode it, the
 * bundled Liberation families can. Any path that reaches the fallback renders;
 * any path that misses it throws UNSUPPORTED_CHARACTER.
 */
const OUT_OF_RANGE = "ĉ"; // ĉ

async function documentWithDefaultFallback() {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    defaults: { font: "Helvetica", fallbackFonts: ["Liberation Sans"] },
  });
  await doc.fonts({ ...liberationFixture, default: "Helvetica", fallbacks: ["Liberation Sans"] });
  return doc;
}

test("defaults.fallbackFonts covers every text path", async () => {
  const doc = await documentWithDefaultFallback();
  const flow = doc.addPage().flow();
  const text = `mark ${OUT_OF_RANGE} here`;

  // Each of these resolves its own options; a path that ignores the document
  // default throws instead of drawing.
  flow.paragraph(text);
  flow.heading(text, { level: 2 });
  flow.code(`// ${OUT_OF_RANGE}\nconst x = 1;`);
  flow.list([text], {});
  flow.table([[text, text]]);
  flow.richParagraph([{ text }]);
  flow.html(`<p>inline <code>${OUT_OF_RANGE}</code> run</p>`);

  assert.ok(doc.toUint8Array().length > 0);
});

test("defaults.fallbackFonts reaches page-level text, lists, and tables", async () => {
  const doc = await documentWithDefaultFallback();
  const page = doc.addPage();
  page.text(`page ${OUT_OF_RANGE}`, { x: 36, y: 720, tag: "P" });
  page.list([`item ${OUT_OF_RANGE}`], { x: 36, y: 690, width: 300 });
  page.table([[`cell ${OUT_OF_RANGE}`]], { x: 36, y: 600, width: 300 });
  page.container("Sect", (c) => {
    c.text(`nested ${OUT_OF_RANGE}`, { x: 36, y: 540 });
  });

  assert.ok(doc.toUint8Array().length > 0);
});

test("a per-call fallbackFonts list overrides the document default", async () => {
  const doc = await documentWithDefaultFallback();
  const flow = doc.addPage().flow();
  // An explicit empty list opts out, so the unencodable character has nowhere
  // to go and the error names it.
  assert.throws(
    () => flow.paragraph(`mark ${OUT_OF_RANGE}`, { fallbackFonts: [] }),
    (error: unknown) =>
      error instanceof Error && error.message.includes("U+0109"),
  );
});

test("without the default, the same text is rejected", () => {
  const doc = createDocument({ tagged: true, language: "en-US", defaults: { font: "Helvetica" } });
  const flow = doc.addPage().flow();
  assert.throws(
    () => flow.paragraph(`mark ${OUT_OF_RANGE}`),
    (error: unknown) => error instanceof Error && error.message.includes("U+0109"),
  );
});
