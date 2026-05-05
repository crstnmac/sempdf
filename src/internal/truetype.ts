import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData, PdfEmbeddedFont } from "../types.js";

export interface ParsedTrueTypeFont extends PdfEmbeddedFont {
  readonly bytes: Uint8Array;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly bbox: readonly [number, number, number, number];
  readonly italicAngle: number;
  readonly capHeight: number;
  readonly stemV: number;
  readonly flags: number;
  readonly glyphCount: number;
  readonly widths: readonly number[];
  readonly cmap: TrueTypeCmap;
  readonly kerningPairs: ReadonlyMap<number, number>;
  readonly ligatures: ReadonlyMap<number, readonly TrueTypeLigatureSubstitution[]>;
  readonly joiningForms: TrueTypeJoiningForms;
}

export interface TrueTypeCmap {
  getGlyphId(codePoint: number): number;
}

export interface TrueTypeLigatureSubstitution {
  readonly sequence: readonly number[];
  readonly glyphId: number;
}

export interface TrueTypeJoiningForms {
  readonly isolated: ReadonlyMap<number, number>;
  readonly initial: ReadonlyMap<number, number>;
  readonly medial: ReadonlyMap<number, number>;
  readonly final: ReadonlyMap<number, number>;
}

export function parseTrueTypeFont(data: BinaryData, family?: string): ParsedTrueTypeFont {
  const bytes = toBytes(data);
  const versionTag = readTag(bytes, 0);
  if (versionTag !== "\u0000\u0001\u0000\u0000" && versionTag !== "true") {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Only TrueType font files are supported for embedding.", {
      versionTag
    });
  }

  const numTables = readUint16(bytes, 4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = 12 + index * 16;
    const tag = readTag(bytes, recordOffset);
    const offset = readUint32(bytes, recordOffset + 8);
    const length = readUint32(bytes, recordOffset + 12);
    tables.set(tag, { offset, length });
  }

  const head = requireTable(tables, "head");
  const hhea = requireTable(tables, "hhea");
  const maxp = requireTable(tables, "maxp");
  const hmtx = requireTable(tables, "hmtx");
  const cmapTable = requireTable(tables, "cmap");
  const nameTable = requireTable(tables, "name");
  const postTable = tables.get("post");
  const os2Table = tables.get("OS/2");
  const kernTable = tables.get("kern");
  const gsubTable = tables.get("GSUB");

  const unitsPerEm = readUint16(bytes, head.offset + 18);
  const xMin = readInt16(bytes, head.offset + 36);
  const yMin = readInt16(bytes, head.offset + 38);
  const xMax = readInt16(bytes, head.offset + 40);
  const yMax = readInt16(bytes, head.offset + 42);
  const macStyle = readUint16(bytes, head.offset + 44);
  const ascent = readInt16(bytes, hhea.offset + 4);
  const descent = readInt16(bytes, hhea.offset + 6);
  const lineGap = readInt16(bytes, hhea.offset + 8);
  const numberOfHMetrics = readUint16(bytes, hhea.offset + 34);
  const glyphCount = readUint16(bytes, maxp.offset + 4);
  const widths = readAdvanceWidths(bytes, hmtx.offset, numberOfHMetrics, glyphCount);
  const cmap = parseCmap(bytes, cmapTable.offset);
  const postScriptName = family ?? readPostScriptName(bytes, nameTable.offset) ?? `EmbeddedFont-${hashBytes(bytes)}`;
  const italicAngle = postTable ? readFixed16_16(bytes, postTable.offset + 4) : 0;
  const capHeight = os2Table ? readInt16(bytes, os2Table.offset + 88) : ascent;
  const flags = computeFontFlags(postScriptName, macStyle);
  const kerningPairs = kernTable ? parseKerningPairs(bytes, kernTable.offset, kernTable.length) : new Map<number, number>();
  const ligatures = gsubTable ? parseLigatureSubstitutions(bytes, gsubTable.offset, gsubTable.length) : new Map<number, readonly TrueTypeLigatureSubstitution[]>();
  const joiningForms = gsubTable ? parseJoiningForms(bytes, gsubTable.offset, gsubTable.length) : createEmptyJoiningForms();

  return {
    kind: "embedded-font",
    id: `font:${hashBytes(bytes)}`,
    postScriptName,
    bytes,
    unitsPerEm,
    ascent,
    descent,
    lineGap,
    bbox: [xMin, yMin, xMax, yMax],
    italicAngle,
    capHeight,
    stemV: 80,
    flags,
    glyphCount,
    widths,
    cmap,
    kerningPairs,
    ligatures,
    joiningForms
  };
}

