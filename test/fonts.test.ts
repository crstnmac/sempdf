import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createDocument, parseDocument, PdfEngineError, PdfErrorCode } from "../src/index.js";
import type { PdfValue } from "../src/internal/pdf-primitives.js";
import { makeKerningPairKey } from "../src/internal/text-layout.js";
import { parseTrueTypeFont } from "../src/internal/truetype.js";

function envFontCandidates(...keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const value = process.env[key];
    return value === undefined || value.length === 0 ? [] : [value];
  });
}

function findTrueTypeFixturePath(): string | undefined {
  const candidates = [
    ...envFontCandidates("PDF_EDITING_LIB_TEST_FONT", "PDF_EDITING_LIB_FONT_PATH"),
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Geneva.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ];

  return candidates.find((path) => existsSync(path));
}

function isDictValue(value: PdfValue | undefined): value is Array<[string, PdfValue]> {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string");
}

function isNameValue(value: PdfValue, expected: string): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "name" && value.value === expected;
}

test("embeds a TrueType font and writes Unicode text", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const fontBytes = readFileSync(fontPath);
  const doc = createDocument();
  const embeddedFont = doc.embedTrueTypeFont(fontBytes, { family: "FixtureUnicode" });
  const page = doc.addPage();
  page.text("Café Ω", {
    x: 36,
    y: 700,
    font: embeddedFont,
    fontSize: 18
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Subtype \/Type0/);
  assert.match(text, /\/Subtype \/CIDFontType2/);
  assert.match(text, /\/FontFile2/);
  assert.match(text, /\/ToUnicode/);

  const parsed = parseDocument(bytes);
  const hasEmbeddedFont = parsed
    .getObjectIds()
    .map((id) => parsed.getObject(id)?.value)
    .some((value) => isDictValue(value) && value.some(([key, entry]) => key === "Subtype" && isNameValue(entry, "Type0")));

  assert.equal(hasEmbeddedFont, true);
});

test("serializes kerning-aware embedded text with TJ", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const fontBytes = readFileSync(fontPath);
  const parsedFont = parseTrueTypeFont(fontBytes, "FixtureKerning");
  const glyphA = parsedFont.cmap.getGlyphId("A".codePointAt(0)!);
  const glyphV = parsedFont.cmap.getGlyphId("V".codePointAt(0)!);
  if ((parsedFont.kerningPairs.get(makeKerningPairKey(glyphA, glyphV)) ?? 0) === 0) {
    return;
  }

  const doc = createDocument();
  const embeddedFont = doc.embedTrueTypeFont(fontBytes, { family: "FixtureKerning" });
  const page = doc.addPage();
  page.text("AV", {
    x: 36,
    y: 700,
    font: embeddedFont,
    fontSize: 18
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\] TJ/);
});

test("allows disabling kerning for embedded text", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const fontBytes = readFileSync(fontPath);
  const parsedFont = parseTrueTypeFont(fontBytes, "FixtureNoKerning");
  const glyphA = parsedFont.cmap.getGlyphId("A".codePointAt(0)!);
  const glyphV = parsedFont.cmap.getGlyphId("V".codePointAt(0)!);
  if ((parsedFont.kerningPairs.get(makeKerningPairKey(glyphA, glyphV)) ?? 0) === 0) {
    return;
  }

  const doc = createDocument();
  const embeddedFont = doc.embedTrueTypeFont(fontBytes, { family: "FixtureNoKerning" });
  const page = doc.addPage();
  page.text("AV", {
    x: 36,
    y: 700,
    font: embeddedFont,
    fontSize: 18,
    kerning: false
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /<[0-9A-F]+> Tj/);
  assert.doesNotMatch(text, /\] TJ/);
});

test("rejects embedded fonts used across different documents", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const fontBytes = readFileSync(fontPath);
  const sourceDoc = createDocument();
  const foreignFont = sourceDoc.embedTrueTypeFont(fontBytes);

  const targetDoc = createDocument();
  const page = targetDoc.addPage();
  assert.throws(
    () => page.text("Cross-doc font", {
      x: 36,
      y: 700,
      font: foreignFont
    }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FONT
  );
});

