/**
 * Zero-dependency WOFF2 decoder: unwraps the WOFF2 container, Brotli-decodes
 * the table data, reverses the glyf/loca and hmtx preprocessing transforms,
 * and rebuilds a standard sfnt (TTF) byte stream.
 */
import { PdfEngineError, PdfErrorCode } from "../errors.js";
import { brotliDecompress } from "./brotli.js";

function fail(message: string): never {
  throw new PdfEngineError(PdfErrorCode.INVALID_FONT, `Invalid WOFF2 data: ${message}`);
}

/** WOFF2 known table tags; flag value 63 means an explicit tag follows. */
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
  "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
  "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
  "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
] as const;

/** Sequential big-endian byte reader. */
class ByteReader {
  position = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.position;
  }

  u8(): number {
    if (this.position >= this.bytes.length) {
      fail("unexpected end of data");
    }
    const value = this.bytes[this.position]!;
    this.position += 1;
    return value;
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  i16(): number {
    const value = this.u16();
    return value >= 0x8000 ? value - 0x10000 : value;
  }

  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }

  bytesView(length: number): Uint8Array {
    if (this.position + length > this.bytes.length) {
      fail("unexpected end of data");
    }
    const view = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return view;
  }

  /** WOFF2 variable-length unsigned integer (UIntBase128, max 5 bytes). */
  uintBase128(): number {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = this.u8();
      if (i === 0 && byte === 0x80) {
        fail("UIntBase128 has a leading zero");
      }
      if (value > 0x1ffffff) {
        fail("UIntBase128 exceeds 32 bits");
      }
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        return value;
      }
    }
    fail("UIntBase128 exceeds 5 bytes");
  }

  /** WOFF2 255UInt16 variable-length unsigned short. */
  read255UInt16(): number {
    const code = this.u8();
    if (code === 253) {
      return this.u16();
    }
    if (code === 254) {
      return this.u8() + 253 * 2;
    }
    if (code === 255) {
      return this.u8() + 253;
    }
    return code;
  }
}

interface Woff2TableEntry {
  tag: string;
  transformVersion: number;
  origLength: number;
  transformLength: number | undefined;
}

interface SfntTable {
  tag: string;
  data: Uint8Array;
}

/** Triplet sign helper: even flag means negative (woff2 spec 5.2). */
function withSign(flag: number, value: number): number {
  return (flag & 1) !== 0 ? value : -value;
}

interface ReconstructedGlyf {
  glyf: Uint8Array;
  loca: Uint8Array;
  indexFormat: number;
  numGlyphs: number;
  xMins: Int16Array;
}

