import { PdfEngineError, PdfErrorCode } from "../errors.js";

export interface ParsedCffFont {
  majorVersion: number;
  minorVersion: number;
  headerSize: number;
  nameIndex: Uint8Array[];
  topDictIndex: Uint8Array[];
  stringIndex: Uint8Array[];
  globalSubrIndex: Uint8Array[];
  chars: Uint8Array[];
  charsets: number[];
  fontMatrix: number[];
  unitsPerEm: number;
  glyphCount: number;
  rawTopDictData: Uint8Array;
  rawCharStringsData: Uint8Array;
  rawPrivateDictData: Uint8Array | undefined;
}

interface DictOperand {
  value: number | Uint8Array;
}

function readUint8(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Unexpected end of CFF font data.", { offset });
  }
  return value;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (readUint8(bytes, offset) << 8) | readUint8(bytes, offset + 1);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    readUint8(bytes, offset) * 0x1000000 +
    (readUint8(bytes, offset + 1) << 16) +
    (readUint8(bytes, offset + 2) << 8) +
    readUint8(bytes, offset + 3)
  );
}

function readInt16(bytes: Uint8Array, offset: number): number {
  const value = readUint16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

export function parseCffTable(bytes: Uint8Array, tableOffset: number, tableLength: number): ParsedCffFont {
  const end = tableOffset + tableLength;
  const majorVersion = readUint8(bytes, tableOffset);
  const minorVersion = readUint8(bytes, tableOffset + 1);
  const headerSize = readUint8(bytes, tableOffset + 2);
  if (headerSize < 4) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Invalid CFF header size.", { headerSize });
  }

  let offset = tableOffset + headerSize;

  const nameIndex = readCffIndex(bytes, offset, end);
  offset += cffIndexSize(bytes, offset);

  const topDictIndexRaw = readCffIndex(bytes, offset, end);
  offset += cffIndexSize(bytes, offset);

  if (topDictIndexRaw.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "CFF Top DICT index is empty.");
  }

  // Save raw Top DICT data for embedding
  let topDictStart = 0;
  let topDictByteLen = 0;
  {
    let pos = tableOffset + headerSize + cffIndexSize(bytes, tableOffset + headerSize);
    pos += 2; // skip count
    const offSize = readUint8(bytes, pos);
    pos += 1;
    if (offSize >= 1 && offSize <= 4) {
      const firstOffset = readCffIndexOffset(bytes, pos, offSize, 0, 1);
      const secondOffset = readCffIndexOffset(bytes, pos, offSize, 1, 1);
      const dataOffset = pos + (1 + 1) * offSize;
      topDictStart = dataOffset + firstOffset - 1;
      topDictByteLen = secondOffset - firstOffset;
    }
  }
  const rawTopDictData = bytes.slice(Math.max(topDictStart, 0), Math.min(topDictStart + topDictByteLen, end));

  const stringIndex = readCffIndex(bytes, offset, end);
  offset += cffIndexSize(bytes, offset);

  const globalSubrIndexRaw = readCffIndex(bytes, offset, end);
  offset += cffIndexSize(bytes, offset);

  const topDictEntries = parseTopDict(topDictIndexRaw[0]!);

  let charStringsRaw: Uint8Array = new Uint8Array(0);
  let charset: number[] = [];
  let fontMatrix: number[] = [0.001, 0, 0, 0.001, 0, 0];
  let privateDictData: Uint8Array | undefined;

  // Parse Top DICT entries
  for (let i = 0; i < topDictEntries.length; i += 2) {
    const operator = topDictEntries[i];
    const operands = topDictEntries[i + 1] as DictOperand[];
    if (operator === undefined || operands === undefined) continue;

    // charStrings offset
    if (operator === 17 && operands.length >= 1 && typeof operands[0]!.value === "number") {
      const charStringsOffset = operands[0]!.value;
      const csData = readCffIndex(bytes, tableOffset + charStringsOffset, end);
      if (csData.length > 0) {
        charStringsRaw = csData[0]!;
      }
    }

    // charset offset
    if (operator === 15 && operands.length >= 1 && typeof operands[0]!.value === "number") {
      const charsetOffset = operands[0]!.value;
      charset = parseCharset(bytes, tableOffset + charsetOffset, charStringsRaw.length, end);
    }

    // FontMatrix
    if (operator === 1207 && operands.length >= 6) {
      fontMatrix = operands.slice(0, 6).map((op) => {
        if (typeof op.value === "number") return op.value;
        return 0;
      });
    }

    // Private dict
    if (operator === 18 && operands.length >= 2) {
      const privateSize = typeof operands[0]!.value === "number" ? operands[0]!.value : 0;
      const privateOffset = typeof operands[1]!.value === "number" ? operands[1]!.value : 0;
      if (privateSize > 0) {
        privateDictData = bytes.slice(tableOffset + privateOffset, tableOffset + privateOffset + privateSize);
      }
    }
  }

  const rawCharStringsData = charStringsRaw;
  const rawPrivateDictData = privateDictData;
  const glyphCount = charStringsRaw.length > 0 ? cffIndexCount(charStringsRaw, 0) : 0;

  return {
    majorVersion,
    minorVersion,
    headerSize,
    nameIndex,
    topDictIndex: topDictIndexRaw,
    stringIndex,
    globalSubrIndex: globalSubrIndexRaw,
    chars: [],
    charsets: charset,
    fontMatrix,
    unitsPerEm: 1000,
    glyphCount,
    rawTopDictData,
    rawCharStringsData,
    rawPrivateDictData
  };
}

