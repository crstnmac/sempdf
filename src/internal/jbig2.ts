import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";
import { toBytes } from "./document-helpers.js";

export interface EmbeddedJbig2Asset {
  readonly kind: "jbig2";
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bitsPerComponent: 1;
  readonly colorSpace: "DeviceGray";
  readonly iccProfile?: undefined;
}

interface Jbig2FileHeader {
  readonly numberOfPages: number;
}

interface Jbig2SegmentHeader {
  readonly segmentNumber: number;
  readonly segmentType: number;
  readonly referredToSegments: readonly number[];
  readonly pageAssociation: number;
  readonly dataLength: number;
}

interface Jbig2RegionSegmentInfo {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

export function parseJbig2(data: BinaryData): EmbeddedJbig2Asset {
  const bytes = toBytes(data);
  try {
    if (bytes.length < 9) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_IMAGE,
        "JBIG2 data is too short to contain a file header.",
      );
    }

    const fileHeader = parseFileHeader(bytes);

    if (fileHeader.numberOfPages === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_IMAGE,
        "JBIG2 file contains no pages.",
      );
    }

    let offset = 9;
    let extractedWidth = 100;
    let extractedHeight = 100;

    while (offset < bytes.length) {
      const segment = parseSegmentHeader(bytes, offset);
      if (segment.dataLength === 0 || segment.dataLength === 0xffffffff) {
        break;
      }

      const segmentDataStart = offset + 11 + segment.referredToSegments.length;
      const segmentData = bytes.slice(
        segmentDataStart,
        segmentDataStart + segment.dataLength,
      );

      if (segment.segmentType === 36) {
        const info = parseGenericRegionSegment(segmentData);
        if (info) {
          extractedWidth = info.width;
          extractedHeight = info.height;
        }
      } else if (segment.segmentType === 0 && segmentData.length >= 4) {
        const info = parseSymbolDictionarySegment(segmentData);
        if (info) {
          extractedWidth = Math.max(extractedWidth, info.width);
          extractedHeight = Math.max(extractedHeight, info.height);
        }
      }

      offset = segmentDataStart + segment.dataLength;
    }

    if (extractedWidth === 100 && extractedHeight === 100) {
      const pageSegment = findPageInformationSegment(bytes);
      if (pageSegment) {
        extractedWidth = pageSegment.width;
        extractedHeight = pageSegment.height;
      }
    }

    return {
      kind: "jbig2",
      key: buildJbig2Key(bytes, extractedWidth, extractedHeight),
      bytes,
      pixelWidth: extractedWidth,
      pixelHeight: extractedHeight,
      bitsPerComponent: 1,
      colorSpace: "DeviceGray",
    };
  } catch (error) {
    if (error instanceof PdfEngineError) {
      throw error;
    }
    throw new PdfEngineError(
      PdfErrorCode.INVALID_IMAGE,
      "Failed to parse JBIG2 image data.",
      { cause: error },
    );
  }
}

function parseFileHeader(bytes: Uint8Array): Jbig2FileHeader {
  const idBytes = bytes.slice(0, 8);
  const id = new TextDecoder().decode(idBytes);
  if (id.codePointAt(0)! !== 0x97 || id !== "JBIG2\x00\x00\x00") {
    throw new PdfEngineError(
      PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT,
      "Only JBIG2 image data is supported.",
    );
  }

  const flags = bytes[8]!;
  const numberOfPages = (flags & 0x04) !== 0
    ? readBigEndian32(bytes, 9)
    : 1;

  return { numberOfPages };
}

function parseSegmentHeader(bytes: Uint8Array, offset: number): Jbig2SegmentHeader {
  if (offset + 7 > bytes.length) {
    return {
      segmentNumber: 0,
      segmentType: 0,
      referredToSegments: [],
      pageAssociation: 0,
      dataLength: 0,
    };
  }

  const segmentNumber = readBigEndian32(bytes, offset);
  const flags = bytes[offset + 4]!;
  const segmentType = flags & 0x3f;
  const referredToCount = (bytes[offset + 5]! >> 5) & 0x07;
  let cursor = offset + 7 + 1;
  const referredToSegments: number[] = [];

  if (referredToCount <= 4) {
    const refBytes = bytes[offset + 5]! & 0x1f;
    if (referredToCount === 1) {
      referredToSegments.push(refBytes);
    } else if (referredToCount >= 2) {
      for (let i = 0; i < referredToCount; i++) {
        referredToSegments.push(bytes[offset + 6 + i]!);
        cursor += 1;
      }
    }
  } else if (referredToCount === 7) {
    cursor = offset + 8;
  }

  const pageAssociationField = bytes[cursor]!;
  const pageAssociationSize = pageAssociationField >> 4 === 0 ? 4 : pageAssociationField >> 4;
  cursor += 1;

  let pageAssociation = 0;
  for (let i = 0; i < pageAssociationSize; i++) {
    pageAssociation = (pageAssociation << 8) | bytes[cursor + i]!;
  }
  cursor += pageAssociationSize;

  const dataLength = readBigEndian32(bytes, cursor);
  cursor += 4;

  return {
    segmentNumber,
    segmentType,
    referredToSegments,
    pageAssociation,
    dataLength,
  };
}

function parseGenericRegionSegment(data: Uint8Array): Jbig2RegionSegmentInfo | undefined {
  if (data.length < 19) return undefined;

  const width = readBigEndian32(data, 0);
  const height = readBigEndian32(data, 4);
  const x = readBigEndian32(data, 8);
  const y = readBigEndian32(data, 12);
  return { width, height, x, y };
}

function parseSymbolDictionarySegment(data: Uint8Array): Jbig2RegionSegmentInfo | undefined {
  if (data.length < 18) return undefined;

  const width = readBigEndian32(data, 2);
  const height = readBigEndian32(data, 6);

  return { width, height, x: 0, y: 0 };
}

function findPageInformationSegment(bytes: Uint8Array): Jbig2RegionSegmentInfo | undefined {
  let offset = 9;
  while (offset + 11 <= bytes.length) {
    const flags = bytes[offset + 4]!;
    const segmentType = flags & 0x3f;

    const referredToCount = (bytes[offset + 5]! >> 5) & 0x07;
    let cursor = offset + 7 + 1;
    if (referredToCount <= 4 && referredToCount >= 2) {
      cursor += referredToCount - 1;
    } else if (referredToCount === 7) {
      cursor = offset + 8;
    }

    const pageAssociationField = bytes[cursor]!;
    const pageAssociationSize = pageAssociationField >> 4 === 0 ? 4 : pageAssociationField >> 4;
    cursor += 1 + pageAssociationSize;

    const dataLength = readBigEndian32(bytes, cursor);

    if (segmentType === 48) {
      const segData = bytes.slice(cursor + 4, cursor + 4 + Math.min(dataLength, bytes.length - cursor - 4));
      if (segData.length >= 11) {
        const width = readBigEndian32(segData, 0);
        const height = readBigEndian32(segData, 4);
        return { width, height, x: 0, y: 0 };
      }
    }

    offset = cursor + 4 + dataLength;
  }
  return undefined;
}

function buildJbig2Key(bytes: Uint8Array, width: number, height: number): string {
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < Math.min(bytes.length, 256); i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `jbig2:${width}x${height}:${bytes.length}:${hash.toString(16)}`;
}

function readBigEndian32(bytes: Uint8Array, offset: number): number {
  if (offset + 3 >= bytes.length) return 0;
  return (
    ((bytes[offset]! << 24) >>> 0) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  ) >>> 0;
}
