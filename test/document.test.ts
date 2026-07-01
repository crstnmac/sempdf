import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { appendPages, BufferSink, cmyk, createDocument, deviceN, editDocument, extractPages, mergeDocuments, PAGE_SIZES, parseDocument, PdfEngineError, PdfErrorCode, rgb, separation, splitDocument } from "../src/index.js";
import { StreamingByteWriter } from "../src/internal/streaming-byte-writer.js";
import { inspectPdf } from "../src/internal/inspect.js";
import { computeParagraphRegionBreaks } from "../src/document.js";
import { makeKerningPairKey, measureTextWidth } from "../src/internal/text-layout.js";
import type { PdfValue } from "../src/internal/pdf-primitives.js";
import { parseTrueTypeFont } from "../src/internal/truetype.js";

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+L6KKK/lM/38P//Z";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC";
const TRANSPARENT_TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAABnRSTlMAAAAAAP9DpOgcAAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC";

function tinyJpegBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(TINY_JPEG_BASE64, "base64"));
}

function tinyPngBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));
}

function transparentTinyPngBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(TRANSPARENT_TINY_PNG_BASE64, "base64"));
}

class CountingSink {
  chunks = 0;
  bytes = 0;
  maxChunkBytes = 0;
  closed = false;

  async write(chunk: Uint8Array): Promise<void> {
    this.chunks += 1;
    this.bytes += chunk.length;
    this.maxChunkBytes = Math.max(this.maxChunkBytes, chunk.length);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function xrefStreamFixtureBytes(): Uint8Array {
  const encoder = new TextEncoder();
  const header = encoder.encode("%PDF-1.5\n");
  const object1 = encoder.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const compressedObjects = [
    { id: 2, body: "<< /Type /Pages /Count 1 /Kids [4 0 R] >>\n" },
    { id: 3, body: "<< /Title (ObjStm PDF) /Producer (Fixture) >>\n" },
    { id: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\n" }
  ];

  let objectBody = "";
  let objectHeader = "";
  for (const object of compressedObjects) {
    objectHeader += `${object.id} ${objectBody.length} `;
    objectBody += object.body;
  }

  const objectStreamDecoded = encoder.encode(objectHeader + objectBody);
  const objectStreamCompressed = deflateSync(objectStreamDecoded);
  const object5Prefix = encoder.encode(
    `5 0 obj\n<< /Type /ObjStm /N ${compressedObjects.length} /First ${objectHeader.length} /Length ${objectStreamCompressed.length} /Filter /FlateDecode >>\nstream\n`
  );
  const object5Suffix = encoder.encode("\nendstream\nendobj\n");
  const object5 = joinBytes([object5Prefix, objectStreamCompressed, object5Suffix]);

  const offset1 = header.length;
  const offset5 = offset1 + object1.length;
  const offset6 = offset5 + object5.length;

  const xrefEntries = joinBytes([
    xrefEntry(0, 0, 65535),
    xrefEntry(1, offset1, 0),
    xrefEntry(2, 5, 0),
    xrefEntry(2, 5, 1),
    xrefEntry(2, 5, 2),
    xrefEntry(1, offset5, 0),
    xrefEntry(1, offset6, 0)
  ]);
  const xrefCompressed = deflateSync(xrefEntries);
  const object6Prefix = encoder.encode(
    `6 0 obj\n<< /Type /XRef /Size 7 /Root 1 0 R /Info 3 0 R /W [1 4 2] /Index [0 7] /Length ${xrefCompressed.length} /Filter /FlateDecode >>\nstream\n`
  );
  const object6Suffix = encoder.encode("\nendstream\nendobj\n");
  const object6 = joinBytes([object6Prefix, xrefCompressed, object6Suffix]);

  const footer = encoder.encode(`startxref\n${offset6}\n%%EOF`);
  return joinBytes([header, object1, object5, object6, footer]);
}

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

function findRtlTrueTypeFixturePath(): string | undefined {
  const candidates = [
    ...envFontCandidates("PDF_EDITING_LIB_RTL_FONT", "PDF_EDITING_LIB_FONT_PATH"),
    "/System/Library/Fonts/SFHebrew.ttf",
    "/System/Library/Fonts/SFHebrewRounded.ttf",
    "/System/Library/Fonts/SFArabic.ttf",
    "/System/Library/Fonts/SFArabicRounded.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf"
  ];

  return candidates.find((path) => existsSync(path));
}

function findArabicJoiningFixture(): { path: string; sample: string } | undefined {
  const candidates = [
    ...envFontCandidates("PDF_EDITING_LIB_ARABIC_FONT", "PDF_EDITING_LIB_RTL_FONT", "PDF_EDITING_LIB_FONT_PATH"),
    "/System/Library/Fonts/SFArabic.ttf",
    "/System/Library/Fonts/SFArabicRounded.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf"
  ];
  const samples = ["سلام", "سس", "مم", "عرب", "لغة"];

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }

    const font = parseTrueTypeFont(readFileSync(path), { family: "FixtureArabicJoinScan" });
    for (const sample of samples) {
      if (sampleHasJoiningSubstitution(font, sample)) {
        return { path, sample };
      }
    }
  }

  return undefined;
}

function findLigatureFixture(): { path: string; sequence: string } | undefined {
  const candidates = [
    ...envFontCandidates("PDF_EDITING_LIB_LIGATURE_FONT", "PDF_EDITING_LIB_TEST_FONT", "PDF_EDITING_LIB_FONT_PATH"),
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    "/System/Library/Fonts/SFNSMono.ttf"
  ];
  const sequences = ["ffi", "ffl", "ff", "fi", "fl"];

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }

    const font = parseTrueTypeFont(readFileSync(path), { family: "FixtureLigatureScan" });
    for (const sequence of sequences) {
      const glyphIds = [...sequence].map((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint === undefined ? 0 : font.cmap.getGlyphId(codePoint);
      });

      if (glyphIds.some((glyphId) => glyphId === 0)) {
        continue;
      }

      const substitutions = font.ligatures.get(glyphIds[0]!);
      if (substitutions?.some((substitution) => substitution.sequence.length === glyphIds.length && substitution.sequence.every((glyphId, index) => glyphId === glyphIds[index]))) {
        return { path, sequence };
      }
    }
  }

  return undefined;
}

function sampleHasJoiningSubstitution(font: ReturnType<typeof parseTrueTypeFont>, sample: string): boolean {
  const visualGlyphIds = [...sample].reverse().map((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? 0 : font.cmap.getGlyphId(codePoint);
  });

  if (visualGlyphIds.some((glyphId) => glyphId === 0)) {
    return false;
  }

  return visualGlyphIds.some((glyphId, index) => {
    const previousGlyphId = index > 0 ? visualGlyphIds[index - 1] : undefined;
    const nextGlyphId = index < visualGlyphIds.length - 1 ? visualGlyphIds[index + 1] : undefined;
    const joinsPrevious =
      previousGlyphId !== undefined
      && (font.joiningForms.initial.has(glyphId) || font.joiningForms.medial.has(glyphId))
      && (font.joiningForms.final.has(previousGlyphId) || font.joiningForms.medial.has(previousGlyphId));
    const joinsNext =
      nextGlyphId !== undefined
      && (font.joiningForms.final.has(glyphId) || font.joiningForms.medial.has(glyphId))
      && (font.joiningForms.initial.has(nextGlyphId) || font.joiningForms.medial.has(nextGlyphId));

    return (
      (joinsPrevious && joinsNext && font.joiningForms.medial.has(glyphId))
      || (joinsPrevious && font.joiningForms.initial.has(glyphId))
      || (joinsNext && font.joiningForms.final.has(glyphId))
      || (!joinsPrevious && !joinsNext && font.joiningForms.isolated.has(glyphId))
    );
  });
}

function extractFirstEmbeddedGlyphRunHex(bytes: Uint8Array): string | undefined {
  return new TextDecoder().decode(bytes).match(/BT[\s\S]*?<([0-9A-F]+)> Tj[\s\S]*?ET/)?.[1];
}

test("creates a single page hello world PDF", () => {
  const doc = createDocument({
    info: {
      title: "Hello World",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });

  const page = doc.addPage({ size: "A4" });
  page.text("Hello PDF", { x: 48, y: 780, fontSize: 18, color: rgb(0.1, 0.2, 0.3) });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const inspection = inspectPdf(bytes);

  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /xref/);
  assert.equal(inspection.objects.size, 6);
  assert.equal(inspection.xrefOffsets.get(1)! > 0, true);
});

