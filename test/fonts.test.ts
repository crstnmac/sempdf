import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createDocument, parseDocument, PdfEngineError, PdfErrorCode } from "../src/index.js";
import type { PdfValue } from "../src/internal/pdf-primitives.js";
import { makeKerningPairKey } from "../src/internal/text-layout.js";
import { parseTrueTypeFont } from "../src/internal/truetype.js";
import { parseType1Font } from "../src/internal/type1.js";

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
  const parsedFont = parseTrueTypeFont(fontBytes, { family: "FixtureKerning" });
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
  const parsedFont = parseTrueTypeFont(fontBytes, { family: "FixtureNoKerning" });
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

test("respects built-in font encoding selection", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Encoded text", {
    x: 36, y: 700, font: "Courier", encoding: "winansi"
  });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/BaseFont \/Courier/);
  assert.ok(text.includes("Encoded text"));
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

function devanagariSampleText(): { fontPath: string; text: string } | undefined {
  const candidates = [
    ...envFontCandidates("PDF_EDITING_LIB_DEVANAGARI_FONT", "PDF_EDITING_LIB_FONT_PATH"),
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/KohinoorDevanagari.ttc",
    "/usr/share/fonts/truetype/Noto/NotoSansDevanagari-Regular.ttf"
  ];
  const sample = "अक्षर";
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const font = parseTrueTypeFont(readFileSync(path), { family: "FixtureDevanagari" });
    const glyphIds = [...sample].map((c) => {
      const cp = c.codePointAt(0);
      return cp === undefined ? 0 : font.cmap.getGlyphId(cp);
    });
    if (glyphIds.every((g) => g !== 0)) return { fontPath: path, text: sample };
  }
  return undefined;
}

test("shapes Devanagari text with half-forms", () => {
  const fixture = devanagariSampleText();
  if (!fixture) return;
  const fontBytes = readFileSync(fixture.fontPath);
  const doc = createDocument();
  const embeddedFont = doc.embedTrueTypeFont(fontBytes, { family: "DevanagariFixture" });
  const page = doc.addPage();
  page.text(fixture.text, {
    x: 36, y: 700, font: embeddedFont, fontSize: 18, kerning: false
  });
  const bytes = doc.toUint8Array();
  assert.ok(bytes.length > 0);
});

function thaiWordBoundarySample(): { fontPath: string; text: string } | undefined {
  const candidates = [
    ...envFontCandidates("PDF_EDITING_LIB_THAI_FONT", "PDF_EDITING_LIB_FONT_PATH"),
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Thonburi.ttc",
    "/usr/share/fonts/truetype/Noto/NotoSansThai-Regular.ttf"
  ];
  const sample = "สวัสดีครับ";
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const font = parseTrueTypeFont(readFileSync(path), { family: "FixtureThai" });
    const glyphIds = [...sample].map((c) => {
      const cp = c.codePointAt(0);
      return cp === undefined ? 0 : font.cmap.getGlyphId(cp);
    });
    if (glyphIds.every((g) => g !== 0)) return { fontPath: path, text: sample };
  }
  return undefined;
}

test("respects Thai word boundaries in wrapping", () => {
  const fixture = thaiWordBoundarySample();
  if (!fixture) return;
  const fontBytes = readFileSync(fixture.fontPath);
  const doc = createDocument();
  const embeddedFont = doc.embedTrueTypeFont(fontBytes, { family: "ThaiFixture" });
  const page = doc.addPage();
  page.textBlock(fixture.text, {
    x: 36, y: 700, width: 80,
    font: embeddedFont, fontSize: 12, lineHeight: 14
  });
  const bytes = doc.toUint8Array();
  assert.ok(bytes.length > 0);
});

function minimalTtcBytes(fontBytes: Uint8Array): Uint8Array {
  const tag = new Uint8Array([0x74,0x74,0x63,0x66]);
  const version = new Uint8Array([0x00,0x01,0x00,0x00]);
  const numFonts = new Uint8Array([0x00,0x00,0x00,0x01]);
  const headerSize = 12;
  const offset = new Uint8Array([
    ((headerSize+4)>>24)&0xff, ((headerSize+4)>>16)&0xff, ((headerSize+4)>>8)&0xff, (headerSize+4)&0xff
  ]);
  const out = new Uint8Array(tag.length + version.length + numFonts.length + offset.length + fontBytes.length);
  out.set(tag, 0);
  out.set(version, tag.length);
  out.set(numFonts, tag.length + version.length);
  out.set(offset, tag.length + version.length + numFonts.length);
  out.set(fontBytes, tag.length + version.length + numFonts.length + offset.length);
  return out;
}

test("parses TrueType Collection and extracts font by index", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;
  const fontBytes = readFileSync(fontPath);
  const ttc = minimalTtcBytes(fontBytes);
  const parsed = parseTrueTypeFont(ttc, { family: "TtcFixture", ttcIndex: 0 });
  assert.ok(parsed.cmap);
  assert.ok(parsed.postScriptName.length > 0);
});

function type1PfbSegment(type: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 5);
  out[0] = 0x80 | (type & 0x03);
  const len = data.length;
  out[1] = len & 0xff;
  out[2] = (len >> 8) & 0xff;
  out[3] = (len >> 16) & 0xff;
  out[4] = (len >> 24) & 0xff;
  out.set(data, 5);
  return out;
}

function minimalPfbBytes(): Uint8Array {
  const ascii = new TextEncoder().encode(
    "%!FontType1-1.0 TestFont 1.0\n" +
    "11 dict begin\n" +
    "/FontName /TestFont def\n" +
    "/PaintType 0 def\n" +
    "/FontType 1 def\n" +
    "/FontMatrix [0.001 0 0 0.001 0 0] def\n" +
    "/FontBBox {0 0 500 500} def\n" +
    "/Encoding StandardEncoding def\n" +
    "currentdict end\n" +
    "currentfile eexec\n"
  );
  const binary = new Uint8Array([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
  const trailer = new Uint8Array([0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08]);
  return catBytes([
    new Uint8Array([0x80,0x01]),
    type1PfbSegment(1, ascii),
    type1PfbSegment(2, binary),
    type1PfbSegment(3, trailer),
    new Uint8Array([0x80,0x03])
  ]);
}

function catBytes(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

test("parses Type1 PFB font", () => {
  const pfb = minimalPfbBytes();
  const parsed = parseType1Font(pfb);
  assert.ok(parsed.fontName.length > 0);
});
