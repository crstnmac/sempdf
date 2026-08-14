/**
 * Zero-dependency Brotli (RFC 7932) decompressor.
 *
 * Implements the full bit-stream format: meta-blocks, prefix codes (simple
 * and complex forms), block switching for the three category types, context
 * modeling for literals and distances, the distance ring buffer, and static
 * dictionary references with the 121 word transforms.
 *
 * Used by the WOFF2 decoder; fonts served as woff2 are Brotli streams.
 */
import { PdfEngineError, PdfErrorCode } from "../errors.js";
import { BROTLI_CONTEXT_LUT } from "./brotli-context.js";
import { brotliDictionary } from "./brotli-dictionary.js";
import { BROTLI_TRANSFORMS } from "./brotli-transforms.js";

function fail(message: string): never {
  throw new PdfEngineError(PdfErrorCode.INVALID_FONT, `Invalid Brotli stream: ${message}`);
}

/** LSB-first bit reader over a byte array. */
class BitReader {
  private position = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readBits(count: number): number {
    while (this.bitCount < count) {
      if (this.position >= this.bytes.length) {
        fail("unexpected end of input");
      }
      this.bitBuffer |= this.bytes[this.position]! << this.bitCount;
      this.position += 1;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << count) - 1);
    this.bitBuffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  /** Discards bits up to the next byte boundary. */
  alignToByte(): void {
    const partial = this.bitCount & 7;
    if (partial !== 0) {
      this.readBits(partial);
    }
  }

  /** Copies `length` bytes from the (byte-aligned) input. */
  copyBytes(target: Uint8Array, offset: number, length: number): void {
    // Drain whole buffered bytes first.
    let written = 0;
    while (this.bitCount >= 8 && written < length) {
      target[offset + written] = this.bitBuffer & 0xff;
      this.bitBuffer >>>= 8;
      this.bitCount -= 8;
      written += 1;
    }
    if (this.bitCount !== 0 && written < length) {
      fail("uncompressed block is not byte-aligned");
    }
    while (written < length) {
      if (this.position >= this.bytes.length) {
        fail("unexpected end of uncompressed block");
      }
      target[offset + written] = this.bytes[this.position]!;
      this.position += 1;
      written += 1;
    }
  }
}

/** Canonical prefix-code lookup built from code lengths (max length 15). */
class PrefixCode {
  private constructor(
    /** Flat lookup table: index by next `maxLength` bits → (symbol << 5) | length. */
    private readonly table: Int32Array,
    readonly maxLength: number,
  ) {}

  static fromLengths(lengths: readonly number[]): PrefixCode {
    let maxLength = 0;
    for (const length of lengths) {
      if (length > maxLength) maxLength = length;
    }
    if (maxLength === 0) {
      fail("empty prefix code");
    }
    const table = new Int32Array(1 << maxLength).fill(-1);
    const blCount = new Array<number>(maxLength + 1).fill(0);
    for (const length of lengths) {
      if (length > 0) blCount[length] = blCount[length]! + 1;
    }
    const nextCode = new Array<number>(maxLength + 1).fill(0);
    let code = 0;
    for (let bits = 1; bits <= maxLength; bits += 1) {
      code = (code + blCount[bits - 1]!) << 1;
      nextCode[bits] = code;
    }
    for (let symbol = 0; symbol < lengths.length; symbol += 1) {
      const length = lengths[symbol]!;
      if (length === 0) continue;
      const canonical = nextCode[length]!;
      nextCode[length] = canonical + 1;
      // Reverse the bits: brotli assigns canonical codes MSB-first but the
      // stream is read LSB-first.
      let reversed = 0;
      for (let bit = 0; bit < length; bit += 1) {
        reversed = (reversed << 1) | ((canonical >> bit) & 1);
      }
      const entry = (symbol << 5) | length;
      for (let index = reversed; index < 1 << maxLength; index += 1 << length) {
        table[index] = entry;
      }
    }
    return new PrefixCode(table, maxLength);
  }

  static single(symbol: number): PrefixCode {
    return new PrefixCode(Int32Array.of(symbol << 5), 0);
  }

