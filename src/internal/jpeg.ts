import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";

/** Supported EXIF orientation values (0/180 degree flips and 90 degree rotations). */
type ExifOrientation = 1 | 3 | 6 | 8;

export interface EmbeddedJpegAsset {
  readonly kind: "jpeg";
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bitsPerComponent: number;
  readonly colorSpace: "DeviceGray" | "DeviceRGB" | "DeviceCMYK";
  readonly iccProfile?: { readonly bytes: Uint8Array; readonly channels: number } | undefined;
  readonly orientation: ExifOrientation;
}

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function parseJpeg(data: BinaryData): EmbeddedJpegAsset {
  const bytes = cloneBinaryData(data);

  try {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Only JPEG image data is supported.", {
        signature: Array.from(bytes.slice(0, 4))
      });
    }

    let offset = 2;
    let orientation: ExifOrientation = 1;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Invalid JPEG marker alignment.", { offset });
      }

      while (bytes[offset] === 0xff) {
        offset += 1;
      }

      const marker = bytes[offset];
      if (marker === undefined) {
        break;
      }
      offset += 1;

      if (marker === 0xd9) {
        break;
      }

      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }

      const segmentLength = readUint16(bytes, offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) {
        throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Invalid JPEG segment length.", { marker, offset, segmentLength });
      }

      if (marker === 0xe1 && segmentLength > 10) {
        const parsed = parseExifOrientation(bytes, offset, segmentLength);
        if (parsed !== undefined) {
          orientation = parsed;
        }
      }

      if (SOF_MARKERS.has(marker)) {
        const bitsPerComponent = bytes[offset + 2];
        const pixelHeight = readUint16(bytes, offset + 3);
        const pixelWidth = readUint16(bytes, offset + 5);
        const componentCount = bytes[offset + 7];

        if (bitsPerComponent === undefined || componentCount === undefined) {
          throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "JPEG frame header is truncated.");
        }

        if (componentCount !== 1 && componentCount !== 3 && componentCount !== 4) {
          throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_COLOR_SPACE, "Only grayscale, RGB, and CMYK JPEG images are supported.", {
            componentCount
          });
        }

        const colorSpace = componentCount === 1
          ? "DeviceGray" as const
          : componentCount === 4
            ? "DeviceCMYK" as const
            : "DeviceRGB" as const;

        return {
          kind: "jpeg",
          key: buildJpegKey(bytes, pixelWidth, pixelHeight, componentCount),
          bytes,
          pixelWidth,
          pixelHeight,
          bitsPerComponent,
          colorSpace,
          orientation
        };
      }

      offset += segmentLength;
    }

    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "JPEG frame header not found.");
  } catch (error) {
    if (error instanceof PdfEngineError) {
      throw error;
    }
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Failed to parse JPEG image data.", { cause: error });
  }
}

function cloneBinaryData(data: BinaryData): Uint8Array {
  if (data instanceof Uint8Array) {
    return data.slice();
  }

  return new Uint8Array(data.slice(0));
}

function readUint16(bytes: Uint8Array, offset: number): number {
  const high = bytes[offset];
  const low = bytes[offset + 1];
  if (high === undefined || low === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of JPEG data.", { offset });
  }

  return (high << 8) | low;
}

function buildJpegKey(bytes: Uint8Array, pixelWidth: number, pixelHeight: number, componentCount: number): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return `jpeg:${pixelWidth}x${pixelHeight}:${componentCount}:${bytes.length}:${(hash >>> 0).toString(16)}`;
}

function parseExifOrientation(bytes: Uint8Array, app1Offset: number, segmentLength: number): ExifOrientation | undefined {
  const dataOffset = app1Offset + 2;
  if (
    bytes[dataOffset] !== 0x45 ||
    bytes[dataOffset + 1] !== 0x78 ||
    bytes[dataOffset + 2] !== 0x69 ||
    bytes[dataOffset + 3] !== 0x66 ||
    bytes[dataOffset + 4] !== 0x00 ||
    bytes[dataOffset + 5] !== 0x00
  ) {
    return undefined;
  }

  const tiffOffset = dataOffset + 6;
  const tiffEnd = app1Offset + segmentLength;
  if (tiffOffset + 8 > tiffEnd) {
    return undefined;
  }

  const isBE = bytes[tiffOffset] === 0x4d && bytes[tiffOffset + 1] === 0x4d;
  const isLE = bytes[tiffOffset] === 0x49 && bytes[tiffOffset + 1] === 0x49;
  if (!isBE && !isLE) {
    return undefined;
  }

  const read16 = isBE
    ? (offset: number) => (bytes[tiffOffset + offset]! << 8) | bytes[tiffOffset + offset + 1]!
    : (offset: number) => bytes[tiffOffset + offset]! | (bytes[tiffOffset + offset + 1]! << 8);

  const ifdOffset = isBE
    ? (bytes[tiffOffset + 4]! << 24) | (bytes[tiffOffset + 5]! << 16) | (bytes[tiffOffset + 6]! << 8) | bytes[tiffOffset + 7]!
    : bytes[tiffOffset + 4]! | (bytes[tiffOffset + 5]! << 8) | (bytes[tiffOffset + 6]! << 16) | (bytes[tiffOffset + 7]! << 24);

  if (read16(2) !== 0x002a) {
    return undefined;
  }

  let cursor = ifdOffset;
  if (cursor <= 0 || cursor > tiffEnd - tiffOffset - 2) {
    return undefined;
  }

  const entryCount = read16(cursor);
  const entriesEnd = cursor + 2 + entryCount * 12;

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = cursor + 2 + i * 12;
    if (entryOffset + 12 > tiffEnd - tiffOffset) {
      break;
    }

    const tag = read16(entryOffset);
    if (tag === 0x0112) {
      const type = read16(entryOffset + 2);
      if (type === 3) {
        const value = read16(entryOffset + 8);
        if (value === 1 || value === 3 || value === 6 || value === 8) {
          return value as ExifOrientation;
        }
      }
    }
  }

  return undefined;
}
