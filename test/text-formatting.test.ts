import test from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "../src/index.js";

/** Serializes a document with compression disabled and decodes operators as latin1. */
function operators(build: (doc: ReturnType<typeof createDocument>) => void): string {
  const doc = createDocument({ compress: false });
  build(doc);
  return new TextDecoder("latin1").decode(doc.toUint8Array());
}

/** Counts non-overlapping occurrences of a substring. */
function count(haystack: string, needle: string): number {
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

test("superscript emits a positive text rise and resets it", () => {
  const out = operators((doc) => {
    doc.addPage().text("2", { x: 56, y: 700, fontSize: 12, superscript: true });
  });
  // 12 * 0.33 = 3.96 up, then reset to 0 so later text is unaffected.
  assert.match(out, /3\.96 Ts/);
  assert.match(out, /0 Ts/);
});

test("subscript emits a negative text rise", () => {
  const out = operators((doc) => {
    doc.addPage().text("2", { x: 56, y: 700, fontSize: 12, subscript: true });
  });
  assert.match(out, /-2\.16 Ts/);
  assert.match(out, /0 Ts/);
});

test("explicit rise overrides the superscript default", () => {
  const out = operators((doc) => {
    doc.addPage().text("x", { x: 56, y: 700, superscript: true, rise: 5 });
  });
  assert.match(out, /5 Ts/);
});

test("stroke render mode emits Tr 1 with stroke width and resets to fill", () => {
  const out = operators((doc) => {
    doc.addPage().text("Outline", {
      x: 56,
      y: 700,
      renderMode: "stroke",
      strokeWidth: 0.5,
      strokeColor: { kind: "rgb", r: 1, g: 0, b: 0 },
    });
  });
  assert.match(out, /1 Tr/);
  assert.match(out, /0\.5 w/);
  assert.match(out, /0 Tr/); // reset so following text isn't stroked
});

test("invisible render mode emits Tr 3", () => {
  const out = operators((doc) => {
    doc.addPage().text("hidden", { x: 56, y: 700, renderMode: "invisible" });
  });
  assert.match(out, /3 Tr/);
  assert.match(out, /0 Tr/);
});

test("fill render mode (default) emits no Tr operator", () => {
  const out = operators((doc) => {
    doc.addPage().text("plain", { x: 56, y: 700, renderMode: "fill" });
  });
  assert.equal(count(out, " Tr"), 0);
});

test("horizontal scaling emits Tz and resets to 100", () => {
  const out = operators((doc) => {
    doc.addPage().text("condensed", { x: 56, y: 700, horizontalScaling: 75 });
  });
  assert.match(out, /75 Tz/);
  assert.match(out, /100 Tz/); // reset
});

test("measureText scales width by horizontalScaling", () => {
  const doc = createDocument();
  const normal = doc.measureText("condensed", { fontSize: 20 }).width;
  const half = doc.measureText("condensed", { fontSize: 20, horizontalScaling: 50 }).width;
  // Tz scales all horizontal advance uniformly, so 50% => exactly half the width.
  assert.ok(Math.abs(half - normal * 0.5) < 1e-6, `expected ${normal * 0.5}, got ${half}`);
});

test("condensed text wraps fewer lines than normal for the same width", () => {
  const doc = createDocument();
  const text = "The quick brown fox jumps over the lazy dog again and again and again";
  const normal = doc.measureTextBlock(text, { width: 200, fontSize: 12 });
  const condensed = doc.measureTextBlock(text, { width: 200, fontSize: 12, horizontalScaling: 50 });
  // Half-width glyphs fit more per line, so wrapping produces fewer lines.
  assert.ok(condensed.lineCount < normal.lineCount, `normal=${normal.lineCount} condensed=${condensed.lineCount}`);
});

test("highlight draws a filled rectangle behind the text", () => {
  const plain = operators((doc) => {
    doc.addPage().text("Highlighted", { x: 56, y: 700 });
  });
  const highlighted = operators((doc) => {
    doc.addPage().text("Highlighted", {
      x: 56,
      y: 700,
      highlight: { kind: "rgb", r: 1, g: 1, b: 0 },
    });
  });
  // The highlight is a filled path tagged as an Artifact; plain text has none.
  assert.ok(count(highlighted, "\nf\n") > count(plain, "\nf\n"));
  assert.match(highlighted, /\/Artifact/);
});

test("rich-text run honors superscript and highlight", () => {
  const out = operators((doc) => {
    doc.addPage().richText(
      [
        { text: "E = mc" },
        { text: "2", superscript: true },
        { text: " highlighted", highlight: { kind: "rgb", r: 0, g: 1, b: 1 } },
      ],
      { x: 56, y: 660, width: 300, fontSize: 14 },
    );
  });
  assert.match(out, / Ts/); // superscript rise on the exponent run
  assert.ok(count(out, "\nf\n") >= 1); // highlight fill
});

test("all new formatting options together render a valid PDF", () => {
  const doc = createDocument();
  doc.addPage().text("everything", {
    x: 56,
    y: 700,
    superscript: true,
    renderMode: "fillStroke",
    strokeWidth: 0.3,
    horizontalScaling: 90,
    highlight: { kind: "gray", value: 0.9 },
  });
  const bytes = doc.toUint8Array();
  assert.match(new TextDecoder().decode(bytes), /^%PDF-/);
});
