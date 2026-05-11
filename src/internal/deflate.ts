import { PdfEngineError, PdfErrorCode } from "../errors.js";

let cachedDeflateSync: ((data: Uint8Array) => Uint8Array) | null | undefined;

function loadDeflateSync(): ((data: Uint8Array) => Uint8Array) | null {
  if (cachedDeflateSync !== undefined) {
    return cachedDeflateSync;
  }

  const nodeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (nodeProcess?.versions?.node === undefined) {
    cachedDeflateSync = null;
    return null;
  }

  const getBuiltin = (nodeProcess as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  let zlib: { deflateSync: (data: Uint8Array) => Uint8Array } | undefined;

  if (typeof getBuiltin === "function") {
    try {
      zlib = getBuiltin.call(nodeProcess, "node:zlib") as typeof zlib;
    } catch {
      zlib = undefined;
    }
  }

  if (!zlib) {
    try {
      const dynamicRequire = (0, eval)("typeof require === 'function' ? require : null");
      if (typeof dynamicRequire === "function") {
        zlib = dynamicRequire("node:zlib") as typeof zlib;
      }
    } catch {
      // ignore
    }
  }

  if (!zlib) {
    cachedDeflateSync = null;
    return null;
  }

  const deflateSync = zlib.deflateSync;
  cachedDeflateSync = (data: Uint8Array) => {
    try {
      const result = deflateSync(data);
      return result instanceof Uint8Array ? result : new Uint8Array(result);
    } catch (error) {
      throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Corrupted compressed stream data.", { cause: error });
    }
  };
  return cachedDeflateSync;
}

export function deflateZlib(data: Uint8Array): Uint8Array {
  const deflate = loadDeflateSync();
  if (!deflate) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "Stream compression requires a zlib implementation. createDocument({ compress: true }) is only supported on Node.js; disable it for browser builds."
    );
  }
  return deflate(data);
}

const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15] as const;

const LENGTH_BASES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258] as const;
const LENGTH_EXTRA_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0] as const;
const DISTANCE_BASES = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577] as const;
const DISTANCE_EXTRA_BITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13] as const;

interface HuffmanTable {
  readonly maxBitLength: number;
  readonly maps: ReadonlyArray<Map<number, number>>;
}

export function inflateZlib(data: Uint8Array): Uint8Array {
  try {
    if (data.length < 6) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Zlib data is too short.");
    }

  const cmf = data[0];
  const flg = data[1];
  if (cmf === undefined || flg === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Zlib header is incomplete.");
  }

  if ((cmf & 0x0f) !== 8) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Only deflate-compressed zlib streams are supported.", {
      compressionMethod: cmf & 0x0f
    });
  }

  if ((((cmf << 8) | flg) % 31) !== 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Invalid zlib header checksum.");
  }

  if ((flg & 0x20) !== 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Preset dictionaries are not supported in zlib streams.");
  }

  const compressed = data.subarray(2, data.length - 4);
  const reader = new BitReader(compressed);
  const output: number[] = [];

  let isFinalBlock = false;
  while (!isFinalBlock) {
    isFinalBlock = reader.readBits(1) === 1;
    const blockType = reader.readBits(2);

    if (blockType === 0) {
      readStoredBlock(reader, output);
    } else if (blockType === 1) {
      const fixedLiteralTable = buildFixedLiteralLengthTable();
      const fixedDistanceTable = buildFixedDistanceTable();
      readCompressedBlock(reader, output, fixedLiteralTable, fixedDistanceTable);
    } else if (blockType === 2) {
      const { literalTable, distanceTable } = readDynamicTables(reader);
      readCompressedBlock(reader, output, literalTable, distanceTable);
    } else {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Reserved deflate block type encountered.", {
        blockType
      });
    }
  }

  const inflated = Uint8Array.from(output);
  const expectedChecksum = readUint32Be(data, data.length - 4);
  const actualChecksum = adler32(inflated);
  if (actualChecksum !== expectedChecksum) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Zlib Adler-32 checksum mismatch.");
  }

    return inflated;
  } catch (error) {
    if (error instanceof PdfEngineError) {
      throw error;
    }
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Corrupted compressed stream data.", { cause: error });
  }
}

