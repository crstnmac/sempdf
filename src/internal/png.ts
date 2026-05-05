import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";
import { inflateZlib } from "./deflate.js";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface EmbeddedPngAsset {
  readonly kind: "png";
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bitsPerComponent: number;
  readonly colorSpace: "DeviceGray" | "DeviceRGB";
  readonly channels: 1 | 3;
  readonly decodeMode: "pngPredictor" | "rawSamples";
  readonly alphaBytes?: Uint8Array | undefined;
  readonly mask?: readonly number[] | undefined;
}

export function parsePng(data: BinaryData): EmbeddedPngAsset {
  const bytes = cloneBinaryData(data);
  if (!hasPngSignature(bytes)) {
    throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT, "Only PNG image data is supported.", {
      signature: Array.from(bytes.slice(0, 8))
    });
  }

  let offset = PNG_SIGNATURE.length;
  let width: number | undefined;
  let height: number | undefined;
  let bitDepth: number | undefined;
  let channels: 1 | 3 | undefined;
  let colorSpace: "DeviceGray" | "DeviceRGB" | undefined;
  let sampleChannels: 1 | 2 | 3 | 4 | undefined;
  let mask: readonly number[] | undefined;
  let colorType: number | undefined;
  const idatChunks: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readChunkType(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;

    if (crcEnd > bytes.length) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "PNG chunk extends beyond the end of the file.", {
        type,
        offset,
        length
      });
    }

    const chunkBytes = bytes.slice(dataStart, dataEnd);
    if (type === "IHDR") {
      if (length !== 13) {
        throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "PNG IHDR chunk must be 13 bytes long.");
      }

      width = readUint32(chunkBytes, 0);
      height = readUint32(chunkBytes, 4);
      bitDepth = chunkBytes[8];
      colorType = chunkBytes[9];
      const compression = chunkBytes[10];
      const filter = chunkBytes[11];
      const interlace = chunkBytes[12];

      if (bitDepth !== 8) {
        throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_BIT_DEPTH, "Only 8-bit PNG images are supported.", {
          bitDepth
        });
      }

      if (colorType === 0) {
        sampleChannels = 1;
        channels = 1;
        colorSpace = "DeviceGray";
      } else if (colorType === 2) {
        sampleChannels = 3;
        channels = 3;
        colorSpace = "DeviceRGB";
      } else if (colorType === 4) {
        sampleChannels = 2;
        channels = 1;
        colorSpace = "DeviceGray";
      } else if (colorType === 6) {
        sampleChannels = 4;
        channels = 3;
        colorSpace = "DeviceRGB";
      } else {
        throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_COLOR_SPACE, "Only grayscale and RGB PNG images are supported, with optional alpha channels.", {
          colorType
        });
      }

      if (compression !== 0 || filter !== 0) {
        throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unsupported PNG compression or filter method.", {
          compression,
          filter
        });
      }

      if (interlace !== 0) {
        throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_INTERLACE, "Interlaced PNG images are not supported.", {
          interlace
        });
      }
    } else if (type === "IDAT") {
      idatChunks.push(chunkBytes);
    } else if (type === "tRNS") {
      if (bitDepth === undefined || colorType === undefined) {
        throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "PNG tRNS chunk must appear after IHDR.");
      }

      mask = parseTransparencyMask(chunkBytes, colorType, bitDepth);
    } else if (type === "IEND") {
      break;
    }

    offset = crcEnd;
  }

  if (
    width === undefined ||
    height === undefined ||
    bitDepth === undefined ||
    channels === undefined ||
    colorSpace === undefined ||
    sampleChannels === undefined
  ) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "PNG file is missing an IHDR header.");
  }

  if (idatChunks.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "PNG file is missing IDAT data.");
  }

  const imageBytes = concatBytes(idatChunks);
  if (sampleChannels === 2 || sampleChannels === 4) {
    const rawScanlines = inflateZlib(imageBytes);
    const pixels = unfilterPngScanlines(rawScanlines, width, height, sampleChannels);
    const { colorBytes, alphaBytes } = splitAlphaChannel(pixels, width, height, channels, sampleChannels);
    return {
      kind: "png",
      key: buildPngKey(bytes, width, height, sampleChannels),
      bytes: colorBytes,
      pixelWidth: width,
      pixelHeight: height,
      bitsPerComponent: bitDepth,
      colorSpace,
      channels,
      decodeMode: "rawSamples",
      alphaBytes
    };
  }

  return {
    kind: "png",
    key: buildPngKey(bytes, width, height, sampleChannels),
    bytes: imageBytes,
    pixelWidth: width,
    pixelHeight: height,
    bitsPerComponent: bitDepth,
    colorSpace,
    channels,
    decodeMode: "pngPredictor",
    mask
  };
}

