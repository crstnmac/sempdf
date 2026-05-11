import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData } from "../types.js";
import type { EmbeddedBmpAsset } from "./bmp.js";
import { parseBmp, buildEmbeddedBmpAsset } from "./bmp.js";
import type { EmbeddedJpegAsset } from "./jpeg.js";
import { parseJpeg } from "./jpeg.js";
import type { EmbeddedPngAsset } from "./png.js";
import { parsePng } from "./png.js";

export type EmbeddedImageAsset = EmbeddedJpegAsset | EmbeddedPngAsset | EmbeddedBmpAsset;

function toUint8Array(data: BinaryData): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function hashBytes(data: Uint8Array): string {
  const sample = data.slice(0, 64);
  let hash = data.length.toString(36);
  for (let i = 0; i < sample.length; i++) {
    hash += sample[i]!.toString(36);
  }
  return hash;
}

const imageCache = new Map<string, EmbeddedImageAsset>();

export function parseImage(format: "jpeg" | "png" | "bmp", data: BinaryData, iccProfile?: BinaryData): EmbeddedImageAsset {
  try {
    const dataBytes = toUint8Array(data);
    const profileBytes = iccProfile ? toUint8Array(iccProfile) : null;
    const cacheKey = `${format}:${hashBytes(dataBytes)}:${profileBytes ? hashBytes(profileBytes) : ""}`;
    const cached = imageCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    if (format === "jpeg") {
      const asset = parseJpeg(data);
      let result: EmbeddedImageAsset;
      if (iccProfile === undefined) {
        result = asset;
      } else {
        const channels = asset.colorSpace === "DeviceGray" ? 1 : asset.colorSpace === "DeviceRGB" ? 3 : 4;
        const iccDigest = simpleDigest(profileBytes!);
        result = {
          ...asset,
          key: `${asset.key}#icc:${iccDigest}`,
          iccProfile: { bytes: profileBytes!, channels }
        } as EmbeddedImageAsset;
      }
      imageCache.set(cacheKey, result);
      return result;
    }

    if (format === "bmp") {
      const result = parseBmp(data);
      const asset = buildEmbeddedBmpAsset(result, iccProfile);
      imageCache.set(cacheKey, asset);
      return asset;
    }

    const asset = parsePng(data);
    let result: EmbeddedImageAsset;
    if (iccProfile === undefined) {
      result = asset;
    } else {
      const channels = asset.colorSpace === "DeviceGray" ? 1 : asset.colorSpace === "DeviceRGB" ? 3 : 4;
      const iccDigest = simpleDigest(profileBytes!);
      result = {
        ...asset,
        key: `${asset.key}#icc:${iccDigest}`,
        iccProfile: { bytes: profileBytes!, channels }
      } as EmbeddedImageAsset;
    }
    imageCache.set(cacheKey, result);
    return result;
  } catch (error) {
    if (error instanceof PdfEngineError) {
      throw error;
    }
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Failed to parse image data.", { cause: error });
  }
}

function simpleDigest(bytes: Uint8Array): string {
  // FNV-1a 64-bit (split into two 32-bit halves) — sufficient for dedup keying.
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0xcbf29ce4 >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    h1 ^= bytes[i]!;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= bytes[bytes.length - 1 - i]!;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}-${bytes.length}`;
}