  readSymbol(reader: BitReader): number {
    if (this.maxLength === 0) {
      return this.table[0]! >> 5;
    }
    // Peek maxLength bits without a peek primitive: read bit-by-bit walking the flat table.
    let bits = 0;
    let read = 0;
    while (read < this.maxLength) {
      bits |= reader.readBits(1) << read;
      read += 1;
      const entry = this.table[bits]!;
      if (entry !== -1 && (entry & 31) === read) {
        return entry >> 5;
      }
      // Continue: any longer code sharing this prefix fills the same slots, so
      // check again after more bits. Entries record exact lengths.
    }
    // Final lookup with all bits read.
    const entry = this.table[bits]!;
    if (entry === -1) {
      fail("invalid prefix code word");
    }
    return entry >> 5;
  }
}

const CODE_LENGTH_CODE_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

/** Reads a prefix code description (RFC 7932 section 3.5). */
function readPrefixCode(reader: BitReader, alphabetSize: number): PrefixCode {
  const hskip = reader.readBits(2);
  if (hskip === 1) {
    // Simple code with 1-4 symbols.
    const maxBits = Math.ceil(Math.log2(alphabetSize));
    const numSymbols = reader.readBits(2) + 1;
    const symbols: number[] = [];
    for (let i = 0; i < numSymbols; i += 1) {
      const symbol = maxBits === 0 ? 0 : reader.readBits(maxBits);
      if (symbol >= alphabetSize) {
        fail("simple prefix symbol out of range");
      }
      if (symbols.includes(symbol)) {
        fail("duplicate simple prefix symbol");
      }
      symbols.push(symbol);
    }
    if (numSymbols === 1) {
      return PrefixCode.single(symbols[0]!);
    }
    const lengths = new Array<number>(alphabetSize).fill(0);
    if (numSymbols === 2) {
      lengths[symbols[0]!] = 1;
      lengths[symbols[1]!] = 1;
    } else if (numSymbols === 3) {
      lengths[symbols[0]!] = 1;
      lengths[symbols[1]!] = 2;
      lengths[symbols[2]!] = 2;
    } else {
      const treeSelect = reader.readBits(1);
      if (treeSelect === 0) {
        for (const symbol of symbols) lengths[symbol] = 2;
      } else {
        lengths[symbols[0]!] = 1;
        lengths[symbols[1]!] = 2;
        lengths[symbols[2]!] = 3;
        lengths[symbols[3]!] = 3;
      }
    }
    return PrefixCode.fromLengths(lengths);
  }

  // Complex code: read code-length code lengths.
  const codeLengthLengths = new Array<number>(18).fill(0);
  let space = 32;
  let numCodes = 0;
  for (let i = hskip; i < 18 && space > 0; i += 1) {
    const order = CODE_LENGTH_CODE_ORDER[i]!;
    // Code-length alphabet code: 2: "00", 4: "1110" 1: "01" 3: "110" 5: "11110" 0: "11111"... per RFC 3.5:
    // value encoding: 0->00(len 2 means cl=0? ) Actual RFC: bits: "00"=0,"0111"? Use the fixed table below.
    // Fixed VLC over stream-order bit patterns (RFC 3.5): "00"->0, "10"->4,
    // "01"->3, "110"->2, "1110"->1, "1111"->5. Bits are read LSB-first, so a
    // 2-bit read returns firstBit | secondBit << 1.
    let codeLength: number;
    const b0 = reader.readBits(2);
    if (b0 === 0) codeLength = 0;
    else if (b0 === 1) codeLength = 4;
    else if (b0 === 2) codeLength = 3;
    else {
      const b1 = reader.readBits(1);
      if (b1 === 0) codeLength = 2;
      else {
        const b2 = reader.readBits(1);
        if (b2 === 0) codeLength = 1;
        else codeLength = 5;
      }
    }
    codeLengthLengths[order] = codeLength;
    if (codeLength !== 0) {
      space -= 32 >> codeLength;
      numCodes += 1;
    }
  }
  if (numCodes !== 1 && space !== 0) {
    fail("invalid code length code");
  }
  // A single non-zero code-length code is read with zero bits per symbol.
  const codeLengthCode =
    numCodes === 1
      ? PrefixCode.single(codeLengthLengths.findIndex((length) => length !== 0))
      : PrefixCode.fromLengths(codeLengthLengths);

  // Read the symbol code lengths with repeat codes 16/17.
  const lengths = new Array<number>(alphabetSize).fill(0);
  let symbol = 0;
  let previousLength = 8;
  let repeat = 0;
  let repeatLength = 0;
  let symbolSpace = 32768;
  while (symbol < alphabetSize && symbolSpace > 0) {
    const codeLength = codeLengthCode.readSymbol(reader);
    if (codeLength < 16) {
      repeat = 0;
      lengths[symbol] = codeLength;
      symbol += 1;
      if (codeLength !== 0) {
        previousLength = codeLength;
        symbolSpace -= 32768 >> codeLength;
      }
    } else {
      const extraBits = codeLength - 14; // 16 -> 2 bits, 17 -> 3 bits
      const newLength = codeLength === 16 ? previousLength : 0;
      if (repeatLength !== newLength) {
        repeat = 0;
        repeatLength = newLength;
      }
      const oldRepeat = repeat;
      if (repeat > 0) {
        repeat -= 2;
        repeat <<= extraBits;
      }
      repeat += reader.readBits(extraBits) + 3;
      const count = repeat - oldRepeat;
      if (symbol + count > alphabetSize) {
        fail("repeat code overflows alphabet");
      }
      for (let i = 0; i < count; i += 1) {
        lengths[symbol] = repeatLength;
        symbol += 1;
      }
      if (repeatLength !== 0) {
        symbolSpace -= count * (32768 >> repeatLength);
      }
    }
  }
  if (symbolSpace !== 0) {
    fail("prefix code lengths do not fill the code space");
  }
  return PrefixCode.fromLengths(lengths);
}

