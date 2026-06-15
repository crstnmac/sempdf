import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

import { brotliDecompress } from "../src/internal/brotli.js";
import { decodeWoff2, isWoff2 } from "../src/internal/woff2.js";
import { createDocument } from "../src/index.js";
import { parseTrueTypeFont } from "../src/internal/truetype.js";

function compress(data: Uint8Array, quality: number): Uint8Array {
  return new Uint8Array(
    brotliCompressSync(data, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality } }),
  );
}

function roundtrip(data: Uint8Array, quality: number): void {
  const decoded = brotliDecompress(compress(data, quality), data.length);
  assert.equal(decoded.length, data.length, `length mismatch at quality ${quality}`);
  assert.deepEqual(decoded, data, `content mismatch at quality ${quality}`);
}

const QUALITIES = [0, 1, 5, 9, 11];

test("brotli: empty and tiny inputs", () => {
  for (const quality of QUALITIES) {
    roundtrip(new Uint8Array(0), quality);
    roundtrip(new Uint8Array([42]), quality);
    roundtrip(new TextEncoder().encode("a"), quality);
  }
});

test("brotli: ASCII text exercises UTF8 context modeling and the dictionary", () => {
  const text = new TextEncoder().encode(
    "The quick brown fox jumps over the lazy dog. " +
      "This is a test of the emergency broadcasting system, and of the world " +
      "wide web of information that the people of the world have created. ".repeat(40),
  );
  for (const quality of QUALITIES) {
    roundtrip(text, quality);
  }
});

test("brotli: UTF-8 multibyte text", () => {
  const text = new TextEncoder().encode(
    "Füße größer als Köpfe — überall ähnliche Verhältnisse. Ω≈ç√∫ 模型上下文协议 ".repeat(60),
  );
  for (const quality of QUALITIES) {
    roundtrip(text, quality);
  }
});

test("brotli: repetitive binary data uses backward references", () => {
  const pattern = new Uint8Array(64 * 1024);
  for (let i = 0; i < pattern.length; i += 1) {
    pattern[i] = (i * 7) & 0xff;
  }
  for (const quality of QUALITIES) {
    roundtrip(pattern, quality);
  }
});

test("brotli: pseudo-random data falls back to literals", () => {
  let seed = 0x2545f491;
  const next = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 24;
  };
  const random = new Uint8Array(32 * 1024);
  for (let i = 0; i < random.length; i += 1) {
    random[i] = next() & 0xff;
  }
  for (const quality of QUALITIES) {
    roundtrip(random, quality);
  }
});

function findTrueTypeFixturePath(): string | undefined {
  const candidates = [
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Geneva.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ];
  return candidates.find((path) => existsSync(path));
}

test("brotli: real font bytes (signed-context heavy binary)", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }
  const fontBytes = new Uint8Array(readFileSync(fontPath));
  for (const quality of [1, 5, 11]) {
    roundtrip(fontBytes, quality);
  }
});

// --- WOFF2 container helpers -------------------------------------------------

function uintBase128(value: number): number[] {
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.unshift(v & 0x7f);
    v = Math.floor(v / 128);
  } while (v > 0);
  for (let i = 0; i < bytes.length - 1; i += 1) {
    bytes[i]! |= 0x80;
  }
  return bytes;
}

const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
  "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
  "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
  "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

interface Woff2InputTable {
  tag: string;
  data: Uint8Array;
  transformVersion?: number;
  transformedData?: Uint8Array;
}

