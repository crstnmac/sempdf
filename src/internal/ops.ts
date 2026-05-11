import type { BmpImageOptions, ExtGStateOptions, JpegImageOptions, PathCommand, PathStyle, PdfColor, PdfFigureStructureTag, PdfFont, PdfStructureOptions, PdfStructureTag, PngImageOptions, Transform } from "../types.js";
import type { EmbeddedImageAsset } from "./image.js";

export interface EmbeddedTextGlyph {
  glyphId: number;
  unicode: string;
}

export interface NormalizedTextOptions {
  x: number;
  y: number;
  font: PdfFont;
  fontSize: number;
  color: PdfColor;
  tag?: PdfStructureTag | undefined;
  structure?: PdfStructureOptions | undefined;
  structureGroupId?: number | undefined;
  characterSpacing?: number | undefined;
  wordSpacing?: number | undefined;
  leading?: number | undefined;
  kerning: boolean;
}

export interface NormalizedPathStyle {
  paint: PathStyle["paint"];
  tag?: "Artifact" | undefined;
  stroke?: {
    color: PdfColor;
    width: number;
    lineCap: 0 | 1 | 2;
    lineJoin: 0 | 1 | 2;
    miterLimit?: number | undefined;
    dashArray?: number[] | undefined;
    dashPhase?: number | undefined;
  } | undefined;
  fill?: {
    color: PdfColor;
  } | undefined;
}

export interface NormalizedImageOptions extends JpegImageOptions, PngImageOptions, BmpImageOptions {
  altText?: string | undefined;
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
  structureGroupId?: number | undefined;
}

export type PdfOp =
  | { type: "saveState" }
  | { type: "restoreState" }
  | { type: "transform"; matrix: Transform }
  | { type: "text"; text: string; options: NormalizedTextOptions; glyphs?: readonly EmbeddedTextGlyph[] | undefined }
  | { type: "path"; commands: PathCommand[]; style: NormalizedPathStyle }
  | { type: "image"; image: EmbeddedImageAsset; options: NormalizedImageOptions }
  | { type: "extGState"; options: ExtGStateOptions }
  | { type: "raw"; content: string };