function cloneBinaryData(data: BinaryData): Uint8Array {
  if (data instanceof Uint8Array) {
    return data.slice();
  }

  return new Uint8Array(data.slice(0));
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      return false;
    }
  }

  return true;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  const b1 = bytes[offset];
  const b2 = bytes[offset + 1];
  const b3 = bytes[offset + 2];
  const b4 = bytes[offset + 3];
  if (b1 === undefined || b2 === undefined || b3 === undefined || b4 === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of PNG data.", { offset });
  }

  return (b1 * 0x1000000) + ((b2 << 16) | (b3 << 8) | b4);
}

function readChunkType(bytes: Uint8Array, offset: number): string {
  const chars = bytes.slice(offset, offset + 4);
  if (chars.length !== 4) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of PNG chunk type.", { offset });
  }

  return String.fromCharCode(...chars);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function buildPngKey(bytes: Uint8Array, pixelWidth: number, pixelHeight: number, channels: number): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return `png:${pixelWidth}x${pixelHeight}:${channels}:${bytes.length}:${(hash >>> 0).toString(16)}`;
}

function unfilterPngScanlines(data: Uint8Array, width: number, height: number, bytesPerPixel: number): Uint8Array {
  const stride = width * bytesPerPixel;
  const expectedLength = height * (stride + 1);
  if (data.length !== expectedLength) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "PNG scanline length does not match image dimensions.", {
      expectedLength,
      actualLength: data.length
    });
  }

  const output = new Uint8Array(width * height * bytesPerPixel);
  let sourceOffset = 0;
  let destinationOffset = 0;

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filterType = data[sourceOffset];
    sourceOffset += 1;
    const row = output.subarray(destinationOffset, destinationOffset + stride);
    const previousRow = rowIndex === 0 ? undefined : output.subarray(destinationOffset - stride, destinationOffset);

    for (let column = 0; column < stride; column += 1) {
      const raw = data[sourceOffset + column];
      if (raw === undefined) {
        throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of PNG scanline data.", {
          rowIndex,
          column
        });
      }

      const left = column >= bytesPerPixel ? row[column - bytesPerPixel]! : 0;
      const up = previousRow ? previousRow[column]! : 0;
      const upLeft = previousRow && column >= bytesPerPixel ? previousRow[column - bytesPerPixel]! : 0;
      row[column] = applyPngFilter(filterType ?? 0, raw, left, up, upLeft);
    }

    sourceOffset += stride;
    destinationOffset += stride;
  }

  return output;
}

function splitAlphaChannel(
  pixels: Uint8Array,
  width: number,
  height: number,
  colorChannels: 1 | 3,
  sampleChannels: 2 | 4
): { colorBytes: Uint8Array; alphaBytes: Uint8Array } {
  const pixelCount = width * height;
  const colorBytes = new Uint8Array(pixelCount * colorChannels);
  const alphaBytes = new Uint8Array(pixelCount);

  let sourceOffset = 0;
  let colorOffset = 0;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    for (let channel = 0; channel < colorChannels; channel += 1) {
      colorBytes[colorOffset] = pixels[sourceOffset]!;
      colorOffset += 1;
      sourceOffset += 1;
    }

    alphaBytes[pixelIndex] = pixels[sourceOffset]!;
    sourceOffset += 1;
  }

  if (sampleChannels !== colorChannels + 1) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "PNG alpha channel layout is invalid.", {
      sampleChannels,
      colorChannels
    });
  }

  return { colorBytes, alphaBytes };
}

function applyPngFilter(filterType: number, raw: number, left: number, up: number, upLeft: number): number {
  switch (filterType) {
    case 0:
      return raw;
    case 1:
      return (raw + left) & 0xff;
    case 2:
      return (raw + up) & 0xff;
    case 3:
      return (raw + Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (raw + paethPredictor(left, up, upLeft)) & 0xff;
    default:
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unsupported PNG filter type.", {
        filterType
      });
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }

  if (upDistance <= upLeftDistance) {
    return up;
  }

  return upLeft;
}

function parseTransparencyMask(chunkBytes: Uint8Array, colorType: number, bitDepth: number): readonly number[] {
  if (bitDepth !== 8) {
    throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_BIT_DEPTH, "PNG transparency masks currently require 8-bit channels.", {
      bitDepth
    });
  }

  if (colorType === 0) {
    if (chunkBytes.length !== 2) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Invalid grayscale tRNS chunk length.");
    }
    const value = readUint16(chunkBytes, 0) & 0xff;
    return [value, value];
  }

  if (colorType === 2) {
    if (chunkBytes.length !== 6) {
      throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Invalid RGB tRNS chunk length.");
    }

    const red = readUint16(chunkBytes, 0) & 0xff;
    const green = readUint16(chunkBytes, 2) & 0xff;
    const blue = readUint16(chunkBytes, 4) & 0xff;
    return [red, red, green, green, blue, blue];
  }

  throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_IMAGE_COLOR_SPACE, "PNG transparency masks are only supported for grayscale and RGB PNGs without alpha channels.", {
    colorType
  });
}

function readUint16(bytes: Uint8Array, offset: number): number {
  const b1 = bytes[offset];
  const b2 = bytes[offset + 1];
  if (b1 === undefined || b2 === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Unexpected end of PNG transparency data.", { offset });
  }

  return (b1 << 8) | b2;
}