function parseJoiningForms(bytes: Uint8Array, offset: number, length: number): TrueTypeJoiningForms {
  if (length < 10) {
    return createEmptyJoiningForms();
  }

  const majorVersion = readUint16(bytes, offset);
  if (majorVersion !== 1) {
    return createEmptyJoiningForms();
  }

  const featureListOffset = readUint16(bytes, offset + 6);
  const lookupListOffset = readUint16(bytes, offset + 8);
  const featureLookupIndices = collectFeatureLookupIndices(bytes, offset + featureListOffset, ["isol", "init", "medi", "fina"]);
  const lookupListPosition = offset + lookupListOffset;
  const lookupCount = readUint16(bytes, lookupListPosition);
  const isolated = new Map<number, number>();
  const initial = new Map<number, number>();
  const medial = new Map<number, number>();
  const final = new Map<number, number>();

  for (const lookupIndex of featureLookupIndices.get("isol") ?? []) {
    if (lookupIndex >= lookupCount) {
      continue;
    }
    const lookupOffset = readUint16(bytes, lookupListPosition + 2 + lookupIndex * 2);
    parseSingleSubstitutionLookup(bytes, lookupListPosition + lookupOffset, isolated);
  }

  for (const lookupIndex of featureLookupIndices.get("init") ?? []) {
    if (lookupIndex >= lookupCount) {
      continue;
    }
    const lookupOffset = readUint16(bytes, lookupListPosition + 2 + lookupIndex * 2);
    parseSingleSubstitutionLookup(bytes, lookupListPosition + lookupOffset, initial);
  }

  for (const lookupIndex of featureLookupIndices.get("medi") ?? []) {
    if (lookupIndex >= lookupCount) {
      continue;
    }
    const lookupOffset = readUint16(bytes, lookupListPosition + 2 + lookupIndex * 2);
    parseSingleSubstitutionLookup(bytes, lookupListPosition + lookupOffset, medial);
  }

  for (const lookupIndex of featureLookupIndices.get("fina") ?? []) {
    if (lookupIndex >= lookupCount) {
      continue;
    }
    const lookupOffset = readUint16(bytes, lookupListPosition + 2 + lookupIndex * 2);
    parseSingleSubstitutionLookup(bytes, lookupListPosition + lookupOffset, final);
  }

  return {
    isolated,
    initial,
    medial,
    final
  };
}

function parseLigatureSubstitutions(
  bytes: Uint8Array,
  offset: number,
  length: number
): Map<number, readonly TrueTypeLigatureSubstitution[]> {
  if (length < 10) {
    return new Map();
  }

  const majorVersion = readUint16(bytes, offset);
  if (majorVersion !== 1) {
    return new Map();
  }

  const featureListOffset = readUint16(bytes, offset + 6);
  const lookupListOffset = readUint16(bytes, offset + 8);
  const lookupListPosition = offset + lookupListOffset;
  const targetLookupIndices = new Set([
    ...(featureLookupIndicesForTag(bytes, offset + featureListOffset, "liga")),
    ...(featureLookupIndicesForTag(bytes, offset + featureListOffset, "rlig")),
    ...(featureLookupIndicesForTag(bytes, offset + featureListOffset, "clig")),
    ...(featureLookupIndicesForTag(bytes, offset + featureListOffset, "dlig"))
  ]);
  const substitutions = new Map<number, TrueTypeLigatureSubstitution[]>();

  if (targetLookupIndices.size === 0) {
    return substitutions;
  }

  const lookupCount = readUint16(bytes, lookupListPosition);
  for (const lookupIndex of targetLookupIndices) {
    if (lookupIndex >= lookupCount) {
      continue;
    }

    const lookupOffset = readUint16(bytes, lookupListPosition + 2 + lookupIndex * 2);
    parseLigatureLookup(bytes, lookupListPosition + lookupOffset, substitutions);
  }

  for (const [firstGlyphId, entries] of substitutions) {
    entries.sort((left, right) => right.sequence.length - left.sequence.length);
    substitutions.set(firstGlyphId, entries);
  }

  return substitutions;
}