export function parseCff2Table(bytes: Uint8Array, tableOffset: number, tableLength: number): ParsedCffFont {
  const end = tableOffset + tableLength;
  const majorVersion = readUint8(bytes, tableOffset);
  const minorVersion = readUint8(bytes, tableOffset + 1);
  const headerSize = readUint8(bytes, tableOffset + 2);
  const topDictLength = readUint16(bytes, tableOffset + 3);

  if (headerSize < 5) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Invalid CFF2 header size.", { headerSize });
  }

  if (majorVersion !== 2) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Invalid CFF2 major version.", { majorVersion });
  }

  const topDictOffset = tableOffset + headerSize;
  const topDictData = bytes.slice(topDictOffset, topDictOffset + topDictLength);
  const rawTopDictData = topDictData;

  const topDictEntries = parseTopDict(topDictData);

  let charStringsRaw: Uint8Array = new Uint8Array(0);
  let charset: number[] = [];
  let fontMatrix: number[] = [0.001, 0, 0, 0.001, 0, 0];
  let privateDictData: Uint8Array | undefined;

  const charStringsIndexData = new Map<number, Uint8Array>();

  for (let i = 0; i < topDictEntries.length; i += 2) {
    const operator = topDictEntries[i];
    const operands = topDictEntries[i + 1] as DictOperand[];
    if (operator === undefined || operands === undefined) continue;

    if (operator === 17 && operands.length >= 1 && typeof operands[0]!.value === "number") {
      const charStringsOffset = operands[0]!.value;
      const csData = readCffIndex(bytes, tableOffset + charStringsOffset, end);
      charStringsIndexData.set(0, new Uint8Array(0));
      for (let ci = 0; ci < csData.length; ci += 1) {
        charStringsIndexData.set(ci, csData[ci]!);
        if (ci === 0) {
          charStringsRaw = csData[ci]!;
        }
      }
    }

    if (operator === 15 && operands.length >= 1 && typeof operands[0]!.value === "number") {
      const charsetOffset = operands[0]!.value;
      const glyphCount = charStringsIndexData.size > 0 ? charStringsIndexData.size - 1 : 0;
      charset = parseCharset(bytes, tableOffset + charsetOffset, Math.max(glyphCount, 1), end);
    }

    if (operator === 1207 && operands.length >= 6) {
      fontMatrix = operands.slice(0, 6).map((op) => {
        if (typeof op.value === "number") return op.value;
        return 0;
      });
    }

    if (operator === 18 && operands.length >= 2) {
      const privateSize = typeof operands[0]!.value === "number" ? operands[0]!.value : 0;
      const privateOffset = typeof operands[1]!.value === "number" ? operands[1]!.value : 0;
      if (privateSize > 0) {
        privateDictData = bytes.slice(tableOffset + privateOffset, tableOffset + privateOffset + privateSize);
      }
    }
  }

  const rawCharStringsData = charStringsRaw;
  const rawPrivateDictData = privateDictData;
  const glyphCount = charStringsIndexData.size > 0 ? charStringsIndexData.size - 1 : 0;

  return {
    majorVersion,
    minorVersion,
    headerSize,
    nameIndex: [],
    topDictIndex: [topDictData],
    stringIndex: [],
    globalSubrIndex: [],
    chars: [],
    charsets: charset,
    fontMatrix,
    unitsPerEm: 1000,
    glyphCount,
    rawTopDictData,
    rawCharStringsData,
    rawPrivateDictData
  };
}

function readCffIndex(bytes: Uint8Array, offset: number, end: number): Uint8Array[] {
  const count = readUint16(bytes, offset);
  if (count === 0) {
    return [];
  }

  const offSize = readUint8(bytes, offset + 2);
  const result: Uint8Array[] = [];
  let dataStart = offset + 3 + (count + 1) * offSize;

  for (let i = 0; i < count; i += 1) {
    const start = readCffIndexOffset(bytes, offset + 3, offSize, i, count);
    const next = readCffIndexOffset(bytes, offset + 3, offSize, i + 1, count);
    const itemStart = dataStart + start - 1;
    const itemEnd = dataStart + next - 1;
    result.push(bytes.slice(itemStart, itemEnd));
  }

  return result;
}

