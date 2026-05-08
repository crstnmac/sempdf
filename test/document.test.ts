import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { appendPages, BufferSink, cmyk, createDocument, editDocument, extractPages, mergeDocuments, PAGE_SIZES, parseDocument, PdfEngineError, PdfErrorCode, rgb, splitDocument } from "../src/index.js";
import { StreamingByteWriter } from "../src/internal/streaming-byte-writer.js";
import { inspectPdf } from "../src/internal/inspect.js";
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

function alphaTinyPngBytes(): Uint8Array {
  const width = 1;
  const height = 1;
  const header = pngChunk("IHDR", Uint8Array.from([
    0x00, 0x00, 0x00, width,
    0x00, 0x00, 0x00, height,
    0x08,
    0x06,
    0x00,
    0x00,
    0x00
  ]));
  const scanline = Uint8Array.from([0x00, 0xff, 0x00, 0x00, 0x80]);
  const imageData = deflateSync(scanline);
  const body = pngChunk("IDAT", imageData);
  const end = pngChunk("IEND", new Uint8Array());

  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const output = new Uint8Array(signature.length + header.length + body.length + end.length);
  output.set(signature, 0);
  output.set(header, signature.length);
  output.set(body, signature.length + header.length);
  output.set(end, signature.length + header.length + body.length);
  return output;
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

function indirectLengthStreamFixtureBytes(): Uint8Array {
  const encoder = new TextEncoder();
  const header = "%PDF-1.7\n";
  const streamBody = "BT /F1 12 Tf (alpha endstream omega) Tj ET";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length 5 0 R >>\nstream\n${streamBody}\nendstream\nendobj\n`,
    `5 0 obj\n${encoder.encode(streamBody).length}\nendobj\n`
  ];
  const offsets: number[] = [];
  let cursor = encoder.encode(header).length;
  for (const object of objects) {
    offsets.push(cursor);
    cursor += encoder.encode(object).length;
  }

  const xrefOffset = cursor;
  const xrefEntries = [
    "0000000000 65535 f \n",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
  ].join("");
  const trailer = `xref\n0 6\n${xrefEntries}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return encoder.encode(`${header}${objects.join("")}${trailer}`);
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

    const font = parseTrueTypeFont(readFileSync(path), "FixtureArabicJoinScan");
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

    const font = parseTrueTypeFont(readFileSync(path), "FixtureLigatureScan");
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
  const parsedFont = parseTrueTypeFont(fontBytes, "FixtureRTL");
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
  const parsedFont = parseTrueTypeFont(fontBytes, "FixtureArabicJoin");
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

test("embeds JPEG images as deduplicated XObjects", () => {
  const jpeg = tinyJpegBytes();
  const doc = createDocument();

  const page1 = doc.addPage();
  page1.jpeg(jpeg, { x: 24, y: 600, width: 48, height: 48 });

  const page2 = doc.addPage();
  const jpegArrayBuffer = new Uint8Array(jpeg).buffer.slice(0);
  page2.jpeg(jpegArrayBuffer, { x: 36, y: 500, width: 24, height: 24 });

  const text = new TextDecoder().decode(doc.toUint8Array());
  const imageObjectMatches = text.match(/\/Subtype \/Image/g) ?? [];

  assert.equal(imageObjectMatches.length, 1);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/ColorSpace \/DeviceRGB/);
  assert.match(text, /48 0 0 48 24 600 cm/);
  assert.match(text, /24 0 0 24 36 500 cm/);
  assert.match(text, /\/Im1 Do/);
});

test("rejects unsupported image formats and invalid placement", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.jpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { x: 24, y: 24, width: 50, height: 50 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT
  );

  assert.throws(
    () => page.jpeg(tinyJpegBytes(), { x: 24, y: 24, width: 0, height: 50 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_IMAGE
  );
});

test("embeds PNG images with FlateDecode and PNG predictor parameters", () => {
  const png = tinyPngBytes();
  const doc = createDocument();
  const page = doc.addPage();

  page.png(png, { x: 40, y: 640, width: 32, height: 32 });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/Filter \/FlateDecode/);
  assert.match(text, /\/Predictor 15/);
  assert.match(text, /\/Columns 1/);
  assert.match(text, /32 0 0 32 40 640 cm/);
  assert.match(text, /\/Im1 Do/);
});

test("embeds PNG transparency masks from tRNS chunks", () => {
  const png = transparentTinyPngBytes();
  const doc = createDocument();
  const page = doc.addPage();

  page.png(png, { x: 40, y: 640, width: 32, height: 32 });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Mask \[0 0 0 0 255 255\]/);
});

test("embeds PNG alpha channels as soft masks", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.png(alphaTinyPngBytes(), { x: 24, y: 640, width: 32, height: 32 });

  const text = new TextDecoder().decode(doc.toUint8Array());
  const imageMatches = text.match(/\/Subtype \/Image/g) ?? [];
  assert.equal(imageMatches.length >= 2, true);
  assert.match(text, /\/SMask \d+ 0 R/);
  assert.doesNotMatch(text, /\/Filter \/FlateDecode[\s\S]*\/SMask/);
});

test("rejects unsupported PNG color modes and interlace settings", () => {
  const palettePng = tinyPngBytes();
  palettePng[25] = 3;

  const interlacedPng = tinyPngBytes();
  interlacedPng[28] = 1;

  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.png(palettePng, { x: 24, y: 24, width: 50, height: 50 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_IMAGE_COLOR_SPACE
  );

  assert.throws(
    () => page.png(interlacedPng, { x: 24, y: 24, width: 50, height: 50 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_IMAGE_INTERLACE
  );
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
      creators: ["Codex", "zeropdf"],
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
  assert.match(xmp, /<rdf:li>Codex<\/rdf:li><rdf:li>zeropdf<\/rdf:li>/);
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

test("serializes tagged structure elements and document language", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const page = doc.addPage({ size: "Letter" });
  page.text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  page.png(tinyPngBytes(), {
    x: 36,
    y: 640,
    width: 24,
    height: 24,
    altText: "Example logo"
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/MarkInfo <</);
  assert.match(text, /\/StructTreeRoot \d+ 0 R/);
  assert.match(text, /\/Lang \(en-US\)/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.isTagged(), true);
  assert.equal(parsed.getLanguage(), "en-US");
  assert.deepEqual(
    parsed.listStructureElements().map((element) => ({
      role: element.role,
      altText: element.altText
    })),
    [
      { role: "H1", altText: undefined },
      { role: "Figure", altText: "Example logo" }
    ]
  );
});

test("serializes extended structure roles, role maps, metadata, and tagged links", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-GB",
    structureRoot: "Document",
    roleMap: {
      CustomHeading: "H5"
    }
  });

  const page = doc.addPage({ size: "Letter" });
  page.structure("CustomHeading", {
    language: "en-US",
    actualText: "Deep heading"
  }, (heading) => {
    heading.text("Deep heading", {
      x: 36,
      y: 720,
      tag: "H5"
    });
  });
  page.container("Table", (table) => {
    table.container("TR", (row) => {
      row.text("Header", { x: 36, y: 680, tag: "Span" });
    });
  });
  page.link("https://example.com", {
    x: 36,
    y: 640,
    width: 100,
    height: 16,
    tag: "Link",
    structure: {
      altText: "Example link"
    }
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/RoleMap <<\s*\/CustomHeading \/H5\s*>>/);
  assert.match(text, /\/Type \/OBJR/);
  assert.match(text, /\/ActualText \(Deep heading\)/);
  assert.match(text, /\/Lang \(en-US\)/);

  const parsed = parseDocument(bytes);
  const [root] = parsed.listStructureElements();
  assert.equal(root?.role, "Document");
  assert.deepEqual(root?.children?.map((element) => element.role), ["CustomHeading", "Table", "Link"]);
  assert.equal(root?.children?.[0]?.actualText, "Deep heading");
  assert.equal(root?.children?.[0]?.language, "en-US");
  assert.equal(root?.children?.[2]?.altText, "Example link");
});

test("serializes tagged page links, annotations, form widgets, attributes, and path artifacts", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const first = doc.addPage({ size: "Letter" });
  const second = doc.addPage({ size: "Letter" });
  second.text("Details", { x: 36, y: 720, tag: "H1" });

  first.path(
    [{ type: "rect", x: 30, y: 700, width: 80, height: 20 }],
    { paint: "stroke", tag: "Artifact" }
  );
  first.linkToPage(second, {
    x: 36,
    y: 660,
    width: 90,
    height: 16,
    tag: "Link",
    structure: { actualText: "Go to details" }
  });
  first.highlight({
    x: 36,
    y: 630,
    width: 90,
    height: 16,
    tag: "Annot",
    structure: { altText: "Important highlight" }
  });
  first.textField("name", {
    x: 36,
    y: 590,
    width: 120,
    height: 24,
    tag: "Annot",
    structure: {
      altText: "Name field",
      attributes: {
        O: { name: "Layout" },
        RowSpan: 1,
        Headers: ["name-header"]
      }
    }
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Artifact(?: BMC| <<)/);
  assert.match(text, /\/Type \/OBJR/);
  assert.match(text, /\/A <<\s*\/O \/Layout\s*\/RowSpan 1\s*\/Headers \[\(name-header\)\]\s*\/BBox \[36 590 156 614\]\s*>>/);

  const [root] = parseDocument(bytes).listStructureElements();
  assert.equal(root?.role, "Document");
  assert.deepEqual(root?.children?.map((element) => element.role), ["Link", "Annot", "Annot", "H1"]);
  assert.equal(root?.children?.[0]?.actualText, "Go to details");
  assert.equal(root?.children?.[1]?.altText, "Important highlight");
  assert.equal(root?.children?.[2]?.altText, "Name field");
});

test("infers structure bounding boxes and supports flow-authored tagged content", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.flow({ margin: 48, width: 300 })
    .heading("Flow Report")
    .paragraph("This paragraph is tagged and laid out without caller supplied coordinates.")
    .link("Read more", "https://example.com/report")
    .png(tinyPngBytes(), {
      width: 24,
      altText: "Status icon"
    });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/S \/H1/);
  assert.match(text, /\/S \/P/);
  assert.match(text, /\/S \/Link/);
  assert.match(text, /\/S \/Figure/);
  assert.match(text, /\/BBox \[48 [0-9.]+ 72 [0-9.]+\]/);

  const [root] = parseDocument(doc.toUint8Array()).listStructureElements();
  assert.deepEqual(root?.children?.map((element) => element.role), ["H1", "P", "Link", "Figure"]);
});

test("flow block margins control placement without legacy spacing props", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: { width: 200, height: 200 } });

  page.flow({ margin: [10, 20, 30, 40] }).png(tinyPngBytes(), {
    width: 10,
    height: 10,
    altText: "Top-left margin image"
  });

  page.flow({ margin: 10 }).png(tinyPngBytes(), {
    width: 10,
    height: 10,
    marginLeft: 20,
    marginRight: 30,
    align: "right",
    altText: "Right-aligned inset image"
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/BBox \[40 180 50 190\]/);
  assert.match(text, /\/BBox \[150 180 160 190\]/);
  assert.doesNotMatch(text, /spaceBefore|spaceAfter|spaceLeft/i);
});