function featureLookupIndicesForTag(bytes: Uint8Array, featureListPosition: number, tag: string): Set<number> {
  return collectFeatureLookupIndices(bytes, featureListPosition, [tag]).get(tag) ?? new Set<number>();
}

function collectFeatureLookupIndices(
  bytes: Uint8Array,
  featureListPosition: number,
  targetTags: readonly string[]
): Map<string, Set<number>> {
  const featureCount = readUint16(bytes, featureListPosition);
  const indices = new Map<string, Set<number>>();
  const targetFeatures = new Set(targetTags);

  for (let index = 0; index < featureCount; index += 1) {
    const recordOffset = featureListPosition + 2 + index * 6;
    const tag = readTag(bytes, recordOffset);
    if (!targetFeatures.has(tag)) {
      continue;
    }

    const featureOffset = readUint16(bytes, recordOffset + 4);
    const featurePosition = featureListPosition + featureOffset;
    const lookupCount = readUint16(bytes, featurePosition + 2);
    const tagIndices = indices.get(tag) ?? new Set<number>();
    for (let lookupIndex = 0; lookupIndex < lookupCount; lookupIndex += 1) {
      tagIndices.add(readUint16(bytes, featurePosition + 4 + lookupIndex * 2));
    }
    indices.set(tag, tagIndices);
  }

  return indices;
}

function parseLigatureLookup(
  bytes: Uint8Array,
  lookupPosition: number,
  substitutions: Map<number, TrueTypeLigatureSubstitution[]>
): void {
  const lookupType = readUint16(bytes, lookupPosition);
  const subtableCount = readUint16(bytes, lookupPosition + 4);

  for (let index = 0; index < subtableCount; index += 1) {
    const subtableOffset = readUint16(bytes, lookupPosition + 6 + index * 2);
    parseLigatureSubtable(bytes, lookupPosition + subtableOffset, lookupType, substitutions);
  }
}

function parseLigatureSubtable(
  bytes: Uint8Array,
  subtablePosition: number,
  lookupType: number,
  substitutions: Map<number, TrueTypeLigatureSubstitution[]>
): void {
  if (lookupType === 7) {
    const extensionLookupType = readUint16(bytes, subtablePosition + 2);
    const extensionOffset = readUint32(bytes, subtablePosition + 4);
    parseLigatureSubtable(bytes, subtablePosition + extensionOffset, extensionLookupType, substitutions);
    return;
  }

  if (lookupType !== 4) {
    return;
  }

  const subtableFormat = readUint16(bytes, subtablePosition);
  if (subtableFormat !== 1) {
    return;
  }

  const coverageOffset = readUint16(bytes, subtablePosition + 2);
  const ligatureSetCount = readUint16(bytes, subtablePosition + 4);
  const coverageGlyphIds = parseCoverageTable(bytes, subtablePosition + coverageOffset);

  for (let setIndex = 0; setIndex < ligatureSetCount; setIndex += 1) {
    const firstGlyphId = coverageGlyphIds[setIndex];
    if (firstGlyphId === undefined) {
      continue;
    }

    const ligatureSetOffset = readUint16(bytes, subtablePosition + 6 + setIndex * 2);
    const ligatureSetPosition = subtablePosition + ligatureSetOffset;
    const ligatureCount = readUint16(bytes, ligatureSetPosition);

    for (let ligatureIndex = 0; ligatureIndex < ligatureCount; ligatureIndex += 1) {
      const ligatureOffset = readUint16(bytes, ligatureSetPosition + 2 + ligatureIndex * 2);
      const ligaturePosition = ligatureSetPosition + ligatureOffset;
      const glyphId = readUint16(bytes, ligaturePosition);
      const componentCount = readUint16(bytes, ligaturePosition + 2);
      const sequence = [firstGlyphId];
      for (let componentIndex = 0; componentIndex < componentCount - 1; componentIndex += 1) {
        sequence.push(readUint16(bytes, ligaturePosition + 4 + componentIndex * 2));
      }

      const entries = substitutions.get(firstGlyphId) ?? [];
      entries.push({
        sequence,
        glyphId
      });
      substitutions.set(firstGlyphId, entries);
    }
  }
}