/** Reverses the WOFF2 glyf transform, producing standard glyf and loca tables. */
function reconstructGlyf(data: Uint8Array): ReconstructedGlyf {
  const reader = new ByteReader(data);
  reader.u16(); // reserved
  const optionFlags = reader.u16();
  const numGlyphs = reader.u16();
  const indexFormat = reader.u16();
  const nContourStreamSize = reader.u32();
  const nPointsStreamSize = reader.u32();
  const flagStreamSize = reader.u32();
  const glyphStreamSize = reader.u32();
  const compositeStreamSize = reader.u32();
  const bboxStreamSize = reader.u32();
  const instructionStreamSize = reader.u32();

  const nContourStream = new ByteReader(reader.bytesView(nContourStreamSize));
  const nPointsStream = new ByteReader(reader.bytesView(nPointsStreamSize));
  const flagStream = new ByteReader(reader.bytesView(flagStreamSize));
  const glyphStream = new ByteReader(reader.bytesView(glyphStreamSize));
  const compositeStream = new ByteReader(reader.bytesView(compositeStreamSize));
  const bboxBitmapSize = ((numGlyphs + 31) >> 5) << 2;
  const bboxBytes = reader.bytesView(bboxStreamSize);
  const bboxBitmap = bboxBytes.subarray(0, bboxBitmapSize);
  const bboxStream = new ByteReader(bboxBytes.subarray(bboxBitmapSize));
  const instructionStream = new ByteReader(reader.bytesView(instructionStreamSize));

  const glyphs: Uint8Array[] = [];
  const xMins = new Int16Array(numGlyphs);

  for (let glyphIndex = 0; glyphIndex < numGlyphs; glyphIndex += 1) {
    const nContours = nContourStream.i16();
    const hasExplicitBbox = (bboxBitmap[glyphIndex >> 3]! & (0x80 >> (glyphIndex & 7))) !== 0;

    if (nContours === 0) {
      if (hasExplicitBbox) {
        fail("empty glyph must not have an explicit bounding box");
      }
      glyphs.push(new Uint8Array(0));
      continue;
    }

    if (nContours < 0) {
      // Composite glyph: copy component records from the composite stream.
      if (!hasExplicitBbox) {
        fail("composite glyph requires an explicit bounding box");
      }
      const parts: number[] = [];
      let haveInstructions = false;
      let more = true;
      while (more) {
        const flags = compositeStream.u16();
        more = (flags & 0x0020) !== 0;
        if ((flags & 0x0100) !== 0) {
          haveInstructions = true;
        }
        let argBytes = (flags & 0x0001) !== 0 ? 4 : 2; // ARG_1_AND_2_ARE_WORDS
        if ((flags & 0x0008) !== 0) argBytes += 2; // WE_HAVE_A_SCALE
        else if ((flags & 0x0040) !== 0) argBytes += 4; // X_AND_Y_SCALE
        else if ((flags & 0x0080) !== 0) argBytes += 8; // 2x2 transform
        parts.push(flags >> 8, flags & 0xff);
        const glyphIdAndArgs = compositeStream.bytesView(2 + argBytes);
        for (const byte of glyphIdAndArgs) parts.push(byte);
      }
      const xMin = bboxStream.i16();
      const yMin = bboxStream.i16();
      const xMax = bboxStream.i16();
      const yMax = bboxStream.i16();
      xMins[glyphIndex] = xMin;
      const header: number[] = [
        0xff, 0xff, // numberOfContours = -1
        (xMin >> 8) & 0xff, xMin & 0xff,
        (yMin >> 8) & 0xff, yMin & 0xff,
        (xMax >> 8) & 0xff, xMax & 0xff,
        (yMax >> 8) & 0xff, yMax & 0xff,
      ];
      let instructions: number[] = [];
      if (haveInstructions) {
        const instructionLength = glyphStream.read255UInt16();
        const bytes = instructionStream.bytesView(instructionLength);
        instructions = [instructionLength >> 8, instructionLength & 0xff, ...bytes];
      }
      glyphs.push(Uint8Array.from([...header, ...parts, ...instructions]));
      continue;
    }

    // Simple glyph.
    const endPoints: number[] = [];
    let totalPoints = 0;
    for (let contour = 0; contour < nContours; contour += 1) {
      totalPoints += nPointsStream.read255UInt16();
      endPoints.push(totalPoints - 1);
    }
    if (totalPoints === 0) {
      fail("simple glyph has contours but no points");
    }

    const flags = new Uint8Array(totalPoints);
    const onCurve = new Uint8Array(totalPoints);
    for (let i = 0; i < totalPoints; i += 1) {
      const flagByte = flagStream.u8();
      onCurve[i] = (flagByte >> 7) === 0 ? 1 : 0;
      flags[i] = flagByte & 0x7f;
    }

    const xs = new Int16Array(totalPoints);
    const ys = new Int16Array(totalPoints);
    let x = 0;
    let y = 0;
    let xMin = 0x7fff;
    let yMin = 0x7fff;
    let xMax = -0x8000;
    let yMax = -0x8000;
    for (let i = 0; i < totalPoints; i += 1) {
      const flag = flags[i]!;
      let dx = 0;
      let dy = 0;
      if (flag < 10) {
        dy = withSign(flag, ((flag & 14) << 7) + glyphStream.u8());
      } else if (flag < 20) {
        dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphStream.u8());
      } else if (flag < 84) {
        const a = flag - 20;
        const b0 = glyphStream.u8();
        dx = withSign(flag, 1 + (a & 0x30) + (b0 >> 4));
        dy = withSign(flag >> 1, 1 + ((a & 0x0c) << 2) + (b0 & 0x0f));
      } else if (flag < 120) {
        const a = flag - 84;
        dx = withSign(flag, 1 + ((a / 12) << 8) + glyphStream.u8());
        dy = withSign(flag >> 1, 1 + (((a % 12) >> 2) << 8) + glyphStream.u8());
      } else if (flag < 124) {
        const b0 = glyphStream.u8();
        const b1 = glyphStream.u8();
        const b2 = glyphStream.u8();
        dx = withSign(flag, (b0 << 4) + (b1 >> 4));
        dy = withSign(flag >> 1, ((b1 & 0x0f) << 8) + b2);
      } else {
        const b0 = glyphStream.u8();
        const b1 = glyphStream.u8();
        const b2 = glyphStream.u8();
        const b3 = glyphStream.u8();
        dx = withSign(flag, (b0 << 8) + b1);
        dy = withSign(flag >> 1, (b2 << 8) + b3);
      }
      x += dx;
      y += dy;
      xs[i] = x;
      ys[i] = y;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }

    const instructionLength = glyphStream.read255UInt16();
    const instructions = instructionStream.bytesView(instructionLength);

    if (hasExplicitBbox) {
      xMin = bboxStream.i16();
      yMin = bboxStream.i16();
      xMax = bboxStream.i16();
      yMax = bboxStream.i16();
    }
    xMins[glyphIndex] = xMin;

    // Emit a standard simple glyph: header, endpoints, instructions, flags
    // (with repeat compression omitted), and delta-encoded coordinates.
    const out: number[] = [
      (nContours >> 8) & 0xff, nContours & 0xff,
      (xMin >> 8) & 0xff, xMin & 0xff,
      (yMin >> 8) & 0xff, yMin & 0xff,
      (xMax >> 8) & 0xff, xMax & 0xff,
      (yMax >> 8) & 0xff, yMax & 0xff,
    ];
    for (const endPoint of endPoints) {
      out.push((endPoint >> 8) & 0xff, endPoint & 0xff);
    }
    out.push((instructionLength >> 8) & 0xff, instructionLength & 0xff);
    for (const byte of instructions) out.push(byte);

    // Build per-point sfnt flags and coordinate encodings.
    const sfntFlags: number[] = [];
    const xBytes: number[] = [];
    const yBytes: number[] = [];
    let previousX = 0;
    let previousY = 0;
    for (let i = 0; i < totalPoints; i += 1) {
      const dx = xs[i]! - previousX;
      const dy = ys[i]! - previousY;
      previousX = xs[i]!;
      previousY = ys[i]!;
      let flag = onCurve[i] === 1 ? 0x01 : 0x00;
      if (dx === 0) {
        flag |= 0x10; // x is same
      } else if (dx >= -255 && dx <= 255) {
        flag |= 0x02 | (dx > 0 ? 0x10 : 0); // x short
        xBytes.push(Math.abs(dx));
      } else {
        xBytes.push((dx >> 8) & 0xff, dx & 0xff);
      }
      if (dy === 0) {
        flag |= 0x20; // y is same
      } else if (dy >= -255 && dy <= 255) {
        flag |= 0x04 | (dy > 0 ? 0x20 : 0); // y short
        yBytes.push(Math.abs(dy));
      } else {
        yBytes.push((dy >> 8) & 0xff, dy & 0xff);
      }
      sfntFlags.push(flag);
    }
    out.push(...sfntFlags, ...xBytes, ...yBytes);
    glyphs.push(Uint8Array.from(out));
  }

  // Assemble glyf with 4-byte glyph alignment and the matching loca table.
  const offsets: number[] = [0];
  let glyfLength = 0;
  for (const glyph of glyphs) {
    glyfLength += (glyph.length + 3) & ~3;
    offsets.push(glyfLength);
  }
  const glyf = new Uint8Array(glyfLength);
  let writeOffset = 0;
  for (const glyph of glyphs) {
    glyf.set(glyph, writeOffset);
    writeOffset += (glyph.length + 3) & ~3;
  }

  const useLongLoca = indexFormat !== 0;
  if (!useLongLoca && glyfLength > 0x1fffe) {
    fail("short loca cannot address the reconstructed glyf table");
  }
  const loca = new Uint8Array(useLongLoca ? (numGlyphs + 1) * 4 : (numGlyphs + 1) * 2);
  for (let i = 0; i <= numGlyphs; i += 1) {
    const offset = offsets[i]!;
    if (useLongLoca) {
      loca[i * 4] = (offset >>> 24) & 0xff;
      loca[i * 4 + 1] = (offset >>> 16) & 0xff;
      loca[i * 4 + 2] = (offset >>> 8) & 0xff;
      loca[i * 4 + 3] = offset & 0xff;
    } else {
      const half = offset >> 1;
      loca[i * 2] = (half >> 8) & 0xff;
      loca[i * 2 + 1] = half & 0xff;
    }
  }

  return { glyf, loca, indexFormat, numGlyphs, xMins };
}

