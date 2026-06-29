import type { BmpImageOptions, ExtGStateOptions, Jbig2ImageOptions, JpegImageOptions, Jp2ImageOptions, PathCommand, PathStyle, PdfColor, PdfFigureStructureTag, PdfFont, PdfStructureOptions, PdfStructureTag, PngImageOptions, TextRenderMode, TiffImageOptions, Transform } from "../types.js";
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
  artifactType?: "Pagination" | "Layout" | "Page" | undefined;
  characterSpacing?: number | undefined;
  wordSpacing?: number | undefined;
  leading?: number | undefined;
  kerning: boolean;
  encoding?: "winansi" | "macroman" | "pdfdoc" | undefined;
  underline?: boolean | undefined;
  strike?: boolean | undefined;
  /** Baseline shift in PDF points (Ts). Set by `rise`/`superscript`/`subscript`. */
  rise?: number | undefined;
  /** Glyph painting mode (Tr). Undefined renders as plain fill. */
  renderMode?: TextRenderMode | undefined;
  /** Stroke color for stroking render modes; defaults to the text color. */
  strokeColor?: PdfColor | undefined;
  /** Stroke width in PDF points for stroking render modes. */
  strokeWidth?: number | undefined;
  /** Horizontal glyph scaling percentage (Tz); 100 is normal. */
  horizontalScaling?: number | undefined;
  /** Background highlight fill drawn behind the run (a rect op, not a text op). */
  highlight?: PdfColor | undefined;
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

export interface NormalizedImageOptions {
  x: number;
  y: number;
  width: number;
  height: number;
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