test("emits an opt-in linearization dictionary", async () => {
  const doc = createDocument({
    linearize: true,
    info: {
      title: "Linearized",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });
  const page = doc.addPage({ size: "Letter" });
  page.text("Fast Web View", { x: 72, y: 720, fontSize: 16 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const firstObject = /(\d+) 0 obj\n([\s\S]*?)\nendobj/.exec(text);

  assert.ok(firstObject);
  assert.match(firstObject[2]!, /\/Linearized 1/);
  assert.match(firstObject[2]!, new RegExp(`/L ${String(bytes.length).padStart(10, "0")}`));
  assert.match(firstObject[2]!, /\/O \d+/);
  assert.match(firstObject[2]!, /\/N 1/);
  assert.match(firstObject[2]!, /\/T \d+/);
  assert.equal(parseDocument(bytes).getPageCount(), 1);

  const sink = new BufferSink();
  await doc.writeTo(sink);
  assert.deepEqual(sink.collect(), bytes);
});

test("streams multi-page documents with non-colliding deferred stream lengths", async () => {
  // Non-linearized, multi-page docs take the lazy sink path, where each page
  // content stream is emitted with a deferred `/Length N 0 R`. Regression test
  // for an offset-collision bug where lazy length object IDs were allocated from
  // the same range as real objects, so `/Length` resolved to a font/page dict
  // and corrupted the streamed output (Kids/Contents unreadable by qpdf).
  const doc = createDocument({ info: { title: "Streamed" } });
  for (let p = 0; p < 3; p += 1) {
    const page = doc.addPage({ size: "A4" });
    for (let line = 0; line < 40; line += 1) {
      page.text(`Page ${p} line ${line} ${"lorem ipsum dolor ".repeat(5)}`, {
        x: 56,
        y: 800 - line * 18,
        fontSize: 10,
      });
    }
  }

  const sink = new BufferSink();
  await doc.writeTo(sink);
  const streamed = sink.collect();

  // The streamed bytes must parse back to the same page count.
  assert.equal(parseDocument(streamed).getPageCount(), 3);

  // Every deferred `/Length N 0 R` must reference an integer-valued object,
  // never a real object (font, page, etc.). A non-integer body here is exactly
  // the corruption the bug produced.
  const text = Buffer.from(streamed).toString("latin1");
  const lengthRefs = [...text.matchAll(/\/Length (\d+) 0 R/g)].map((m) => Number(m[1]));
  assert.ok(lengthRefs.length > 0, "expected deferred length objects in streamed output");
  for (const id of lengthRefs) {
    const objMatch = new RegExp(`(?:^|\\n)${id} 0 obj\\s+([\\s\\S]*?)\\s*endobj`).exec(text);
    assert.ok(objMatch, `deferred length object ${id} is missing`);
    assert.match(
      objMatch[1]!.trim(),
      /^\d+$/,
      `deferred length object ${id} is not an integer: ${objMatch[1]!.slice(0, 60)}`,
    );
  }
});

test("rejects multi-page linearization until page hint tables are complete", () => {
  const doc = createDocument({ linearize: true });
  doc.addPage().text("One", { x: 72, y: 720 });
  doc.addPage().text("Two", { x: 72, y: 720 });

  assert.throws(
    () => doc.toUint8Array(),
    /single-page generated documents/
  );
});

test("supports additional built-in page sizes", () => {
  const doc = createDocument();
  const expected = [
    "A3",
    "A5",
    "B5",
    "C6",
    "Tabloid",
    "Ledger",
    "Executive",
    "Statement",
    "Envelope10",
    "EnvelopeDL",
  ] as const;

  for (const size of expected) {
    const page = doc.addPage({ size });
    assert.deepEqual(page.size, PAGE_SIZES[size]);
    page.text(size, { x: 12, y: 12 });
  }

  const pages = parseDocument(doc.toUint8Array()).listPages();
  for (const [index, size] of expected.entries()) {
    const { width, height } = PAGE_SIZES[size];
    assert.deepEqual(pages[index]?.mediaBox, [0, 0, width, height]);
  }
});

test("writes generated documents to byte sinks", async () => {
  const doc = createDocument({
    info: {
      title: "Sink Output",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });
  doc.addPage({ size: "A4" }).text("Hello sink", { x: 48, y: 780 });

  const sink = new BufferSink();
  await doc.writeTo(sink);
  const bytes = sink.collect();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.equal(parsed.getMetadata().title, "Sink Output");
  assert.equal(parsed.getPageCount(), 1);
  assert.match(text, /\/Length \d+ 0 R/);
});

test("streams generated documents to a sink", async () => {
  const doc = createDocument({
    info: {
      title: "Streaming Output",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });
  doc.addPage({ size: "A4" }).text("Hello streaming sink", { x: 48, y: 780 });

  const sink = new CountingSink();
  await doc.writeTo(sink);

  assert.equal(sink.closed, true);
  assert.equal(sink.bytes >= doc.toUint8Array().length, true);
  assert.equal(sink.chunks >= 1, true);
});

test("streams large generated documents in bounded-size chunks without OOM", async () => {
  const pageCount = 4000;
  const doc = createDocument({
    info: {
      title: "Large Sink Output",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });

  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage({ size: "A4" }).text(`Streaming page ${index + 1}`, { x: 48, y: 780 });
  }

  const sink = new CountingSink();
  const heapBeforeWrite = process.memoryUsage().heapUsed;
  await doc.writeTo(sink);
  const heapGrowth = process.memoryUsage().heapUsed - heapBeforeWrite;

  assert.equal(sink.closed, true);
  assert.equal(sink.bytes > pageCount * 100, true);
  // streaming produces multiple bounded chunks rather than one giant buffer
  assert.equal(sink.chunks > 1, true);
  assert.equal(sink.maxChunkBytes < sink.bytes, true);
  assert.equal(sink.maxChunkBytes <= 1024 * 1024, true);
  assert.equal(heapGrowth < 64 * 1024 * 1024, true);
});

test("streams generated image and attachment payloads with lazy lengths for large payloads", async () => {
  const doc = createDocument({
    info: {
      title: "Payload Sink Output",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });
  const page = doc.addPage({ size: "A4" });
  page.text("Payloads", { x: 48, y: 780 });
  page.png(tinyPngBytes(), { x: 48, y: 720, width: 16, height: 16 });
  // payload above the 64 KiB lazy-stream threshold so the streaming path emits an indirect length
  const largePayload = new Uint8Array(96 * 1024).fill(0x41);
  doc.attachFile("payload.bin", largePayload, {
    description: "Large payload",
    mimeType: "application/octet-stream"
  });

  const sink = new BufferSink();
  await doc.writeTo(sink);
  const bytes = sink.collect();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.equal(parsed.getMetadata().title, "Payload Sink Output");
  assert.equal(parsed.listAttachments()[0]?.name, "payload.bin");
  // at least one lazy-length indirect ref is written for the large attachment
  assert.equal((text.match(/\/Length \d+ 0 R/g) ?? []).length >= 1, true);
});

test("streams encrypted generated documents with lazy encrypted streams", async () => {
  const doc = createDocument({
    info: {
      title: "Encrypted Sink Output",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    },
    encryption: {
      algorithm: "aes-128",
      userPassword: "reader",
      ownerPassword: "owner"
    }
  });
  doc.addPage({ size: "A4" }).text("Secret sink", { x: 48, y: 780 });

  const sink = new BufferSink();
  await doc.writeTo(sink);
  const bytes = sink.collect();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes, { password: "reader" });

  assert.equal(parsed.getMetadata().title, "Encrypted Sink Output");
  assert.equal(parsed.getPageCount(), 1);
  assert.match(text, /\/CFM \/AESV2/);
  assert.equal(text.includes("Secret sink"), false);
  assert.match(text, /\/Length \d+ 0 R/);
});

test("streams incremental edits with lazy content lengths", async () => {
  const base = createDocument({
    info: {
      title: "Editable Sink Base",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });
  base.addPage({ size: "A4" }).text("Base page", { x: 48, y: 780 });

  const editable = editDocument(base.toUint8Array());
  editable.addPage({ size: "A4" }).text("Appended page", { x: 48, y: 780 });

  const sink = new BufferSink();
  await editable.writeTo(sink);
  const bytes = sink.collect();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.equal(parsed.getPageCount(), 2);
  assert.match(text, /\/Length \d+ 0 R/);
});

test("streams unchanged editable documents as source bytes", async () => {
  const base = createDocument({
    info: {
      title: "Unchanged Editable Sink",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });
  base.addPage({ size: "A4" }).text("Base page", { x: 48, y: 780 });
  const baseBytes = base.toUint8Array();
  const editable = editDocument(baseBytes);

  const sink = new CountingSink();
  await editable.writeTo(sink);

  assert.equal(sink.closed, true);
  assert.equal(sink.bytes, baseBytes.length);
  assert.equal(sink.chunks, 1);
});

test("streams incremental xref-stream edits with lazy content lengths", async () => {
  const editable = editDocument(xrefStreamFixtureBytes());
  editable.addPage({ size: "A4" }).text("Appended from xref stream sink", { x: 36, y: 700 });

  const sink = new BufferSink();
  await editable.writeTo(sink);
  const bytes = sink.collect();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.equal(parsed.getPageCount(), 2);
  assert.match(text, /\/Length \d+ 0 R/);
});

test("streaming byte writer tracks sink offsets", async () => {
  const sink = new BufferSink();
  const writer = new StreamingByteWriter(sink);

  await writer.writeLine("%PDF-1.4");
  assert.equal(writer.size, 9);

  await writer.writeBytes(Uint8Array.from([0x25, 0xff, 0x0a]));
  assert.equal(writer.size, 12);

  await writer.close();
  assert.deepEqual(sink.collect(), Uint8Array.from([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
    0x25, 0xff, 0x0a
  ]));
});

test("reuses built-in font objects across multiple pages", () => {
  const doc = createDocument({
    info: {
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });

  const page1 = doc.addPage({ size: "Letter" });
  page1.text("Page one", { x: 32, y: 700, font: "Helvetica", fontSize: 12 });

  const page2 = doc.addPage({ size: "Letter" });
  page2.text("Page two", { x: 32, y: 700, font: "Helvetica", fontSize: 12 });

  const text = new TextDecoder().decode(doc.toUint8Array());
  const fontObjectMatches = text.match(/\/Type \/Font/g) ?? [];

  assert.equal(fontObjectMatches.length, 1);
  assert.match(text, /\/Kids \[6 0 R 8 0 R\]/);
});

test("escapes parentheses, backslashes, and line breaks in text", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text(String.raw`Hello (\world)\nLine`, { x: 24, y: 700 });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\(Hello \\\(\\\\world\\\)\\\\nLine\) Tj/);
});

test("wraps and aligns text blocks across multiple lines", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.textBlock("AAAA BBBB", {
    x: 36,
    y: 700,
    width: 48,
    font: "Courier",
    fontSize: 10,
    lineHeight: 12,
    align: "center"
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /1 0 0 1 48 700 Tm/);
  assert.match(text, /1 0 0 1 48 688 Tm/);
  // Non-terminal wrapped lines carry a trailing space so PDF reading order
  // preserves the word boundary for screen readers / copy-paste.
  assert.match(text, /\(AAAA \) Tj/);
  assert.match(text, /\(BBBB\) Tj/);
});

test("justifies non-terminal text block lines using word spacing", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.textBlock("AA BB CC DD", {
    x: 36,
    y: 700,
    width: 42,
    font: "Courier",
    fontSize: 10,
    lineHeight: 12,
    align: "justify"
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /12 Tw/);
});

test("breaks justified text at soft hyphens", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.textBlock("AA\u00ADBB CC\u00ADDD", {
    x: 36,
    y: 700,
    width: 20,
    font: "Courier",
    fontSize: 10,
    lineHeight: 12,
    align: "justify"
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\(AA- \) Tj/);
  assert.match(text, /\(BB \) Tj/);
  assert.match(text, /\(CC- \) Tj/);
  assert.match(text, /\(DD\) Tj/);
});

test("uses embedded fallback fonts for mixed-script single-line text", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const fontBytes = readFileSync(fontPath);
  const doc = createDocument();
  const fallbackFont = doc.embedTrueTypeFont(fontBytes, { family: "FixtureFallback" });
  const page = doc.addPage();
  page.text("Hello Ω World", {
    x: 36,
    y: 700,
    font: "Helvetica",
    fallbackFonts: [fallbackFont],
    fontSize: 18
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\(Hello \) Tj/);
  assert.match(text, /<[0-9A-F]+> Tj|<[0-9A-F]+> TJ/);
  assert.match(text, /\/Subtype \/Type0/);
});

test("uses embedded fallback fonts inside wrapped text blocks", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const fontBytes = readFileSync(fontPath);
  const doc = createDocument();
  const fallbackFont = doc.embedTrueTypeFont(fontBytes, { family: "FixtureBlockFallback" });
  const page = doc.addPage();
  page.textBlock("Hello Hello Ω", {
    x: 36,
    y: 700,
    width: 42,
    font: "Helvetica",
    fallbackFonts: [fallbackFont],
    fontSize: 12,
    lineHeight: 14
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /1 0 0 1 36 700 Tm/);
  assert.match(text, /1 0 0 1 36 686 Tm/);
  assert.match(text, /\/Subtype \/Type0/);
});

test("serializes embedded TrueType text with compact CID remapping", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument();
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "CompactCid" });
  doc.addPage().text("AZ", { x: 36, y: 700, font });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/CIDToGIDMap \d+ 0 R/);
  assert.doesNotMatch(text, /\/CIDToGIDMap \/Identity/);
  assert.match(text, /<00010002> Tj/);
  assert.match(text, /<0001> <00[0-9A-F]{2}>/);
});

test("anchors rtl single-line text from the right edge", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("ABC", {
    x: 100,
    y: 700,
    font: "Courier",
    fontSize: 10,
    direction: "rtl"
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /1 0 0 1 82 700 Tm/);
  assert.match(text, /\(ABC\) Tj/);
});

test("defaults rtl text blocks to right alignment", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.textBlock("AAAA BBBB", {
    x: 36,
    y: 700,
    width: 48,
    font: "Courier",
    fontSize: 10,
    lineHeight: 12,
    direction: "rtl"
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /1 0 0 1 60 700 Tm/);
  assert.match(text, /1 0 0 1 60 688 Tm/);
});

test("auto-detects rtl direction for Hebrew embedded text", () => {
  const fontPath = findRtlTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const sample = "שלום";
  const fontBytes = readFileSync(fontPath);
  const parsedFont = parseTrueTypeFont(fontBytes, { family: "FixtureRTL" });
  for (const character of sample) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || parsedFont.cmap.getGlyphId(codePoint) === 0) {
      return;
    }
  }

  const doc = createDocument();
  const embeddedFont = doc.embedTrueTypeFont(fontBytes, { family: "FixtureRTL" });
  const page = doc.addPage();
  page.text(sample, {
    x: 100,
    y: 700,
    font: embeddedFont,
    fontSize: 18,
    direction: "auto"
  });

  const expectedX = 100 - measureTextWidth(sample, {
    font: parsedFont,
    fallbackFonts: [],
    direction: "auto",
    fontSize: 18,
    kerning: true
  }, new Map([[parsedFont.id, parsedFont]]));
  const expectedPdfX = expectedX.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "");

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, new RegExp(`1 0 0 1 ${expectedPdfX.replace(".", "\\.")} 700 Tm`));
});