/** Reverses the WOFF2 hmtx transform using glyph xMin values for elided LSBs. */
function reconstructHmtx(
  data: Uint8Array,
  numGlyphs: number,
  numHMetrics: number,
  xMins: Int16Array,
): Uint8Array {
  const reader = new ByteReader(data);
  const flags = reader.u8();
  const lsbsOmitted = (flags & 0x01) !== 0;
  const leftSideBearingsOmitted = (flags & 0x02) !== 0;
  if ((flags & 0xfc) !== 0) {
    fail("reserved hmtx transform flags set");
  }
  if (!lsbsOmitted && !leftSideBearingsOmitted) {
    fail("hmtx transform applied without any elided side bearings");
  }

  const advances: number[] = [];
  for (let i = 0; i < numHMetrics; i += 1) {
    advances.push(reader.u16());
  }
  const proportionalLsbs: number[] = [];
  if (!lsbsOmitted) {
    for (let i = 0; i < numHMetrics; i += 1) {
      proportionalLsbs.push(reader.i16());
    }
  }
  const monospaceLsbs: number[] = [];
  if (!leftSideBearingsOmitted) {
    for (let i = numHMetrics; i < numGlyphs; i += 1) {
      monospaceLsbs.push(reader.i16());
    }
  }

  const out = new Uint8Array(numHMetrics * 4 + (numGlyphs - numHMetrics) * 2);
  let offset = 0;
  for (let i = 0; i < numHMetrics; i += 1) {
    const advance = advances[i]!;
    const lsb = lsbsOmitted ? xMins[i]! : proportionalLsbs[i]!;
    out[offset] = (advance >> 8) & 0xff;
    out[offset + 1] = advance & 0xff;
    out[offset + 2] = (lsb >> 8) & 0xff;
    out[offset + 3] = lsb & 0xff;
    offset += 4;
  }
  for (let i = numHMetrics; i < numGlyphs; i += 1) {
    const lsb = leftSideBearingsOmitted ? xMins[i]! : monospaceLsbs[i - numHMetrics]!;
    out[offset] = (lsb >> 8) & 0xff;
    out[offset + 1] = lsb & 0xff;
    offset += 2;
  }
  return out;
}

