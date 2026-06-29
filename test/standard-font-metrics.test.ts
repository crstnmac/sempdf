import test from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "../src/index.js";

const doc = createDocument();
// fontSize 1000 makes measured width equal the 1000-em AFM advance directly.
const advance = (text: string, font?: string, bold?: boolean) =>
  Math.round(
    doc.measureText(text, {
      fontSize: 1000,
      ...(font ? { font } : {}),
      ...(bold ? { bold } : {}),
    }).width,
  );

test("Helvetica uses exact Core-14 AFM advance widths", () => {
  assert.equal(advance("space".slice(0, 0) + " "), 278);
  assert.equal(advance("I"), 278); // narrow cap — the heuristic wrongly gave 722
  assert.equal(advance("m"), 833); // wide lowercase that caused run overlap
  assert.equal(advance("W"), 944);
  assert.equal(advance("i"), 222);
  assert.equal(advance("0"), 556);
});

test("Times-Roman and Helvetica-Bold differ per the AFM tables", () => {
  assert.equal(advance("m", "Times-Roman"), 778);
  assert.equal(advance("I", "Times-Roman"), 333);
  assert.equal(advance("m", "Helvetica", true), 889); // bold m wider than regular 833
});

test("Courier is monospaced (every glyph 600)", () => {
  for (const ch of ["i", "m", "W", "0", "."]) {
    assert.equal(advance(ch, "Courier"), 600);
  }
});

test("a run placed after wide glyphs no longer overlaps", () => {
  // "mc" advance must equal m + c (833 + 500) so a following run starts clear.
  assert.equal(advance("mc"), 833 + 500);
});