function parseSingleSubstitutionLookup(bytes: Uint8Array, lookupPosition: number, substitutions: Map<number, number>): void {
  const lookupType = readUint16(bytes, lookupPosition);
  const subtableCount = readUint16(bytes, lookupPosition + 4);

  for (let index = 0; index < subtableCount; index += 1) {
    const subtableOffset = readUint16(bytes, lookupPosition + 6 + index * 2);
    parseSingleSubstitutionSubtable(bytes, lookupPosition + subtableOffset, lookupType, substitutions);
  }
}

function parseSingleSubstitutionSubtable(
  bytes: Uint8Array,
  subtablePosition: number,
  lookupType: number,
  substitutions: Map<number, number>
): void {
  if (lookupType === 7) {
    const extensionLookupType = readUint16(bytes, subtablePosition + 2);
    const extensionOffset = readUint32(bytes, subtablePosition + 4);
    parseSingleSubstitutionSubtable(bytes, subtablePosition + extensionOffset, extensionLookupType, substitutions);
    return;
  }

  if (lookupType !== 1) {
    return;
  }

  const subtableFormat = readUint16(bytes, subtablePosition);
  const coverageOffset = readUint16(bytes, subtablePosition + 2);
  const coverageGlyphIds = parseCoverageTable(bytes, subtablePosition + coverageOffset);

  if (subtableFormat === 1) {
    const deltaGlyphId = readInt16(bytes, subtablePosition + 4);
    for (const glyphId of coverageGlyphIds) {
      substitutions.set(glyphId, (glyphId + deltaGlyphId) & 0xffff);
    }
    return;
  }

  if (subtableFormat !== 2) {
    return;
  }

  const glyphCount = readUint16(bytes, subtablePosition + 4);
  for (let index = 0; index < glyphCount && index < coverageGlyphIds.length; index += 1) {
    substitutions.set(coverageGlyphIds[index]!, readUint16(bytes, subtablePosition + 6 + index * 2));
  }
}

function parseCoverageTable(bytes: Uint8Array, coveragePosition: number): number[] {
  const coverageFormat = readUint16(bytes, coveragePosition);
  if (coverageFormat === 1) {
    const glyphCount = readUint16(bytes, coveragePosition + 2);
    const glyphIds: number[] = [];
    for (let index = 0; index < glyphCount; index += 1) {
      glyphIds.push(readUint16(bytes, coveragePosition + 4 + index * 2));
    }
    return glyphIds;
  }

  if (coverageFormat === 2) {
    const rangeCount = readUint16(bytes, coveragePosition + 2);
    const glyphIds: number[] = [];
    for (let index = 0; index < rangeCount; index += 1) {
      const rangePosition = coveragePosition + 4 + index * 6;
      const startGlyphId = readUint16(bytes, rangePosition);
      const endGlyphId = readUint16(bytes, rangePosition + 2);
      for (let glyphId = startGlyphId; glyphId <= endGlyphId; glyphId += 1) {
        glyphIds.push(glyphId);
      }
    }
    return glyphIds;
  }

  return [];
}

