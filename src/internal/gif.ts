import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";

export interface EmbeddedGifAsset {
  readonly kind: "gif";
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

export function parseGif(data: BinaryData): EmbeddedGifAsset {
  const bytes = toBytes(data);
  try {
    if (
      bytes.length < 13 ||
      !(readTag(bytes, 0) === "GIF87a" || readTag(bytes, 0) === "GIF89a")
    ) {
      throw new PdfEngineError(
        PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT,
        "Only GIF image data is supported.",
        { signature: Array.from(bytes.slice(0, 6)) }
      );
    }

    const width = readUint16LE(bytes, 6);
    const height = readUint16LE(bytes, 8);
    const packed = bytes[10]!;
    const hasGlobalColorTable = (packed & 0x80) !== 0;
    const gctSize = 1 << ((packed & 0x07) + 1);
    let offset = 13;

    let globalColorTable: Uint8Array | undefined;
    if (hasGlobalColorTable) {
      const tableLen = gctSize * 3;
      globalColorTable = bytes.slice(offset, offset + tableLen);
      offset += tableLen;
    }

    const frames: { left: number; top: number; width: number; height: number; imageData: Uint8Array; delayMs: number; transparentIndex: number | undefined; disposalMethod: number }[] = [];
    let transparentIndex: number | undefined;
    let delayMs = 0;
    let disposalMethod = 0;

    while (offset < bytes.length) {
      const blockType = bytes[offset];
      if (blockType === undefined) break;

      if (blockType === 0x3b) {
        break;
      }

      if (blockType === 0x21) {
        offset += 1;
        const extensionLabel = bytes[offset];
        offset += 1;
        if (extensionLabel === 0xf9) {
          offset += 1; // graphic control extension block size
          const gcePacked = bytes[offset]!;
          offset += 1;
          const hasTransparent = (gcePacked & 0x01) !== 0;
          disposalMethod = (gcePacked & 0x1c) >> 2;
          delayMs = readUint16LE(bytes, offset) * 10;
          offset += 2;
          if (hasTransparent) {
            transparentIndex = bytes[offset]!;
          }
          offset += 1;
          offset += 1; // block terminator
          continue;
        }
        // Skip other extensions
        while (offset < bytes.length) {
          const blockSize = bytes[offset]!;
          if (blockSize === 0) {
            offset += 1;
            break;
          }
          offset += 1 + blockSize;
        }
        continue;
      }

      if (blockType === 0x2c) {
        offset += 1;
        const frameLeft = readUint16LE(bytes, offset);
        const frameTop = readUint16LE(bytes, offset + 2);
        const frameWidth = readUint16LE(bytes, offset + 4);
        const frameHeight = readUint16LE(bytes, offset + 6);
        const framePacked = bytes[offset + 8]!;
        offset += 9;
        const hasLocalColorTable = (framePacked & 0x80) !== 0;

        let lctSize = gctSize;
        if (hasLocalColorTable && globalColorTable === undefined) {
          lctSize = 1 << ((framePacked & 0x07) + 1);
        }

        if (hasLocalColorTable) {
          // Local color tables are skipped: only the first frame is decoded.
          offset += lctSize * 3;
        }

        const minCodeSize = bytes[offset]!;
        offset += 1;

        // Read lzw sub-blocks
        const subBlocks: Uint8Array[] = [];
        while (offset < bytes.length) {
          const subBlockSize = bytes[offset]!;
          offset += 1;
          if (subBlockSize === 0) break;
          subBlocks.push(bytes.slice(offset, offset + subBlockSize));
          offset += subBlockSize;
        }

        const compressedData = concatBytes(subBlocks);
        let indices: Uint8Array;
        try {
          indices = decodeGifLzw(compressedData, minCodeSize, lctSize);
        } catch {
          throw new PdfEngineError(
            PdfErrorCode.INVALID_IMAGE,
            "Failed to decode GIF LZW data."
          );
        }

        frames.push({
          left: frameLeft,
          top: frameTop,
          width: frameWidth,
          height: frameHeight,
          imageData: indices,
          delayMs,
          transparentIndex,
          disposalMethod
        });

        if (frames.length >= 1) break;
      } else {
        offset += 1;
      }
    }

    if (frames.length === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_IMAGE,
        "No image frames found in GIF."
      );
    }

    const frame = frames[0]!;
    const imageWidth = frame.width > 0 ? frame.width : width;
    const imageHeight = frame.height > 0 ? frame.height : height;

    const colorTable =
      globalColorTable ?? new Uint8Array(gctSize * 3);

    const { rgbBytes, alphaBytes } = buildGifRGBA(
      frame.imageData,
      colorTable,
      imageWidth,
      imageHeight,
      frame.transparentIndex,
      gctSize
    );

    return {
      kind: "gif",
      key: buildGifKey(bytes, imageWidth, imageHeight),
      bytes: rgbBytes,
      pixelWidth: imageWidth,
      pixelHeight: imageHeight,
      bitsPerComponent: 8,
      colorSpace: "DeviceRGB",
      channels: 3,
      decodeMode: "rawSamples",
      alphaBytes,
      orientation: 1
    };
  } catch (error) {
    if (error instanceof PdfEngineError) {
      throw error;
    }
    throw new PdfEngineError(
      PdfErrorCode.INVALID_IMAGE,
      "Failed to parse GIF image data.",
      { cause: error }
    );
  }
}