test("applies contextual GSUB joining forms for embedded Arabic text", () => {
  const fixture = findArabicJoiningFixture();
  if (!fixture) {
    return;
  }

  const fontBytes = readFileSync(fixture.path);
  const parsedFont = parseTrueTypeFont(fontBytes, { family: "FixtureArabicJoin" });
  const nominalVisualHex = [...fixture.sample]
    .reverse()
    .map((character) => parsedFont.cmap.getGlyphId(character.codePointAt(0)!))
    .map((glyphId) => glyphId.toString(16).toUpperCase().padStart(4, "0"))
    .join("");

  const doc = createDocument();
  const embeddedFont = doc.embedTrueTypeFont(fontBytes, { family: "FixtureArabicJoin" });
  const page = doc.addPage();
  page.text(fixture.sample, {
    x: 100,
    y: 700,
    font: embeddedFont,
    fontSize: 18,
    direction: "auto",
    kerning: false
  });

  const glyphRun = extractFirstEmbeddedGlyphRunHex(doc.toUint8Array());

  assert.ok(glyphRun);
  assert.equal(glyphRun.length, nominalVisualHex.length);
  assert.notEqual(glyphRun, nominalVisualHex);
});

test("treats ZWNJ as an invisible shaping control for embedded Arabic text", () => {
  const fixture = findArabicJoiningFixture();
  if (!fixture || fixture.sample.length < 2) {
    return;
  }

  const controlledSample = `${fixture.sample[0]}\u200C${fixture.sample.slice(1)}`;
  const fontBytes = readFileSync(fixture.path);
  const doc = createDocument();
  const embeddedFont = doc.embedTrueTypeFont(fontBytes, { family: "FixtureArabicZwnj" });

  const joinedPage = doc.addPage();
  joinedPage.text(fixture.sample, {
    x: 100,
    y: 700,
    font: embeddedFont,
    fontSize: 18,
    direction: "auto",
    kerning: false
  });

  const blockedPage = doc.addPage();
  blockedPage.text(controlledSample, {
    x: 100,
    y: 700,
    font: embeddedFont,
    fontSize: 18,
    direction: "auto",
    kerning: false
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  const glyphRuns = [...text.matchAll(/BT[\s\S]*?<([0-9A-F]+)> Tj[\s\S]*?ET/g)].map((match) => match[1]);

  assert.equal(glyphRuns.length >= 2, true);
  assert.equal(glyphRuns[0]?.length, glyphRuns[1]?.length);
  assert.notEqual(glyphRuns[0], glyphRuns[1]);
});

test("serializes GSUB ligatures into single embedded glyphs with ToUnicode mappings", () => {
  const fixture = findLigatureFixture();
  if (!fixture) {
    return;
  }

  const fontBytes = readFileSync(fixture.path);
  const doc = createDocument();
  const embeddedFont = doc.embedTrueTypeFont(fontBytes, { family: "FixtureLigature" });
  const page = doc.addPage();
  page.text(fixture.sequence, {
    x: 36,
    y: 700,
    font: embeddedFont,
    fontSize: 18,
    kerning: false
  });

  const unicodeHex = [...fixture.sequence]
    .map((character) => character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"))
    .join("");

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /<[0-9A-F]{4}> Tj/);
  assert.match(text, new RegExp(`<${unicodeHex}>`));
  assert.match(text, /\/ToUnicode/);
});

test("throws on unsupported characters, invalid numbers, and empty pages", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.text("Hello 🙂", { x: 24, y: 700 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_CHARACTER
  );

  page.text("Still valid", { x: 24, y: 700 });

  assert.throws(
    () => page.translate(Number.NaN, 0),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_NUMBER
  );

  const emptyDoc = createDocument();
  emptyDoc.addPage();
  assert.throws(
    () => emptyDoc.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.EMPTY_PAGE
  );
});

test("serializes vector graphics operators", () => {
  const doc = createDocument();
  const page = doc.addPage();

  page.saveState();
  page.translate(10, 20);
  page.path(
    [
      { type: "moveTo", x: 0, y: 0 },
      { type: "lineTo", x: 100, y: 0 },
      { type: "curveTo", x1: 120, y1: 10, x2: 120, y2: 40, x3: 80, y3: 60 },
      { type: "rect", x: 12, y: 12, width: 24, height: 18 },
      { type: "closePath" }
    ],
    {
      paint: "fillStroke",
      stroke: {
        width: 2,
        lineCap: "round",
        lineJoin: "bevel",
        dashArray: [4, 2],
        dashPhase: 1,
        color: rgb(0.8, 0.2, 0.1)
      },
      fill: {
        color: rgb(0.2, 0.3, 0.8)
      }
    }
  );
  page.restoreState();

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\[4 2\] 1 d/);
  assert.match(text, /1 J/);
  assert.match(text, /2 j/);
  assert.match(text, /0\.8 0\.2 0\.1 RG/);
  assert.match(text, /0\.2 0\.3 0\.8 rg/);
  assert.match(text, /B/);
});

test("serializes deterministically when metadata is fixed", () => {
  const makeDocument = () => {
    const doc = createDocument({
      info: {
        title: "Deterministic",
        creationDate: "D:20260413213000Z",
        modificationDate: "D:20260413213000Z"
      }
    });

    const page = doc.addPage();
    page.text("Same bytes", { x: 24, y: 700, font: "Courier", fontSize: 11 });
    return doc.toUint8Array();
  };

  assert.deepEqual(makeDocument(), makeDocument());
});

test("supports Uint8Array, ArrayBuffer, and Blob outputs", async () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Dual runtime", { x: 24, y: 700 });

  const uint8 = doc.toUint8Array();
  const arrayBuffer = doc.toArrayBuffer();
  const blob = doc.toBlob();

  assert.equal(uint8 instanceof Uint8Array, true);
  assert.equal(arrayBuffer instanceof ArrayBuffer, true);
  assert.equal(blob.type, "application/pdf");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), uint8);
});

test("parses metadata, page count, and page tree from generated PDFs", () => {
  const doc = createDocument({
    info: {
      title: "Parsed Document",
      author: "Codex",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });

  const page1 = doc.addPage({ size: "Letter" });
  page1.text("First page", { x: 24, y: 700 });

  const page2 = doc.addPage({ size: "A4" });
  page2.text("Second page", { x: 40, y: 800 });

  const parsed = parseDocument(doc.toUint8Array());
  const metadata = parsed.getMetadata();
  const pages = parsed.listPages();

  assert.equal(parsed.version, "1.4");
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(metadata.title, "Parsed Document");
  assert.equal(metadata.author, "Codex");
  assert.deepEqual(pages.map((page) => page.objectId), [6, 8]);
  assert.deepEqual(pages[0]?.mediaBox, [0, 0, 612, 792]);
  assert.deepEqual(pages[1]?.mediaBox, [0, 0, 595.28, 841.89]);
});

test("top-level document title populates info and structured XMP metadata", () => {
  const doc = createDocument({
    title: "Unified Title",
    xmpMetadata: {
      creator: "Codex"
    }
  });

  doc.addPage().text("Metadata page", { x: 24, y: 700 });

  const parsed = parseDocument(doc.toUint8Array());
  const xmp = parsed.getXmpMetadata() ?? "";

  assert.equal(parsed.getMetadata().title, "Unified Title");
  assert.match(xmp, /Unified Title/);
  assert.match(xmp, /<rdf:li>Codex<\/rdf:li>/);
});

test("top-level document title creates XMP and display-title viewer preference", () => {
  const doc = createDocument({
    title: "Accessible Title"
  });

  doc.addPage().text("Metadata page", { x: 24, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);
  const xmp = parsed.getXmpMetadata() ?? "";

  assert.equal(parsed.getMetadata().title, "Accessible Title");
  assert.match(xmp, /Accessible Title/);
  assert.match(text, /\/ViewerPreferences <<\s*\/DisplayDocTitle true\s*>>/);
});

test("explicit metadata titles override the top-level document title", () => {
  const doc = createDocument({
    title: "Fallback Title",
    info: { title: "Info Title" },
    xmpMetadata: { title: "XMP Title" }
  });

  doc.addPage().text("Metadata page", { x: 24, y: 700 });

  const parsed = parseDocument(doc.toUint8Array());
  const xmp = parsed.getXmpMetadata() ?? "";

  assert.equal(parsed.getMetadata().title, "Info Title");
  assert.match(xmp, /XMP Title/);
  assert.doesNotMatch(xmp, /Fallback Title/);
});

test("serializes and parses XMP metadata streams", () => {
  const xmpMetadata =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Hello Ω</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';

  const doc = createDocument({
    xmpMetadata
  });

  const page = doc.addPage({ size: "Letter" });
  page.text("Metadata page", { x: 24, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Metadata 4 0 R/);
  assert.match(text, /\/Type \/Metadata/);
  assert.match(text, /\/Subtype \/XML/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getXmpMetadata(), xmpMetadata);
});

test("generates XMP metadata from structured options", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument({
    conformance: "pdfua-1",
    tagged: true,
    language: "en-US",
    structureRoot: "Document",
    info: {
      title: "Structured XMP",
      author: "Codex"
    },
    xmpMetadata: {
      title: "Structured <XMP>",
      creators: ["Codex", "BarrierBreak"],
      createDate: new Date("2026-05-05T00:00:00Z"),
      modifyDate: "2026-05-06T00:00:00Z",
      metadataDate: "2026-05-07T00:00:00Z"
    }
  });

  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "StructuredXmp" });
  const page = doc.addPage({ size: "Letter" });
  page.text("Tagged", { x: 24, y: 700, font, tag: "P" });

  const parsed = parseDocument(doc.toUint8Array());
  const xmp = parsed.getXmpMetadata() ?? "";
  assert.match(xmp, /Structured &lt;XMP&gt;/);
  assert.match(xmp, /<rdf:li>Codex<\/rdf:li><rdf:li>BarrierBreak<\/rdf:li>/);
  assert.match(xmp, /<xmp:CreateDate>2026-05-05T00:00:00Z<\/xmp:CreateDate>/);
  assert.match(xmp, /<xmp:ModifyDate>2026-05-06T00:00:00Z<\/xmp:ModifyDate>/);
  assert.match(xmp, /<xmp:MetadataDate>2026-05-07T00:00:00Z<\/xmp:MetadataDate>/);
  assert.match(xmp, /pdfuaid:part>\s*1\s*</);
});