/** Reads a 256-capped variable-length count (NBLTYPES, NTREES; RFC 9.2). */
function readVarLenUint8(reader: BitReader): number {
  if (reader.readBits(1) === 0) {
    return 1;
  }
  const nbits = reader.readBits(3);
  if (nbits === 0) {
    return 2;
  }
  return reader.readBits(nbits) + (1 << nbits) + 1;
}

/** Insert-length code table: [extra bits, offset]. */
const INSERT_LENGTH_CODES: ReadonlyArray<readonly [number, number]> = (() => {
  const extra = [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24];
  const codes: Array<[number, number]> = [];
  let offset = 0;
  for (const bits of extra) {
    codes.push([bits, offset]);
    offset += 1 << bits;
  }
  return codes;
})();

/** Copy-length code table: [extra bits, offset]. */
const COPY_LENGTH_CODES: ReadonlyArray<readonly [number, number]> = (() => {
  const extra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24];
  const codes: Array<[number, number]> = [];
  let offset = 2;
  for (const bits of extra) {
    codes.push([bits, offset]);
    offset += 1 << bits;
  }
  return codes;
})();

/**
 * Decomposes an insert-and-copy length symbol (0-703) into its insert code,
 * copy code, and implicit-distance-zero flag (RFC 5).
 */
function decodeInsertAndCopy(symbol: number): { insertCode: number; copyCode: number; distanceZero: boolean } {
  // RFC 7932 section 5 cell layout (symbol >> 6). Cells 0-1 repeat the
  // insert/copy ranges of cells 2-3 with an implicit distance of zero.
  //   0:  insert 0-7,   copy 0-7,  implicit distance 0
  //   1:  insert 0-7,   copy 8-15, implicit distance 0
  //   2:  insert 0-7,   copy 0-7
  //   3:  insert 0-7,   copy 8-15
  //   4:  insert 8-15,  copy 0-7
  //   5:  insert 8-15,  copy 8-15
  //   6:  insert 0-7,   copy 16-23
  //   7:  insert 16-23, copy 0-7
  //   8:  insert 8-15,  copy 16-23
  //   9:  insert 16-23, copy 8-15
  //   10: insert 16-23, copy 16-23
  const cell = symbol >> 6;
  const distanceZero = cell < 2;
  const insertHigh = [0, 0, 0, 0, 1, 1, 0, 2, 1, 2, 2][cell]!;
  const copyHigh = [0, 1, 0, 1, 0, 1, 2, 0, 2, 1, 2][cell]!;
  const insertCode = (insertHigh << 3) | ((symbol >> 3) & 7);
  const copyCode = (copyHigh << 3) | (symbol & 7);
  return { insertCode, copyCode, distanceZero };
}