function cffIndexCount(bytes: Uint8Array, offset: number): number {
  return readUint16(bytes, offset);
}

function cffIndexSize(bytes: Uint8Array, offset: number): number {
  const count = readUint16(bytes, offset);
  if (count === 0) {
    return 3;
  }
  const offSize = readUint8(bytes, offset + 2);
  let dataSize = 0;
  for (let i = 0; i < count; i += 1) {
    const start = readCffIndexOffset(bytes, offset + 3, offSize, i, count);
    const end = readCffIndexOffset(bytes, offset + 3, offSize, i + 1, count);
    dataSize = end - 1;
  }
  return 3 + (count + 1) * offSize + dataSize;
}

function readCffIndexOffset(bytes: Uint8Array, offset: number, offSize: number, index: number, count: number): number {
  if (offSize === 1) {
    return readUint8(bytes, offset + index);
  }
  if (offSize === 2) {
    return readUint16(bytes, offset + index * 2);
  }
  if (offSize === 3) {
    return (readUint8(bytes, offset + index * 3) << 16)
      | (readUint8(bytes, offset + index * 3 + 1) << 8)
      | readUint8(bytes, offset + index * 3 + 2);
  }
  if (offSize === 4) {
    return readUint32(bytes, offset + index * 4);
  }
  return 0;
}

function parseTopDict(data: Uint8Array): (number | DictOperand[])[] {
  const entries: (number | DictOperand[])[] = [];
  const operands: DictOperand[] = [];
  let i = 0;

  while (i < data.length) {
    const b0 = data[i]!;

    if (b0 === 28) {
      operands.push({ value: readInt16(data, i + 1) });
      i += 3;
      continue;
    }

    if (b0 === 29) {
      operands.push({ value: readUint32(data, i + 1) });
      i += 5;
      continue;
    }

    if (b0 === 30) {
      let value = "";
      let j = i + 1;
      while (j < data.length) {
        const nibble1 = (data[j]! >> 4) & 0xf;
        const nibble2 = data[j]! & 0xf;
        if (nibble1 === 0xf) break;
        value += nibbleToReal(nibble1);
        if (nibble2 === 0xf) break;
        value += nibbleToReal(nibble2);
        j += 1;
      }
      operands.push({ value: parseFloat(value) || 0 });
      i = j + 1;
      continue;
    }

    if (b0 >= 32 && b0 <= 246) {
      operands.push({ value: b0 - 139 });
      i += 1;
      continue;
    }

    if (b0 >= 247 && b0 <= 250) {
      const b1 = data[i + 1]!;
      operands.push({ value: (b0 - 247) * 256 + b1 + 108 });
      i += 2;
      continue;
    }

    if (b0 >= 251 && b0 <= 254) {
      const b1 = data[i + 1]!;
      operands.push({ value: -(b0 - 251) * 256 - b1 - 108 });
      i += 2;
      continue;
    }

    if (b0 === 12) {
      const b1 = data[i + 1]!;
      entries.push([...operands], (b0 << 8) | b1);
      operands.length = 0;
      i += 2;
      continue;
    }

    if (b0 <= 31) {
      entries.push([...operands], b0);
      operands.length = 0;
      i += 1;
      continue;
    }

    i += 1;
  }

  return entries;
}

function nibbleToReal(nibble: number): string {
  if (nibble <= 9) return String(nibble);
  if (nibble === 10) return ".";
  if (nibble === 11) return "E";
  if (nibble === 12) return "E-";
  if (nibble === 14) return "-";
  return "";
}

function parseCharset(bytes: Uint8Array, offset: number, nGlyphs: number, end: number): number[] {
  if (nGlyphs <= 0) return [];

  const format = readUint8(bytes, offset);
  const result: number[] = [0];

  if (format === 0) {
    for (let i = 1; i < nGlyphs && offset + 1 + (i - 1) * 2 + 2 <= end; i += 1) {
      result.push(readUint16(bytes, offset + 1 + (i - 1) * 2));
    }
  } else if (format === 1 || format === 2) {
    let pos = offset + 1;
    for (let i = 1; i < nGlyphs; ) {
      const first = readUint16(bytes, pos);
      pos += 2;
      const nLeft = format === 1 ? readUint8(bytes, pos) : readUint16(bytes, pos);
      pos += format === 1 ? 1 : 2;
      for (let j = 0; j <= nLeft && i < nGlyphs; j += 1) {
        result.push(first + j);
        i += 1;
      }
    }
  }

  return result.slice(0, nGlyphs);
}
