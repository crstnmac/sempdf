import type { BinaryData } from "../types.js";
import type { EmbeddedJpegAsset } from "./jpeg.js";
import { parseJpeg } from "./jpeg.js";
import type { EmbeddedPngAsset } from "./png.js";
import { parsePng } from "./png.js";

export type EmbeddedImageAsset = EmbeddedJpegAsset | EmbeddedPngAsset;

export function parseImage(format: "jpeg" | "png", data: BinaryData, iccProfile?: BinaryData): EmbeddedImageAsset {
  const asset = format === "jpeg" ? parseJpeg(data) : parsePng(data);
  if (iccProfile === undefined) return asset;
  const profileBytes = iccProfile instanceof Uint8Array
    ? new Uint8Array(iccProfile)
    : new Uint8Array(iccProfile);
  const channels = asset.colorSpace === "DeviceGray" ? 1 : asset.colorSpace === "DeviceRGB" ? 3 : 4;
  const iccDigest = simpleDigest(profileBytes);
  return {
    ...asset,
    key: `${asset.key}#icc:${iccDigest}`,
    iccProfile: { bytes: profileBytes, channels }
  } as EmbeddedImageAsset;
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
