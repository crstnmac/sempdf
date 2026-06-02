import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, PdfEngineError, PdfErrorCode } from "../src/index.js";
import type { PageSize } from "../src/index.js";

test("PdfStructureContainer builder methods are chainable", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "A4" });
  const container = page.container("Sect");

  const returned = container
    .text("a", { x: 50, y: 700 })
    .text("b", { x: 50, y: 680 })
    .rect(50, 600, 100, 40, { stroke: "red" })
    .line(50, 590, 150, 590)
    .circle(100, 520, 20, { fill: "blue" })
    .ellipse(100, 460, 30, 15);

  assert.equal(returned, container);
  assert.match(new TextDecoder("latin1").decode(doc.toUint8Array()), /^%PDF/);
});

test("PdfFlow exposes chainable ellipse and line helpers", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "A4" });
  const flow = page.flow({ x: 56, y: 760, width: 400 });

  const returned = flow.rect(56, 740, 80, 30).ellipse().line(56, 700, 300, 700);

  assert.equal(returned, flow);
  assert.match(new TextDecoder("latin1").decode(doc.toUint8Array()), /^%PDF/);
});

test("unknown page-size name throws INVALID_PAGE_SIZE with a suggestion", () => {
  const cases: ReadonlyArray<{ bad: string; suggestion: string }> = [
    { bad: "letter", suggestion: "Letter" },
    { bad: "Legel", suggestion: "Legal" },
  ];
  for (const { bad, suggestion } of cases) {
    assert.throws(
      () => createDocument().addPage({ size: bad as PageSize }),
      (error: unknown) =>
        error instanceof PdfEngineError &&
        error.code === PdfErrorCode.INVALID_PAGE_SIZE &&
        error.message.includes(`Did you mean "${suggestion}"`),
      `expected "${bad}" to suggest "${suggestion}"`,
    );
  }
});

test("registerFontFamily resolves built-in face names", () => {
  const doc = createDocument();
  const family = doc.registerFontFamily("Fam", { regular: "Courier", bold: "Courier-Bold" });
  const page = doc.addPage({ size: "A4" });
  page.text("plain", { x: 56, y: 700, font: family });
  page.text("bold", { x: 56, y: 680, font: family, bold: true });

  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  assert.match(text, /\/Courier-Bold/);
  assert.match(text, /\/Courier\b/);
});