/** Context-map RLEMAX inverse-move-to-front decoding (RFC 7.3). */
function readContextMap(reader: BitReader, size: number, treeCount: number): Uint8Array {
  const map = new Uint8Array(size);
  if (treeCount === 1) {
    return map;
  }
  const useRle = reader.readBits(1);
  const rleMax = useRle === 1 ? reader.readBits(4) + 1 : 0;
  const code = readPrefixCode(reader, treeCount + rleMax);
  let index = 0;
  while (index < size) {
    const symbol = code.readSymbol(reader);
    if (symbol === 0) {
      map[index] = 0;
      index += 1;
    } else if (symbol <= rleMax) {
      let repeat = (1 << symbol) + reader.readBits(symbol);
      while (repeat > 0) {
        if (index >= size) {
          fail("context map run overflows");
        }
        map[index] = 0;
        index += 1;
        repeat -= 1;
      }
    } else {
      map[index] = symbol - rleMax;
      index += 1;
    }
  }
  if (reader.readBits(1) === 1) {
    // Inverse move-to-front.
    const mtf = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) mtf[i] = i;
    for (let i = 0; i < size; i += 1) {
      const idx = map[i]!;
      const value = mtf[idx]!;
      map[i] = value;
      for (let j = idx; j > 0; j -= 1) {
        mtf[j] = mtf[j - 1]!;
      }
      mtf[0] = value;
    }
  }
  return map;
}

/** Per-category block-switching state (literals, insert&copy, distances). */
class BlockState {
  blockType = 0;
  blockLength: number;
  private previousType = 1;
  private secondLastType = 0;

  constructor(
    readonly typeCount: number,
    private readonly typeCode: PrefixCode | undefined,
    private readonly lengthCode: PrefixCode | undefined,
    reader: BitReader,
  ) {
    this.blockLength = lengthCode === undefined ? 1 << 28 : readBlockLength(lengthCode, reader);
  }

  /** Consumes one element; switches blocks when the current one is exhausted. */
  next(reader: BitReader): void {
    if (this.blockLength === 0) {
      if (this.typeCode === undefined || this.lengthCode === undefined) {
        fail("block length exhausted without block-switch codes");
      }
      const typeSymbol = this.typeCode.readSymbol(reader);
      let newType: number;
      if (typeSymbol === 0) {
        newType = this.previousType;
      } else if (typeSymbol === 1) {
        newType = (this.blockType + 1) % this.typeCount;
      } else {
        newType = typeSymbol - 2;
      }
      this.secondLastType = this.previousType;
      this.previousType = this.blockType;
      this.blockType = newType;
      this.blockLength = readBlockLength(this.lengthCode, reader);
    }
    this.blockLength -= 1;
  }
}

/** Block-count code table: [extra bits, offset] for the 26 block-length codes. */
const BLOCK_LENGTH_CODES: ReadonlyArray<readonly [number, number]> = (() => {
  const extra = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 24];
  const codes: Array<[number, number]> = [];
  let offset = 1;
  for (const bits of extra) {
    codes.push([bits, offset]);
    offset += 1 << bits;
  }
  return codes;
})();

function readBlockLength(code: PrefixCode, reader: BitReader): number {
  const symbol = code.readSymbol(reader);
  const [bits, offset] = BLOCK_LENGTH_CODES[symbol]!;
  return offset + reader.readBits(bits);
}

/**
 * Computes the literal context id for the given mode from the previous two
 * bytes (RFC 7.1), via the shared 2048-entry lookup table.
 */
function literalContext(mode: number, p1: number, p2: number): number {
  const base = mode << 9;
  return BROTLI_CONTEXT_LUT[base + p1]! | BROTLI_CONTEXT_LUT[base + 256 + p2]!;
}