function parseKerningPairs(bytes: Uint8Array, offset: number, length: number): Map<number, number> {
  if (length < 4) {
    return new Map();
  }

  const end = offset + length;
  const version = readUint16(bytes, offset);
  if (version !== 0) {
    return new Map();
  }

  const subtableCount = readUint16(bytes, offset + 2);
  let cursor = offset + 4;
  const pairs = new Map<number, number>();

  for (let index = 0; index < subtableCount && cursor + 6 <= end; index += 1) {
    const subtableLength = readUint16(bytes, cursor + 2);
    const coverage = readUint16(bytes, cursor + 4);
    const format = coverage >> 8;
    const horizontal = (coverage & 0x0001) !== 0;
    const minimum = (coverage & 0x0002) !== 0;
    const crossStream = (coverage & 0x0004) !== 0;
    const subtableEnd = Math.min(cursor + subtableLength, end);

    if (format === 0 && horizontal && !minimum && !crossStream && cursor + 14 <= subtableEnd) {
      const pairCount = readUint16(bytes, cursor + 6);
      let pairOffset = cursor + 14;
      for (let pairIndex = 0; pairIndex < pairCount && pairOffset + 6 <= subtableEnd; pairIndex += 1) {
        const leftGlyphId = readUint16(bytes, pairOffset);
        const rightGlyphId = readUint16(bytes, pairOffset + 2);
        const value = readInt16(bytes, pairOffset + 4);
        pairs.set((leftGlyphId << 16) | rightGlyphId, value);
        pairOffset += 6;
      }
    }

    cursor += Math.max(subtableLength, 6);
  }

  return pairs;
}

function parseCmap(bytes: Uint8Array, offset: number): TrueTypeCmap {
  const numTables = readUint16(bytes, offset + 2);
  let chosenOffset: number | undefined;

  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = offset + 4 + index * 8;
    const platformId = readUint16(bytes, recordOffset);
    const encodingId = readUint16(bytes, recordOffset + 2);
    const subtableOffset = readUint32(bytes, recordOffset + 4);
    const format = readUint16(bytes, offset + subtableOffset);

    if (platformId === 3 && encodingId === 10 && format === 12) {
      chosenOffset = offset + subtableOffset;
      break;
    }

    if (chosenOffset === undefined && platformId === 3 && (encodingId === 1 || encodingId === 0) && format === 4) {
      chosenOffset = offset + subtableOffset;
    }
  }

  if (chosenOffset === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "A Unicode cmap table is required for embedded fonts.");
  }

  const format = readUint16(bytes, chosenOffset);
  if (format === 4) {
    return parseFormat4Cmap(bytes, chosenOffset);
  }
  if (format === 12) {
    return parseFormat12Cmap(bytes, chosenOffset);
  }

  throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Unsupported cmap format for embedded font.", { format });
}

function parseFormat4Cmap(bytes: Uint8Array, offset: number): TrueTypeCmap {
  const segCount = readUint16(bytes, offset + 6) / 2;
  const endCodesOffset = offset + 14;
  const startCodesOffset = endCodesOffset + segCount * 2 + 2;
  const idDeltaOffset = startCodesOffset + segCount * 2;
  const idRangeOffsetOffset = idDeltaOffset + segCount * 2;

  return {
    getGlyphId(codePoint: number): number {
      if (codePoint > 0xffff) {
        return 0;
      }

      for (let index = 0; index < segCount; index += 1) {
        const endCode = readUint16(bytes, endCodesOffset + index * 2);
        const startCode = readUint16(bytes, startCodesOffset + index * 2);
        if (codePoint < startCode || codePoint > endCode) {
          continue;
        }

        const idDelta = readInt16(bytes, idDeltaOffset + index * 2);
        const idRangeOffset = readUint16(bytes, idRangeOffsetOffset + index * 2);
        if (idRangeOffset === 0) {
          return (codePoint + idDelta) & 0xffff;
        }

        const glyphIndexAddress = idRangeOffsetOffset + index * 2 + idRangeOffset + (codePoint - startCode) * 2;
        const glyphIndex = readUint16(bytes, glyphIndexAddress);
        if (glyphIndex === 0) {
          return 0;
        }
        return (glyphIndex + idDelta) & 0xffff;
      }

      return 0;
    }
  };
}

