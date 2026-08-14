import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";

export interface EmbeddedJp2Asset {
  readonly kind: "jp2";
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bitsPerComponent: number;
  readonly colorSpace: "DeviceGray" | "DeviceRGB" | "DeviceCMYK";
  readonly channels: 1 | 3 | 4;
  readonly iccProfile?: { readonly bytes: Uint8Array; readonly channels: number } | undefined;
}

const JP2_SIGNATURE = new Uint8Array([
  0x00, 0x00, 0x00, 0x0c,
  0x6a, 0x50, 0x20, 0x20,
  0x0d, 0x0a, 0x87, 0x0a,
]);

function toUint8Array(data: BinaryData): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  ) >>> 0;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[offset + i];
    if (byte === 0) break;
    if (byte === undefined) break;
    result += String.fromCodePoint(byte);
  }
  return result;
}

function checkSignature(bytes: Uint8Array): boolean {
  if (bytes.length < JP2_SIGNATURE.length) return false;
  for (let i = 0; i < JP2_SIGNATURE.length; i++) {
    if (bytes[i] !== JP2_SIGNATURE[i]) return false;
  }
  return true;
}

interface Jp2Header {
  width: number;
  height: number;
  componentCount: number;
  bitsPerComponent: number;
  compressionType: number;
}

function parseJp2Boxes(bytes: Uint8Array): {
  header: Jp2Header;
  rawData: Uint8Array;
} {
  let offset = JP2_SIGNATURE.length;
  let header: Jp2Header | null = null;

  while (offset + 8 <= bytes.length) {
    const boxLength = readUint32BE(bytes, offset);
    const boxType = readAscii(bytes, offset + 4, 4);

    if (boxLength < 8 || offset + boxLength > bytes.length) {
      break;
    }

    if (boxType === "jp2h") {
      header = parseJp2hBox(bytes, offset + 8, boxLength - 8);
    }

    if (boxLength === 0) break;
    offset += boxLength;
  }

  if (!header) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "JP2 Header box (jp2h) not found.");
  }

  return { header, rawData: bytes };
}

function parseJp2hBox(bytes: Uint8Array, offset: number, length: number): Jp2Header {
  let pos = offset;
  const end = offset + length;

  let ihdrHeader: Jp2Header | null = null;

  while (pos + 8 <= end) {
    const boxLength = readUint32BE(bytes, pos);
    const boxType = readAscii(bytes, pos + 4, 4);

    if (boxLength < 8 || pos + boxLength > end) break;

    if (boxType === "ihdr") {
      const height = readUint32BE(bytes, pos + 8);
      const width = readUint32BE(bytes, pos + 12);
      const componentCount = readUint16BE(bytes, pos + 16);
      const bitsPerComponent = bytes[pos + 18] !== undefined ? (bytes[pos + 18]! + 1) : 8;
      const compressionType = bytes[pos + 19] !== undefined ? bytes[pos + 19]! : 7;

      if (width === 0 || height === 0) {
        throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "JP2 image has zero dimensions.");
      }

      if (componentCount !== 1 && componentCount !== 3 && componentCount !== 4) {
        throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_COLOR_SPACE, "JP2 supports 1, 3, or 4 components.", { componentCount });
      }

      if (compressionType !== 7) {
        throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Only wavelet compression (type 7) is supported for JP2.", { compressionType });
      }

      ihdrHeader = { width, height, componentCount, bitsPerComponent, compressionType };
    }

    if (boxLength === 0) break;
    pos += boxLength;
  }

  if (!ihdrHeader) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "JP2 Image Header box (ihdr) not found.");
  }

  return ihdrHeader;
}

export function parseJp2(data: BinaryData): EmbeddedJp2Asset {
  const bytes = toUint8Array(data);

  try {
    if (!checkSignature(bytes)) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Invalid JP2 signature.", {
        signature: Array.from(bytes.slice(0, 12))
      });
    }

    const { header, rawData } = parseJp2Boxes(bytes);

    let colorSpace: "DeviceGray" | "DeviceCMYK" | "DeviceRGB" = "DeviceRGB";
    if (header.componentCount === 1) {
      colorSpace = "DeviceGray";
    } else if (header.componentCount === 4) {
      colorSpace = "DeviceCMYK";
    }

    const channels = header.componentCount as 1 | 3 | 4;

    const key = `jp2:${header.width}x${header.height}:${channels}:${rawData.length}:${hashBytes(rawData)}`;

    return {
      kind: "jp2",
      key,
      bytes: rawData,
      pixelWidth: header.width,
      pixelHeight: header.height,
      bitsPerComponent: header.bitsPerComponent,
      colorSpace,
      channels,
    };
  } catch (error) {
    if (error instanceof PdfEngineError) throw error;
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Failed to parse JPEG 2000 image data.", { cause: error });
  }
}

function hashBytes(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const byte of data) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
