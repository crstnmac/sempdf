import type { BinaryData } from "../types.js";
import type { EmbeddedJpegAsset } from "./jpeg.js";
import { parseJpeg } from "./jpeg.js";
import type { EmbeddedPngAsset } from "./png.js";
import { parsePng } from "./png.js";

export type EmbeddedImageAsset = EmbeddedJpegAsset | EmbeddedPngAsset;

export function parseImage(format: "jpeg" | "png", data: BinaryData): EmbeddedImageAsset {
  return format === "jpeg" ? parseJpeg(data) : parsePng(data);
}
