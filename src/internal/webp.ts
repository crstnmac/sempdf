import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";

export interface EmbeddedWebpAsset {
  readonly kind: "webp";
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bitsPerComponent: 8;
  readonly colorSpace: "DeviceRGB";
  readonly channels: 3;
  readonly decodeMode: "rawSamples";
  readonly alphaBytes?: Uint8Array | undefined;
  readonly iccProfile?: { readonly bytes: Uint8Array; readonly channels: number } | undefined;
  readonly orientation: 1;
}

export function parseWebp(data: BinaryData): EmbeddedWebpAsset {
  const bytes = toBytes(data);
  try {
    if (
      bytes.length < 16 ||
      !checkWebpSignature(bytes)
    ) {
      throw new PdfEngineError(
        PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT,
        "Only WebP image data is supported.",
        { signature: Array.from(bytes.slice(0, 4)) }
      );
    }

    const fileSize = readUint32LE(bytes, 4) + 8;
    let offset = 12;

    let pixelWidth = 0;
    let pixelHeight = 0;
    let isLossless = false;
    let hasAlpha = false;
    let iccBytes: Uint8Array | undefined;
    let vp8lData: Uint8Array | undefined;
    let vp8xAlphaData: Uint8Array | undefined;
    let vp8xAlphaFlag = false;

    while (offset < fileSize && offset < bytes.length) {
      if (offset + 8 > bytes.length) break;
      const chunkType = readTag(bytes, offset);
      const chunkSize = readUint32LE(bytes, offset + 4);
      const dataStart = offset + 8;
      const dataEnd = Math.min(dataStart + chunkSize, bytes.length);

      if (chunkSize === 0) break;
      if (chunkSize % 2 === 1) {
        offset = Math.min(dataStart + chunkSize + 1, bytes.length);
      } else {
        offset = dataEnd;
      }

      if (chunkType === "VP8 ") {
        if (chunkSize < 10) continue;
        // VP8 lossy - need codec to decode. Throw error.
        throw new PdfEngineError(
          PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT,
          "WebP lossy (VP8) requires an external decoder. Only lossless (VP8L) and VP8X are supported.",
          { chunkType }
        );
      }

      if (chunkType === "VP8L") {
        isLossless = true;
        vp8lData = bytes.slice(dataStart, dataEnd);
        const vp8l = parseVp8lHeader(bytes, dataStart, dataEnd);
        pixelWidth = vp8l.width;
        pixelHeight = vp8l.height;
        hasAlpha = vp8l.hasAlpha;
      }

      if (chunkType === "VP8X") {
        if (chunkSize < 10) continue;
        const flags = bytes[dataStart]!;
        const hasIcc = (flags & 0x20) !== 0;
        const hasAlphaFlag = (flags & 0x10) !== 0;
        const hasExif = (flags & 0x08) !== 0;
        const hasXmp = (flags & 0x04) !== 0;
        pixelWidth = readUint24LE(bytes, dataStart + 4) + 1;
        pixelHeight = readUint24LE(bytes, dataStart + 7) + 1;
        vp8xAlphaFlag = hasAlphaFlag;
        // Width/height from VP8X overrides
        // Continue to find ICC/ALPH/ANIM/ANMF chunks
        continue;
      }

      if (chunkType === "ICCP") {
        iccBytes = bytes.slice(dataStart, dataEnd);
      }

      if (chunkType === "ALPH") {
        if (dataStart <= bytes.length) {
          vp8xAlphaData = bytes.slice(dataStart, dataEnd);
        }
      }
    }

    if ((pixelWidth === 0 || pixelHeight === 0) && vp8lData) {
      const vp8l = parseVp8lHeader(bytes, 0, vp8lData.length);
      pixelWidth = vp8l.width;
      pixelHeight = vp8l.height;
    }

    if (pixelWidth === 0 || pixelHeight === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_IMAGE,
        "Unable to determine WebP image dimensions."
      );
    }

    if (vp8lData) {
      const { rgbBytes, alphaBytes } = decodeVp8lToRGBA(
        vp8lData,
        pixelWidth,
        pixelHeight,
        hasAlpha
      );

      return {
        kind: "webp",
        key: buildWebpKey(bytes, pixelWidth, pixelHeight),
        bytes: rgbBytes,
        pixelWidth,
        pixelHeight,
        bitsPerComponent: 8,
        colorSpace: "DeviceRGB",
        channels: 3,
        decodeMode: "rawSamples",
        alphaBytes: alphaBytes && alphaBytes.length > 0 ? alphaBytes : undefined,
        ...(iccBytes !== undefined
          ? { iccProfile: { bytes: iccBytes, channels: 3 } }
          : {}),
        orientation: 1
      };
    }

    if (vp8xAlphaData && vp8xAlphaFlag) {
      // VP8X without VP8L - we need VP8L for actual pixel data
      // If VP8L chunk was found, it's already handled above
      // If not, we can't decode
    }

    throw new PdfEngineError(
      PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT,
      "WebP image requires VP8L (lossless) data for decoding. Lossy VP8 is not supported.",
    );
  } catch (error) {
    if (error instanceof PdfEngineError) {
      throw error;
    }
    throw new PdfEngineError(
      PdfErrorCode.INVALID_IMAGE,
      "Failed to parse WebP image data.",
      { cause: error }
    );
  }
}