/**
 *
 * An internal bit-level reader for deflate streams. It reads least-significant-bit-first values, aligns to byte boundaries, and reports malformed compressed input.
 *
 * @class BitReader
 */
class BitReader {
  private byteOffset = 0;
  private bitOffset = 0;

  /**
   * Creates a bit reader over the compressed byte buffer.
   *
   * @param bytes The source bytes to read.
   */
  constructor(private readonly bytes: Uint8Array) {}

  /**
   * Reads a little-endian bit sequence from the current bit position.
   *
   * @param count The number of bits to read.
   *
   * @returns The decoded bit value.
   */
  readBits(count: number): number {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const byte = this.bytes[this.byteOffset];
      if (byte === undefined) {
        throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of deflate stream.");
      }

      const bit = (byte >> this.bitOffset) & 1;
      value |= bit << index;
      this.bitOffset += 1;
      if (this.bitOffset === 8) {
        this.bitOffset = 0;
        this.byteOffset += 1;
      }
    }

    return value;
  }

  /**
   * Advances the cursor to the next byte boundary.
   */
  alignToByte(): void {
    if (this.bitOffset !== 0) {
      this.bitOffset = 0;
      this.byteOffset += 1;
    }
  }

  /**
   * Reads the next byte after aligning to a byte boundary.
   *
   * @returns The decoded byte value.
   */
  readByte(): number {
    this.alignToByte();
    const byte = this.bytes[this.byteOffset];
    if (byte === undefined) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of deflate stream.");
    }

    this.byteOffset += 1;
    return byte;
  }
}

function readStoredBlock(reader: BitReader, output: number[]): void {
  reader.alignToByte();
  const len = reader.readByte() | (reader.readByte() << 8);
  const nlen = reader.readByte() | (reader.readByte() << 8);
  if ((len ^ 0xffff) !== nlen) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Stored deflate block checksum mismatch.");
  }

  for (let index = 0; index < len; index += 1) {
    output.push(reader.readByte());
  }
}

function readCompressedBlock(reader: BitReader, output: number[], literalTable: HuffmanTable, distanceTable: HuffmanTable): void {
  while (true) {
    const symbol = decodeSymbol(reader, literalTable);
    if (symbol < 256) {
      output.push(symbol);
      continue;
    }

    if (symbol === 256) {
      return;
    }

    const lengthIndex = symbol - 257;
    const lengthBase = LENGTH_BASES[lengthIndex];
    const extraLengthBits = LENGTH_EXTRA_BITS[lengthIndex];
    if (lengthBase === undefined || extraLengthBits === undefined) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Invalid deflate length symbol.", { symbol });
    }

    const length = lengthBase + (extraLengthBits > 0 ? reader.readBits(extraLengthBits) : 0);
    const distanceSymbol = decodeSymbol(reader, distanceTable);
    const distanceBase = DISTANCE_BASES[distanceSymbol];
    const extraDistanceBits = DISTANCE_EXTRA_BITS[distanceSymbol];
    if (distanceBase === undefined || extraDistanceBits === undefined) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Invalid deflate distance symbol.", {
        distanceSymbol
      });
    }

    const distance = distanceBase + (extraDistanceBits > 0 ? reader.readBits(extraDistanceBits) : 0);
    if (distance > output.length) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Deflate back-reference exceeds output size.", {
        distance,
        outputLength: output.length
      });
    }

    const start = output.length - distance;
    for (let index = 0; index < length; index += 1) {
      output.push(output[start + index]!);
    }
  }
}