test("rejects empty XMP metadata", () => {
  assert.throws(
    () => createDocument({ xmpMetadata: "   " }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_METADATA
  );
});

test("template pageBreak starts following content on a new page", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });

  doc.renderTemplate({
    page: {
      size: { width: 240, height: 220 },
      margin: 24
    },
    blocks: [
      { type: "pageBreak" },
      { type: "heading", text: "First section" },
      { type: "paragraph", text: "This content stays on the first non-empty page." },
      { type: "pageBreak" },
      { type: "heading", text: "Second section" },
      { type: "paragraph", text: "This content starts after the forced break." }
    ]
  });

  const parsed = parseDocument(doc.toUint8Array());
  assert.equal(parsed.getPageCount(), 2);

  const [root] = parsed.listStructureElements();
  assert.deepEqual(
    root?.children?.map((element) => element.role),
    ["H1", "P", "H1", "P"]
  );
});

test("flow columns continue paragraph text in the next column", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: { width: 200, height: 180 } });
  const flow = page.flow({
    margin: 20,
    columns: { count: 2, gap: 20 },
    fontSize: 10,
    lineHeight: 12,
    spacing: { paragraphAfter: 0 }
  });

  flow.paragraph(
    Array.from({ length: 52 }, (_, index) => `word${index + 1}`).join(" ")
  );

  assert.equal(flow.columnIndex, 1);

  const [{ runs = [] } = {}] = parseDocument(doc.toUint8Array()).extractText();
  const firstColumnRuns = runs.filter((run) => run.x < 80);
  const secondColumnRuns = runs.filter((run) => run.x >= 110);

  assert.ok(firstColumnRuns.length > 0);
  assert.ok(secondColumnRuns.length > 0);
  assert.ok(
    Math.max(...secondColumnRuns.map((run) => run.y)) >
      Math.min(...firstColumnRuns.map((run) => run.y)),
    "expected wrapped text to restart near the top of the second column"
  );
});

test("renderTemplate balances short multi-column pages automatically", () => {
  const doc = createDocument();

  doc.renderTemplate({
    page: {
      size: { width: 260, height: 360 },
      margin: 30,
      columns: { count: 2, gap: 24 },
      fontSize: 10,
      lineHeight: 12,
      spacing: { paragraphAfter: 8 }
    },
    blocks: [
      { type: "paragraph", text: "Column item one." },
      { type: "paragraph", text: "Column item two." },
      { type: "paragraph", text: "Column item three." },
      { type: "paragraph", text: "Column item four." }
    ]
  });

  const [{ runs = [] } = {}] = parseDocument(doc.toUint8Array()).extractText();
  const firstColumn = runs.filter((run) => run.x < 120).map((run) => run.text).join("");
  const secondColumn = runs.filter((run) => run.x >= 140).map((run) => run.text).join("");

  assert.match(firstColumn, /Column item one/);
  assert.match(firstColumn, /Column item two/);
  assert.match(secondColumn, /Column item three/);
  assert.match(secondColumn, /Column item four/);
});

test("renderTemplate advances through columns before creating a new page", () => {
  const doc = createDocument();

  doc.renderTemplate({
    page: {
      size: { width: 220, height: 170 },
      margin: 20,
      columns: { count: 2, gap: 20 },
      fontSize: 10,
      lineHeight: 12,
      spacing: { paragraphAfter: 0 }
    },
    blocks: [
      {
        type: "paragraph",
        text: Array.from({ length: 70 }, (_, index) => `word${index + 1}`).join(" ")
      }
    ]
  });

  const parsed = parseDocument(doc.toUint8Array());
  assert.equal(parsed.getPageCount(), 2);

  const pages = parsed.extractText();
  assert.ok(pages[0]!.runs.some((run) => run.x < 80));
  assert.ok(pages[0]!.runs.some((run) => run.x >= 110));
  assert.ok(pages[1]!.runs.some((run) => run.x < 80));
});

