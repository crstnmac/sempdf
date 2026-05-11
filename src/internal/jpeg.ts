import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";

export interface EmbeddedJpegAsset {
  readonly kind: "jpeg";
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bitsPerComponent: number;
  readonly colorSpace: "DeviceGray" | "DeviceRGB";
  readonly iccProfile?: { readonly bytes: Uint8Array; readonly channels: number } | undefined;
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

      if (SOF_MARKERS.has(marker)) {
        const bitsPerComponent = bytes[offset + 2];
        const pixelHeight = readUint16(bytes, offset + 3);
        const pixelWidth = readUint16(bytes, offset + 5);
        const componentCount = bytes[offset + 7];

        if (bitsPerComponent === undefined || componentCount === undefined) {
          throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "JPEG frame header is truncated.");
        }

        if (componentCount !== 1 && componentCount !== 3) {
          throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_COLOR_SPACE, "Only grayscale and RGB JPEG images are supported.", {
            componentCount
          });
        }

        return {
          kind: "jpeg",
          key: buildJpegKey(bytes, pixelWidth, pixelHeight, componentCount),
          bytes,
          pixelWidth,
          pixelHeight,
          bitsPerComponent,
          colorSpace: componentCount === 1 ? "DeviceGray" : "DeviceRGB"
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