function readTag(view: Uint8Array, offset: number): string {
  return String.fromCodePoint(view[offset]!, view[offset + 1]!, view[offset + 2]!, view[offset + 3]!);
}

function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word =
      ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    sum = (sum + word) >>> 0;
  }
  return sum;
}

/** Orders sfnt table tags by their ASCII byte order, as the spec requires. */
function compareSfntTags(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Rebuilds an sfnt (TTF/OTF) byte stream from reconstructed tables. */
function buildSfnt(flavor: number, tables: SfntTable[]): Uint8Array {
  const sorted = [...tables].sort((left, right) => compareSfntTags(left.tag, right.tag));
  const numTables = sorted.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector += 1;
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;

  const headerSize = 12 + numTables * 16;
  let totalSize = headerSize;
  const offsets: number[] = [];
  for (const table of sorted) {
    offsets.push(totalSize);
    totalSize += (table.data.length + 3) & ~3;
  }

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, flavor);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, rangeShift);

  let headIndex = -1;
  for (let i = 0; i < numTables; i += 1) {
    const table = sorted[i]!;
    const recordOffset = 12 + i * 16;
    for (let c = 0; c < 4; c += 1) {
      out[recordOffset + c] = table.tag.codePointAt(c)!;
    }
    if (table.tag === "head") {
      headIndex = i;
      // Zero checkSumAdjustment before computing checksums.
      table.data[8] = 0;
      table.data[9] = 0;
      table.data[10] = 0;
      table.data[11] = 0;
    }
    view.setUint32(recordOffset + 4, tableChecksum(table.data));
    view.setUint32(recordOffset + 8, offsets[i]!);
    view.setUint32(recordOffset + 12, table.data.length);
    out.set(table.data, offsets[i]!);
  }

  if (headIndex >= 0) {
    const adjustment = (0xb1b0afba - tableChecksum(out)) >>> 0;
    view.setUint32(offsets[headIndex]! + 8, adjustment);
  }
  return out;
}

/**
 * Decodes a WOFF2 font file into standard sfnt (TTF/OTF) bytes.
 *
 * @param data The WOFF2 file bytes.
 *
 * @returns The decoded sfnt bytes, ready for TrueType embedding.
 */
