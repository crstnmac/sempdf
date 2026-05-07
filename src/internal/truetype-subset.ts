import { PdfEngineError, PdfErrorCode } from "../errors.js";

interface TableEntry {
  readonly tag: string;
  readonly checksum: number;
  readonly offset: number;
  readonly length: number;
}

const COMPOSITE_FLAGS = {
  ARG_1_AND_2_ARE_WORDS: 0x0001,
  WE_HAVE_A_SCALE: 0x0008,
  MORE_COMPONENTS: 0x0020,
  WE_HAVE_AN_X_AND_Y_SCALE: 0x0040,
  WE_HAVE_A_TWO_BY_TWO: 0x0080,
  WE_HAVE_INSTRUCTIONS: 0x0100
} as const;

/**
 * Produces a subsetted TrueType font containing only the glyphs in `usedGlyphIds`
 * (plus glyph 0 and any composite-glyph dependencies). Glyph IDs are preserved
 * (sparse glyf approach), so PDF content references do not need remapping.
 */
export function subsetTrueTypeFont(bytes: Uint8Array, usedGlyphIds: Iterable<number>): Uint8Array {
  if (readUint32(bytes, 0) !== 0x00010000 && readTag(bytes, 0) !== "true") {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Subsetting requires a TrueType font.");
  }

  const numTables = readUint16(bytes, 4);
  const tables = new Map<string, TableEntry>();
  for (let i = 0; i < numTables; i += 1) {
    const recordOffset = 12 + i * 16;
    const tag = readTag(bytes, recordOffset);
    tables.set(tag, {
      tag,
      checksum: readUint32(bytes, recordOffset + 4),
      offset: readUint32(bytes, recordOffset + 8),
      length: readUint32(bytes, recordOffset + 12)
    });
  }

  const head = required(tables, "head");
  const maxp = required(tables, "maxp");
  const glyf = tables.get("glyf");
  const loca = tables.get("loca");

  // No glyf/loca → font has no outlines (CFF-based or empty); return original
  if (!glyf || !loca) {
    return bytes;
  }

  const indexToLocFormat = readInt16(bytes, head.offset + 50);
  const numGlyphs = readUint16(bytes, maxp.offset + 4);
  const oldLocaOffsets = readLocaOffsets(bytes, loca.offset, numGlyphs, indexToLocFormat);

  // Build closure of needed glyph IDs (used + composite dependencies)
  const needed = new Set<number>([0]);
  for (const id of usedGlyphIds) needed.add(id);

  const stack = [...needed];
  while (stack.length > 0) {
    const glyphId = stack.pop()!;
    if (glyphId >= numGlyphs) continue;
    const glyphStart = glyf.offset + oldLocaOffsets[glyphId]!;
    const glyphEnd = glyf.offset + oldLocaOffsets[glyphId + 1]!;
    if (glyphEnd <= glyphStart) continue;
    const numContours = readInt16(bytes, glyphStart);
    if (numContours >= 0) continue;
    // composite glyph
    let cursor = glyphStart + 10;
    while (cursor < glyphEnd) {
      const flags = readUint16(bytes, cursor);
      const componentId = readUint16(bytes, cursor + 2);
      cursor += 4;
      if (flags & COMPOSITE_FLAGS.ARG_1_AND_2_ARE_WORDS) {
        cursor += 4;
      } else {
        cursor += 2;
      }
      if (flags & COMPOSITE_FLAGS.WE_HAVE_A_SCALE) {
        cursor += 2;
      } else if (flags & COMPOSITE_FLAGS.WE_HAVE_AN_X_AND_Y_SCALE) {
        cursor += 4;
      } else if (flags & COMPOSITE_FLAGS.WE_HAVE_A_TWO_BY_TWO) {
        cursor += 8;
      }
      if (!needed.has(componentId)) {
        needed.add(componentId);
        stack.push(componentId);
      }
      if (!(flags & COMPOSITE_FLAGS.MORE_COMPONENTS)) break;
    }
  }

  // Build new glyf + loca: keep glyph data for needed glyphs, zero-length entries for rest.
  const newGlyfChunks: Uint8Array[] = [];
  const newLocaOffsets = new Array<number>(numGlyphs + 1);
  let glyfCursor = 0;
  for (let glyphId = 0; glyphId < numGlyphs; glyphId += 1) {
    newLocaOffsets[glyphId] = glyfCursor;
    if (needed.has(glyphId)) {
      const start = glyf.offset + oldLocaOffsets[glyphId]!;
      const end = glyf.offset + oldLocaOffsets[glyphId + 1]!;
      const length = end - start;
      if (length > 0) {
        const padded = (length + 3) & ~3;
        const buf = new Uint8Array(padded);
        buf.set(bytes.subarray(start, end));
        newGlyfChunks.push(buf);
        glyfCursor += padded;
      }
    }
  }
  newLocaOffsets[numGlyphs] = glyfCursor;

  const newGlyf = concat(newGlyfChunks, glyfCursor);
  const newLoca = writeLocaOffsets(newLocaOffsets, indexToLocFormat);

  // Replace glyf and loca in the table set; copy the rest.
  const replacements = new Map<string, Uint8Array>([
    ["glyf", newGlyf],
    ["loca", newLoca]
  ]);

  return rebuildTrueType(bytes, tables, replacements);
}