test("renders template blocks across pages with semantic tags", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });

  doc.renderTemplate({
    page: {
      size: { width: 240, height: 220 },
      margin: 24,
      marginBottom: 24
    },
    blocks: [
      { type: "heading", text: "Template report" },
      ...Array.from({ length: 14 }, (_, index) => ({
        type: "paragraph" as const,
        text: `Paragraph ${index + 1} in an automatically paginated template document.`
      })),
      {
        type: "table",
        rows: [
          [{ text: "Metric", header: true }, { text: "Result", header: true }],
          [{ text: "Tagged", header: true, scope: "row" }, "Yes"]
        ],
        options: { headerRows: 1, headerColumns: 1 }
      }
    ],
    header: ({ pageNumber }) => [
      { type: "paragraph", text: `Page ${pageNumber}`, options: { fontSize: 8 } }
    ]
  });

  assert.ok(doc.toUint8Array().length > 0);
  const parsed = parseDocument(doc.toUint8Array());
  assert.ok(parsed.getPageCount() > 1);

  const [root] = parsed.listStructureElements();
  const roles = root?.children?.map((element) => element.role) ?? [];
  assert.ok(roles.includes("H1"));
  assert.ok(roles.includes("P"));
  assert.ok(roles.includes("Table"));
});

test("flow advances past wrapped table cell content", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: { width: 220, height: 260 } });
  const flow = page.flow({ margin: 24, width: 120, fontSize: 10, gap: 8 });
  const startY = flow.cursorY;

  flow.table(
    [
      ["Label", "Value"],
      [
        "Long",
        "This table cell wraps across multiple lines so the flow cursor must advance by the measured row height."
      ]
    ],
    { fontSize: 10 }
  );

  assert.ok(
    flow.cursorY < startY - 50,
    `expected wrapped table to consume more than a fixed two-row height, got ${startY - flow.cursorY}`
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

test("renderTemplate applies document info and structured XMP metadata", () => {
  const doc = createDocument();

  doc.renderTemplate({
    info: {
      title: "Template Metadata",
      author: "zeropdf"
    },
    xmpMetadata: {
      title: "Template <Metadata>",
      creator: "zeropdf",
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
  assert.equal(parsed.getMetadata().author, "zeropdf");
  assert.match(xmp, /Template &lt;Metadata&gt;/);
  assert.match(xmp, /<rdf:li>zeropdf<\/rdf:li>/);
  assert.match(xmp, /<xmp:MetadataDate>2026-05-07T00:00:00Z<\/xmp:MetadataDate>/);
});

test("serializes tagged table helpers with header scopes and spans", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.table(
    [
      [
        { text: "Metric", header: true },
        { text: "Q1", header: true },
        { text: "Q2", header: true }
      ],
      [
        { text: "Revenue", header: true, scope: "row" },
        { text: "$10M", colSpan: 2, structure: { attributes: { Headers: ["q1", "q2"] } } }
      ],
      [
        { text: "Notes", header: true, rowSpan: 2 },
        "Audited",
        "Reviewed"
      ],
      [
        "Board",
        "Approved"
      ]
    ],
    {
      x: 36,
      y: 720,
      width: 300,
      columnWidths: [100, 100, 100],
      headerRows: 1,
      headerColumns: 1
    }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/S \/Table/);
  assert.match(text, /\/S \/TR/);
  assert.match(text, /\/S \/TH/);
  assert.match(text, /\/S \/TD/);
  assert.match(text, /\/Scope \/Column/);
  assert.match(text, /\/Scope \/Row/);
  assert.match(text, /\/ColSpan 2/);
  assert.match(text, /\/RowSpan 2/);
  assert.match(text, /\/Headers \[\(q1\) \(q2\)\]/);

  const [root] = parseDocument(doc.toUint8Array()).listStructureElements();
  const table = root?.children?.[0];
  assert.equal(table?.role, "Table");
  assert.deepEqual(table?.children?.map((row) => row.role), ["TR", "TR", "TR", "TR"]);
  assert.deepEqual(table?.children?.[0]?.children?.map((cell) => cell.role), ["TH", "TH", "TH"]);
});

test("inspects tagged structure content text and OBJR annotations", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.text("Quarterly Report", { x: 36, y: 720, tag: "H1" });
  page.table(
    [
      [{ text: "Metric", header: true }, { text: "Q1", header: true }],
      [{ text: "Revenue", header: true, scope: "row" }, "$10M"]
    ],
    {
      x: 36,
      y: 680,
      width: 180,
      columnWidths: [90, 90],
      headerRows: 1,
      headerColumns: 1
    }
  );
  page.textField("approval", {
    x: 36,
    y: 560,
    width: 120,
    height: 24,
    value: "Approved",
    tag: "Annot",
    structure: { altText: "Approval field" }
  });
  page.structure("Link", { actualText: "Open report" }, (link) => {
    link.text("Open report", {
      x: 36,
      y: 525,
      tag: "Span"
    });
    link.link("https://example.com/report", {
      x: 36,
      y: 521,
      width: 120,
      height: 16,
      tag: "Link"
    });
  });

  const [root] = parseDocument(doc.toUint8Array()).inspectStructureElements();
  assert.equal(root?.role, "Document");

  const heading = root?.children?.find((element) => element.role === "H1");
  assert.equal(heading?.text, "Quarterly Report");

  const table = root?.children?.find((element) => element.role === "Table");
  const firstHeader = table?.children?.[0]?.children?.[0];
  const valueCell = table?.children?.[1]?.children?.[1];
  assert.equal(firstHeader?.role, "TH");
  assert.equal(firstHeader?.text, "Metric");
  assert.equal(valueCell?.role, "TD");
  assert.equal(valueCell?.text, "$10M");

  const widget = root?.children?.find((element) => element.altText === "Approval field");
  assert.equal(widget?.annotations?.[0]?.subtype, "Widget");
  assert.equal(widget?.annotations?.[0]?.fieldName, "approval");
  assert.equal(widget?.annotations?.[0]?.fieldType, "Tx");
  assert.equal(widget?.annotations?.[0]?.value, "Approved");

  const link = root?.children?.find((element) => element.role === "Link");
  assert.equal(link?.actualText, "Open report");
  assert.deepEqual(link?.children?.map((element) => element.role), ["Span"]);
  assert.equal(link?.children?.[0]?.text, "Open report");
  assert.equal(link?.annotations?.[0]?.subtype, "Link");
  assert.equal(link?.annotations?.[0]?.url, "https://example.com/report");
});

test("serializes PDF/UA-1 identification metadata and validates required tagging inputs", () => {
  const doc = createDocument({
    conformance: "pdfua-1",
    tagged: true,
    language: "en-US",
    structureRoot: "Document",
    info: {
      title: "Accessible Document"
    }
  });
  const page = doc.addPage({ size: "Letter" });
  page.link("https://example.com/accessibility", {
    x: 36,
    y: 680,
    width: 120,
    height: 16,
    tag: "Link",
    structure: { altText: "Accessibility link" }
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/ViewerPreferences <<\s*\/DisplayDocTitle true\s*>>/);
  assert.match(text, /\/Tabs \/S/);
  assert.match(text, /\/Contents \(Accessibility link\)/);
  assert.match(text, /\/StructParent \d+/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getConformanceProfile(), "pdfua-1");
  assert.match(parsed.getXmpMetadata() ?? "", /pdfuaid:part>\s*1\s*</);
  assert.equal(parsed.inspectStructureElements()[0]?.children?.find((element) => element.role === "Link")?.annotations?.[0]?.contents, "Accessibility link");

  const invalid = createDocument({ conformance: "pdfua-1" });
  invalid.addPage({ size: "Letter" }).text("Plain", { x: 36, y: 720 });
  assert.throws(
    () => invalid.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );
});

test("reports tagged PDF accessibility warnings", () => {
  const doc = createDocument({ tagged: true });
  const page = doc.addPage();
  page.text("Heading", { x: 36, y: 720, tag: "H1" });
  page.png(tinyPngBytes(), {
    x: 36,
    y: 640,
    width: 24,
    height: 24,
    tag: "Figure"
  });

  const issues = [...doc.validateCompliance()].sort((left, right) => left.code.localeCompare(right.code));
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ["FIGURE_ALT_TEXT_RECOMMENDED", "TAGGED_LANGUAGE_RECOMMENDED"]
  );
});

test("groups wrapped tagged text blocks into a single structure element", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const page = doc.addPage({ size: "Letter" });
  page.textBlock(
    "This paragraph wraps onto multiple lines so the tagged PDF structure should keep it as one logical paragraph element.",
    {
      x: 36,
      y: 720,
      width: 140,
      fontSize: 12,
      lineHeight: 14,
      tag: "P"
    }
  );

  const parsed = parseDocument(doc.toUint8Array());
  const structureElements = parsed.listStructureElements();

  assert.equal(structureElements.length, 1);
  assert.equal(structureElements[0]?.role, "P");
  assert.ok((structureElements[0]?.mcids?.length ?? 0) > 1);
});

test("groups fallback-split tagged text into a single structure element", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const fallbackFont = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "TaggedFallback" });
  const page = doc.addPage({ size: "Letter" });
  page.text("Hello Ω", {
    x: 36,
    y: 720,
    font: "Helvetica",
    fallbackFonts: [fallbackFont],
    tag: "P",
    fontSize: 18
  });

  const parsed = parseDocument(doc.toUint8Array());
  const structureElements = parsed.listStructureElements();

  assert.equal(structureElements.length, 1);
  assert.equal(structureElements[0]?.role, "P");
  assert.ok((structureElements[0]?.mcids?.length ?? 0) >= 2);
});