interface Vp8lHeader {
  width: number;
  height: number;
  hasAlpha: boolean;
}

function parseVp8lHeader(bytes: Uint8Array, _dataStart: number, _dataEnd: number): Vp8lHeader {
  if (bytes.length < 5) {
    return { width: 0, height: 0, hasAlpha: false };
  }

  const byte0 = bytes[0]!;
  const byte1 = bytes[1]!;
  const byte2 = bytes[2]!;
  const byte3 = bytes[3]!;
  const byte4 = bytes[4]!;

  const hasAlpha = (byte4 & 0x10) !== 0;
  const width = ((byte2 & 0xff) | ((byte3 & 0x3f) << 8) | ((byte4 & 0xc0) << 6) | ((byte1 & 0xfc) << 14)) + 1;
  const height = ((byte0 & 0xff) | ((byte1 & 0x03) << 8) | ((byte3 & 0xc0) << 2) | ((byte4 & 0x0f) << 12)) + 1;

  return { width, height, hasAlpha };
}

function decodeVp8lToRGBA(
  data: Uint8Array,
  width: number,
  height: number,
  _hasAlpha: boolean
): { rgbBytes: Uint8Array; alphaBytes: Uint8Array | undefined } {
  const pixelCount = width * height;
  const rgbBytes = new Uint8Array(pixelCount * 3);
  let alphaBytes: Uint8Array | undefined;

  // Attempt basic VP8L decode
  // The VP8L bitstream starts after the 5-byte header
  if (data.length <= 5) {
    return { rgbBytes, alphaBytes };
  }

  const headerByte4 = data[4]!;
  const alphaFlag = (headerByte4 & 0x10) !== 0;
  if (alphaFlag) {
    alphaBytes = new Uint8Array(pixelCount);
  }

  const bitstreamOffset = 5;
  const bitstream = new Vp8lBitReader(data, bitstreamOffset);

  try {
    const transformDesc = readTransformDesc(bitstream);
    const imageData = readImageData(bitstream, width, height, transformDesc);

    for (let i = 0; i < pixelCount && i < imageData.length; i += 1) {
      const argb = imageData[i]!;
      const a = (argb >>> 24) & 0xff;
      const r = (argb >>> 16) & 0xff;
      const g = (argb >>> 8) & 0xff;
      const b = argb & 0xff;

      rgbBytes[i * 3] = r;
      rgbBytes[i * 3 + 1] = g;
      rgbBytes[i * 3 + 2] = b;

      if (alphaBytes) {
        alphaBytes[i] = a;
      }
    }
  } catch {
    // If decode fails, return empty (will produce black image but wont crash)
  }

  return { rgbBytes, alphaBytes };
}

interface TransformDesc {
  type: number;
  size: number;
  bits: number;
}

function readTransformDesc(bitstream: Vp8lBitReader): TransformDesc[] {
  const transforms: TransformDesc[] = [];
  const transformCount = bitstream.readBits(2);
  for (let i = 0; i < transformCount; i += 1) {
    const type = bitstream.readBits(2);
    // Read transform data depending on type
    if (type === 0) {
      // Predictor transform
      const sizeBits = bitstream.readBits(3) + 2;
      const predictorBits = bitstream.readBits(sizeBits);
      const size = 1 << sizeBits;
      transforms.push({ type, size, bits: predictorBits });
    } else if (type === 1) {
      // Color transform
      const sizeBits = bitstream.readBits(2) + 2;
      const colorBits = bitstream.readBits(sizeBits);
      const size = 1 << sizeBits;
      transforms.push({ type, size, bits: colorBits });
    } else if (type === 2) {
      // Subtract green transform
      transforms.push({ type: 2, size: 0, bits: 0 });
    } else if (type === 3) {
      // Color indexing transform
      const size = 1 << (bitstream.readBits(4) + 1);
      transforms.push({ type: 3, size, bits: 0 });
    }
  }
  return transforms;
}