/** Builds a woff2 file from per-table original/transformed data. */
function buildWoff2(flavor: number, tables: Woff2InputTable[]): Uint8Array {
  const directory: number[] = [];
  const payloadParts: Uint8Array[] = [];
  for (const table of tables) {
    const knownIndex = KNOWN_TAGS.indexOf(table.tag);
    const transformVersion = table.transformVersion ?? (table.tag === "glyf" || table.tag === "loca" ? 3 : 0);
    const flags = ((transformVersion & 3) << 6) | (knownIndex >= 0 ? knownIndex : 63);
    directory.push(flags);
    if (knownIndex < 0) {
      for (let i = 0; i < 4; i += 1) directory.push(table.tag.charCodeAt(i));
    }
    directory.push(...uintBase128(table.data.length));
    const isTransformed =
      table.tag === "glyf" || table.tag === "loca" ? transformVersion === 0 : transformVersion !== 0;
    if (isTransformed) {
      const transformed = table.transformedData ?? new Uint8Array(0);
      directory.push(...uintBase128(transformed.length));
      payloadParts.push(transformed);
    } else {
      payloadParts.push(table.data);
    }
  }
  const payloadLength = payloadParts.reduce((sum, part) => sum + part.length, 0);
  const payload = new Uint8Array(payloadLength);
  let offset = 0;
  for (const part of payloadParts) {
    payload.set(part, offset);
    offset += part.length;
  }
  const compressed = compress(payload, 11);

  const header = new Uint8Array(48);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x774f4632);
  view.setUint32(4, flavor);
  view.setUint16(12, tables.length);
  view.setUint32(16, 12 + tables.length * 16 + payloadLength);
  view.setUint32(20, compressed.length);
  const total = new Uint8Array(header.length + directory.length + compressed.length);
  total.set(header, 0);
  total.set(Uint8Array.from(directory), header.length);
  total.set(compressed, header.length + directory.length);
  view.setUint32(8, total.length);
  return total;
}

function readTables(sfnt: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const numTables = view.getUint16(4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(sfnt[record]!, sfnt[record + 1]!, sfnt[record + 2]!, sfnt[record + 3]!);
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    tables.set(tag, sfnt.subarray(offset, offset + length));
  }
  return tables;
}

test("woff2: null-transform container roundtrips a real font", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }
  const original = new Uint8Array(readFileSync(fontPath));
  const originalTables = readTables(original);
  if (!originalTables.has("glyf")) {
    return; // some system fonts are CFF/other flavors
  }
  const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const flavor = view.getUint32(0);
  const inputTables: Woff2InputTable[] = [];
  for (const [tag, data] of originalTables) {
    inputTables.push({ tag, data: new Uint8Array(data) });
  }
  const woff2 = buildWoff2(flavor, inputTables);
  assert.ok(isWoff2(woff2));

  const decoded = decodeWoff2(woff2);
  const decodedTables = readTables(decoded);
  for (const [tag, data] of originalTables) {
    if (tag === "head") continue; // checkSumAdjustment is recomputed
    assert.deepEqual(decodedTables.get(tag), new Uint8Array(data), `table ${tag} mismatch`);
  }

  // The reconstructed font parses and embeds.
  const font = parseTrueTypeFont(decoded, { family: "Woff2Roundtrip" });
  assert.ok(font.unitsPerEm > 0);
  const doc = createDocument();
  const handle = doc.embedTrueTypeFont(decoded, { family: "Woff2Roundtrip" });
  doc.addPage().text("woff2", { x: 56, y: 700, font: handle, fontSize: 12 });
  assert.ok(doc.toUint8Array().length > 0);
});

// --- transformed glyf reconstruction ----------------------------------------

