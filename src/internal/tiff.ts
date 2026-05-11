import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";

export interface EmbeddedTiffAsset {
  readonly kind: "tiff";
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bitsPerComponent: number;
  readonly colorSpace: "DeviceGray" | "DeviceRGB" | "DeviceCMYK";
  readonly channels: 1 | 3 | 4;
  readonly decodeMode: "rawSamples";
  readonly iccProfile?: { readonly bytes: Uint8Array; readonly channels: number } | undefined;
}

function toUint8Array(data: BinaryData): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  ) >>> 0;
}

interface TiffIfdTag {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
  value: number | number[];
}

function parseIfd(
  bytes: Uint8Array,
  offset: number,
  isLE: boolean
): Map<number, TiffIfdTag> {
  const read16 = isLE ? readUint16LE : readUint16BE;
  const read32 = isLE ? readUint32LE : readUint32BE;

  const entryCount = read16(bytes, offset);
  const tags = new Map<number, TiffIfdTag>();

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = offset + 2 + i * 12;
    if (entryOffset + 12 > bytes.length) break;

    const tag = read16(bytes, entryOffset);
    const type = read16(bytes, entryOffset + 2);
    const count = read32(bytes, entryOffset + 4);

    let value: number | number[] = 0;
    let valueOffset = entryOffset + 8;

    const dataSize = count * typeSize(type);
    if (dataSize <= 4) {
      if (type === 3 || type === 8) {
        const vals: number[] = [];
        for (let j = 0; j < count; j++) {
          vals.push(read16(bytes, entryOffset + 8 + j * 2));
        }
        value = vals;
      } else if (type === 4) {
        value = read32(bytes, entryOffset + 8);
      } else {
        value = read16(bytes, entryOffset + 8);
      }
    } else {
      valueOffset = read32(bytes, entryOffset + 8);
    }

    tags.set(tag, { tag, type, count, valueOffset, value });
  }

  return tags;
}

function typeSize(type: number): number {
  switch (type) {
    case 1: return 1;  // BYTE
    case 2: return 1;  // ASCII
    case 3: return 2;  // SHORT
    case 4: return 4;  // LONG
    case 5: return 8;  // RATIONAL
    case 6: return 1;  // SBYTE
    case 7: return 1;  // UNDEFINED
    case 8: return 2;  // SSHORT
    case 9: return 4;  // SLONG
    case 10: return 8; // SRATIONAL
    case 11: return 4; // FLOAT
    case 12: return 8; // DOUBLE
    default: return 1;
  }
}

function getTagValue(tag: TiffIfdTag, bytes: Uint8Array, isLE: boolean): number {
  const read32 = isLE ? readUint32LE : readUint32BE;
  const read16 = isLE ? readUint16LE : readUint16BE;

  if (typeof tag.value !== "number") {
    if (tag.type === 3 && Array.isArray(tag.value) && tag.value.length > 0) {
      return tag.value[0]!;
    }
    return 0;
  }

  if (tag.type === 4) {
    return tag.value;
  }

  if (tag.type === 3) {
    return tag.value;
  }

  return 0;
}

function getTagValueArray(tag: TiffIfdTag, bytes: Uint8Array, isLE: boolean): number[] {
  const read32 = isLE ? readUint32LE : readUint32BE;
  const read16 = isLE ? readUint16LE : readUint16BE;

  if (Array.isArray(tag.value)) {
    return tag.value;
  }

  const vals: number[] = [];
  for (let i = 0; i < tag.count; i++) {
    if (tag.type === 4) {
      vals.push(read32(bytes, tag.valueOffset + i * 4));
    } else if (tag.type === 3) {
      vals.push(read16(bytes, tag.valueOffset + i * 2));
    }
  }
  return vals;
}

function decompressLZW(data: Uint8Array): Uint8Array {
  const result: number[] = [];
  let dictSize = 256;
  const dictionary = new Map<number, number[]>();

  for (let i = 0; i < 256; i++) {
    dictionary.set(i, [i]);
  }

  const CLEAR_CODE = 256;
  const EOI_CODE = 257;
  const INITIAL_BITS = 9;

  let codeBits = INITIAL_BITS;
  let nextCode = 258;
  let bitPos = 0;
  let bitBuf = 0;

  function readBits(bits: number): number {
    while (bitPos < bits) {
      if (data.length === 0) return EOI_CODE;
      bitBuf |= data[0]! << bitPos;
      data = data.subarray(1);
      bitPos += 8;
    }
    const val = bitBuf & ((1 << bits) - 1);
    bitBuf >>>= bits;
    bitPos -= bits;
    return val;
  }

  let prevCode = -1;

  while (true) {
    const code = readBits(codeBits);
    if (code === EOI_CODE) break;

    if (code === CLEAR_CODE) {
      codeBits = INITIAL_BITS;
      nextCode = 258;
      dictSize = 256;
      for (let i = 0; i < 256; i++) {
        dictionary.set(i, [i]);
      }
      prevCode = -1;
      continue;
    }

    let entry: number[];

    if (dictionary.has(code)) {
      entry = dictionary.get(code)!;
    } else if (code === nextCode && prevCode >= 0) {
      entry = [...dictionary.get(prevCode)!, dictionary.get(prevCode)![0]!];
    } else {
      break;
    }

    result.push(...entry);

    if (prevCode >= 0 && nextCode < (1 << codeBits)) {
      const newEntry = [...dictionary.get(prevCode)!, entry[0]!];
      dictionary.set(nextCode, newEntry);
      nextCode++;
    }

    if (nextCode >= (1 << codeBits) && codeBits < 12) {
      codeBits++;
      dictSize = 1 << codeBits;
    }

    prevCode = code;
  }

  return new Uint8Array(result);
}