function buildGifRGBA(
  indices: Uint8Array,
  colorTable: Uint8Array,
  width: number,
  height: number,
  transparentIndex: number | undefined,
  _colorTableSize: number
): { rgbBytes: Uint8Array; alphaBytes: Uint8Array | undefined } {
  const pixelCount = width * height;
  const rgbBytes = new Uint8Array(pixelCount * 3);
  let alphaBytes: Uint8Array | undefined;
  const hasTransparency = transparentIndex !== undefined;

  if (hasTransparency) {
    alphaBytes = new Uint8Array(pixelCount);
  }

  for (let i = 0; i < pixelCount && i < indices.length; i += 1) {
    const idx = indices[i]!;
    const rgbOffset = i * 3;
    const ctOffset = idx * 3;
    rgbBytes[rgbOffset] = colorTable[ctOffset] ?? 0;
    rgbBytes[rgbOffset + 1] = colorTable[ctOffset + 1] ?? 0;
    rgbBytes[rgbOffset + 2] = colorTable[ctOffset + 2] ?? 0;

    if (alphaBytes) {
      alphaBytes[i] = idx === transparentIndex ? 0 : 255;
    }
  }

  return { rgbBytes, alphaBytes };
}

function decodeGifLzw(
  data: Uint8Array,
  minCodeSize: number,
  _colorTableSize: number
): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let maxCode = (1 << codeSize) - 1;
  let nextCode = eoiCode + 1;

  const table: number[][] = [];
  for (let i = 0; i < clearCode; i += 1) {
    table[i] = [i];
  }
  table[clearCode] = []; // clear
  table[eoiCode] = []; // eoi

  const output: number[] = [];
  let bits = 0;
  let bitCount = 0;
  let byteOffset = 0;
  let prevCode: number | undefined;

  const readBits = (n: number): number => {
    while (bitCount < n) {
      if (byteOffset >= data.length) return -1;
      bits |= (data[byteOffset]! << bitCount);
      bitCount += 8;
      byteOffset += 1;
    }
    const value = bits & ((1 << n) - 1);
    bits >>>= n;
    bitCount -= n;
    return value;
  };

  const emit = (seq: number[]) => {
    for (const idx of seq) {
      output.push(idx);
    }
  };

  while (true) {
    const code = readBits(codeSize);
    if (code < 0 || code === eoiCode) break;

    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      maxCode = (1 << codeSize) - 1;
      nextCode = eoiCode + 1;
      table.length = nextCode;
      prevCode = undefined;
      continue;
    }

    const entry = table[code];
    if (entry === undefined) {
      if (prevCode !== undefined) {
        const prev = table[prevCode];
        if (prev !== undefined) {
          const newEntry = [...prev, prev[0]!];
          emit(newEntry);
          if (nextCode < 4096) {
            table[nextCode] = newEntry;
            nextCode += 1;
            if (nextCode > maxCode && codeSize < 12) {
              codeSize += 1;
              maxCode = (1 << codeSize) - 1;
            }
          }
        }
      }
    } else {
      emit(entry);
      if (prevCode !== undefined) {
        const prev = table[prevCode];
        if (prev !== undefined) {
          const newEntry = [...prev, entry[0]!];
          if (nextCode < 4096) {
            table[nextCode] = newEntry;
            nextCode += 1;
            if (nextCode > maxCode && codeSize < 12) {
              codeSize += 1;
              maxCode = (1 << codeSize) - 1;
            }
          }
        }
      }
    }

    prevCode = code;
  }

  return new Uint8Array(output);
}

function toBytes(data: BinaryData): Uint8Array {
  return data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
}

function readTag(bytes: Uint8Array, offset: number): string {
  return String.fromCodePoint(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
    bytes[offset + 4] ?? 0,
    bytes[offset + 5] ?? 0
  );
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  const low = bytes[offset];
  const high = bytes[offset + 1];
  if (low === undefined || high === undefined) return 0;
  return low | (high << 8);
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function buildGifKey(bytes: Uint8Array, width: number, height: number): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `gif:${width}x${height}:${bytes.length}:${(hash >>> 0).toString(16)}`;
}
