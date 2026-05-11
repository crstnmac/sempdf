import type { ParsedTrueTypeFont } from "./truetype.js";

export interface ShapedGlyph {
  glyphId: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  yAdvance: number;
}

export interface TextShaper {
  shape(
    text: string,
    font: ParsedTrueTypeFont,
    direction: "ltr" | "rtl",
    script?: string,
  ): ShapedGlyph[];
}
