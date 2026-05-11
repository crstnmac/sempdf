import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createDocument, parseDocument } from "../src/index.js";

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

test("extractText computes user-space width when CTM rotates 90°", async () => {
  const { extractPageText } = await import("../src/internal/text-extract.js");
  const fonts = new Map([
    ["F1", { twoByteCodes: false, widths: new Map([[65, 500]]) }],
  ]);
  const content = "q 0 1 -1 0 0 0 cm BT /F1 10 Tf 0 0 Td (A) Tj ET Q";
  const runs = extractPageText(content, fonts);
  assert.equal(runs.length, 1);
  assert.ok(Math.abs(runs[0]!.width - 5) < 0.001);
});

test("extractText decodes Identity-H 2-byte codes when no ToUnicode", async () => {
  const { extractPageText } = await import("../src/internal/text-extract.js");
  const fonts = new Map([
    ["F1", { twoByteCodes: true, identityHFallback: true, widths: new Map(), defaultWidth: 1000 }],
  ]);
  const content = "BT /F1 10 Tf 0 0 Td <00410042> Tj ET";
  const runs = extractPageText(content, fonts);
  assert.equal(runs[0]?.text, "AB");
});

test("extractText advances vertically in vertical writing mode", async () => {
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
      defaultVerticalOrigin: { vx: 0, vy: 0 },
    }],
  ]);
  const content = "BT /F1 10 Tf 100 200 Td <00410042> Tj ET";
  const runs = extractPageText(content, fonts);
  assert.equal(runs[0]?.x, 100);
  assert.equal(runs[0]?.y, 200);
  assert.ok(Math.abs(runs[0]!.width - 20) < 0.001);
});

test("expanded glyph-name table resolves Greek + math operators", async () => {
  const { glyphNameToString } = await import("../src/internal/pdf-encodings.js");
  assert.equal(glyphNameToString("alpha"), "α");
  assert.equal(glyphNameToString("Omega"), "Ω");
  assert.equal(glyphNameToString("infinity"), "∞");
  assert.equal(glyphNameToString("uni4E2D"), "中");
  assert.equal(glyphNameToString("u1F600"), "😀");
});

test("extractText emits per-string runs with widths from TJ arrays", async () => {
  const { extractPageText } = await import("../src/internal/text-extract.js");
  const fonts = new Map([
    ["F1", {
      twoByteCodes: false,
      encoding: undefined,
      widths: new Map([
        [65, 500], [66, 500], [67, 500],
      ]),
    }],
  ]);
  const content = "BT /F1 10 Tf 100 200 Td [(A) -100 (B) (C)] TJ ET";
  const runs = extractPageText(content, fonts);
  assert.equal(runs.length, 3);
  assert.equal(runs[0]!.text, "A");
  assert.equal(runs[0]!.x, 100);
  assert.equal(runs[1]!.text, "B");
  assert.equal(Math.round(runs[1]!.x * 100) / 100, 106);
  assert.equal(runs[2]!.text, "C");
  assert.equal(Math.round(runs[2]!.x * 100) / 100, 111);
});

test("extractText decodes WinAnsi /Differences and StandardEncoding", async () => {
  const { extractPageText } = await import("../src/internal/text-extract.js");
  const baseTable = new Array<number | undefined>(256);
  for (let i = 0x20; i <= 0x7e; i += 1) baseTable[i] = i;
  baseTable[0x80] = 0x20ac;
  const fonts = new Map([
    ["F1", { twoByteCodes: false, encoding: baseTable, widths: new Map() }],
  ]);
  const content = "BT /F1 12 Tf 0 0 Td <80> Tj ET";
  const runs = extractPageText(content, fonts);
  assert.equal(runs[0]?.text, "€");
});

test("extractText tracks MCID through BDC/EMC and supports structure reading order", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document",
  });
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "OrderFont" });
  const page = doc.addPage({ size: "Letter" });
  page.text("First", { x: 36, y: 720, font, fontSize: 12, tag: "P" });
  page.text("Second", { x: 36, y: 700, font, fontSize: 12, tag: "P" });

  const parsed = parseDocument(doc.toUint8Array());
  const stream = parsed.extractText({ readingOrder: "stream" });
  const struct = parsed.extractText({ readingOrder: "structure" });
  assert.ok(stream.length === 1 && struct.length === 1);
  assert.match(stream[0]!.text, /First.*Second/);
  assert.match(struct[0]!.text, /First.*Second/);
  const tagged = struct[0]!.runs.filter((r) => r.mcid !== undefined);
  assert.ok(tagged.length >= 2, `expected MCID-tagged runs, got ${tagged.length}`);
});

test("extractText returns positioned runs from a built-in-font document", () => {
  const doc = createDocument({});
  doc.addPage({ size: "Letter" }).text("Hello, world!", { x: 100, y: 700, fontSize: 14 });

  const parsed = parseDocument(doc.toUint8Array());
  const pages = parsed.extractText();
  assert.equal(pages.length, 1);
  const [page] = pages;
  assert.ok(page);
  assert.match(page.text, /Hello, world!/);
  assert.ok(page.runs.length >= 1);
  const run = page.runs.find((r) => r.text.includes("Hello"));
  assert.ok(run, "expected a run containing 'Hello'");
  assert.equal(run.fontSize, 14);
  assert.equal(Math.round(run.x), 100);
  assert.equal(Math.round(run.y), 700);
});

test("extractText decodes embedded TrueType text via ToUnicode CMap", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const doc = createDocument({});
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "ExtractFont" });
  doc.addPage({ size: "Letter" }).text("Codex 42", { x: 36, y: 720, font, fontSize: 12 });

  const parsed = parseDocument(doc.toUint8Array());
  const pages = parsed.extractText();
  const text = pages[0]?.text ?? "";
  assert.match(text, /Codex 42/);
});

test("extractText handles multi-page documents", () => {
  const doc = createDocument({});
  doc.addPage({ size: "Letter" }).text("Page one", { x: 36, y: 720 });
  doc.addPage({ size: "Letter" }).text("Page two", { x: 36, y: 720 });

  const pages = parseDocument(doc.toUint8Array()).extractText();
  assert.equal(pages.length, 2);
  assert.match(pages[0]!.text, /Page one/);
  assert.match(pages[1]!.text, /Page two/);
});