/** Static dictionary word-count bits per word length (RFC Appendix A). */
const DICTIONARY_NDBITS = [0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5] as const;
const DICTIONARY_OFFSETS = (() => {
  // Word lengths 0-3 have no dictionary entries; the length-4 section starts
  // at offset 0 (compare kBrotliDictionaryOffsetsByLength: 0, 4096, 9216, ...).
  const offsets = new Array<number>(26).fill(0);
  for (let length = 4; length < 25; length += 1) {
    offsets[length + 1] = offsets[length]! + (length << DICTIONARY_NDBITS[length]!);
  }
  return offsets;
})();

/** Applies UTF-8-aware uppercasing at `position` (Ferment; RFC 8). */
function ferment(bytes: Uint8Array, length: number, position: number): number {
  const byte = bytes[position]!;
  if (byte < 0x80) {
    if (byte >= 97 && byte <= 122) {
      bytes[position] = byte ^ 32;
    }
    return 1;
  }
  if (byte < 0xe0) {
    if (position + 1 < length) {
      bytes[position + 1] = bytes[position + 1]! ^ 32;
    }
    return 2;
  }
  if (position + 2 < length) {
    bytes[position + 2] = bytes[position + 2]! ^ 5;
  }
  return 3;
}

/** Expands a static dictionary word with the given transform into `target`. */
function transformDictionaryWord(
  target: Uint8Array,
  targetOffset: number,
  word: Uint8Array,
  transformId: number,
): number {
  const transform = BROTLI_TRANSFORMS[transformId];
  if (transform === undefined) {
    fail(`invalid dictionary transform ${transformId}`);
  }
  let offset = targetOffset;
  for (const byte of transform.prefix) {
    target[offset] = byte;
    offset += 1;
  }
  let start = 0;
  let length = word.length;
  const op = transform.op;
  if (op >= 12) {
    length = Math.max(0, length - (op - 11)); // OmitLast1-9
  } else if (op >= 3) {
    const omit = op - 2; // OmitFirst1-9
    start = Math.min(omit, length);
    length -= start;
  }
  const wordStart = offset;
  for (let i = 0; i < length; i += 1) {
    target[offset] = word[start + i]!;
    offset += 1;
  }
  if (op === 1) {
    ferment(target, offset, wordStart); // FermentFirst
  } else if (op === 2) {
    let position = wordStart;
    while (position < offset) {
      position += ferment(target, offset, position); // FermentAll
    }
  }
  for (const byte of transform.suffix) {
    target[offset] = byte;
    offset += 1;
  }
  return offset - targetOffset;
}

/**
 * Decompresses a complete Brotli stream.
 *
 * @param input The compressed bytes.
 * @param expectedSize Optional decompressed size hint used to pre-allocate.
 *
 * @returns The decompressed bytes.
 */
