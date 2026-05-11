import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import { createDocument, parseDocument, PdfEngineError, PdfErrorCode } from "../src/index.js";
import type { PdfValue } from "../src/internal/pdf-primitives.js";

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

function isStreamValue(value: PdfValue): value is Extract<PdfValue, { kind: "stream" }> {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "stream";
}

function isNameValue(value: PdfValue, expected: string): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "name" && value.value === expected;
}

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
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_IMAGE
  );

  assert.throws(
    () => page.png(interlacedPng, { x: 24, y: 24, width: 50, height: 50 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_IMAGE_INTERLACE
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

test("PNG image with iccProfile emits ICCBased ColorSpace and embedded profile stream", () => {
  const fakeIcc = new Uint8Array(64);
  for (let i = 0; i < fakeIcc.length; i += 1) fakeIcc[i] = i;

  const doc = createDocument({});
  doc.addPage({ size: "Letter" }).png(tinyPngBytes(), {
    x: 36,
    y: 720,
    width: 24,
    height: 24,
    iccProfile: fakeIcc
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/N 3[^>]*\/Alternate \/DeviceRGB/);
  assert.match(text, /\/ColorSpace \[\/ICCBased \d+ 0 R\]/);
});

test("JPEG image with iccProfile emits ICCBased ColorSpace", () => {
  const fakeIcc = new Uint8Array(32);
  const doc = createDocument({});
  doc.addPage({ size: "Letter" }).jpeg(tinyJpegBytes(), {
    x: 36,
    y: 720,
    width: 24,
    height: 24,
    iccProfile: fakeIcc
  });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/ColorSpace \[\/ICCBased \d+ 0 R\]/);
  assert.match(text, /\/Filter \/DCTDecode/);
});

test("identical PNG bytes with different iccProfiles produce distinct image XObjects", () => {
  const iccA = new Uint8Array([1, 2, 3, 4]);
  const iccB = new Uint8Array([5, 6, 7, 8]);
  const doc = createDocument({});
  const page = doc.addPage({ size: "Letter" });
  page.png(tinyPngBytes(), { x: 0, y: 0, width: 8, height: 8, iccProfile: iccA });
  page.png(tinyPngBytes(), { x: 16, y: 0, width: 8, height: 8, iccProfile: iccB });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.equal((text.match(/\/Subtype \/Image/g) ?? []).length, 2);
  assert.equal((text.match(/\/ColorSpace \[\/ICCBased \d+ 0 R\]/g) ?? []).length, 2);
});

function tinyBmpBytes(): Uint8Array {
  const width = 2, height = 2, bpp = 24;
  const rowSize = Math.floor((width * bpp / 8 + 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buf = new Uint8Array(fileSize);
  const view = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4D;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, bpp, true);
  const pixels = new Uint8Array([
    255,0,0, 0,255,0, 0,0,255, 255,255,0,
    255,255,255, 128,128,128, 0,0,0, 64,64,64,
  ]);
  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 3;
    const dstRow = (height - 1 - y) * rowSize;
    buf.set(pixels.slice(srcRow, srcRow + width * 3), 54 + dstRow);
  }
  return buf;
}

function indexedPngBytes(): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = new Uint8Array([0,0,0,2, 0,0,0,2, 8, 3, 0, 0, 0]);
  const ihdr = pngChunk("IHDR", ihdrData);
  const plteData = new Uint8Array([255,0,0, 0,255,0, 0,0,255, 255,255,255]);
  const plte = pngChunk("PLTE", plteData);
  const raw = new Uint8Array([0,0,1, 0,2,3]);
  const compressed = deflateSync(raw);
  const idat = pngChunk("IDAT", compressed);
  const iend = pngChunk("IEND", new Uint8Array());
  const result = new Uint8Array(signature.length + ihdr.length + plte.length + idat.length + iend.length);
  let offset = 0;
  for (const chunk of [signature, ihdr, plte, idat, iend]) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

test("embeds 24-bit BMP images as FlateDecode XObjects", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.bmp(tinyBmpBytes(), { x: 24, y: 640, width: 48, height: 48 });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/ColorSpace \/DeviceRGB/);
  assert.match(text, /\/BitsPerComponent 8/);
});

test("rejects 1-bit BMP images", () => {
  const width = 1, height = 1, bpp = 1;
  const rowSize = Math.floor((width * bpp / 8 + 3) / 4) * 4;
  const buf = new Uint8Array(54 + rowSize * height);
  const view = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4D;
  view.setUint32(2, buf.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, bpp, true);
  const doc = createDocument();
  const page = doc.addPage();
  assert.throws(
    () => page.bmp(buf, { x: 24, y: 24, width: 48, height: 48 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_IMAGE_BIT_DEPTH,
  );
});

test("embeds indexed PNG images with palette expansion", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.png(indexedPngBytes(), { x: 40, y: 640, width: 32, height: 32 });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Subtype \/Image/);
});