function readLocaOffsets(bytes: Uint8Array, offset: number, numGlyphs: number, format: number): number[] {
  const offsets = new Array<number>(numGlyphs + 1);
  if (format === 0) {
    for (let i = 0; i <= numGlyphs; i += 1) {
      offsets[i] = readUint16(bytes, offset + i * 2) * 2;
    }
  } else {
    for (let i = 0; i <= numGlyphs; i += 1) {
      offsets[i] = readUint32(bytes, offset + i * 4);
    }
  }
  return offsets;
}

function writeLocaOffsets(offsets: readonly number[], format: number): Uint8Array {
  const entrySize = format === 0 ? 2 : 4;
  const buf = new Uint8Array(offsets.length * entrySize);
  for (let i = 0; i < offsets.length; i += 1) {
    if (format === 0) {
      writeUint16(buf, i * 2, offsets[i]! / 2);
    } else {
      writeUint32(buf, i * 4, offsets[i]!);
    }
  }
  return buf;
}

// PDF readers only need a small subset of TTF tables for rendering. Variation,
// layout (GPOS/GSUB), and Apple-specific metadata tables are stripped to drop
// dead weight from large variable fonts.
const PDF_REQUIRED_TABLES = new Set([
  "head", "hhea", "maxp", "hmtx", "loca", "glyf",
  "cmap", "name", "post", "prep", "fpgm", "cvt ", "OS/2"
]);

function rebuildTrueType(
  source: Uint8Array,
  tables: ReadonlyMap<string, TableEntry>,
  replacements: ReadonlyMap<string, Uint8Array>
): Uint8Array {
  const tags = [...tables.keys()].filter((tag) => PDF_REQUIRED_TABLES.has(tag)).sort();
  const numTables = tags.length;
  const headerSize = 12 + numTables * 16;

  // Compute total size with 4-byte padding per table.
  const tableData = new Map<string, Uint8Array>();
  let totalDataLength = 0;
  for (const tag of tags) {
    const entry = tables.get(tag)!;
    const data = replacements.get(tag) ?? source.subarray(entry.offset, entry.offset + entry.length);
    tableData.set(tag, data);
    totalDataLength += (data.length + 3) & ~3;
  }

  const out = new Uint8Array(headerSize + totalDataLength);
  // sfnt header
  writeUint32(out, 0, 0x00010000);
  writeUint16(out, 4, numTables);
  const searchRange = nextPow2(numTables) * 16;
  writeUint16(out, 6, searchRange);
  writeUint16(out, 8, log2(nextPow2(numTables)));
  writeUint16(out, 10, numTables * 16 - searchRange);

  // Reserve space for the head table so we can adjust its checksumAdjustment after.
  let dataCursor = headerSize;
  for (let i = 0; i < tags.length; i += 1) {
    const tag = tags[i]!;
    const data = tableData.get(tag)!;
    writeTag(out, 12 + i * 16, tag);
    writeUint32(out, 12 + i * 16 + 8, dataCursor);
    writeUint32(out, 12 + i * 16 + 12, data.length);
    out.set(data, dataCursor);
    if (tag === "head") {
      // zero out checksumAdjustment before computing checksums
      writeUint32(out, dataCursor + 8, 0);
    }
    const checksum = computeChecksum(out, dataCursor, data.length);
    writeUint32(out, 12 + i * 16 + 4, checksum);
    dataCursor += (data.length + 3) & ~3;
  }

  // Compute file checksum and adjust 'head' checksumAdjustment.
  const fileChecksum = computeChecksum(out, 0, out.length);
  const adjustment = (0xb1b0afba - fileChecksum) >>> 0;
  const headEntryIndex = tags.indexOf("head");
  if (headEntryIndex >= 0) {
    const headOffset = readUint32(out, 12 + headEntryIndex * 16 + 8);
    writeUint32(out, headOffset + 8, adjustment);
  }

  return out;
}

function computeChecksum(bytes: Uint8Array, offset: number, length: number): number {
  let sum = 0;
  const end = offset + ((length + 3) & ~3);
  for (let i = offset; i < end; i += 4) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const b3 = bytes[i + 3] ?? 0;
    sum = (sum + ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)) >>> 0;
  }
  return sum;
}

function concat(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

function log2(n: number): number {
  let l = 0;
  let v = n;
  while (v > 1) { v >>= 1; l += 1; }
  return l;
}

function required(tables: Map<string, TableEntry>, tag: string): TableEntry {
  const entry = tables.get(tag);
  if (!entry) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, `TrueType font is missing required table '${tag}'.`);
  }
  return entry;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}
function readInt16(bytes: Uint8Array, offset: number): number {
  const v = readUint16(bytes, offset);
  return v >= 0x8000 ? v - 0x10000 : v;
}
function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! * 0x1000000)
    + ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)
  );
}
function readTag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}
function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}
function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
function writeTag(bytes: Uint8Array, offset: number, tag: string): void {
  for (let i = 0; i < 4; i += 1) {
    bytes[offset + i] = tag.charCodeAt(i);
  }
}