test("serializes nested tagged lists as structured list elements", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const page = doc.addPage({ size: "Letter" });
  page.list(
    [
      "First item",
      {
        body: "Second item",
        children: [
          {
            body: "Nested item"
          }
        ]
      }
    ],
    {
      x: 36,
      y: 720,
      width: 220
    }
  );

  const parsed = parseDocument(doc.toUint8Array());
  const structureElements = parsed.listStructureElements();
  const list = structureElements[0];

  assert.equal(structureElements.length, 1);
  assert.equal(list?.role, "L");
  assert.deepEqual(list?.children?.map((child) => child.role), ["LI", "LI"]);
  assert.deepEqual(list?.children?.[0]?.children?.map((child) => child.role), ["Lbl", "LBody"]);
  assert.equal(list?.children?.[0]?.children?.[0]?.mcids?.length, 1);
  // PDF/UA: text inside LBody must NOT be wrapped in a separate P element.
  assert.equal((list?.children?.[0]?.children?.[1]?.mcids?.length ?? 0) > 0, true);
  assert.equal(list?.children?.[1]?.children?.[1]?.children?.[0]?.role, "L");
});

test("serializes tagged containers with nested semantic children", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const page = doc.addPage({ size: "Letter" });
  page.container("Sect", (section) => {
    section.text("Architecture", {
      x: 36,
      y: 720,
      tag: "H2"
    });
    section.container("Div", (content) => {
      content.textBlock("Body copy inside a tagged section should default to a paragraph element.", {
        x: 36,
        y: 690,
        width: 180,
        lineHeight: 14
      });
    });
  });

  const parsed = parseDocument(doc.toUint8Array());
  const structureElements = parsed.listStructureElements();
  const section = structureElements[0];

  assert.equal(structureElements.length, 1);
  assert.equal(section?.role, "Sect");
  assert.deepEqual(section?.children?.map((child) => child.role), ["H2", "Div"]);
  assert.equal(section?.children?.[1]?.children?.[0]?.role, "P");
  assert.ok((section?.children?.[1]?.children?.[0]?.mcids?.length ?? 0) > 0);
});

test("serializes pdfa-1b output intents and autogenerated conformance XMP", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument({
    conformance: "pdfa-1b",
    info: {
      title: "Archive Copy",
      creator: "Codex"
    }
  });

  const embeddedFont = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "PdfaFixture" });
  doc.addPage({ size: "Letter" }).text("Archive Copy", {
    x: 36,
    y: 720,
    font: embeddedFont,
    fontSize: 18
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/OutputIntents \[/);
  assert.match(text, /\/S \/GTS_PDFA1/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getConformanceProfile(), "pdfa-1b");
  assert.match(parsed.getXmpMetadata() ?? "", /pdfaid:part>1</);
  assert.match(parsed.getXmpMetadata() ?? "", /pdfaid:conformance>B</);
});

test("rejects pdfa-1b output that relies on built-in fonts", () => {
  const doc = createDocument({ conformance: "pdfa-1b" });
  doc.addPage({ size: "Letter" }).text("Archive Copy", { x: 36, y: 720 });

  assert.throws(
    () => doc.toUint8Array(),
    (error: unknown) =>
      error instanceof PdfEngineError
      && error.code === PdfErrorCode.INVALID_COMPLIANCE
      && /embedded fonts/i.test(error.message)
  );
});

test("incrementally edits tagged PDFs while preserving the structure tree", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const editable = editDocument(doc.toUint8Array());

  editable.editPage(0).text("Accessible note", { x: 36, y: 680, tag: "P" });
  editable.addPage({ size: "Letter" }).container("Sect", (section) => {
    section.text("Appended section", { x: 36, y: 720, tag: "H2" });
    section.textBlock("Body copy for the appended tagged page.", {
      x: 36,
      y: 690,
      width: 180
    });
  });

  const parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.isTagged(), true);
  assert.equal(parsed.getLanguage(), "en-US");
  assert.equal(parsed.getPageCount(), 2);
  assert.deepEqual(parsed.listStructureElements().map((element) => element.role), ["H1", "P", "Sect"]);
});

test("incrementally preserves existing annotation parent tree references", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });
  page.link("https://example.com", {
    x: 36,
    y: 680,
    width: 120,
    height: 16,
    tag: "Link"
  });

  const baseBytes = doc.toUint8Array();
  const baseParentTreeEntries = collectParentTreeEntries(parseDocument(baseBytes));
  const annotationEntries = [...baseParentTreeEntries.entries()].filter((entry): entry is [number, Extract<PdfValue, { kind: "ref" }>] =>
    isRefValue(entry[1])
  );
  assert.ok(annotationEntries.length > 0);

  const editable = editDocument(baseBytes);
  editable.addPage({ size: "Letter" }).text("Appended tagged paragraph", { x: 36, y: 720, tag: "P" });

  const updatedParentTreeEntries = collectParentTreeEntries(parseDocument(editable.toUint8Array()));
  for (const [key, value] of annotationEntries) {
    assert.deepEqual(updatedParentTreeEntries.get(key), value);
  }
});

test("incrementally preserves existing direct StructTreeRoot K child", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Single root heading", { x: 36, y: 720, tag: "H1" });

  const baseBytes = forceDirectStructTreeRootKid(doc.toUint8Array());
  assert.deepEqual(parseDocument(baseBytes).listStructureElements().map((element) => element.role), ["H1"]);

  const editable = editDocument(baseBytes);
  editable.addPage({ size: "Letter" }).text("Appended paragraph", { x: 36, y: 720, tag: "P" });

  const parsed = parseDocument(editable.toUint8Array());
  assert.deepEqual(parsed.listStructureElements().map((element) => element.role), ["H1", "P"]);
});

test("retags existing tagged headings through editable structure handles", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const editable = editDocument(doc.toUint8Array());

  const structure = editable.listEditableStructureElements();
  assert.equal(structure.length, 1);
  assert.equal(structure[0]?.role, "H1");

  editable.setStructureRole(structure[0]!, "H2");
  editable.editPage(0).text("Accessible note", { x: 36, y: 680, tag: "P" });
  editable.addPage({ size: "Letter" }).container("Sect", (section) => {
    section.text("Appended section", { x: 36, y: 720, tag: "H2" });
  });

  const parsed = parseDocument(editable.toUint8Array());
  assert.deepEqual(parsed.listStructureElements().map((element) => element.role), ["H2", "P", "Sect"]);
});

test("retags multiple tagged elements in one call", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });
  page.text("Heading one", { x: 36, y: 720, tag: "H1" });
  page.text("Heading two", { x: 36, y: 684, tag: "H1" });

  const editable = editDocument(doc.toUint8Array());
  editable.setStructureRoles(editable.findEditableStructureElements({ role: "H1" }), "H2");

  const parsed = parseDocument(editable.toUint8Array());
  assert.deepEqual(parsed.listStructureElements().map((element) => element.role), ["H2", "H2"]);
});

test("finds similar tagged elements by role and scope", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page1 = doc.addPage({ size: "Letter" });
  page1.text("Page one heading", { x: 36, y: 720, tag: "H1" });
  page1.text("Page one body", { x: 36, y: 684, tag: "P" });
  const page2 = doc.addPage({ size: "Letter" });
  page2.text("Page two heading", { x: 36, y: 720, tag: "H1" });

  const editable = editDocument(doc.toUint8Array());
  const firstHeading = editable.findEditableStructureElements({ role: "H1", pageObjectId: editable.listEditableStructureElements()[0]!.pageObjectId })[0]!;

  assert.equal(editable.findSimilarStructureElements(firstHeading).length, 2);
  assert.equal(editable.findSimilarStructureElements(firstHeading, { scope: "page" }).length, 1);
});

test("retags nested tagged structure elements while preserving tree shape", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).container("Sect", (section) => {
    section.text("Section heading", { x: 36, y: 720, tag: "H1" });
    section.list(
      [
        {
          body: "Item body",
          children: ["Nested child"]
        }
      ],
      {
        x: 36,
        y: 680,
        width: 180
      }
    );
  });

  const editable = editDocument(doc.toUint8Array());
  const [section] = editable.listEditableStructureElements();
  const heading = section?.children?.find((element) => element.role === "H1");
  const list = section?.children?.find((element) => element.role === "L");
  assert.ok(section);
  assert.ok(heading);
  assert.ok(list);

  editable.setStructureRole(heading!, "H2");
  editable.setStructureRole(list!, "Div");

  const parsed = parseDocument(editable.toUint8Array());
  const [parsedSection] = parsed.listStructureElements();
  assert.equal(parsedSection?.role, "Sect");
  assert.equal(parsedSection?.children?.[0]?.role, "H2");
  assert.equal(parsedSection?.children?.[1]?.role, "Div");
  assert.equal(parsedSection?.children?.[1]?.children?.[0]?.role, "LI");
});