function write255UInt16(value: number): number[] {
  if (value < 253) return [value];
  return [253, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Encodes a square contour as a WOFF2-transformed glyf table with one simple
 * glyph (plus the empty .notdef), using the 5-byte triplet encoding (flag
 * 124/125 area) so the encoding is unambiguous.
 */
function buildTransformedGlyf(): { transformed: Uint8Array; expectedPoints: Array<[number, number]> } {
  const points: Array<[number, number]> = [
    [100, 0],
    [400, 0],
    [400, 300],
    [100, 300],
  ];
  const nContourStream: number[] = [0, 0, 0, 1]; // .notdef: 0 contours; glyph 1: 1 contour
  const nPointsStream: number[] = write255UInt16(points.length);
  const flagStream: number[] = [];
  const glyphStream: number[] = [];
  let prevX = 0;
  let prevY = 0;
  for (const [x, y] of points) {
    const dx = x - prevX;
    const dy = y - prevY;
    prevX = x;
    prevY = y;
    // flag 124-127: 4 data bytes, dx = (b0<<8)+b1, dy = (b2<<8)+b3, signs from flag bits.
    const flag = 124 + (dy > 0 || dy === 0 ? 2 : 0) + (dx > 0 || dx === 0 ? 1 : 0);
    flagStream.push(flag); // on-curve (high bit clear)
    glyphStream.push((Math.abs(dx) >> 8) & 0xff, Math.abs(dx) & 0xff, (Math.abs(dy) >> 8) & 0xff, Math.abs(dy) & 0xff);
  }
  glyphStream.push(...write255UInt16(0)); // instruction length

  const numGlyphs = 2;
  const bboxBitmap = new Uint8Array(((numGlyphs + 31) >> 5) << 2); // no explicit bboxes
  const header: number[] = [];
  const push16 = (v: number): void => {
    header.push((v >> 8) & 0xff, v & 0xff);
  };
  const push32 = (v: number): void => {
    header.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  };
  push16(0); // reserved
  push16(0); // optionFlags
  push16(numGlyphs);
  push16(0); // short loca
  push32(nContourStream.length);
  push32(nPointsStream.length);
  push32(flagStream.length);
  push32(glyphStream.length);
  push32(0); // composite
  push32(bboxBitmap.length); // bbox stream = bitmap only
  push32(0); // instructions
  const transformed = Uint8Array.from([
    ...header,
    ...nContourStream,
    ...nPointsStream,
    ...flagStream,
    ...glyphStream,
    ...bboxBitmap,
  ]);
  return { transformed, expectedPoints: points };
}

test("woff2: transformed glyf/loca reconstruct standard outlines", () => {
  const { transformed, expectedPoints } = buildTransformedGlyf();

  // Expected reconstructed glyf: glyph 0 empty; glyph 1 simple square.
  // origLength values must match the reconstruction.
  const numGlyphs = 2;
  // glyph 1: header 10 + endPts 2 + instLen 2 + flags 4 + xs/ys variable
  // dx values: 100, 300, 0, -300 / dy: 0, 0, 300, 0
  // Reconstructor emits: short x where |dx|<=255 etc. Compute expected below via decode instead.
  const minimalHead = new Uint8Array(54);
  {
    const v = new DataView(minimalHead.buffer);
    v.setUint32(0, 0x00010000);
    v.setUint32(12, 0x5f0f3cf5); // magic
    v.setUint16(18, 1000); // unitsPerEm
    v.setInt16(50, 0); // indexToLocFormat = short
  }
  const minimalMaxp = new Uint8Array(6);
  {
    const v = new DataView(minimalMaxp.buffer);
    v.setUint32(0, 0x00010000);
    v.setUint16(4, numGlyphs);
  }

  // Predict reconstructed glyf size: glyph0 = 0 bytes; glyph1:
  // 10 header + 2 endPts + 2 instLen + 4 flags + x/y bytes.
  // dxs: 100 (short, 1B), 300 (long, 2B), 0 (same, 0B), -300 (long, 2B) = 5 bytes
  // dys: 0 (same), 0 (same), 300 (long 2B), 0 (same) = 2 bytes
  const glyph1Size = 10 + 2 + 2 + 4 + 5 + 2;
  const glyfLength = (glyph1Size + 3) & ~3;
  const locaLength = (numGlyphs + 1) * 2;

  const woff2 = buildWoff2(0x00010000, [
    { tag: "head", data: minimalHead },
    { tag: "maxp", data: minimalMaxp },
    {
      tag: "glyf",
      data: new Uint8Array(glyfLength),
      transformVersion: 0,
      transformedData: transformed,
    },
    { tag: "loca", data: new Uint8Array(locaLength), transformVersion: 0, transformedData: new Uint8Array(0) },
  ]);

  const decoded = decodeWoff2(woff2);
  const tables = readTables(decoded);
  const glyf = tables.get("glyf")!;
  const loca = tables.get("loca")!;
  assert.equal(loca.length, locaLength);
  // loca: glyph0 at 0..0, glyph1 0..glyph1Size (padded)
  const locaView = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
  assert.equal(locaView.getUint16(0), 0);
  assert.equal(locaView.getUint16(2), 0);
  assert.equal(locaView.getUint16(4) * 2, glyfLength);

  // Parse glyph 1.
  const view = new DataView(glyf.buffer, glyf.byteOffset, glyf.byteLength);
  assert.equal(view.getInt16(0), 1); // 1 contour
  assert.equal(view.getInt16(2), 100); // xMin
  assert.equal(view.getInt16(4), 0); // yMin
  assert.equal(view.getInt16(6), 400); // xMax
  assert.equal(view.getInt16(8), 300); // yMax
  assert.equal(view.getUint16(10), expectedPoints.length - 1); // last endPt
  assert.equal(view.getUint16(12), 0); // no instructions

  // Decode flags/coords and compare to the source square.
  let offset = 14;
  const flags: number[] = [];
  for (let i = 0; i < expectedPoints.length; i += 1) {
    flags.push(glyf[offset]!);
    offset += 1;
  }
  const xs: number[] = [];
  let x = 0;
  for (const flag of flags) {
    if ((flag & 0x02) !== 0) {
      const value = glyf[offset]!;
      offset += 1;
      x += (flag & 0x10) !== 0 ? value : -value;
    } else if ((flag & 0x10) === 0) {
      x += view.getInt16(offset);
      offset += 2;
    }
    xs.push(x);
  }
  const ys: number[] = [];
  let yv = 0;
  for (const flag of flags) {
    if ((flag & 0x04) !== 0) {
      const value = glyf[offset]!;
      offset += 1;
      yv += (flag & 0x20) !== 0 ? value : -value;
    } else if ((flag & 0x20) === 0) {
      yv += view.getInt16(offset);
      offset += 2;
    }
    ys.push(yv);
  }
  assert.deepEqual(
    xs.map((value, i) => [value, ys[i]]),
    expectedPoints,
  );
  for (const flag of flags) {
    assert.equal(flag & 0x01, 1, "all points on-curve");
  }
});

test("woff2: rejects non-woff2 data", () => {
  assert.equal(isWoff2(new TextEncoder().encode("OTTO")), false);
  assert.throws(() => decodeWoff2(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
});

test("loadGoogleFont decodes a woff2 response via the lazy decoder", async () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }
  const original = new Uint8Array(readFileSync(fontPath));
  const originalTables = readTables(original);
  if (!originalTables.has("glyf")) {
    return;
  }
  const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const inputTables: Woff2InputTable[] = [];
  for (const [tag, data] of originalTables) {
    inputTables.push({ tag, data: new Uint8Array(data) });
  }
  const woff2 = buildWoff2(view.getUint32(0), inputTables);

  const css = `@font-face { font-family: 'X'; src: url(https://fonts.gstatic.com/s/x/x.woff2) format('woff2'); }`;
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("css2")) {
      return new Response(css, { status: 200 });
    }
    return new Response(woff2.slice(), { status: 200 });
  }) as typeof fetch;

  const { loadGoogleFont } = await import("../src/google-fonts.js");
  const bytes = await loadGoogleFont("X", { fetch: fakeFetch });
  // Returned bytes are a decoded sfnt, not the woff2 container.
  assert.equal(isWoff2(bytes), false);
  const tables = readTables(bytes);
  assert.deepEqual(tables.get("glyf"), new Uint8Array(originalTables.get("glyf")!));
});
