import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";
import { toBytes } from "./document-helpers.js";

export interface EmbeddedBmpAsset {
  readonly kind: "bmp";
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bitsPerComponent: number;
  readonly colorSpace: "DeviceRGB";
  readonly channels: 3;
  readonly decodeMode: "rawSamples";
  readonly alphaBytes?: Uint8Array | undefined;
  readonly iccProfile?: { readonly bytes: Uint8Array; readonly channels: number } | undefined;
}

const BMP_SIGNATURE = 0x4d42;

export function parseBmp(data: BinaryData): {
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  kind: "bmp";
  rgba: Uint8Array;
  hasAlpha: boolean;
} {
  const bytes = toBytes(data);

  try {
    if (bytes.length < 14) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Only BMP image data is supported.", {
        reason: "File too small for BMP header"
      });
    }

    const signature = readUint16LE(bytes, 0);
    if (signature !== BMP_SIGNATURE) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Only BMP image data is supported.", {
        signature: Array.from(bytes.slice(0, 2))
      });
    }

    const dataOffset = readUint32LE(bytes, 10);

    if (bytes.length < 14 + 40) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "BMP DIB header is truncated.");
    }

    const dibHeaderSize = readUint32LE(bytes, 14);
    if (dibHeaderSize < 40) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Unsupported BMP DIB header version.", {
        dibHeaderSize
      });
    }

    const width = readInt32LE(bytes, 18);
    const height = readInt32LE(bytes, 22);
    const planes = readUint16LE(bytes, 26);
    const bitDepth = readUint16LE(bytes, 28);
    const compression = readUint32LE(bytes, 30);

    if (planes !== 1) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "BMP planes must be 1.", { planes });
    }

    if (compression !== 0) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Compressed BMP images are not supported.", {
        compression
      });
    }

    if (bitDepth !== 24 && bitDepth !== 32) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_BIT_DEPTH, "Only 24-bit and 32-bit BMP images are supported.", {
        bitDepth
      });
    }

    if (width <= 0 || height === 0) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "BMP image dimensions must be positive.", {
        width,
        height
      });
    }

    const pixelWidth = width;
    const pixelHeight = Math.abs(height);
    const bottomUp = height > 0;
    const bytesPerPixel = bitDepth / 8;
    const rowSize = Math.floor((bitDepth * width + 31) / 32) * 4;
    const expectedPixelDataSize = rowSize * pixelHeight;

    if (dataOffset + expectedPixelDataSize > bytes.length) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "BMP pixel data extends beyond the end of the file.", {
        dataOffset,
        expectedPixelDataSize,
        fileSize: bytes.length
      });
    }

    const rgba = new Uint8Array(pixelWidth * pixelHeight * 4);
    const hasAlpha = bitDepth === 32;

    for (let row = 0; row < pixelHeight; row += 1) {
      const sourceRow = bottomUp ? (pixelHeight - 1 - row) : row;
      const sourceOffset = dataOffset + sourceRow * rowSize;

      for (let col = 0; col < pixelWidth; col += 1) {
        const pixelSrcOffset = sourceOffset + col * bytesPerPixel;
        const blue = bytes[pixelSrcOffset];
        const green = bytes[pixelSrcOffset + 1];
        const red = bytes[pixelSrcOffset + 2];
        const alpha = hasAlpha ? bytes[pixelSrcOffset + 3] : 0xff;

        if (blue === undefined || green === undefined || red === undefined) {
          throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of BMP pixel data.", {
            row,
            col
          });
        }

        if (hasAlpha && alpha === undefined) {
          throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of BMP alpha data.", {
            row,
            col
          });
        }

        const dstOffset = (row * pixelWidth + col) * 4;
        rgba[dstOffset] = red!;
        rgba[dstOffset + 1] = green!;
        rgba[dstOffset + 2] = blue!;
        rgba[dstOffset + 3] = byteOrUndefined(alpha, 0xff) ?? 0xff;
      }
    }

    return {
      width: pixelWidth,
      height: pixelHeight,
      pixelWidth,
      pixelHeight,
      kind: "bmp",
      rgba,
      hasAlpha
    };
  } catch (error) {
    if (error instanceof PdfEngineError) {
      throw error;
    }
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Failed to parse BMP image data.", { cause: error });
  }
}

function byteOrUndefined(value: number | undefined, fallback: number): number | undefined {
  return value === undefined ? undefined : value;
}

export function buildEmbeddedBmpAsset(
  result: ReturnType<typeof parseBmp>,
  iccProfile?: BinaryData
): EmbeddedBmpAsset {
  const pixelCount = result.pixelWidth * result.pixelHeight;
  const hasAlpha = result.hasAlpha;
  const rgba = result.rgba;

  const colorBytes = new Uint8Array(pixelCount * 3);
  const alphaBytes = hasAlpha ? new Uint8Array(pixelCount) : undefined;

  for (let i = 0; i < pixelCount; i += 1) {
    const srcOffset = i * 4;
    const dstColorOffset = i * 3;
    colorBytes[dstColorOffset] = rgba[srcOffset]!;
    colorBytes[dstColorOffset + 1] = rgba[srcOffset + 1]!;
    colorBytes[dstColorOffset + 2] = rgba[srcOffset + 2]!;
    if (alphaBytes) {
      alphaBytes[i] = rgba[srcOffset + 3]!;
    }
  }

  const profileBytes = iccProfile !== undefined
    ? (iccProfile instanceof Uint8Array ? new Uint8Array(iccProfile) : new Uint8Array(iccProfile))
    : undefined;

  return {
    kind: "bmp",
    key: buildBmpKey(result.pixelWidth, result.pixelHeight, colorBytes, alphaBytes, profileBytes),
    bytes: colorBytes,
    pixelWidth: result.pixelWidth,
    pixelHeight: result.pixelHeight,
    bitsPerComponent: 8,
    colorSpace: "DeviceRGB",
    channels: 3,
    decodeMode: "rawSamples",
    alphaBytes,
    ...(profileBytes !== undefined ? { iccProfile: { bytes: profileBytes, channels: 3 } } : {})
  };
}

function buildBmpKey(
  pixelWidth: number,
  pixelHeight: number,
  colorBytes: Uint8Array,
  alphaBytes: Uint8Array | undefined,
  iccProfile: Uint8Array | undefined
): string {
  let hash = 0x811c9dc5;
  for (const byte of colorBytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  if (alphaBytes) {
    for (const byte of alphaBytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  const alphaPart = alphaBytes ? "-a" : "";
  const iccPart = iccProfile !== undefined ? `-icc:${iccProfile.length}` : "";
  return `bmp:${pixelWidth}x${pixelHeight}${alphaPart}:${colorBytes.length}:${(hash >>> 0).toString(16)}${iccPart}`;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  const low = bytes[offset];
  const high = bytes[offset + 1];
  if (low === undefined || high === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of BMP data.", { offset });
  }
  return low | (high << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  const b1 = bytes[offset];
  const b2 = bytes[offset + 1];
  const b3 = bytes[offset + 2];
  const b4 = bytes[offset + 3];
  if (b1 === undefined || b2 === undefined || b3 === undefined || b4 === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of BMP data.", { offset });
  }
  return ((b4 << 24) | (b3 << 16) | (b2 << 8) | b1) >>> 0;
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  const unsigned = readUint32LE(bytes, offset);
  return unsigned | 0;
}