export function decodeWoff2(data: Uint8Array): Uint8Array {
  const reader = new ByteReader(data);
  const signature = reader.u32();
  if (signature !== 0x774f4632) {
    fail("missing wOF2 signature");
  }
  const flavor = reader.u32();
  reader.u32(); // length
  const numTables = reader.u16();
  reader.u16(); // reserved
  const totalSfntSize = reader.u32();
  const totalCompressedSize = reader.u32();
  reader.u16(); // majorVersion
  reader.u16(); // minorVersion
  reader.u32(); // metaOffset
  reader.u32(); // metaLength
  reader.u32(); // metaOrigLength
  reader.u32(); // privOffset
  reader.u32(); // privLength

  const entries: Woff2TableEntry[] = [];
  let decompressedSize = 0;
  for (let i = 0; i < numTables; i += 1) {
    const flags = reader.u8();
    const tagIndex = flags & 0x3f;
    const tag = tagIndex === 63 ? readTag(reader.bytesView(4), 0) : KNOWN_TAGS[tagIndex]!;
    const transformVersion = (flags >> 6) & 0x03;
    const origLength = reader.uintBase128();
    // glyf and loca interpret transform version 0 as "transformed"; all other
    // tables treat version 0 as the null transform.
    const isTransformed =
      tag === "glyf" || tag === "loca" ? transformVersion === 0 : transformVersion !== 0;
    let transformLength: number | undefined;
    if (isTransformed) {
      transformLength = reader.uintBase128();
    }
    entries.push({ tag, transformVersion, origLength, transformLength });
    decompressedSize += transformLength ?? origLength;
  }

  const compressed = reader.bytesView(totalCompressedSize);
  const decompressed = brotliDecompress(compressed, decompressedSize);
  if (decompressed.length !== decompressedSize) {
    fail(
      `decompressed table data has ${decompressed.length} bytes, expected ${decompressedSize}`,
    );
  }

  // Slice the decompressed stream into per-table data.
  const rawTables = new Map<string, { entry: Woff2TableEntry; data: Uint8Array }>();
  let offset = 0;
  for (const entry of entries) {
    const length = entry.transformLength ?? entry.origLength;
    rawTables.set(entry.tag, { entry, data: decompressed.subarray(offset, offset + length) });
    offset += length;
  }

  // Reconstruct transformed tables.
  let reconstructedGlyf: ReconstructedGlyf | undefined;
  const glyfEntry = rawTables.get("glyf");
  if (glyfEntry?.entry.transformVersion === 0) {
    const locaEntry = rawTables.get("loca");
    if (locaEntry?.entry.transformVersion !== 0) {
      fail("transformed glyf requires a transformed loca");
    }
    if ((locaEntry.entry.transformLength ?? 0) !== 0) {
      fail("transformed loca must have zero transform length");
    }
    reconstructedGlyf = reconstructGlyf(glyfEntry.data);
  }

  const tables: SfntTable[] = [];
  for (const entry of entries) {
    const raw = rawTables.get(entry.tag)!;
    if (entry.tag === "glyf" && reconstructedGlyf !== undefined) {
      tables.push({ tag: "glyf", data: reconstructedGlyf.glyf });
    } else if (entry.tag === "loca" && reconstructedGlyf !== undefined) {
      if (reconstructedGlyf.loca.length !== entry.origLength) {
        fail(
          `reconstructed loca has ${reconstructedGlyf.loca.length} bytes, expected ${entry.origLength}`,
        );
      }
      tables.push({ tag: "loca", data: reconstructedGlyf.loca });
    } else if (entry.tag === "hmtx" && entry.transformVersion === 1) {
      if (reconstructedGlyf === undefined) {
        fail("transformed hmtx requires a transformed glyf");
      }
      const hhea = rawTables.get("hhea");
      if (hhea === undefined) {
        fail("transformed hmtx requires an hhea table");
      }
      const numHMetrics = (hhea.data[34]! << 8) | hhea.data[35]!;
      tables.push({
        tag: "hmtx",
        data: reconstructHmtx(
          raw.data,
          reconstructedGlyf.numGlyphs,
          numHMetrics,
          reconstructedGlyf.xMins,
        ),
      });
    } else if (entry.transformVersion !== 0 && !(entry.tag === "glyf" || entry.tag === "loca")) {
      fail(`unsupported transform ${entry.transformVersion} for table ${entry.tag}`);
    } else {
      tables.push({ tag: entry.tag, data: new Uint8Array(raw.data) });
    }
  }

  const sfnt = buildSfnt(flavor, tables);
  return sfnt;
}

/** Returns whether the bytes start with the WOFF2 signature. */
export function isWoff2(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x77 &&
    data[1] === 0x4f &&
    data[2] === 0x46 &&
    data[3] === 0x32
  );
}