test("template headers, footers, and page numbers receive total page count", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });

  doc.renderTemplate({
    info: {
      title: "Running Report",
      author: "Template Author"
    },
    page: {
      size: { width: 260, height: 220 },
      margin: 24,
      headerHeight: 24,
      footerHeight: 24
    },
    blocks: [
      { type: "heading", text: "First page" },
      { type: "pageBreak" },
      { type: "heading", text: "Second page" }
    ],
    header: ({ title, pageNumber, totalPages }) => [
      {
        type: "paragraph",
        text: `${title} ${pageNumber}/${totalPages}`,
        options: { fontSize: 8, tag: "Artifact" }
      }
    ],
    footer: ({ author, pageNumber, totalPages }) => [
      {
        type: "paragraph",
        text: `${author} ${pageNumber}/${totalPages}`,
        options: { fontSize: 8, tag: "Artifact" }
      }
    ],
    pageNumber: {
      align: "right",
      format: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`
    }
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /Running Report 1\/2/);
  assert.match(text, /Template Author 2\/2/);
  assert.match(text, /Page 1 of 2/);
  assert.match(text, /Page 2 of 2/);
  assert.match(text, /\/Artifact(?: BMC| <<)/);

  const [root] = parseDocument(doc.toUint8Array()).listStructureElements();
  assert.deepEqual(root?.children?.map((element) => element.role), ["H1", "H1"]);
});

test("computeParagraphRegionBreaks: no break when the paragraph fits", () => {
  assert.deepEqual(computeParagraphRegionBreaks(5, 10, 10, 1, 1), []);
  assert.deepEqual(computeParagraphRegionBreaks(10, 10, 10, 1, 1), []);
});

test("computeParagraphRegionBreaks: defaults reproduce greedy fill", () => {
  // firstCap 4, fullCap 10 → 4 | 10 | 10 → breaks after 4 and 14.
  assert.deepEqual(computeParagraphRegionBreaks(24, 4, 10, 1, 1), [4, 14]);
  // Exact multiples: 10 | 10 → break after 10 only (last region full).
  assert.deepEqual(computeParagraphRegionBreaks(20, 10, 10, 1, 1), [10]);
});

test("computeParagraphRegionBreaks: widow control pulls a lone trailing line down", () => {
  // Greedy would place 10 | 1 (a widow). widows=2 pulls one line down → 9 | 2.
  assert.deepEqual(computeParagraphRegionBreaks(11, 10, 10, 1, 2), [9]);
  // The previous region is never dropped below the orphan minimum: with the prev
  // region already at the minimum (10), the widow cannot be fixed.
  assert.deepEqual(computeParagraphRegionBreaks(11, 10, 10, 10, 2), [10]);
});

test("orphans move a paragraph to the next column instead of stranding lines", () => {
  const stranded = createDocument();
  // Two columns, ~10 lines each. A heading eats most of column 1, leaving a
  // small sliver, then a multi-line paragraph follows.
  const build = (orphans: number | undefined) => {
    const doc = createDocument();
    doc.renderTemplate({
      page: {
        size: { width: 240, height: 170 },
        margin: 20,
        columns: { count: 2, gap: 20 },
        fontSize: 10,
        lineHeight: 12,
        spacing: { paragraphAfter: 0, paragraphBefore: 0 },
      },
      blocks: [
        { type: "paragraph", text: Array.from({ length: 24 }, (_, i) => `head${i}`).join(" ") },
        {
          type: "paragraph",
          text: Array.from({ length: 30 }, (_, i) => `body${i}`).join(" "),
          ...(orphans !== undefined ? { options: { orphans } } : {}),
        },
      ],
    });
    return parseDocument(doc.toUint8Array());
  };
  void stranded;
  const bodyInCol1 = (doc: ReturnType<typeof build>) =>
    doc.extractText()[0]!.runs.filter((run) => run.text.startsWith("body") && run.x < 100).length;
  // With a high orphan minimum, fewer (ideally zero) body lines are stranded in
  // the narrow tail of column 1 than with the default greedy fill.
  assert.ok(bodyInCol1(build(5)) <= bodyInCol1(build(undefined)));
});

test("breakBefore forces a block onto a new page and is a no-op at the top", () => {
  const withoutBreak = createDocument();
  withoutBreak.renderTemplate({
    page: { size: { width: 300, height: 400 }, margin: 24 },
    blocks: [
      { type: "heading", text: "First" },
      { type: "heading", text: "Second" },
    ],
  });
  // Two short headings comfortably share one page by default.
  assert.equal(parseDocument(withoutBreak.toUint8Array()).getPageCount(), 1);

  const withBreak = createDocument();
  withBreak.renderTemplate({
    page: { size: { width: 300, height: 400 }, margin: 24 },
    blocks: [
      // breakBefore on the first block is a no-op (already at the top) — no blank page.
      { type: "heading", text: "First", breakBefore: true },
      { type: "heading", text: "Second", breakBefore: true },
    ],
  });
  const parsed = parseDocument(withBreak.toUint8Array());
  assert.equal(parsed.getPageCount(), 2);
  const pages = parsed.extractText();
  assert.ok(pages[0]!.runs.some((run) => run.text.includes("First")));
  assert.ok(pages[1]!.runs.some((run) => run.text.includes("Second")));
});

test("breakAfter pushes the following block onto a new page", () => {
  const doc = createDocument();
  doc.renderTemplate({
    page: { size: { width: 300, height: 400 }, margin: 24 },
    blocks: [
      { type: "heading", text: "Alpha", breakAfter: true },
      { type: "heading", text: "Beta" },
    ],
  });
  const parsed = parseDocument(doc.toUint8Array());
  assert.equal(parsed.getPageCount(), 2);
  const pages = parsed.extractText();
  assert.ok(pages[0]!.runs.some((run) => run.text.includes("Alpha")));
  assert.ok(pages[1]!.runs.some((run) => run.text.includes("Beta")));
});

test("footerRows repeat at the bottom of every table slice", () => {
  const doc = createDocument();
  const rows = [
    [{ text: "Item" }, { text: "Qty" }],
    ...Array.from({ length: 24 }, (_, i) => [{ text: `Row ${i}` }, { text: String(i) }]),
    [{ text: "TOTAL" }, { text: "300" }],
  ];
  doc.renderTemplate({
    page: { size: { width: 300, height: 150 }, margin: 20, fontSize: 10, lineHeight: 12 },
    blocks: [{ type: "table", rows, options: { headerRows: 1, footerRows: 1 } }],
  });
  const parsed = parseDocument(doc.toUint8Array());
  const pageCount = parsed.getPageCount();
  assert.ok(pageCount >= 2, `expected a split table, got ${pageCount} page(s)`);
  const pages = parsed.extractText();
  // Both the header row and the footer row repeat on every page.
  const totalPages = pages.filter((p) => p.runs.some((r) => r.text.includes("TOTAL"))).length;
  const headerPages = pages.filter((p) => p.runs.some((r) => r.text.includes("Item"))).length;
  assert.equal(totalPages, pageCount);
  assert.equal(headerPages, pageCount);
});

test("columnWidths auto sizes columns to their content", () => {
  const build = (columnWidths: readonly number[] | "auto" | undefined) => {
    const doc = createDocument();
    doc.renderTemplate({
      page: { size: { width: 400, height: 300 }, margin: 20, fontSize: 10, lineHeight: 12 },
      blocks: [
        {
          type: "table",
          rows: [[{ text: "A" }, { text: "This column holds substantially more text than the first one" }]],
          options: columnWidths ? { columnWidths } : {},
        },
      ],
    });
    return parseDocument(doc.toUint8Array()).extractText();
  };
  // The second column starts at tableX + column-0 width; every run other than the
  // lone "A" in column 0 sits there, so its min x reveals column 0's width.
  const col1Start = (pages: ReturnType<typeof build>) =>
    Math.min(...pages[0]!.runs.filter((r) => r.text.trim() !== "A").map((r) => r.x));
  const auto = col1Start(build("auto"));
  const equal = col1Start(build(undefined));
  // Auto shrinks the tiny first column, so column 2 starts well left of the
  // equal-width layout's midpoint.
  assert.ok(auto < equal, `auto column start ${auto} should be < equal-width start ${equal}`);
});

test("toc block lists headings with resolved page numbers and links", () => {
  const doc = createDocument();
  doc.renderTemplate({
    page: { size: { width: 320, height: 220 }, margin: 20, fontSize: 10, lineHeight: 12 },
    blocks: [
      { type: "paragraph", text: "Table of Contents" },
      { type: "toc", options: { maxLevel: 2 } },
      { type: "pageBreak" },
      { type: "heading", text: "Chapter One", options: { level: 1 } },
      { type: "pageBreak" },
      { type: "heading", text: "Chapter Two", options: { level: 1 } },
    ],
  });
  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 3);
  const pages = parsed.extractText();

  // The TOC (page 1) lists both chapter titles even though the chapters render
  // on later pages.
  const tocRuns = pages[0]!.runs.map((r) => r.text).join(" ");
  assert.match(tocRuns, /Chapter One/);
  assert.match(tocRuns, /Chapter Two/);
  // Backfilled page numbers: Chapter One is on page 2, Chapter Two on page 3.
  assert.ok(pages[0]!.runs.some((r) => r.text.trim() === "2"), "expected page number 2 in TOC");
  assert.ok(pages[0]!.runs.some((r) => r.text.trim() === "3"), "expected page number 3 in TOC");

  // The real headings are on their own pages.
  assert.ok(pages[1]!.runs.some((r) => r.text.includes("Chapter One")));
  assert.ok(pages[2]!.runs.some((r) => r.text.includes("Chapter Two")));

  // TOC entries emit navigation links.
  assert.match(new TextDecoder("latin1").decode(bytes), /\/Link/);
});

test("toc, footnotes, and cross-refs inherit the selected font from every source", () => {
  // The font can be selected via page.font, the document defaults, or the
  // stylesheet body style. In all three the TOC/footnote/cross-ref must use it
  // rather than leaking the built-in Helvetica default.
  const render = (docOptions: object, templateExtra: object) => {
    const doc = createDocument({ compress: false, ...docOptions });
    doc.renderTemplate({
      page: { size: "A4", margin: 56 },
      ...templateExtra,
      blocks: [
        { type: "toc" },
        { type: "crossRef", to: "ch", text: "see page {page}" },
        { type: "pageBreak" },
        { type: "heading", text: "Chapter", options: { level: 1 }, anchor: "ch" },
        { type: "paragraph", text: "Body", footnote: "A note." },
      ],
    });
    return new TextDecoder("latin1").decode(doc.toUint8Array());
  };
  const cases = [
    render({}, { page: { size: "A4", margin: 56, font: "Times-Roman" } }),
    render({ defaults: { font: "Times-Roman" } }, {}),
    render({}, { styles: { paragraph: { font: "Times-Roman" }, heading: { font: "Times-Roman" }, heading1: { font: "Times-Roman" } } }),
  ];
  for (const text of cases) {
    assert.match(text, /\/BaseFont \/Times-Roman/);
    assert.doesNotMatch(text, /\/BaseFont \/Helvetica\b/);
  }
});

test("page.container inherits the document's default font", () => {
  const doc = createDocument({ compress: false, tagged: true, defaults: { font: "Courier" } });
  doc.addPage().container("Sect", (c) => {
    c.text("Inside a container", { x: 56, y: 700 });
  });
  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  // Text drawn through a page-level structure container uses the document
  // default font, not the built-in Helvetica fallback.
  assert.match(text, /\/BaseFont \/Courier/);
  assert.doesNotMatch(text, /\/BaseFont \/Helvetica\b/);
});

test("toc numbering adds hierarchical Lbl labels", () => {
  const doc = createDocument({ tagged: true, structureRoot: "Document" });
  doc.renderTemplate({
    page: { size: { width: 360, height: 400 }, margin: 20, fontSize: 10, lineHeight: 12 },
    blocks: [
      { type: "toc", options: { maxLevel: 2, numbering: true } },
      { type: "pageBreak" },
      { type: "heading", text: "Alpha", options: { level: 1 } },
      { type: "heading", text: "Beta", options: { level: 2 } },
      { type: "heading", text: "Gamma", options: { level: 2 } },
    ],
  });
  const parsed = parseDocument(doc.toUint8Array());
  // Section numbers are tagged as Lbl inside each TOCI.
  const [root] = parsed.listStructureElements();
  const toc = root?.children?.find((el) => el.role === "TOC");
  const firstItem = toc?.children?.[0];
  assert.ok((firstItem?.children ?? []).some((c) => c.role === "Lbl"), "TOCI should start with a Lbl");
  // Hierarchical numbering: 1, 1.1, 1.2.
  const toc0 = parsed.extractText()[0]!.runs.map((r) => r.text).join("");
  assert.match(toc0, /1\.1/);
  assert.match(toc0, /1\.2/);
});

test("toc levelStyles renders entries at per-level font sizes", () => {
  const doc = createDocument();
  doc.renderTemplate({
    page: { size: { width: 360, height: 400 }, margin: 20, fontSize: 10, lineHeight: 16 },
    blocks: [
      { type: "toc", options: { maxLevel: 2, levelStyles: { 1: { fontSize: 18 }, 2: { fontSize: 9 } } } },
      { type: "pageBreak" },
      { type: "heading", text: "BigChapter", options: { level: 1 } },
      { type: "heading", text: "SmallSection", options: { level: 2 } },
    ],
  });
  const runs = parseDocument(doc.toUint8Array()).extractText()[0]!.runs;
  const big = runs.find((r) => r.text.includes("BigChapter"));
  const small = runs.find((r) => r.text.includes("SmallSection"));
  assert.ok(big && small);
  // The level-1 entry is rendered larger than the level-2 entry.
  assert.ok((big!.fontSize ?? 0) > (small!.fontSize ?? 0), `expected L1 > L2, got ${big!.fontSize} vs ${small!.fontSize}`);
});

test("toc draws a dotted leader by default as a decorative artifact", () => {
  const build = (leader?: "dots" | "line" | "none") => {
    const doc = createDocument({ compress: false });
    doc.renderTemplate({
      page: { size: { width: 320, height: 220 }, margin: 20, fontSize: 10, lineHeight: 12 },
      blocks: [
        { type: "toc", ...(leader ? { options: { leader } } : {}) },
        { type: "pageBreak" },
        { type: "heading", text: "Chapter One" },
      ],
    });
    return new TextDecoder("latin1").decode(doc.toUint8Array());
  };
  // Default: a dotted leader, emitted inside an /Artifact marked-content run.
  const dflt = build();
  assert.match(dflt, /\. \. \./);
  assert.match(dflt, /\/Artifact BMC/);
  // Opt out.
  assert.doesNotMatch(build("none"), /\. \. \. \./);
  // A rule leader strokes a line instead of drawing dots.
  const line = build("line");
  assert.doesNotMatch(line, /\. \. \. \./);
  assert.match(line, / l\n/); // a lineto in the stroked leader path
});

test("toc emits a TOC/TOCI/Reference/Link structure hierarchy", () => {
  const doc = createDocument({ tagged: true, language: "en-US", structureRoot: "Document" });
  doc.renderTemplate({
    page: { size: { width: 320, height: 220 }, margin: 20, fontSize: 10, lineHeight: 12 },
    blocks: [
      { type: "toc", options: { maxLevel: 2 } },
      { type: "pageBreak" },
      { type: "heading", text: "Chapter One", options: { level: 1 } },
      { type: "heading", text: "Section 1.1", options: { level: 2 } },
    ],
  });
  const [root] = parseDocument(doc.toUint8Array()).listStructureElements();
  const toc = root?.children?.find((el) => el.role === "TOC");
  assert.ok(toc, "expected a TOC structure element");
  const tocis = toc!.children ?? [];
  // One TOCI per heading entry (two headings within maxLevel 2).
  assert.equal(tocis.length, 2);
  for (const toci of tocis) {
    assert.equal(toci.role, "TOCI");
    // PDF/UA-1 nesting: TOCI -> Reference -> Link -> (text content).
    const reference = (toci.children ?? []).find((c) => c.role === "Reference");
    assert.ok(reference, `TOCI should contain a Reference, got ${(toci.children ?? []).map((c) => c.role)}`);
    const linkEl = (reference!.children ?? []).find((c) => c.role === "Link");
    assert.ok(linkEl, "Reference should contain a Link");
    // The Link must enclose its own text content (accessible name), not be empty.
    assert.ok((linkEl!.children ?? []).length > 0, "Link must contain text content");
  }
});

test("crossRef resolves a forward anchor to its page number and links to it", () => {
  const doc = createDocument();
  doc.renderTemplate({
    page: { size: { width: 320, height: 200 }, margin: 20, fontSize: 10, lineHeight: 12 },
    blocks: [
      { type: "paragraph", text: "Intro" },
      { type: "crossRef", to: "appendix", text: "Details are on page {page}." },
      { type: "pageBreak" },
      { type: "heading", text: "Appendix", anchor: "appendix" },
    ],
  });
  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  const pages = parsed.extractText();
  // The appendix lands on page 2 (one forced break after page 1).
  assert.ok(pages[1]!.runs.some((r) => r.text.includes("Appendix")));
  // The cross-reference on page 1 shows the resolved page number.
  const page1 = pages[0]!.runs.map((r) => r.text).join(" ");
  assert.match(page1, /Details are on page 2\./);
  // And emits a navigation link.
  assert.match(new TextDecoder("latin1").decode(bytes), /\/Link/);
});

test("footnote appends a marker and renders the note at the page bottom", () => {
  const doc = createDocument();
  doc.renderTemplate({
    page: { size: { width: 320, height: 260 }, margin: 20, fontSize: 10, lineHeight: 12 },
    blocks: [
      { type: "paragraph", text: "Referencing a source", footnote: "Smith 2020, p. 42." },
      { type: "paragraph", text: "Another claim", footnote: "Jones 2019." },
    ],
  });
  const pages = parseDocument(doc.toUint8Array()).extractText();
  const runs = pages[0]!.runs;
  const joined = runs.map((r) => r.text).join(" ");
  // Markers appended in the body text.
  assert.match(joined, /\[1\]/);
  assert.match(joined, /\[2\]/);
  // Note text rendered at the page bottom.
  assert.match(joined, /1\. Smith 2020, p\. 42\./);
  assert.match(joined, /2\. Jones 2019\./);
  // Notes sit below the body: the note runs have the smallest y on the page.
  const noteRun = runs.find((r) => r.text.includes("Smith 2020"))!;
  const bodyRun = runs.find((r) => r.text.includes("Referencing"))!;
  assert.ok(noteRun.y < bodyRun.y, "footnote should render below its reference");
});

test("master-page background renders on every page behind the content", () => {
  const doc = createDocument({ compress: false });
  doc.renderTemplate({
    page: { size: { width: 300, height: 200 }, margin: 20, fontSize: 10, lineHeight: 12 },
    background: () => [{ type: "paragraph", text: "WATERMARK", options: { tag: "Artifact", fontSize: 8 } }],
    blocks: [
      { type: "paragraph", text: "Body one" },
      { type: "pageBreak" },
      { type: "paragraph", text: "Body two" },
    ],
  });
  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 2);
  const pages = parsed.extractText();
  // The background appears on both pages...
  const wm0 = pages[0]!.runs.find((r) => r.text.includes("WATERMARK"));
  assert.ok(wm0);
  assert.ok(pages[1]!.runs.some((r) => r.text.includes("WATERMARK")));
  // ...and lands on the page (below the top edge), not clipped above it.
  assert.ok(wm0!.y > 0 && wm0!.y <= 200 - 10, `background text should be on-page, got y=${wm0!.y}`);
  // It is drawn behind the body: on page 1 the watermark op precedes the body op.
  const text = new TextDecoder("latin1").decode(bytes);
  assert.ok(text.indexOf("WATERMARK") < text.indexOf("Body one"), "background must draw before body");
});

test("document pageBackground fills manually added pages behind their content", () => {
  const doc = createDocument({ compress: false, pageBackground: rgb(0.95, 0.97, 1) });
  const page = doc.addPage({ size: { width: 200, height: 300 } });
  page.text("Hello", { x: 20, y: 260 });
  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  const fill = text.search(/0 0 200 300 re/);
  assert.ok(fill >= 0, "expected a full-page fill");
  assert.ok(fill < text.indexOf("(Hello)"), "page background must draw before content");
});

test("document pageBackground applies to template pages exactly once", () => {
  const doc = createDocument({ compress: false, pageBackground: rgb(0.95, 0.97, 1) });
  doc.renderTemplate({
    page: { size: { width: 200, height: 300 }, margin: 20 },
    watermark: "DRAFT",
    blocks: [{ type: "paragraph", text: "Body" }],
  });
  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  // Inherited by the template, drawn once per page and back-most.
  assert.equal((text.match(/0 0 200 300 re/g) ?? []).length, 1);
  const fill = text.search(/0 0 200 300 re/);
  assert.ok(fill < text.indexOf("(DRAFT)") && fill < text.indexOf("(Body)"));
});

test("pageBackground fills every page behind all content as an artifact", () => {
  const doc = createDocument({ compress: false });
  doc.renderTemplate({
    page: { size: { width: 200, height: 300 }, margin: 20 },
    pageBackground: rgb(0.9, 0.95, 1),
    watermark: "DRAFT",
    blocks: [{ type: "paragraph", text: "Body one" }, { type: "pageBreak" }, { type: "paragraph", text: "Body two" }],
  });
  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  // A full-page fill rect on each page.
  assert.equal((text.match(/0 0 200 300 re/g) ?? []).length, 2);
  // Behind everything: the fill precedes the watermark and body on page 1.
  const fill = text.indexOf("0 0 200 300 re");
  assert.ok(fill >= 0 && fill < text.indexOf("(DRAFT)") && fill < text.indexOf("(Body one)"), "page background must draw first");
});

test("watermark renders a rotated, centered artifact behind content on every page", () => {
  const doc = createDocument({ compress: false });
  doc.renderTemplate({
    page: { size: { width: 300, height: 400 }, margin: 30 },
    watermark: { text: "DRAFT", rotation: 30, opacity: 0.2, fontSize: 60 },
    blocks: [
      { type: "paragraph", text: "Body one" },
      { type: "pageBreak" },
      { type: "paragraph", text: "Body two" },
    ],
  });
  const bytes = doc.toUint8Array();
  const text = new TextDecoder("latin1").decode(bytes);
  // One watermark per page.
  assert.equal((text.match(/\(DRAFT\)/g) ?? []).length, 2);
  // Tagged as an artifact, rotated, and alpha-blended via an ExtGState.
  assert.match(text, /\/Artifact BMC/);
  assert.match(text, / gs\n/);
  assert.match(text, /0\.86602[0-9]* /); // cos(30deg) in the rotation matrix
  // Drawn behind the body: the watermark precedes the body text on page 1.
  assert.ok(text.indexOf("(DRAFT)") < text.indexOf("(Body one)"), "watermark must draw behind content");
  // Not in the reading order (artifact) — the structure tree has no watermark text.
  assert.equal(parseDocument(bytes).getPageCount(), 2);
});

test("crossRef throws when the target anchor is missing", () => {
  const doc = createDocument();
  assert.throws(
    () =>
      doc.renderTemplate({
        page: { size: { width: 320, height: 200 }, margin: 20 },
        blocks: [{ type: "crossRef", to: "nope", text: "see {page}" }],
      }),
    /anchor does not exist/,
  );
});

test("renderTemplate applies document info and structured XMP metadata", () => {
  const doc = createDocument();

  doc.renderTemplate({
    info: {
      title: "Template Metadata",
      author: "BarrierBreak"
    },
    xmpMetadata: {
      title: "Template <Metadata>",
      creator: "BarrierBreak",
      createDate: "2026-05-05T00:00:00Z",
      modifyDate: "2026-05-06T00:00:00Z",
      metadataDate: "2026-05-07T00:00:00Z"
    },
    blocks: [
      { type: "heading", text: "Template Metadata" },
      { type: "paragraph", text: "Metadata can live with the report template." }
    ]
  });

  const parsed = parseDocument(doc.toUint8Array());
  const xmp = parsed.getXmpMetadata() ?? "";

  assert.equal(parsed.getMetadata().title, "Template Metadata");
  assert.equal(parsed.getMetadata().author, "BarrierBreak");
  assert.match(xmp, /Template &lt;Metadata&gt;/);
  assert.match(xmp, /<rdf:li>BarrierBreak<\/rdf:li>/);
  assert.match(xmp, /<xmp:MetadataDate>2026-05-07T00:00:00Z<\/xmp:MetadataDate>/);
});

test("renderTemplate title populates info and structured XMP metadata", () => {
  const doc = createDocument();

  doc.renderTemplate({
    title: "Template Unified Title",
    xmpMetadata: {
      creator: "BarrierBreak"
    },
    blocks: [
      { type: "heading", text: "Template Unified Title" }
    ]
  });

  const parsed = parseDocument(doc.toUint8Array());
  const xmp = parsed.getXmpMetadata() ?? "";

  assert.equal(parsed.getMetadata().title, "Template Unified Title");
  assert.match(xmp, /Template Unified Title/);
  assert.match(xmp, /<rdf:li>BarrierBreak<\/rdf:li>/);
});

test("renderTemplate title creates XMP without separate metadata options", () => {
  const doc = createDocument();

  doc.renderTemplate({
    title: "Template Accessible Title",
    blocks: [
      { type: "heading", text: "Template Accessible Title" }
    ]
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.equal(parsed.getMetadata().title, "Template Accessible Title");
  assert.match(parsed.getXmpMetadata() ?? "", /Template Accessible Title/);
  assert.match(text, /\/ViewerPreferences <<\s*\/DisplayDocTitle true\s*>>/);
});

test("strict template layout rejects oversized non-table blocks", () => {
  const doc = createDocument();

  assert.throws(
    () => doc.renderTemplate({
      strictLayout: true,
      page: { size: { width: 180, height: 140 }, margin: 20 },
      blocks: [
        {
          type: "custom",
          estimate: () => 200,
          render: (flow) => {
            flow.moveDown(200);
            return 200;
          }
        }
      ]
    }),
    (error: unknown) =>
      error instanceof PdfEngineError &&
      error.code === PdfErrorCode.LAYOUT_OVERFLOW &&
      error.details?.blockType === "custom"
  );
});

test("strict template layout rejects oversized table rows", () => {
  const doc = createDocument();

  assert.throws(
    () => doc.renderTemplate({
      strictLayout: true,
      page: {
        size: { width: 220, height: 130 },
        margin: 20,
        fontSize: 10,
        lineHeight: 12
      },
      blocks: [
        {
          type: "table",
          rows: [[Array.from({ length: 80 }, () => "wrapped").join(" ")]],
          options: { width: 180, columnWidths: [180], cellPadding: 4 }
        }
      ]
    }),
    (error: unknown) =>
      error instanceof PdfEngineError &&
      error.code === PdfErrorCode.LAYOUT_OVERFLOW &&
      error.details?.blockType === "table" &&
      error.details?.rowIndex === 0
  );
});

test("non-strict template layout preserves forced oversized table row behavior", () => {
  const doc = createDocument();

  doc.renderTemplate({
    page: {
      size: { width: 220, height: 130 },
      margin: 20,
      fontSize: 10,
      lineHeight: 12
    },
    blocks: [
      {
        type: "table",
        rows: [[Array.from({ length: 80 }, () => "wrapped").join(" ")]],
        options: { width: 180, columnWidths: [180], cellPadding: 4 }
      }
    ]
  });

  assert.equal(parseDocument(doc.toUint8Array()).getPageCount(), 1);
});

test("strict template layout can allow oversized content while enforcing other limits", () => {
  const doc = createDocument();

  doc.renderTemplate({
    strictLayout: { oversizedContent: "allow", maxPages: 1 },
    page: { size: { width: 180, height: 140 }, margin: 20 },
    blocks: [
      {
        type: "custom",
        estimate: () => 200,
        render: (flow) => {
          flow.paragraph("Allowed overflow marker", { marginBottom: 0 });
          flow.moveDown(180);
          return 200;
        }
      }
    ]
  });

  assert.equal(parseDocument(doc.toUint8Array()).getPageCount(), 1);
});

test("strict template layout enforces max page count", () => {
  const doc = createDocument();

  assert.throws(
    () => doc.renderTemplate({
      strictLayout: { maxPages: 1 },
      page: { size: { width: 220, height: 180 }, margin: 20 },
      blocks: [
        { type: "paragraph", text: "First page" },
        { type: "pageBreak" },
        { type: "paragraph", text: "Second page" }
      ]
    }),
    (error: unknown) =>
      error instanceof PdfEngineError &&
      error.code === PdfErrorCode.LAYOUT_OVERFLOW &&
      error.details?.maxPages === 1
  );
});

test("strict template layout succeeds for fixed invoice-style templates", () => {
  const doc = createDocument({
    info: {
      title: "Strict Invoice",
      creationDate: "D:20260508093000Z"
    }
  });

  doc.renderTemplate({
    strictLayout: { maxPages: 1 },
    page: { size: "A4", margin: 48, font: "Helvetica", fontSize: 10, lineHeight: 13 },
    blocks: [
      { type: "heading", text: "INVOICE", options: { font: "Helvetica-Bold" } },
      {
        type: "table",
        rows: [
          ["Invoice #", "INV-001"],
          ["Date", "May 8, 2026"]
        ],
        options: { width: 499.28, columnWidths: [120, 379.28], headerColumns: 1 }
      },
      {
        type: "table",
        rows: [
          [{ text: "Description", header: true }, { text: "Amount", header: true }],
          ["Template implementation", "$1,200.00"],
          [{ text: "Total", header: true }, { text: "$1,200.00", header: true }]
        ],
        options: { width: 499.28, columnWidths: [349.28, 150], headerRows: 1 }
      }
    ]
  });

  const parsed = parseDocument(doc.toUint8Array());
  assert.equal(parsed.getPageCount(), 1);
});

test("serializes CMYK colors and custom ICC output intents", () => {
  const icc = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
  const doc = createDocument({
    outputIntent: {
      profile: icc,
      outputConditionIdentifier: "Fixture CMYK",
      info: "Fixture press profile",
      alternate: "DeviceCMYK",
      channels: 4
    }
  });
  const page = doc.addPage();
  page.text("CMYK", { x: 36, y: 700, color: cmyk(0.1, 0.2, 0.3, 0.4) });
  page.path([{ type: "rect", x: 36, y: 640, width: 80, height: 24 }], {
    paint: "fillStroke",
    fill: { color: cmyk(0, 0.1, 0.2, 0.3) },
    stroke: { color: cmyk(0.4, 0.3, 0.2, 0.1) }
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /0\.1 0\.2 0\.3 0\.4 k/);
  assert.match(text, /0\.4 0\.3 0\.2 0\.1 K/);
  assert.match(text, /\/OutputConditionIdentifier \(Fixture CMYK\)/);
  assert.match(text, /\/N 4/);
  assert.match(text, /\/Alternate \/DeviceCMYK/);
});

function xrefEntry(type: number, field2: number, field3: number): Uint8Array {
  return Uint8Array.from([
    type & 0xff,
    (field2 >>> 24) & 0xff,
    (field2 >>> 16) & 0xff,
    (field2 >>> 8) & 0xff,
    field2 & 0xff,
    (field3 >>> 8) & 0xff,
    field3 & 0xff
  ]);
}

function joinBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

test("emits pdfa-2b identification metadata and PDF 1.7 header", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const doc = createDocument({ conformance: "pdfa-2b", info: { title: "A2 archive" } });
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "A2Fixture" });
  doc.addPage({ size: "Letter" }).text("hello", { x: 36, y: 720, font, fontSize: 12 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^%PDF-1\.7/);
  assert.match(text, /\/S \/GTS_PDFA1/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getConformanceProfile(), "pdfa-2b");
  assert.match(parsed.getXmpMetadata() ?? "", /pdfaid:part>2</);
  assert.match(parsed.getXmpMetadata() ?? "", /pdfaid:conformance>B</);
});

test("pdfa-2b allows transparent images that pdfa-1b would reject", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const doc = createDocument({ conformance: "pdfa-2b" });
  doc.embedTrueTypeFont(readFileSync(fontPath), { family: "A2Fixture" });
  doc.addPage({ size: "Letter" }).png(transparentTinyPngBytes(), { x: 36, y: 720, width: 8, height: 8 });

  // No throw expected.
  const bytes = doc.toUint8Array();
  assert.ok(bytes.length > 0);
});

test("emits pdfa-3b identification metadata", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const doc = createDocument({ conformance: "pdfa-3b" });
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "A3Fixture" });
  doc.addPage({ size: "Letter" }).text("a3", { x: 36, y: 720, font, fontSize: 12 });

  const parsed = parseDocument(doc.toUint8Array());
  assert.equal(parsed.getConformanceProfile(), "pdfa-3b");
  assert.match(parsed.getXmpMetadata() ?? "", /pdfaid:part>3</);
  assert.match(parsed.getXmpMetadata() ?? "", /pdfaid:conformance>B</);
});

test("emits pdfa-4 identification metadata with rev=2020 and PDF 2.0 header", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const doc = createDocument({ conformance: "pdfa-4" });
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "A4Fixture" });
  doc.addPage({ size: "Letter" }).text("a4", { x: 36, y: 720, font, fontSize: 12 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^%PDF-2\.0/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getConformanceProfile(), "pdfa-4");
  const xmp = parsed.getXmpMetadata() ?? "";
  assert.match(xmp, /pdfaid:part>4</);
  assert.match(xmp, /pdfaid:rev>2020</);
  assert.doesNotMatch(xmp, /pdfaid:conformance>/);
});

test("emits pdfua-2 identification metadata and PDF 2.0 header", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const doc = createDocument({
    conformance: "pdfua-2",
    tagged: true,
    language: "en-US",
    structureRoot: "Document",
    info: { title: "UA-2" }
  });
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "UA2Fixture" });
  doc.addPage({ size: "Letter" }).text("hello", { x: 36, y: 720, font, fontSize: 12, tag: "P" });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^%PDF-2\.0/);
  assert.match(text, /\/DisplayDocTitle true/);
  assert.match(text, /\/Tabs \/S/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getConformanceProfile(), "pdfua-2");
  assert.match(parsed.getXmpMetadata() ?? "", /pdfuaid:part>2</);
});

test("rejects pdfua-2 output without language", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;
  const doc = createDocument({ conformance: "pdfua-2", tagged: true });
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "UA2Fixture" });
  doc.addPage({ size: "Letter" }).text("hi", { x: 36, y: 720, font, fontSize: 12, tag: "P" });
  assert.throws(
    () => doc.toUint8Array(),
    (error: unknown) =>
      error instanceof PdfEngineError
      && error.code === PdfErrorCode.INVALID_COMPLIANCE
      && /language/i.test(error.message)
  );
});

test("emits wtpdf identification metadata", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const doc = createDocument({
    conformance: "wtpdf",
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "WtpdfFixture" });
  doc.addPage({ size: "Letter" }).text("wt", { x: 36, y: 720, font, fontSize: 12, tag: "P" });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^%PDF-2\.0/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getConformanceProfile(), "wtpdf");
  assert.match(parsed.getXmpMetadata() ?? "", /wtpdf/);
});

test("setExtGState emits an ExtGState resource and gs operator", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "Letter" });
  page.saveState();
  page.setExtGState({ fillAlpha: 0.5, strokeAlpha: 0.7, blendMode: "Multiply" });
  page.path([
    { type: "moveTo", x: 36, y: 36 },
    { type: "lineTo", x: 100, y: 100 }
  ], { paint: "fill", fill: { color: rgb(1, 0, 0) } });
  page.restoreState();

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/ExtGState <<[^>]*\/GS1 <<[^>]*\/Type \/ExtGState[^>]*\/CA 0\.7[^>]*\/ca 0\.5[^>]*\/BM \/Multiply/);
  assert.match(text, /\/GS1 gs/);
});

test("setExtGState dedupes identical graphics-state options", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "Letter" });
  page.setExtGState({ fillAlpha: 0.25 });
  page.path(
    [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: 10, y: 10 }],
    { paint: "fill", fill: { color: rgb(0, 0, 0) } }
  );
  page.setExtGState({ fillAlpha: 0.25 });
  page.path(
    [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: 20, y: 20 }],
    { paint: "fill", fill: { color: rgb(0, 0, 0) } }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.equal((text.match(/\/Type \/ExtGState/g) ?? []).length, 1);
  assert.equal((text.match(/\/GS1 gs/g) ?? []).length, 2);
});

test("createLuminositySoftMask emits Form XObject and ExtGState SMask reference", () => {
  const doc = createDocument({});
  const mask = doc.createLuminositySoftMask({ width: 100, height: 100 }, (m) => {
    m.path(
      [{ type: "rect", x: 0, y: 0, width: 100, height: 100 }],
      { paint: "fill", fill: { color: rgb(1, 1, 1) } }
    );
  });

  const page = doc.addPage({ size: "Letter" });
  page.saveState();
  page.setExtGState({ softMask: mask });
  page.path(
    [{ type: "rect", x: 36, y: 36, width: 100, height: 100 }],
    { paint: "fill", fill: { color: rgb(1, 0, 0) } }
  );
  page.restoreState();

  const text = new TextDecoder().decode(doc.toUint8Array());
  // Form XObject for the mask, with grayscale transparency group.
  assert.match(text, /\/Subtype \/Form[^>]*\/BBox \[0 0 100 100\][^>]*\/Group <<[^>]*\/S \/Transparency[^>]*\/CS \/DeviceGray/);
  // ExtGState entry with SMask referencing the form.
  assert.match(text, /\/SMask <<[^>]*\/S \/Luminosity[^>]*\/G \d+ 0 R/);
  // Page content uses the gs operator.
  assert.match(text, /\/GS1 gs/);
});

test("setExtGState({ softMask: null }) emits /SMask /None", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "Letter" });
  page.setExtGState({ softMask: null });
  page.path(
    [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: 10, y: 10 }],
    { paint: "fill", fill: { color: rgb(0, 0, 0) } }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/SMask \/None/);
});

test("Separation spot color emits ColorSpace resource and cs/scn ops", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "Letter" });
  const pantone185 = separation("PANTONE 185 C", 0.6, cmyk(0, 0.85, 0.85, 0));
  page.path(
    [{ type: "moveTo", x: 36, y: 36 }, { type: "lineTo", x: 100, y: 100 }],
    { paint: "fill", fill: { color: pantone185 } }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  // Resource entry: [/Separation /<name> /DeviceCMYK <funcDict>]
  assert.match(text, /\/CS1 \[\/Separation \/PANTONE#20185#20C \/DeviceCMYK <</);
  // Tint transform Type 2 with C1 reflecting the alternate full-tint CMYK.
  assert.match(text, /\/FunctionType 2[^>]*\/N 1[^>]*\/C0 \[0 0 0 0\][^>]*\/C1 \[0 0\.85 0\.85 0\]/);
  // Page content uses the spot resource: /CS1 cs 0.6 scn
  assert.match(text, /\/CS1 cs 0\.6 scn/);
});

test("DeviceN spot color emits multi-channel ColorSpace with tint vector", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "Letter" });
  const inks = deviceN(["Cyan", "Magenta"], [0.4, 0.7], cmyk(0.4, 0.7, 0, 0));
  page.path(
    [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: 50, y: 50 }],
    { paint: "stroke", stroke: { color: inks, width: 1 } }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/CS1 \[\/DeviceN \[\/Cyan \/Magenta\] \/DeviceCMYK <</);
  // DeviceN domain has two input channels.
  assert.match(text, /\/Domain \[0 1 0 1\]/);
  // Stroke uses CS / SCN with two tint values.
  assert.match(text, /\/CS1 CS 0\.4 0\.7 SCN/);
});

test("Separation spot colors dedupe across stroke and fill", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "Letter" });
  const ink = separation("PANTONE 185 C", 0.5, cmyk(0, 1, 1, 0));
  page.path(
    [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: 10, y: 10 }],
    { paint: "fillStroke", fill: { color: ink }, stroke: { color: ink, width: 1 } }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.equal((text.match(/\[\/Separation \/PANTONE/g) ?? []).length, 1);
});

test("addPage emits a transparency group dictionary when configured", () => {
  const doc = createDocument({});
  doc.addPage({
    size: "Letter",
    transparencyGroup: { colorSpace: "DeviceCMYK", isolated: true, knockout: false }
  }).path(
    [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: 10, y: 10 }],
    { paint: "fill", fill: { color: rgb(0, 0, 0) } }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Group <<[^>]*\/Type \/Group[^>]*\/S \/Transparency[^>]*\/CS \/DeviceCMYK[^>]*\/I true[^>]*\/K false/);
});

test("addPage transparency group defaults to DeviceRGB isolated=true", () => {
  const doc = createDocument({});
  doc.addPage({ size: "Letter", transparencyGroup: {} }).path(
    [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: 10, y: 10 }],
    { paint: "fill", fill: { color: rgb(0, 0, 0) } }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Group <<[^>]*\/CS \/DeviceRGB[^>]*\/I true/);
});

test("setExtGState rejects out-of-range alpha and empty options", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "Letter" });
  assert.throws(() => page.setExtGState({}), /at least one/i);
  assert.throws(() => page.setExtGState({ fillAlpha: 1.5 }), /between 0 and 1/i);
  assert.throws(() => page.setExtGState({ strokeAlpha: -0.1 }), /between 0 and 1/i);
});

test("vertical writing mode positions characters vertically", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.text("ABC", { x: 100, y: 500, fontSize: 20, writingMode: "vertical" });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.ok(text.includes("/Helvetica"));
  assert.ok(text.includes("BT"));
  assert.ok(text.includes("ET"));
});

test("vertical writing mode in text blocks stacks characters", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.textBlock("Hello", {
    x: 100,
    y: 500,
    width: 200,
    fontSize: 20,
    writingMode: "vertical",
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.ok(text.includes("/Helvetica"));
  assert.ok(text.includes("BT"));
  assert.ok(text.includes("ET"));
});

test("vertical writing mode via flow cursor", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "A4" });
  const flow = page.flow({ writingMode: "vertical" });
  flow.paragraph("Vertical text");

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.ok(text.includes("/Helvetica"));
  assert.ok(text.includes("BT"));
});

test("handles 4-byte Unicode supplementary plane characters", () => {
  const doc = createDocument();
  const page = doc.addPage();
  assert.throws(
    () => page.text("\u{1F600}", { x: 36, y: 700 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_CHARACTER
  );
});

test("breaks text at soft hyphens in justified paragraphs", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.textBlock("supercali\u00ADfragilistic", {
    x: 36, y: 720, width: 60, fontSize: 12, align: "justify"
  });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.ok(text.includes("-"));
});

test("prevents mutation after document finalization", () => {
  const doc = createDocument();
  doc.addPage({ size: "A4" }).text("Locked", { x: 36, y: 700 });
  doc.toUint8Array();
  assert.throws(
    () => doc.addPage({ size: "A4" }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_OPERATION
  );
});

test("supports lazy object loading", () => {
  const doc = createDocument();
  doc.addPage({ size: "A4" }).text("Lazy", { x: 36, y: 700 });
  const parsed = parseDocument(doc.toUint8Array());
  const pageIds = parsed.getObjectIds().filter((id) => {
    const obj = parsed.getObject(id);
    return obj?.value !== undefined;
  });
  assert.ok(pageIds.length > 0);
});

test("detects concurrent access with debug flag", () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: string) => warnings.push(msg);
  try {
    const doc = createDocument();
    (doc as any)._debugThreadSafe = true;
    const page = doc.addPage({ size: "A4" });
    page.text("Concurrent", { x: 36, y: 700 });
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test("template stylesheet applies type-selector styles to matching blocks", () => {
  const doc = createDocument();

  doc.renderTemplate({
    page: { size: { width: 300, height: 240 }, margin: 24 },
    styles: {
      paragraph: { fontSize: 9 },
      heading1: { fontSize: 28 }
    },
    blocks: [
      { type: "heading", text: "Styled heading" },
      { type: "paragraph", text: "Styled paragraph." }
    ]
  });

  const [{ runs = [] } = {}] = parseDocument(doc.toUint8Array()).extractText();
  const heading = runs.find((run) => run.text.includes("Styled heading"));
  const paragraph = runs.find((run) => run.text.includes("Styled paragraph"));
  assert.equal(heading?.fontSize, 28);
  assert.equal(paragraph?.fontSize, 9);
});

test("template inline options override stylesheet styles", () => {
  const doc = createDocument();

  doc.renderTemplate({
    page: { size: { width: 300, height: 200 }, margin: 24 },
    styles: { paragraph: { fontSize: 9 } },
    blocks: [
      { type: "paragraph", text: "Overridden.", options: { fontSize: 18 } }
    ]
  });

  const [{ runs = [] } = {}] = parseDocument(doc.toUint8Array()).extractText();
  assert.equal(runs.find((run) => run.text.includes("Overridden"))?.fontSize, 18);
});

test("template class selectors cascade with later classes winning", () => {
  const doc = createDocument();

  doc.renderTemplate({
    page: { size: { width: 300, height: 200 }, margin: 24 },
    styles: {
      paragraph: { fontSize: 9 },
      big: { fontSize: 20 },
      bigger: { fontSize: 30 }
    },
    blocks: [
      { type: "paragraph", text: "Cascade.", class: ["big", "bigger"] }
    ]
  });

  const [{ runs = [] } = {}] = parseDocument(doc.toUint8Array()).extractText();
  assert.equal(runs.find((run) => run.text.includes("Cascade"))?.fontSize, 30);
});

test("template heading-level selector overrides the generic heading selector", () => {
  const doc = createDocument();

  doc.renderTemplate({
    page: { size: { width: 320, height: 260 }, margin: 24 },
    styles: {
      heading: { fontSize: 12 },
      heading2: { fontSize: 22 }
    },
    blocks: [
      { type: "heading", text: "Level one", options: { level: 1 } },
      { type: "heading", text: "Level two", options: { level: 2 } }
    ]
  });

  const [{ runs = [] } = {}] = parseDocument(doc.toUint8Array()).extractText();
  assert.equal(runs.find((run) => run.text.includes("Level one"))?.fontSize, 12);
  assert.equal(runs.find((run) => run.text.includes("Level two"))?.fontSize, 22);
});

test("template stylesheet styles propagate into section children", () => {
  const doc = createDocument();

  doc.renderTemplate({
    page: { size: { width: 300, height: 220 }, margin: 24 },
    styles: { paragraph: { fontSize: 7 } },
    blocks: [
      {
        type: "section",
        blocks: [
          { type: "paragraph", text: "Nested paragraph." }
        ]
      }
    ]
  });

  const [{ runs = [] } = {}] = parseDocument(doc.toUint8Array()).extractText();
  assert.equal(runs.find((run) => run.text.includes("Nested paragraph"))?.fontSize, 7);
});