export function brotliDecompress(input: Uint8Array, expectedSize?: number): Uint8Array {
  const reader = new BitReader(input);

  // Window size (WBITS).
  let windowBits: number;
  if (reader.readBits(1) === 0) {
    windowBits = 16;
  } else {
    const n = reader.readBits(3);
    if (n !== 0) {
      windowBits = 17 + n;
    } else {
      const m = reader.readBits(3);
      if (m === 0) {
        windowBits = 17;
      } else if (m === 1) {
        fail("reserved WBITS value");
      } else {
        windowBits = 8 + m;
      }
    }
  }
  const maxBackwardDistance = (1 << windowBits) - 16;

  let output = new Uint8Array(expectedSize !== undefined && expectedSize > 0 ? expectedSize : 64 * 1024);
  let outputLength = 0;
  const ensureCapacity = (extra: number): void => {
    if (outputLength + extra <= output.length) return;
    let next = output.length * 2;
    while (next < outputLength + extra) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(output.subarray(0, outputLength));
    output = grown;
  };

  const distanceRing = [16, 15, 11, 4];
  let distanceRingIndex = 0;

  let isLast = false;
  while (!isLast) {
    isLast = reader.readBits(1) === 1;
    if (isLast && reader.readBits(1) === 1) {
      break; // ISLASTEMPTY
    }
    // MLEN
    const sizeNibbles = reader.readBits(2) + 4;
    let metaBlockLength = 0;
    if (sizeNibbles === 7) {
      // MNIBBLES = 0: metadata meta-block.
      if (reader.readBits(1) === 1) {
        fail("reserved bit set in metadata block");
      }
      const sizeBytes = reader.readBits(2);
      let metadataLength = 0;
      for (let i = 0; i < sizeBytes; i += 1) {
        const byte = reader.readBits(8);
        if (i + 1 === sizeBytes && sizeBytes > 1 && byte === 0) {
          fail("metadata size has trailing zero byte");
        }
        metadataLength |= byte << (i * 8);
      }
      reader.alignToByte();
      for (let i = 0; i < metadataLength; i += 1) {
        reader.readBits(8); // skip metadata
      }
      continue;
    }
    for (let i = 0; i < sizeNibbles; i += 1) {
      const nibble = reader.readBits(4);
      if (i + 1 === sizeNibbles && sizeNibbles > 4 && nibble === 0) {
        fail("meta-block size has trailing zero nibble");
      }
      metaBlockLength |= nibble << (i * 4);
    }
    metaBlockLength += 1;

    if (!isLast && reader.readBits(1) === 1) {
      // ISUNCOMPRESSED
      reader.alignToByte();
      ensureCapacity(metaBlockLength);
      reader.copyBytes(output, outputLength, metaBlockLength);
      outputLength += metaBlockLength;
      continue;
    }

    // Block-switch state per category.
    const categories: BlockState[] = [];
    for (let category = 0; category < 3; category += 1) {
      const typeCount = readVarLenUint8(reader);
      if (typeCount >= 2) {
        const typeCode = readPrefixCode(reader, typeCount + 2);
        const lengthCode = readPrefixCode(reader, BLOCK_LENGTH_CODES.length);
        categories.push(new BlockState(typeCount, typeCode, lengthCode, reader));
      } else {
        categories.push(new BlockState(1, undefined, undefined, reader));
      }
    }
    const [literalState, commandState, distanceState] = categories as [BlockState, BlockState, BlockState];

    // Distance parameters.
    const npostfix = reader.readBits(2);
    const ndirect = reader.readBits(4) << npostfix;
    const postfixMask = (1 << npostfix) - 1;

    // Literal context modes per literal block type.
    const contextModes: number[] = [];
    for (let i = 0; i < literalState.typeCount; i += 1) {
      contextModes.push(reader.readBits(2));
    }

    // Context maps.
    const literalTreeCount = readVarLenUint8(reader);
    const literalContextMap = readContextMap(reader, literalState.typeCount * 64, literalTreeCount);
    const distanceTreeCount = readVarLenUint8(reader);
    const distanceContextMap = readContextMap(reader, distanceState.typeCount * 4, distanceTreeCount);

    // Prefix code trees.
    const literalCodes: PrefixCode[] = [];
    for (let i = 0; i < literalTreeCount; i += 1) {
      literalCodes.push(readPrefixCode(reader, 256));
    }
    const commandCodes: PrefixCode[] = [];
    for (let i = 0; i < commandState.typeCount; i += 1) {
      commandCodes.push(readPrefixCode(reader, 704));
    }
    const distanceAlphabetSize = 16 + ndirect + (48 << npostfix);
    const distanceCodes: PrefixCode[] = [];
    for (let i = 0; i < distanceTreeCount; i += 1) {
      distanceCodes.push(readPrefixCode(reader, distanceAlphabetSize));
    }

    let remaining = metaBlockLength;
    ensureCapacity(metaBlockLength);
    while (remaining > 0) {
      commandState.next(reader);
      const commandCode = commandCodes[commandState.blockType]!;
      const commandSymbol = commandCode.readSymbol(reader);
      const { insertCode, copyCode, distanceZero } = decodeInsertAndCopy(commandSymbol);
      const [insertBits, insertOffset] = INSERT_LENGTH_CODES[insertCode]!;
      const insertLength = insertOffset + reader.readBits(insertBits);
      const [copyBits, copyOffset] = COPY_LENGTH_CODES[copyCode]!;
      let copyLength = copyOffset + reader.readBits(copyBits);

      // Literals.
      if (insertLength > remaining) {
        fail("insert length exceeds meta-block length");
      }
      ensureCapacity(insertLength);
      for (let i = 0; i < insertLength; i += 1) {
        literalState.next(reader);
        const p1 = outputLength > 0 ? output[outputLength - 1]! : 0;
        const p2 = outputLength > 1 ? output[outputLength - 2]! : 0;
        const context = literalContext(contextModes[literalState.blockType]!, p1, p2);
        const treeIndex = literalContextMap[(literalState.blockType << 6) | context]!;
        const literal = literalCodes[treeIndex]!.readSymbol(reader);
        output[outputLength] = literal;
        outputLength += 1;
      }
      remaining -= insertLength;
      if (remaining <= 0) {
        break;
      }

      // Distance.
      let distance: number;
      let updateRing = false;
      if (distanceZero) {
        distance = distanceRing[(distanceRingIndex + 3) & 3]!;
      } else {
        distanceState.next(reader);
        const distanceContext = copyLength <= 4 ? copyLength - 2 : 3;
        const treeIndex = distanceContextMap[(distanceState.blockType << 2) | distanceContext]!;
        const distanceSymbol = distanceCodes[treeIndex]!.readSymbol(reader);
        // Distance code 0 re-uses the last distance and does not refresh the ring.
        updateRing = distanceSymbol !== 0;
        if (distanceSymbol < 16) {
          // Ring buffer references with offsets.
          const ringIndex = (distanceRingIndex + [3, 2, 1, 0, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2][distanceSymbol]!) & 3;
          const delta = [0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3][distanceSymbol]!;
          distance = distanceRing[ringIndex]! + delta;
          if (distance <= 0) {
            fail("non-positive ring distance");
          }
        } else if (distanceSymbol < 16 + ndirect) {
          distance = distanceSymbol - 15;
        } else {
          const ndistbits = 1 + ((distanceSymbol - ndirect - 16) >> (npostfix + 1));
          const dextra = reader.readBits(ndistbits);
          const hcode = (distanceSymbol - ndirect - 16) >> npostfix;
          const lcode = (distanceSymbol - ndirect - 16) & postfixMask;
          const offset = ((2 + (hcode & 1)) << ndistbits) - 4;
          distance = ((offset + dextra) << npostfix) + lcode + ndirect + 1;
        }
      }

      const maxDistance = Math.min(outputLength, maxBackwardDistance);
      if (distance <= maxDistance) {
        // Backward reference. Dictionary references never enter the ring.
        if (updateRing) {
          distanceRing[distanceRingIndex & 3] = distance;
          distanceRingIndex += 1;
        }
        if (copyLength > remaining) {
          fail("copy length exceeds meta-block length");
        }
        ensureCapacity(copyLength);
        for (let i = 0; i < copyLength; i += 1) {
          output[outputLength] = output[outputLength - distance]!;
          outputLength += 1;
        }
        remaining -= copyLength;
      } else {
        // Static dictionary reference.
        if (copyLength < 4 || copyLength > 24) {
          fail(`invalid dictionary copy length ${copyLength}`);
        }
        const wordId = distance - maxDistance - 1;
        const ndbits = DICTIONARY_NDBITS[copyLength]!;
        const index = wordId & ((1 << ndbits) - 1);
        const transformId = wordId >> ndbits;
        if (transformId >= 121) {
          fail(`invalid dictionary transform id ${transformId}`);
        }
        const dictionary = brotliDictionary();
        const wordOffset = DICTIONARY_OFFSETS[copyLength]! + index * copyLength;
        const word = dictionary.subarray(wordOffset, wordOffset + copyLength);
        ensureCapacity(copyLength + 13); // transforms add at most 13 bytes
        const written = transformDictionaryWord(output, outputLength, word, transformId);
        outputLength += written;
        remaining -= written;
        if (remaining < 0) {
          fail("dictionary word overflows meta-block");
        }
      }
    }
  }

  return output.subarray(0, outputLength);
}