function parseFormat12Cmap(bytes: Uint8Array, offset: number): TrueTypeCmap {
  const nGroups = readUint32(bytes, offset + 12);
  const groupsOffset = offset + 16;

  return {
    getGlyphId(codePoint: number): number {
      for (let index = 0; index < nGroups; index += 1) {
        const groupOffset = groupsOffset + index * 12;
        const startCharCode = readUint32(bytes, groupOffset);
        const endCharCode = readUint32(bytes, groupOffset + 4);
        const startGlyphId = readUint32(bytes, groupOffset + 8);
        if (codePoint >= startCharCode && codePoint <= endCharCode) {
          return startGlyphId + (codePoint - startCharCode);
        }
      }
      return 0;
    }
  };
}

function readAdvanceWidths(bytes: Uint8Array, offset: number, numberOfHMetrics: number, glyphCount: number): number[] {
  const widths: number[] = [];
  let lastAdvance = 0;
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    if (glyphId < numberOfHMetrics) {
      lastAdvance = readUint16(bytes, offset + glyphId * 4);
      widths.push(lastAdvance);
    } else {
      widths.push(lastAdvance);
    }
  }
  return widths;
}

function readPostScriptName(bytes: Uint8Array, offset: number): string | undefined {
  const count = readUint16(bytes, offset + 2);
  const stringOffset = readUint16(bytes, offset + 4);

  for (let index = 0; index < count; index += 1) {
    const recordOffset = offset + 6 + index * 12;
    const platformId = readUint16(bytes, recordOffset);
    const nameId = readUint16(bytes, recordOffset + 6);
    const length = readUint16(bytes, recordOffset + 8);
    const recordStringOffset = readUint16(bytes, recordOffset + 10);
    if (nameId !== 6) {
      continue;
    }

    const start = offset + stringOffset + recordStringOffset;
    const slice = bytes.slice(start, start + length);
    if (platformId === 3) {
      return decodeUtf16Be(slice);
    }
    return new TextDecoder("latin1").decode(slice);
  }

  return undefined;
}

function computeFontFlags(postScriptName: string, macStyle: number): number {
  let flags = 1 << 5;
  if (/Fixed|Mono|Courier|Menlo|Code|Monaspace/i.test(postScriptName)) {
    flags |= 1;
  }
  if ((macStyle & 0x02) !== 0 || /Italic|Oblique/i.test(postScriptName)) {
    flags |= 1 << 6;
  }
  return flags;
}

function createEmptyJoiningForms(): TrueTypeJoiningForms {
  return {
    isolated: new Map(),
    initial: new Map(),
    medial: new Map(),
    final: new Map()
  };
}

function requireTable(tables: Map<string, { offset: number; length: number }>, tag: string): { offset: number; length: number } {
  const table = tables.get(tag);
  if (!table) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, `Missing required TrueType table: ${tag}`);
  }
  return table;
}

function toBytes(data: BinaryData): Uint8Array {
  return data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
}

function readTag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    readUint8(bytes, offset),
    readUint8(bytes, offset + 1),
    readUint8(bytes, offset + 2),
    readUint8(bytes, offset + 3)
  );
}

function readUint8(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Unexpected end of TrueType font data.", { offset });
  }
  return value;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (readUint8(bytes, offset) << 8) | readUint8(bytes, offset + 1);
}

function readInt16(bytes: Uint8Array, offset: number): number {
  const value = readUint16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    readUint8(bytes, offset) * 0x1000000 +
    (readUint8(bytes, offset + 1) << 16) +
    (readUint8(bytes, offset + 2) << 8) +
    readUint8(bytes, offset + 3)
  );
}

function readFixed16_16(bytes: Uint8Array, offset: number): number {
  const raw = readUint32(bytes, offset);
  return raw / 65536;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  const view = new Uint8Array(bytes.length + (bytes.length % 2));
  view.set(bytes);
  return new TextDecoder("utf-16be").decode(view);
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