function readDynamicTables(reader: BitReader): { literalTable: HuffmanTable; distanceTable: HuffmanTable } {
  const literalCount = reader.readBits(5) + 257;
  const distanceCount = reader.readBits(5) + 1;
  const codeLengthCount = reader.readBits(4) + 4;

  const codeLengths = new Array<number>(19).fill(0);
  for (let index = 0; index < codeLengthCount; index += 1) {
    codeLengths[CODE_LENGTH_ORDER[index]!] = reader.readBits(3);
  }

  const codeLengthTable = buildHuffmanTable(codeLengths);
  const lengths: number[] = [];
  while (lengths.length < literalCount + distanceCount) {
    const symbol = decodeSymbol(reader, codeLengthTable);
    if (symbol <= 15) {
      lengths.push(symbol);
      continue;
    }

    if (symbol === 16) {
      const previous = lengths[lengths.length - 1];
      if (previous === undefined) {
        throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Deflate repeat code encountered without a previous value.");
      }

      const repeat = reader.readBits(2) + 3;
      for (let index = 0; index < repeat; index += 1) {
        lengths.push(previous);
      }
      continue;
    }

    if (symbol === 17) {
      const repeat = reader.readBits(3) + 3;
      for (let index = 0; index < repeat; index += 1) {
        lengths.push(0);
      }
      continue;
    }

    if (symbol === 18) {
      const repeat = reader.readBits(7) + 11;
      for (let index = 0; index < repeat; index += 1) {
        lengths.push(0);
      }
      continue;
    }

    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Invalid deflate code-length symbol.", { symbol });
  }

  const literalTable = buildHuffmanTable(lengths.slice(0, literalCount));
  const distanceLengths = lengths.slice(literalCount, literalCount + distanceCount);
  if (distanceLengths.every((entry) => entry === 0)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Deflate distance table is empty.");
  }

  return {
    literalTable,
    distanceTable: buildHuffmanTable(distanceLengths)
  };
}

function decodeSymbol(reader: BitReader, table: HuffmanTable): number {
  let code = 0;
  for (let bitLength = 1; bitLength <= table.maxBitLength; bitLength += 1) {
    code |= reader.readBits(1) << (bitLength - 1);
    const symbol = table.maps[bitLength]?.get(code);
    if (symbol !== undefined) {
      return symbol;
    }
  }

  throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unable to decode Huffman symbol from deflate stream.");
}

function buildFixedLiteralLengthTable(): HuffmanTable {
  const lengths = new Array<number>(288).fill(0);
  for (let index = 0; index <= 143; index += 1) lengths[index] = 8;
  for (let index = 144; index <= 255; index += 1) lengths[index] = 9;
  for (let index = 256; index <= 279; index += 1) lengths[index] = 7;
  for (let index = 280; index <= 287; index += 1) lengths[index] = 8;
  return buildHuffmanTable(lengths);
}

function buildFixedDistanceTable(): HuffmanTable {
  return buildHuffmanTable(new Array<number>(32).fill(5));
}

function buildHuffmanTable(lengths: readonly number[]): HuffmanTable {
  const maxBitLength = Math.max(...lengths, 0);
  if (maxBitLength === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Huffman table must include at least one symbol.");
  }

  const bitLengthCounts = new Array<number>(maxBitLength + 1).fill(0);
  for (const length of lengths) {
    if (length < 0) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Negative Huffman bit length encountered.");
    }
    if (length > 0) {
      bitLengthCounts[length] = (bitLengthCounts[length] ?? 0) + 1;
    }
  }

  const nextCode = new Array<number>(maxBitLength + 1).fill(0);
  let code = 0;
  for (let bitLength = 1; bitLength <= maxBitLength; bitLength += 1) {
    code = (code + bitLengthCounts[bitLength - 1]!) << 1;
    nextCode[bitLength] = code;
  }

  const maps = Array.from({ length: maxBitLength + 1 }, () => new Map<number, number>());
  for (const [symbol, bitLength] of lengths.entries()) {
    if (bitLength === 0) {
      continue;
    }

    const assignedCode = nextCode[bitLength]!;
    nextCode[bitLength] = assignedCode + 1;
    maps[bitLength]!.set(reverseBits(assignedCode, bitLength), symbol);
  }

  return {
    maxBitLength,
    maps
  };
}

function reverseBits(value: number, bitLength: number): number {
  let result = 0;
  let remaining = value;
  for (let index = 0; index < bitLength; index += 1) {
    result = (result << 1) | (remaining & 1);
    remaining >>>= 1;
  }
  return result;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }

  return (((b << 16) | a) >>> 0);
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  const b1 = bytes[offset];
  const b2 = bytes[offset + 1];
  const b3 = bytes[offset + 2];
  const b4 = bytes[offset + 3];
  if (b1 === undefined || b2 === undefined || b3 === undefined || b4 === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of checksum data.", { offset });
  }

  return (((b1 << 24) >>> 0) | (b2 << 16) | (b3 << 8) | b4) >>> 0;
}