test("updates structure alt text through editable structure handles", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).png(tinyPngBytes(), {
    x: 36,
    y: 680,
    width: 24,
    height: 24,
    altText: "Original logo"
  });

  const editable = editDocument(doc.toUint8Array());
  const figure = editable.listEditableStructureElements()[0]!;
  assert.equal(figure.role, "Figure");
  assert.equal(figure.altText, "Original logo");

  editable.setStructureAltText(figure, "Updated logo");

  const parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.listStructureElements()[0]?.altText, "Updated logo");
});

test("changes tagged structure reading order among siblings", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).container("Sect", (section) => {
    section.text("First heading", { x: 36, y: 720, tag: "H1" });
    section.text("Second heading", { x: 36, y: 684, tag: "H2" });
    section.textBlock("Body copy", { x: 36, y: 648, width: 160, tag: "P" });
  });

  const editable = editDocument(doc.toUint8Array());
  const section = editable.listEditableStructureElements()[0]!;
  const children = section.children ?? [];
  editable.setStructureReadingOrder([children[1]!, children[0]!, children[2]!]);

  const parsed = parseDocument(editable.toUint8Array());
  assert.deepEqual(parsed.listStructureElements()[0]?.children?.map((element) => element.role), ["H2", "H1", "P"]);
});

test("adds and removes structure alt text through editable structure handles", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Heading", { x: 36, y: 720, tag: "H1" });

  const editable = editDocument(doc.toUint8Array());
  const heading = editable.listEditableStructureElements()[0]!;
  assert.equal(heading.altText, undefined);

  editable.setStructureAltText(heading, "Heading for assistive tech");
  let parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.listStructureElements()[0]?.altText, "Heading for assistive tech");

  const editableAgain = editDocument(parsed.getSourceBytes());
  const updatedHeading = editableAgain.listEditableStructureElements()[0]!;
  editableAgain.setStructureAltText(updatedHeading, undefined);
  parsed = parseDocument(editableAgain.toUint8Array());
  assert.equal(parsed.listStructureElements()[0]?.altText, undefined);
});

test("treats setting the existing structure alt text as a no-op", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).png(tinyPngBytes(), {
    x: 36,
    y: 680,
    width: 24,
    height: 24,
    altText: "Original logo"
  });
  const bytes = doc.toUint8Array();
  const editable = editDocument(bytes);

  editable.setStructureAltText(editable.listEditableStructureElements()[0]!, "Original logo");

  assert.deepEqual(editable.toUint8Array(), bytes);
});

test("treats setting the existing structure role as a no-op", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const bytes = doc.toUint8Array();
  const editable = editDocument(bytes);

  editable.setStructureRole(editable.listEditableStructureElements()[0]!, "H1");

  assert.deepEqual(editable.toUint8Array(), bytes);
});

test("rejects invalid tagged structure role updates", () => {
  const taggedDoc = createDocument({ tagged: true, language: "en-US" });
  taggedDoc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const taggedEditable = editDocument(taggedDoc.toUint8Array());
  const handle = taggedEditable.listEditableStructureElements()[0]!;

  const untaggedDoc = createDocument();
  untaggedDoc.addPage({ size: "Letter" }).text("Plain heading", { x: 36, y: 720 });
  const untaggedEditable = editDocument(untaggedDoc.toUint8Array());
  assert.deepEqual(untaggedEditable.listEditableStructureElements(), []);
  assert.throws(
    () => untaggedEditable.setStructureRole(handle, "H2"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );

  const otherDoc = createDocument({ tagged: true, language: "en-US" });
  otherDoc.addPage({ size: "Letter" }).text("Other heading", { x: 36, y: 720, tag: "H1" });
  const foreignHandle = editDocument(otherDoc.toUint8Array()).listEditableStructureElements()[0]!;
  assert.throws(
    () => taggedEditable.setStructureRole(foreignHandle, "H2"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PDF
  );

  assert.throws(
    () => taggedEditable.setStructureRole({ ...handle, objectId: 99999 }, "H2"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PDF
  );

  assert.throws(
    () => taggedEditable.setStructureRole(handle, "Artifact" as unknown as "H1"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );
});

test("rejects unsafe page-order edits for tagged PDFs", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const editable = editDocument(doc.toUint8Array());

  assert.throws(
    () => editable.removePage(0),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );
});

test("incrementally edits pdfa-1b documents with compliant appended pages", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument({
    conformance: "pdfa-1b",
    info: {
      title: "Archive Copy",
      creator: "Codex"
    }
  });
  const embeddedFont = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "PdfaIncremental" });
  doc.addPage({ size: "Letter" }).text("Archive Copy", {
    x: 36,
    y: 720,
    font: embeddedFont,
    fontSize: 18
  });

  const editable = editDocument(doc.toUint8Array());
  const appendedFont = editable.embedTrueTypeFont(readFileSync(fontPath), { family: "PdfaIncrementalAppend" });
  editable.addPage({ size: "Letter" }).text("Appended Archive Copy", {
    x: 36,
    y: 720,
    font: appendedFont,
    fontSize: 18
  });

  const parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.getConformanceProfile(), "pdfa-1b");
  assert.equal(parsed.getPageCount(), 2);
});

test("rejects non-compliant incremental pdfa-1b edits", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument({
    conformance: "pdfa-1b"
  });
  const embeddedFont = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "PdfaReject" });
  doc.addPage({ size: "Letter" }).text("Archive Copy", {
    x: 36,
    y: 720,
    font: embeddedFont
  });

  const editable = editDocument(doc.toUint8Array());
  editable.addPage({ size: "Letter" }).text("Built-in font should fail", {
    x: 36,
    y: 720
  });

  assert.throws(
    () => editable.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );
});