export function parseTiff(data: BinaryData): EmbeddedTiffAsset {
  const bytes = toUint8Array(data);

  try {
    if (bytes.length < 8) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "TIFF data too short.", {});
    }

    const isLE = bytes[0] === 0x49 && bytes[1] === 0x49;
    const isBE = bytes[0] === 0x4d && bytes[1] === 0x4d;
    if (!isLE && !isBE) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Invalid TIFF byte order.", {
        byteOrder: [bytes[0], bytes[1]]
      });
    }

    const read32 = isLE ? readUint32LE : readUint32BE;
    const read16 = isLE ? readUint16LE : readUint16BE;

    const magic = read16(bytes, 2);
    if (magic !== 42) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Invalid TIFF magic number.", { magic });
    }

    let ifdOffset = read32(bytes, 4);
    const ifd = parseIfd(bytes, ifdOffset, isLE);

    const widthTag = ifd.get(256);
    const heightTag = ifd.get(257);
    const bitsPerSampleTag = ifd.get(258);
    const compressionTag = ifd.get(259);
    const photoTag = ifd.get(262);
    const stripOffsetsTag = ifd.get(273);
    const rowsPerStripTag = ifd.get(278);
    const stripByteCountsTag = ifd.get(279);
    const samplesPerPixelTag = ifd.get(277);

    if (!widthTag || !heightTag || !bitsPerSampleTag || !photoTag) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "TIFF missing required tags.", {});
    }

    const width = getTagValue(widthTag, bytes, isLE);
    const height = getTagValue(heightTag, bytes, isLE);
    const bitsPerSample = getTagValue(bitsPerSampleTag, bytes, isLE);
    const compression = compressionTag ? getTagValue(compressionTag, bytes, isLE) : 1;
    const photometric = getTagValue(photoTag, bytes, isLE);
    const samplesPerPixel = samplesPerPixelTag ? getTagValue(samplesPerPixelTag, bytes, isLE) : 1;

    if (width <= 0 || height <= 0) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "TIFF has invalid dimensions.", { width, height });
    }

    if (compression !== 1 && compression !== 5) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Only uncompressed and LZW-compressed TIFF images are supported.", { compression });
    }

    let colorSpace: "DeviceGray" | "DeviceRGB" | "DeviceCMYK";
    let channels: 1 | 3 | 4;

    if (photometric === 0 || photometric === 1) {
      colorSpace = "DeviceGray";
      channels = 1;
    } else if (photometric === 2) {
      colorSpace = "DeviceRGB";
      channels = 3;
    } else if (photometric === 5) {
      colorSpace = "DeviceCMYK";
      channels = 4;
    } else {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_COLOR_SPACE, "Unsupported TIFF photometric interpretation.", { photometric });
    }

    if (bitsPerSample !== 8) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_BIT_DEPTH, "Only 8-bit TIFF images are supported.", { bitsPerSample });
    }

    const stripOffsets = stripOffsetsTag ? getTagValueArray(stripOffsetsTag, bytes, isLE) : [0];
    const stripByteCounts = stripByteCountsTag ? getTagValueArray(stripByteCountsTag, bytes, isLE) : [bytes.length - 8];
    const rowsPerStrip = rowsPerStripTag ? getTagValue(rowsPerStripTag, bytes, isLE) : height;

    const output = new Uint8Array(width * height * channels);

    let outIdx = 0;
    let currentRow = 0;

    for (let si = 0; si < stripOffsets.length && currentRow < height; si++) {
      const stripOffset = stripOffsets[si]!;
      const stripByteCount = stripByteCounts[si] ?? 0;
      const rowsInThisStrip = Math.min(rowsPerStrip, height - currentRow);

      let stripData = bytes.subarray(stripOffset, stripOffset + stripByteCount);

      if (compression === 5) {
        stripData = decompressLZW(stripData);
      }

      const rowBytes = width * channels;
      for (let r = 0; r < rowsInThisStrip && currentRow < height; r++) {
        const srcOffset = r * rowBytes;
        if (srcOffset + rowBytes <= stripData.length) {
          output.set(stripData.subarray(srcOffset, srcOffset + rowBytes), outIdx);
        }
        outIdx += rowBytes;
        currentRow++;
      }
    }

    const key = `tiff:${width}x${height}:${channels}:${bytes.length}:${hashBytes(bytes)}`;

    return {
      kind: "tiff",
      key,
      bytes: output,
      pixelWidth: width,
      pixelHeight: height,
      bitsPerComponent: 8,
      colorSpace,
      channels,
      decodeMode: "rawSamples",
    };
  } catch (error) {
    if (error instanceof PdfEngineError) throw error;
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Failed to parse TIFF image data.", { cause: error });
  }
}

function hashBytes(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