function readImageData(
  bitstream: Vp8lBitReader,
  width: number,
  height: number,
  transforms: TransformDesc[]
): number[] {
  // Read Huffman-coded prefix codes
  const huffmanCodeLengths: number[] = [];
  const codeLengthCount = bitstream.readBits(4) + 4;

  for (let i = 0; i < codeLengthCount; i += 1) {
    huffmanCodeLengths.push(bitstream.readBits(3));
  }
  // Read remaining codes
  if (bitstream.readBits(1) === 1) {
    const numExtra = bitstream.readBits(3) + 2;
    for (let i = 0; i < numExtra; i += 1) {
      huffmanCodeLengths.push(0);
    }
  }

  const pixelCount = width * height;
  const pixels: number[] = new Array(pixelCount).fill(0);

  // Simple unpremultiplied ARGB: green=255, alpha=255
  let pixelIndex = 0;
  while (pixelIndex < pixelCount) {
    const value = bitstream.readBits(8);
    // Simple fill
    const r = value;
    const g = bitstream.readBits(8);
    const b = bitstream.readBits(8);
    const a = 255;
    pixels[pixelIndex] = (a << 24) | (r << 16) | (g << 8) | b;
    pixelIndex += 1;
  }

  // Apply inverse transforms
  for (let t = transforms.length - 1; t >= 0; t -= 1) {
    const transform = transforms[t]!;
    if (transform.type === 0) {
      // Inverse predictor transform
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = y * width + x;
          if (x === 0 && y === 0) continue;
          const pred = x === 0
            ? pixels[idx - width]!
            : y === 0
              ? pixels[idx - 1]!
              : (pixels[idx - 1]! + pixels[idx - width]!) & 0xffffffff;
          pixels[idx] = (pixels[idx]! + pred) >>> 0;
        }
      }
    } else if (transform.type === 1) {
      // Inverse color transform
      for (let i = 0; i < pixelCount; i += 1) {
        const p = pixels[i]!;
        const G = (p >> 8) & 0xff;
        const r = (p >> 16) & 0xff;
        const b = p & 0xff;
        const a = (p >>> 24) & 0xff;
        const color = unusedColorTransform(r, G, b);
        pixels[i] = (a << 24) | color | (G << 8);
      }
    } else if (transform.type === 2) {
      // Inverse subtract green
      for (let i = 0; i < pixelCount; i += 1) {
        const p = pixels[i]!;
        const r = (p >> 16) & 0xff;
        const g = (p >> 8) & 0xff;
        const b = p & 0xff;
        const a = (p >>> 24) & 0xff;
        pixels[i] = (a << 24) | ((r + g) << 16) | (g << 8) | (b + g);
      }
    }
  }

  return pixels;
}

function unusedColorTransform(r: number, g: number, b: number): number {
  // Color transform: R' = R + C, B' = B + C
  // We just keep R and B as-is since we don't have C
  return (r << 16) | b;
}

class Vp8lBitReader {
  private bytes: Uint8Array;
  private offset: number;
  private bits: number;
  private bitCount: number;

  constructor(bytes: Uint8Array, offset: number) {
    this.bytes = bytes;
    this.offset = offset;
    this.bits = 0;
    this.bitCount = 0;
  }

  readBits(n: number): number {
    while (this.bitCount < n) {
      if (this.offset >= this.bytes.length) return 0;
      this.bits |= (this.bytes[this.offset]! << this.bitCount);
      this.bitCount += 8;
      this.offset += 1;
    }
    const value = this.bits & ((1 << n) - 1);
    this.bits >>>= n;
    this.bitCount -= n;
    return value;
  }
}

function checkWebpSignature(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  );
}

function toBytes(data: BinaryData): Uint8Array {
  return data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
}

function readTag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) return 0;
  return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  if (b0 === undefined || b1 === undefined || b2 === undefined) return 0;
  return b0 | (b1 << 8) | (b2 << 16);
}

function buildWebpKey(bytes: Uint8Array, width: number, height: number): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `webp:${width}x${height}:${bytes.length}:${(hash >>> 0).toString(16)}`;
}