test("serializes password-protected PDFs with permissions and hides plaintext", () => {
  const doc = createDocument({
    info: {
      title: "Protected Title"
    },
    encryption: {
      algorithm: "rc4-40",
      userPassword: "reader",
      ownerPassword: "owner-secret",
      permissions: {
        printing: false,
        modifying: false,
        copying: false,
        annotating: false
      }
    }
  });

  const page = doc.addPage({ size: "Letter" });
  page.text("Top Secret", { x: 24, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /\/Encrypt 4 0 R/);
  assert.match(text, /\/Filter \/Standard/);
  assert.match(text, /\/V 1/);
  assert.match(text, /\/R 2/);
  assert.match(text, /\/P -64/);
  assert.match(text, /\/ID \[<[0-9A-F]+> <[0-9A-F]+>\]/);
  assert.equal(text.includes("Top Secret"), false);
  assert.equal(text.includes("Protected Title"), false);

  assert.throws(
    () => parseDocument(bytes),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ENCRYPTION
  );

  assert.throws(
    () => parseDocument(bytes, { password: "wrong-password" }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ENCRYPTION
  );

  const parsed = parseDocument(bytes, { password: "reader" });
  assert.equal(parsed.getMetadata().title, "Protected Title");
  assert.equal(parsed.getPageCount(), 1);

  const ownerParsed = parseDocument(bytes, { password: "owner-secret" });
  assert.equal(ownerParsed.getMetadata().title, "Protected Title");

  assert.throws(
    () => editDocument(bytes),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ENCRYPTION
  );
});

test("defaults password-protected PDFs to rc4-128 protection", () => {
  const doc = createDocument({
    info: {
      title: "Protected 128"
    },
    encryption: {
      userPassword: "reader",
      ownerPassword: "owner-secret"
    }
  });

  doc.addPage({ size: "Letter" }).text("High Security", { x: 24, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /\/Encrypt 4 0 R/);
  assert.match(text, /\/V 2/);
  assert.match(text, /\/R 3/);
  assert.match(text, /\/Length 128/);
  assert.equal(text.includes("High Security"), false);
  assert.equal(parseDocument(bytes, { password: "reader" }).getMetadata().title, "Protected 128");
});

test("serializes and parses AES password-protected PDFs", () => {
  for (const algorithm of ["aes-128", "aes-256"] as const) {
    const doc = createDocument({
      info: { title: `Protected ${algorithm}` },
      encryption: {
        algorithm,
        userPassword: "reader",
        ownerPassword: "owner-secret"
      }
    });

    doc.addPage({ size: "Letter" }).text(`Secret ${algorithm}`, { x: 24, y: 700 });
    const bytes = doc.toUint8Array();
    const text = new TextDecoder().decode(bytes);

    assert.match(text, new RegExp(`/CFM /${algorithm === "aes-256" ? "AESV3" : "AESV2"}`));
    assert.match(text, new RegExp(`/Length ${algorithm === "aes-256" ? "256" : "128"}`));
    assert.equal(text.includes(`Secret ${algorithm}`), false);
    assert.equal(parseDocument(bytes, { password: "reader" }).getMetadata().title, `Protected ${algorithm}`);
    assert.equal(parseDocument(bytes, { password: "owner-secret" }).getPageCount(), 1);
  }
});

test("incrementally edits encrypted PDFs and preserves encryption", () => {
  const base = createDocument({
    info: {
      title: "Encrypted Draft"
    },
    encryption: {
      algorithm: "rc4-128",
      userPassword: "reader",
      ownerPassword: "owner-secret",
      permissions: {
        printing: true,
        modifying: false,
        copying: false,
        annotating: false
      }
    }
  });

  base.addPage({ size: "Letter" }).text("Classified", { x: 36, y: 720 });
  const baseBytes = base.toUint8Array();

  const editable = editDocument(baseBytes, { password: "reader" });
  editable.updateInfo({ title: "Encrypted Revision" });
  editable.addPage({ size: "Letter" }).text("Revision page", { x: 36, y: 720 });

  const updatedBytes = editable.toUint8Array();
  const updatedText = new TextDecoder().decode(updatedBytes);

  assert.match(updatedText, /\/Encrypt 4 0 R/);
  assert.match(updatedText, /\/V 2/);
  assert.match(updatedText, /\/R 3/);
  assert.match(updatedText, /\/Length 128/);
  assert.equal(updatedText.includes("Encrypted Revision"), false);
  assert.equal(updatedText.includes("Revision page"), false);

  const parsed = parseDocument(updatedBytes, { password: "reader" });
  assert.equal(parsed.getMetadata().title, "Encrypted Revision");
  assert.equal(parsed.getPageCount(), 2);

  const ownerParsed = parseDocument(updatedBytes, { password: "owner-secret" });
  assert.equal(ownerParsed.getMetadata().title, "Encrypted Revision");
  assert.equal(ownerParsed.getPageCount(), 2);
});

test("streams encrypted incremental edits with lazy encrypted streams", async () => {
  const base = createDocument({
    info: {
      title: "Encrypted Stream Base"
    },
    encryption: {
      algorithm: "rc4-128",
      userPassword: "reader",
      ownerPassword: "owner-secret"
    }
  });
  base.addPage({ size: "Letter" }).text("Base secret", { x: 36, y: 720 });

  const editable = editDocument(base.toUint8Array(), { password: "reader" });
  editable.updateInfo({ title: "Encrypted Stream Revision" });
  editable.addPage({ size: "Letter" }).text("Streamed revision page", { x: 36, y: 720 });

  const sink = new BufferSink();
  await editable.writeTo(sink);
  const bytes = sink.collect();
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /\/Length \d+ 0 R/);
  assert.equal(text.includes("Encrypted Stream Revision"), false);
  assert.equal(text.includes("Streamed revision page"), false);

  const parsed = parseDocument(bytes, { password: "reader" });
  assert.equal(parsed.getMetadata().title, "Encrypted Stream Revision");
  assert.equal(parsed.getPageCount(), 2);
});

test("rejects invalid encryption definitions", () => {
  assert.throws(
    () => createDocument({ encryption: {} }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ENCRYPTION
  );
});

test("parses image stream objects from generated PDFs", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.jpeg(tinyJpegBytes(), { x: 24, y: 600, width: 48, height: 48 });
  page.png(tinyPngBytes(), { x: 80, y: 600, width: 48, height: 48 });

  const parsed = parseDocument(doc.toUint8Array());
  const objectValues = parsed
    .getObjectIds()
    .map((id) => parsed.getObject(id)?.value)
    .filter((value): value is PdfValue => value !== undefined);
  const streamValues = objectValues.filter(isStreamValue);

  const imageStreams = streamValues.filter((stream) =>
    stream.dict.some(([key, entry]) => key === "Subtype" && isNameValue(entry, "Image"))
  );

  assert.equal(imageStreams.length, 2);
  assert.equal(
    imageStreams.some((stream) =>
      stream.dict.some(([key, entry]) => key === "Filter" && isNameValue(entry, "DCTDecode"))
    ),
    true
  );
  assert.equal(
    imageStreams.some((stream) =>
      stream.dict.some(([key, entry]) => key === "Filter" && isNameValue(entry, "FlateDecode"))
    ),
    true
  );
});

test("parses stream objects with indirect Length references exactly", () => {
  const parsed = parseDocument(indirectLengthStreamFixtureBytes());
  const streamValue = parsed.getObject(4)?.value;

  assert.ok(streamValue && isStreamValue(streamValue));
  assert.equal(new TextDecoder().decode(streamValue.bytes), "BT /F1 12 Tf (alpha endstream omega) Tj ET");
});

test("serializes URI link annotations and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.text("Open OpenAI", { x: 36, y: 700 });
  page.link("https://openai.com", {
    x: 36,
    y: 694,
    width: 120,
    height: 18,
    borderWidth: 0
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Subtype \/Link/);
  assert.match(text, /\/S \/URI/);
  assert.match(text, /\/URI \(https:\/\/openai\.com\)/);

  const parsed = parseDocument(bytes);
  const parsedPage = parsed.listPages()[0];
  const pageObject = parsedPage ? parsed.getObject(parsedPage.objectId)?.value : undefined;
  assert.equal(isDictValue(pageObject) && pageObject.some(([key]) => key === "Annots"), true);

  const annotationObject = parsed
    .getObjectIds()
    .map((id) => parsed.getObject(id)?.value)
    .find((value) =>
      isDictValue(value) && value.some(([key, entry]) => key === "Subtype" && isNameValue(entry, "Link"))
    );
  assert.equal(
    isDictValue(annotationObject) &&
      annotationObject.some(([key, entry]) => key === "Subtype" && isNameValue(entry, "Link")),
    true
  );
});

test("rejects invalid link annotations", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Has content", { x: 24, y: 700 });

  assert.throws(
    () => page.link("not-a-url", { x: 24, y: 24, width: 50, height: 20 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_LINK
  );

  assert.throws(
    () => page.link("https://openai.com", { x: 24, y: 24, width: 0, height: 20 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_LINK
  );
});

test("serializes internal page links as destinations", () => {
  const doc = createDocument();
  const firstPage = doc.addPage({ size: "Letter" });
  firstPage.text("Jump to page 2", { x: 36, y: 700 });

  const secondPage = doc.addPage({ size: "Letter" });
  secondPage.text("Destination page", { x: 36, y: 700 });

  firstPage.linkToPage(secondPage, {
    x: 36,
    y: 694,
    width: 120,
    height: 18
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Dest \[\d+ 0 R \/Fit\]/);

  const parsed = parseDocument(bytes);
  const linkAnnotation = parsed
    .getObjectIds()
    .map((id) => parsed.getObject(id)?.value)
    .find((value) =>
      isDictValue(value) && value.some(([key, entry]) => key === "Dest" && Array.isArray(entry))
    );

  assert.equal(isDictValue(linkAnnotation), true);
});

test("serializes AcroForm text fields and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.textField("customerName", {
    x: 36,
    y: 640,
    width: 180,
    height: 24,
    value: "Ada",
    font: "Courier",
    fontSize: 10,
    color: rgb(0.1, 0.2, 0.3),
    required: true
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/AcroForm \d+ 0 R/);
  assert.match(text, /\/NeedAppearances true/);
  assert.match(text, /\/Subtype \/Widget/);
  assert.match(text, /\/FT \/Tx/);
  assert.match(text, /\/T \(customerName\)/);
  assert.match(text, /\/V \(Ada\)/);
  assert.match(text, /\/DA \(\/FormF\d+ 10 Tf 0\.1 0\.2 0\.3 rg\)/);

  const parsed = parseDocument(bytes);
  const field = parsed.listFormFields()[0];

  assert.equal(field?.name, "customerName");
  assert.equal(field?.fieldType, "Tx");
  assert.equal(field?.value, "Ada");
  assert.equal(field?.pageObjectId, parsed.listPages()[0]?.objectId);
  assert.deepEqual(field?.rect, [36, 640, 216, 664]);
  assert.equal(field?.required, true);
});

test("rejects invalid text field definitions", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.textField("", { x: 24, y: 24, width: 100, height: 24 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.textField("bad-size", { x: 24, y: 24, width: 0, height: 24 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.textField("bad-value", { x: 24, y: 24, width: 100, height: 24, value: "Hello 🙂" }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_CHARACTER
  );
});

test("serializes check box widgets and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.checkBox("subscribe", {
    x: 36,
    y: 600,
    width: 16,
    height: 16,
    checked: true,
    required: true
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/FT \/Btn/);
  assert.match(text, /\/V \/Yes/);
  assert.match(text, /\/AS \/Yes/);
  assert.match(text, /\/AP << \/N << \/Off \d+ 0 R \/Yes \d+ 0 R >> >>/);
  assert.match(text, /\/Subtype \/Form/);

  const parsed = parseDocument(bytes);
  const field = parsed.listFormFields()[0];
  assert.equal(field?.name, "subscribe");
  assert.equal(field?.fieldType, "Btn");
  assert.equal(field?.checked, true);
  assert.equal(field?.required, true);
  assert.deepEqual(field?.rect, [36, 600, 52, 616]);
});

test("rejects invalid check box definitions", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.checkBox("", { x: 24, y: 24, width: 16, height: 16 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.checkBox("bad-size", { x: 24, y: 24, width: 0, height: 16 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.checkBox("bad-border", { x: 24, y: 24, width: 16, height: 16, borderWidth: -1 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );
});

test("serializes choice fields and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.choiceField("department", {
    x: 36,
    y: 560,
    width: 140,
    height: 24,
    options: ["Engineering", "Design", "Sales"],
    value: "Design",
    font: "Courier",
    fontSize: 11,
    color: rgb(0.2, 0.1, 0.4),
    required: true,
    mode: "combo"
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/FT \/Ch/);
  assert.match(text, /\/Opt \[\(Engineering\) \(Design\) \(Sales\)\]/);
  assert.match(text, /\/V \(Design\)/);
  assert.match(text, /\/Ff 131074/);
  assert.match(text, /\/DA \(\/FormF\d+ 11 Tf 0\.2 0\.1 0\.4 rg\)/);

  const parsed = parseDocument(bytes);
  const field = parsed.listFormFields()[0];
  assert.equal(field?.name, "department");
  assert.equal(field?.fieldType, "Ch");
  assert.equal(field?.value, "Design");
  assert.deepEqual(field?.options, ["Engineering", "Design", "Sales"]);
  assert.equal(field?.choiceMode, "combo");
  assert.equal(field?.required, true);
  assert.deepEqual(field?.rect, [36, 560, 176, 584]);
});

test("rejects invalid choice field definitions", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.choiceField("", { x: 24, y: 24, width: 100, height: 24, options: ["One"] }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.choiceField("empty-options", { x: 24, y: 24, width: 100, height: 24, options: [] }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.choiceField("bad-value", { x: 24, y: 24, width: 100, height: 24, options: ["One"], value: "Two" }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );
});

test("serializes radio groups and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.radioGroup("contactMethod", {
    items: [
      { value: "email", x: 36, y: 520, width: 16, height: 16 },
      { value: "phone", x: 36, y: 492, width: 16, height: 16 }
    ],
    value: "phone",
    required: true
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/FT \/Btn/);
  assert.match(text, /\/Ff 32770/);
  assert.match(text, /\/Kids \[\d+ 0 R \d+ 0 R\]/);
  assert.match(text, /\/Parent \d+ 0 R/);
  assert.match(text, /\/V \/phone/);
  assert.match(text, /\/AS \/phone/);

  const parsed = parseDocument(bytes);
  const field = parsed.listFormFields()[0];
  assert.equal(field?.name, "contactMethod");
  assert.equal(field?.fieldType, "Btn");
  assert.equal(field?.buttonKind, "radio");
  assert.equal(field?.value, "phone");
  assert.deepEqual(field?.options, ["email", "phone"]);
  assert.equal(field?.required, true);
});

test("rejects invalid radio group definitions", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.radioGroup("", { items: [{ value: "email", x: 24, y: 24, width: 16, height: 16 }] }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.radioGroup("contactMethod", { items: [] }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.radioGroup("contactMethod", {
      items: [
        { value: "email", x: 24, y: 24, width: 16, height: 16 },
        { value: "email", x: 24, y: 48, width: 16, height: 16 }
      ]
    }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );
});

test("serializes named destinations and outline bookmarks", () => {
  const doc = createDocument();
  const firstPage = doc.addPage({ size: "Letter" });
  firstPage.text("Section one", { x: 36, y: 700 });

  const secondPage = doc.addPage({ size: "Letter" });
  secondPage.text("Section two", { x: 36, y: 700 });

  doc.addNamedDestination("section-two", secondPage);
  const topLevel = doc.addOutline("Section One", firstPage);
  topLevel.addChild("Jump to section two", "section-two", { expanded: false });
  doc.addOutline("Section Two", secondPage);

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Outlines \d+ 0 R/);
  assert.match(text, /\/PageMode \/UseOutlines/);
  assert.match(text, /\/Dests << \/Names \[\(section-two\) \[\d+ 0 R \/Fit\]\] >>/);
  assert.match(text, /\/Title \(Section One\)/);
  assert.match(text, /\/Title \(Jump to section two\)/);
  assert.match(text, /\/Dest \(section-two\)/);

  const parsed = parseDocument(bytes);
  assert.deepEqual(parsed.listNamedDestinations(), [
    {
      name: "section-two",
      pageObjectId: parsed.listPages()[1]?.objectId,
      mode: "Fit"
    }
  ]);

  assert.deepEqual(parsed.listOutlines(), [
    {
      title: "Section One",
      targetPageObjectId: parsed.listPages()[0]?.objectId,
      children: [
        {
          title: "Jump to section two",
          targetName: "section-two",
          targetPageObjectId: parsed.listPages()[1]?.objectId,
          children: []
        }
      ]
    },
    {
      title: "Section Two",
      targetPageObjectId: parsed.listPages()[1]?.objectId,
      children: []
    }
  ]);
});

test("serializes page labels and embedded file attachments", () => {
  const doc = createDocument();
  const cover = doc.addPage({ size: "Letter" });
  cover.text("Cover", { x: 36, y: 700 });

  const body = doc.addPage({ size: "Letter" });
  body.text("Body", { x: 36, y: 700 });

  const appendix = doc.addPage({ size: "Letter" });
  appendix.text("Appendix", { x: 36, y: 700 });

  doc.setPageLabel(cover, { style: "decimal", prefix: "Sec-" });
  doc.setPageLabel(appendix, { style: "romanLower", prefix: "App-", startAt: 7 });
  doc.attachFile("notes.txt", new TextEncoder().encode("hi"), {
    description: "Release notes",
    mimeType: "text/plain"
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /\/PageLabels << \/Nums \[/);
  assert.match(text, /\/EmbeddedFiles << \/Names \[/);
  assert.match(text, /\/Type \/EmbeddedFile/);
  assert.match(text, /\/Subtype \/text#2Fplain/);

  const parsed = parseDocument(bytes);
  assert.deepEqual(parsed.listPageLabels(), [
    {
      startPageIndex: 0,
      style: "decimal",
      prefix: "Sec-",
      startAt: 1
    },
    {
      startPageIndex: 2,
      style: "romanLower",
      prefix: "App-",
      startAt: 7
    }
  ]);

  const attachments = parsed.listAttachments();
  assert.equal(attachments.length, 1);
  assert.deepEqual(
    attachments.map(({ objectId: _objectId, ...attachment }) => attachment),
    [
      {
        name: "notes.txt",
        description: "Release notes",
        mimeType: "text/plain",
        byteLength: 2
      }
    ]
  );
  assert.equal(typeof attachments[0]?.objectId, "number");
});

test("rejects invalid page labels and attachment definitions", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.text("Validation", { x: 36, y: 700 });

  assert.throws(
    () => doc.setPageLabel(page, {}),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PAGE_LABEL
  );

  assert.throws(
    () => doc.attachFile("", new Uint8Array([1])),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ATTACHMENT
  );

  doc.attachFile("notes.txt", new Uint8Array([1]));
  doc.attachFile("notes.txt", new Uint8Array([2]));

  assert.throws(
    () => doc.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ATTACHMENT
  );
});

test("rejects invalid named destinations and outline targets", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Outline content", { x: 24, y: 700 });

  assert.throws(
    () => doc.addNamedDestination("", page),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_DESTINATION
  );

  assert.throws(
    () => doc.addOutline(" ", page),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_OUTLINE
  );

  const foreignDoc = createDocument();
  const foreignPage = foreignDoc.addPage();
  foreignPage.text("Foreign page", { x: 24, y: 700 });

  doc.addNamedDestination("foreign", foreignPage);
  assert.throws(
    () => doc.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_DESTINATION
  );

  const secondDoc = createDocument();
  const secondPage = secondDoc.addPage();
  secondPage.text("Same document", { x: 24, y: 700 });
  secondDoc.addOutline("Broken", "missing-destination");

  assert.throws(
    () => secondDoc.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_OUTLINE
  );
});

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

test("incrementally updates metadata and appends pages", () => {
  const baseDoc = createDocument({
    info: {
      title: "Base Title",
      author: "Codex",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });

  const basePage = baseDoc.addPage({ size: "Letter" });
  basePage.text("Original page", { x: 36, y: 700 });

  const baseBytes = baseDoc.toUint8Array();
  const baseStartXref = inspectPdf(baseBytes).startXref;

  const editable = editDocument(baseBytes);
  editable.updateInfo({
    title: "Updated Title",
    modificationDate: "D:20260414091500Z"
  });

  const appendedPage = editable.addPage({ size: "Letter" });
  appendedPage.text("Appended page", { x: 36, y: 700, font: "Courier" });

  const bytes = editable.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.deepEqual(bytes.slice(0, baseBytes.length), baseBytes);
  assert.match(text, new RegExp(`/Prev ${baseStartXref}`));
  assert.match(text, /\/Title \(Updated Title\)/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(parsed.getMetadata().title, "Updated Title");
  assert.equal(parsed.getMetadata().modificationDate, "D:20260414091500Z");
  assert.deepEqual(parsed.listPages().map((page) => page.objectId).length, 2);
});

test("incrementally updates and clears XMP metadata", () => {
  const baseXmpMetadata =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Base</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';
  const updatedXmpMetadata =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Updated</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';

  const baseDoc = createDocument({
    xmpMetadata: baseXmpMetadata
  });
  baseDoc.addPage({ size: "Letter" }).text("Original page", { x: 36, y: 700 });

  const baseBytes = baseDoc.toUint8Array();
  const editable = editDocument(baseBytes);
  editable.setXmpMetadata(updatedXmpMetadata);

  const updatedBytes = editable.toUint8Array();
  assert.deepEqual(updatedBytes.slice(0, baseBytes.length), baseBytes);

  const updatedParsed = parseDocument(updatedBytes);
  assert.equal(updatedParsed.getXmpMetadata(), updatedXmpMetadata);

  const clearedEditable = editDocument(updatedBytes);
  clearedEditable.setXmpMetadata(undefined);

  const clearedParsed = parseDocument(clearedEditable.toUint8Array());
  assert.equal(clearedParsed.getXmpMetadata(), undefined);
  const catalogValue = clearedParsed.getObject(clearedParsed.getRootObjectId())?.value;
  assert.equal(isDictValue(catalogValue) && catalogValue.some(([key]) => key === "Metadata"), false);
});

test("incrementally updates existing text field values", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.textField("customerName", {
    x: 48,
    y: 620,
    width: 180,
    height: 24,
    value: "Ada"
  });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.setFieldValue("customerName", "Grace");

  const updated = parseDocument(editable.toUint8Array());
  const field = updated.listFormFields()[0];
  assert.equal(field?.name, "customerName");
  assert.equal(field?.value, "Grace");
});

test("incrementally updates existing check box values", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.checkBox("subscribe", {
    x: 48,
    y: 620,
    width: 16,
    height: 16,
    checked: false
  });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.setFieldValue("subscribe", true);

  const updated = parseDocument(editable.toUint8Array());
  const field = updated.listFormFields()[0];
  assert.equal(field?.name, "subscribe");
  assert.equal(field?.checked, true);
  assert.equal(field?.value, "Yes");
});

test("incrementally updates existing choice field values", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.choiceField("department", {
    x: 48,
    y: 620,
    width: 180,
    height: 24,
    options: ["Engineering", "Design", "Sales"],
    value: "Engineering"
  });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.setFieldValue("department", "Sales");

  const updated = parseDocument(editable.toUint8Array());
  const field = updated.listFormFields()[0];
  assert.equal(field?.name, "department");
  assert.equal(field?.fieldType, "Ch");
  assert.equal(field?.value, "Sales");
  assert.deepEqual(field?.options, ["Engineering", "Design", "Sales"]);
});

test("incrementally updates existing radio group values", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.radioGroup("contactMethod", {
    items: [
      { value: "email", x: 48, y: 620, width: 16, height: 16 },
      { value: "phone", x: 48, y: 592, width: 16, height: 16 }
    ],
    value: "email"
  });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.setFieldValue("contactMethod", "phone");

  const updated = parseDocument(editable.toUint8Array());
  const field = updated.listFormFields()[0];
  assert.equal(field?.name, "contactMethod");
  assert.equal(field?.buttonKind, "radio");
  assert.equal(field?.value, "phone");
  assert.deepEqual(field?.options, ["email", "phone"]);
});

test("rejects invalid incremental field updates", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.textField("email", {
    x: 48,
    y: 620,
    width: 180,
    height: 24,
    value: "ada@example.com"
  });
  page.checkBox("subscribe", {
    x: 48,
    y: 580,
    width: 16,
    height: 16
  });
  page.choiceField("department", {
    x: 48,
    y: 540,
    width: 180,
    height: 24,
    options: ["Engineering", "Design"]
  });
  page.radioGroup("contactMethod", {
    items: [
      { value: "email", x: 48, y: 500, width: 16, height: 16 },
      { value: "phone", x: 48, y: 472, width: 16, height: 16 }
    ]
  });

  const editable = editDocument(baseDoc.toUint8Array());

  assert.throws(
    () => editable.setFieldValue("missing", "value"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("email", true),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("subscribe", "yes"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("department", true),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("department", "Support"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("contactMethod", true),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("contactMethod", "mail"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );
});

test("returns the original bytes when no incremental changes are made", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage();
  page.text("No changes", { x: 24, y: 700 });

  const baseBytes = baseDoc.toUint8Array();
  const editable = editDocument(baseBytes);

  assert.deepEqual(editable.toUint8Array(), baseBytes);
});

test("incrementally reorders and removes existing pages", () => {
  const baseDoc = createDocument();
  const page1 = baseDoc.addPage({ size: "Letter" });
  page1.text("Page 1", { x: 36, y: 700 });
  const page2 = baseDoc.addPage({ size: "Letter" });
  page2.text("Page 2", { x: 36, y: 700 });
  const page3 = baseDoc.addPage({ size: "Letter" });
  page3.text("Page 3", { x: 36, y: 700 });

  const baseParsed = parseDocument(baseDoc.toUint8Array());
  const baseIds = baseParsed.listPages().map((page) => page.objectId);

  const editable = editDocument(baseDoc.toUint8Array());
  editable.movePage(2, 0);
  editable.removePage(1);

  const updated = parseDocument(editable.toUint8Array());
  assert.equal(updated.getPageCount(), 2);
  assert.deepEqual(updated.listPages().map((page) => page.objectId), [baseIds[2], baseIds[1]]);
});

test("incrementally inserts appended pages at a specific index", () => {
  const baseDoc = createDocument();
  const page1 = baseDoc.addPage({ size: "Letter" });
  page1.text("First", { x: 36, y: 700 });
  const page2 = baseDoc.addPage({ size: "Letter" });
  page2.text("Second", { x: 36, y: 700 });

  const baseBytes = baseDoc.toUint8Array();
  const baseIds = parseDocument(baseBytes).listPages().map((page) => page.objectId);

  const editable = editDocument(baseBytes);
  const inserted = editable.insertPage(1, { size: "Letter" });
  inserted.text("Inserted", { x: 36, y: 700 });

  const updated = parseDocument(editable.toUint8Array());
  const updatedIds = updated.listPages().map((page) => page.objectId);

  assert.equal(updated.getPageCount(), 3);
  assert.equal(updatedIds[0], baseIds[0]);
  assert.equal(updatedIds[2], baseIds[1]);
  assert.equal(updatedIds[1] !== baseIds[0] && updatedIds[1] !== baseIds[1], true);
});

test("incrementally appends AcroForm fields on new pages", () => {
  const baseDoc = createDocument();
  const basePage = baseDoc.addPage({ size: "Letter" });
  basePage.text("Base page", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  const formPage = editable.addPage({ size: "Letter" });
  formPage.textField("email", {
    x: 48,
    y: 620,
    width: 220,
    height: 24,
    value: "ada@example.com",
    readOnly: true
  });

  const parsed = parseDocument(editable.toUint8Array());
  const field = parsed.listFormFields()[0];
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(field?.name, "email");
  assert.equal(field?.pageObjectId, parsed.listPages()[1]?.objectId);
  assert.equal(field?.readOnly, true);
});

test("incrementally removes form fields when their page is removed", () => {
  const baseDoc = createDocument();
  const formPage = baseDoc.addPage({ size: "Letter" });
  formPage.textField("customerId", {
    x: 48,
    y: 620,
    width: 140,
    height: 24,
    value: "42"
  });
  const contentPage = baseDoc.addPage({ size: "Letter" });
  contentPage.text("Keep me", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.removePage(0);

  const parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.getPageCount(), 1);
  assert.equal(parsed.listFormFields().length, 0);
});

test("incrementally appends check box fields on new pages", () => {
  const baseDoc = createDocument();
  const basePage = baseDoc.addPage({ size: "Letter" });
  basePage.text("Base page", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  const formPage = editable.addPage({ size: "Letter" });
  formPage.checkBox("tosAccepted", {
    x: 48,
    y: 620,
    width: 14,
    height: 14,
    checked: true,
    readOnly: true
  });

  const parsed = parseDocument(editable.toUint8Array());
  const field = parsed.listFormFields()[0];
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(field?.name, "tosAccepted");
  assert.equal(field?.checked, true);
  assert.equal(field?.readOnly, true);
  assert.equal(field?.pageObjectId, parsed.listPages()[1]?.objectId);
});

test("incrementally appends choice fields on new pages", () => {
  const baseDoc = createDocument();
  const basePage = baseDoc.addPage({ size: "Letter" });
  basePage.text("Base page", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  const formPage = editable.addPage({ size: "Letter" });
  formPage.choiceField("department", {
    x: 48,
    y: 620,
    width: 180,
    height: 24,
    options: ["Engineering", "Design", "Sales"],
    value: "Design",
    mode: "list",
    readOnly: true
  });

  const parsed = parseDocument(editable.toUint8Array());
  const field = parsed.listFormFields()[0];
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(field?.name, "department");
  assert.equal(field?.fieldType, "Ch");
  assert.equal(field?.value, "Design");
  assert.equal(field?.choiceMode, "list");
  assert.equal(field?.readOnly, true);
  assert.equal(field?.pageObjectId, parsed.listPages()[1]?.objectId);
});

test("rejects invalid editable page indices", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage();
  page.text("Editable page", { x: 24, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());

  assert.throws(
    () => editable.removePage(1),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PAGE
  );

  assert.throws(
    () => editable.movePage(0, 1),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PAGE
  );

  assert.throws(
    () => editable.insertPage(-1),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PAGE
  );
});

test("parses xref streams and compressed object streams", () => {
  const bytes = xrefStreamFixtureBytes();
  const parsed = parseDocument(bytes);

  assert.equal(parsed.version, "1.5");
  assert.equal(parsed.getPageCount(), 1);
  assert.equal(parsed.getMetadata().title, "ObjStm PDF");
  assert.equal(parsed.getMetadata().producer, "Fixture");
  assert.deepEqual(parsed.listPages()[0]?.mediaBox, [0, 0, 612, 792]);

  const pagesObject = parsed.getObject(2)?.value;
  assert.equal(isDictValue(pagesObject) && pagesObject.some(([key, value]) => key === "Type" && isNameValue(value, "Pages")), true);
});

test("incrementally edits xref-stream PDFs by appending a new revision xref stream", () => {
  const editable = editDocument(xrefStreamFixtureBytes());
  const page = editable.addPage();
  page.text("Appended from xref stream", { x: 36, y: 700 });

  const bytes = editable.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.equal(parsed.getPageCount(), 2);
  assert.match(text, /\/Type \/XRef/);
  assert.match(text, /\/Prev \d+/);
});

test("serializes generated PDFs with compressed object streams when requested", () => {
  const doc = createDocument({ objectStreams: true, compress: true });
  const page = doc.addPage();
  page.text("Object stream body", { x: 36, y: 700 });
  page.note({ x: 36, y: 660, contents: "Packed objects" });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.match(text, /%PDF-1\.5/);
  assert.match(text, /\/Type \/ObjStm/);
  assert.match(text, /\/Type \/XRef/);
  assert.equal(parsed.getPageCount(), 1);
});

test("serializes encrypted generated PDFs with object streams", () => {
  const doc = createDocument({
    objectStreams: true,
    compress: true,
    encryption: {
      algorithm: "aes-128",
      userPassword: "reader"
    }
  });
  doc.addPage().text("Encrypted object stream body", { x: 36, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes, { password: "reader" });

  assert.match(text, /\/Type \/ObjStm/);
  assert.match(text, /\/CFM \/AESV2/);
  assert.equal(parsed.getPageCount(), 1);
});

test("incrementally adds XMP metadata to xref-stream PDFs", () => {
  const xmpMetadata =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>XRef Stream</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';

  const editable = editDocument(xrefStreamFixtureBytes());
  editable.setXmpMetadata(xmpMetadata);

  const bytes = editable.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.match(text, /\/Type \/XRef/);
  assert.equal(parsed.getXmpMetadata(), xmpMetadata);
});

test("edits existing pages by appending overlay content streams", () => {
  const baseDoc = createDocument();
  baseDoc.addPage().text("Base layer", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.editPage(0).text("Overlay layer", { x: 36, y: 680, font: "Courier" });

  const updated = parseDocument(editable.toUint8Array());
  assert.equal(updated.listPages()[0]?.contentObjectIds.length, 2);
});

test("serializes highlight, note, and free text annotations", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Annotated", { x: 36, y: 700 });
  page.highlight({ x: 34, y: 694, width: 80, height: 14, color: rgb(1, 1, 0) });
  page.note({ x: 120, y: 694, contents: "Review this" });
  page.freeText({ x: 36, y: 640, width: 140, height: 32, text: "Inline note" });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Subtype \/Highlight/);
  assert.match(text, /\/Subtype \/Text/);
  assert.match(text, /\/Subtype \/FreeText/);
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

test("serializes push buttons and signature fields through AcroForm", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Controls", { x: 36, y: 700 });
  page.pushButton("submit", { x: 36, y: 640, width: 96, height: 24, label: "Submit" });
  page.signatureField("sign-here", { x: 36, y: 600, width: 180, height: 36 });

  const parsed = parseDocument(doc.toUint8Array());
  const fields = parsed.listFormFields();
  const pushButton = fields.find((field) => field.name === "submit");
  const signatureField = fields.find((field) => field.name === "sign-here");

  assert.equal(pushButton?.buttonKind, "pushButton");
  assert.equal(signatureField?.fieldType, "Sig");
});

test("applies detached digital signatures with patched byte ranges", () => {
  let signedInput: Uint8Array | undefined;
  const cms = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
  const doc = createDocument({
    signature: {
      fieldName: "approval",
      reason: "Reviewed",
      placeholderBytes: 256,
      sign(bytes) {
        signedInput = bytes.slice();
        return cms;
      }
    }
  });
  doc.addPage().text("Signed payload", { x: 36, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const byteRange = /\/ByteRange \[0\s+(\d+)\s+(\d+)\s+(\d+)\]/.exec(text);

  assert.ok(byteRange);
  assert.ok(signedInput);
  assert.match(text, /\/FT \/Sig/);
  assert.match(text, /\/SubFilter \/adbe\.pkcs7\.detached/);
  assert.match(text, /\/Reason \(Reviewed\)/);
  assert.match(text, /\/Contents <DEADBEEF0+/);
  assert.equal(Number(byteRange[1]) + Number(byteRange[3]), signedInput!.length);
});

test("applies detached digital signatures as incremental updates", () => {
  const base = createDocument();
  base.addPage().text("Base signed payload", { x: 36, y: 700 });

  let signedInput: Uint8Array | undefined;
  const editable = editDocument(base.toUint8Array());
  editable.sign({
    fieldName: "incremental-approval",
    placeholderBytes: 128,
    sign(bytes) {
      signedInput = bytes.slice();
      return Uint8Array.from([0xca, 0xfe]);
    }
  });

  const bytes = editable.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.ok(signedInput);
  assert.match(text, /\/Prev \d+/);
  assert.match(text, /\/Contents <CAFE0+/);
  assert.equal(parsed.listFormFields().some((field) => field.name === "incremental-approval" && field.fieldType === "Sig"), true);
});

test("flattens existing AcroForm widgets into static page content", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage();
  page.textField("name", { x: 36, y: 640, width: 160, height: 24, value: "Ada" });
  page.checkBox("agree", { x: 36, y: 600, width: 18, height: 18, checked: true });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.flattenForms();

  const flattened = parseDocument(editable.toUint8Array());
  assert.equal(flattened.listFormFields().length, 0);
});

test("extracts, splits, merges, and appends pages across PDFs", () => {
  const source = createDocument();
  source.addPage().text("Page one", { x: 36, y: 700 });
  source.addPage().text("Page two", { x: 36, y: 700 });
  const sourceBytes = source.toUint8Array();

  const extracted = extractPages(sourceBytes, [1]);
  const split = splitDocument(sourceBytes);
  const merged = mergeDocuments([sourceBytes, extracted]);
  const appended = appendPages(extracted, sourceBytes, [0]);

  assert.equal(parseDocument(extracted).getPageCount(), 1);
  assert.equal(split.length, 2);
  assert.equal(parseDocument(split[0]!).getPageCount(), 1);
  assert.equal(parseDocument(split[1]!).getPageCount(), 1);
  assert.equal(parseDocument(merged).getPageCount(), 3);
  assert.equal(parseDocument(appended).getPageCount(), 2);
});

function isStreamValue(value: PdfValue): value is Extract<PdfValue, { kind: "stream" }> {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "stream";
}

function isDictValue(value: PdfValue | undefined): value is Array<[string, PdfValue]> {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string");
}

function isNameValue(value: PdfValue, expected: string): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "name" && value.value === expected;
}

function isRefValue(value: PdfValue | undefined): value is Extract<PdfValue, { kind: "ref" }> {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "ref";
}

function getDictEntry(dict: PdfValue | undefined, key: string): PdfValue | undefined {
  return isDictValue(dict) ? dict.find(([entryKey]) => entryKey === key)?.[1] : undefined;
}

function resolveTestValue(parsed: ReturnType<typeof parseDocument>, value: PdfValue | undefined): PdfValue | undefined {
  return isRefValue(value) ? parsed.getObject(value.objectId)?.value : value;
}

function collectParentTreeEntries(parsed: ReturnType<typeof parseDocument>): Map<number, PdfValue> {
  const catalog = parsed.getObject(parsed.getRootObjectId())?.value;
  const structTreeRoot = resolveTestValue(parsed, getDictEntry(catalog, "StructTreeRoot"));
  const parentTree = resolveTestValue(parsed, getDictEntry(structTreeRoot, "ParentTree"));
  const entries = new Map<number, PdfValue>();
  collectParentTreeEntriesFromNode(parsed, parentTree, entries);
  return entries;
}

function collectParentTreeEntriesFromNode(
  parsed: ReturnType<typeof parseDocument>,
  node: PdfValue | undefined,
  entries: Map<number, PdfValue>
): void {
  const resolvedNode = resolveTestValue(parsed, node);
  const nums = getDictEntry(resolvedNode, "Nums");
  if (Array.isArray(nums) && !isDictValue(nums)) {
    for (let index = 0; index < nums.length; index += 2) {
      const key = nums[index];
      const value = nums[index + 1];
      if (typeof key === "number" && value !== undefined) {
        entries.set(key, value);
      }
    }
  }

  const kids = getDictEntry(resolvedNode, "Kids");
  if (Array.isArray(kids) && !isDictValue(kids)) {
    for (const kid of kids) {
      collectParentTreeEntriesFromNode(parsed, kid, entries);
    }
  }
}

function forceDirectStructTreeRootKid(bytes: Uint8Array): Uint8Array {
  const parsed = parseDocument(bytes);
  const catalog = parsed.getObject(parsed.getRootObjectId())?.value;
  const structTreeRootRef = getDictEntry(catalog, "StructTreeRoot");
  assert.ok(isRefValue(structTreeRootRef));

  const objectOffset = parsed.xrefOffsets.get(structTreeRootRef.objectId);
  assert.notEqual(objectOffset, undefined);

  const text = Buffer.from(bytes).toString("latin1");
  const objectEnd = text.indexOf("endobj", objectOffset);
  assert.notEqual(objectEnd, -1);

  const objectText = text.slice(objectOffset, objectEnd);
  const updatedObjectText = objectText.replace(/\/K \[(\d+ 0 R)\]/, (_match, kid: string) => `/K ${kid}  `);
  assert.notEqual(updatedObjectText, objectText);
  assert.equal(updatedObjectText.length, objectText.length);

  const output = new Uint8Array(bytes);
  output.set(Buffer.from(updatedObjectText, "latin1"), objectOffset);
  return output;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type.split("").map((character) => character.charCodeAt(0)));
  const length = data.length;
  const chunk = new Uint8Array(12 + length);
  chunk[0] = (length >>> 24) & 0xff;
  chunk[1] = (length >>> 16) & 0xff;
  chunk[2] = (length >>> 8) & 0xff;
  chunk[3] = length & 0xff;
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + length));
  chunk[8 + length] = (crc >>> 24) & 0xff;
  chunk[9 + length] = (crc >>> 16) & 0xff;
  chunk[10 + length] = (crc >>> 8) & 0xff;
  chunk[11 + length] = crc & 0xff;
  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

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

test("PDF/UA Math: emits MathML embedded file and AF reference for Formula", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const mathML =
    '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>=</mo><mn>1</mn></mrow></math>';
  const doc = createDocument({
    conformance: "pdfua-2",
    tagged: true,
    language: "en-US",
    structureRoot: "Document",
    info: { title: "Math" }
  });
  doc.embedTrueTypeFont(readFileSync(fontPath), { family: "MathFixture" });
  const page = doc.addPage({ size: "Letter" });
  page.png(tinyPngBytes(), {
    x: 36,
    y: 720,
    width: 24,
    height: 24,
    tag: "Formula",
    structure: { altText: "x equals one", mathML }
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  // Catalog AF references the Formula filespec.
  assert.match(text, /\/AF \[/);
  // Filespec entry.
  assert.match(text, /\/AFRelationship \/Supplement/);
  // Embedded file Subtype names the MathML mime type.
  assert.match(text, /\/Subtype \/application#2Fmathml\+xml|\/Subtype \/application\/mathml\+xml/);
});