test("ToUnicode CMap codespacerange enables mixed 1- and 2-byte codes", async () => {
  const { extractPageText, parseToUnicodeCMap } = await import("../src/internal/text-extract.js");
  const cmap = `
    begincodespacerange
    <00> <7F>
    <8000> <80FF>
    endcodespacerange
    1 beginbfchar
    <41> <0041>
    endbfchar
    1 beginbfrange
    <8000> <80FF> <4E00>
    endbfrange
    endcmap
  `;
  const parsed = parseToUnicodeCMap(cmap);
  const fontState = {
    twoByteCodes: true,
    toUnicode: parsed,
    codeRanges: parsed.codeRanges,
    widths: new Map<number, number>(),
    defaultWidth: 1000,
  };
  const fonts = new Map([["F1", fontState]]);
  const content = "BT /F1 10 Tf 0 0 Td <418005> Tj ET";
  const runs = extractPageText(content, fonts);
  assert.equal(runs[0]?.text, `A${String.fromCharCode(0x4e05)}`);
});

test("ToUnicode bfchar handles 4-byte codes via codespacerange", async () => {
  const { parseToUnicodeCMap } = await import("../src/internal/text-extract.js");
  const cmap = `
    begincodespacerange
    <00000000> <FFFFFFFF>
    endcodespacerange
    1 beginbfchar
    <0001F600> <1F600>
    endbfchar
    endcmap
  `;
  const parsed = parseToUnicodeCMap(cmap);
  assert.ok(parsed.size >= 1);
  assert.equal(parsed.codeRanges.length, 1);
  assert.equal(parsed.codeRanges[0]!.byteLen, 4);
});

test("vertical /W2 origin offsets shift first glyph position", async () => {
  const { extractPageText } = await import("../src/internal/text-extract.js");
  const fonts = new Map([
    ["F1", {
      twoByteCodes: true,
      verticalMode: true,
      identityHFallback: true,
      widths: new Map(),
      defaultWidth: 1000,
      verticalWidths: new Map(),
      defaultVerticalWidth: -1000,
      defaultVerticalOrigin: { vx: 500, vy: 880 },
    }],
  ]);
  const content = "BT /F1 10 Tf 100 200 Td <0041> Tj ET";
  const runs = extractPageText(content, fonts);
  assert.ok(Math.abs(runs[0]!.x - (100 - 5)) < 0.001);
  assert.ok(Math.abs(runs[0]!.y - (200 - 8.8)) < 0.001);
});

test("expanded glyph table covers Latin Extended + AFII Cyrillic + Hebrew", async () => {
  const { glyphNameToString } = await import("../src/internal/pdf-encodings.js");
  assert.equal(glyphNameToString("Lslash"), "Ł");
  assert.equal(glyphNameToString("Tcommaaccent"), "Ț");
  assert.equal(glyphNameToString("afii10023"), "Ж");
  assert.equal(glyphNameToString("afii57664"), "א");
  assert.equal(glyphNameToString("Eng"), "Ŋ");
});

test("parseToUnicodeCMap maps bfchar and bfrange entries", async () => {
  const cmap = `
    /CIDInit /ProcSet findresource begin
    12 dict begin
    begincmap
    2 beginbfchar
    <0001> <0041>
    <0002> <0042>
    endbfchar
    1 beginbfrange
    <0010> <0012> <0061>
    endbfrange
    endcmap
  `;
  const { parseToUnicodeCMap } = await import("../src/internal/text-extract.js");
  const map = parseToUnicodeCMap(cmap);
  assert.equal(map.get(0x0001), "A");
  assert.equal(map.get(0x0002), "B");
  assert.equal(map.get(0x0010), "a");
  assert.equal(map.get(0x0011), "b");
  assert.equal(map.get(0x0012), "c");
});
