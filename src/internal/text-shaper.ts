import type { ParsedTrueTypeFont } from "./truetype.js";

/**
 * A single shaped glyph produced by a {@link TextShaper}.
 */
export interface ShapedGlyph {
  /** The glyph ID in the font.
   */
  glyphId: number;
  /** Horizontal offset for mark positioning. */
  xOffset: number;
  /** Vertical offset for mark positioning. */
  yOffset: number;
  /** Horizontal advance width. */
  xAdvance: number;
  /** Vertical advance height. */
  yAdvance: number;
}

/**
 * Interface for pluggable text shaping engines.
 *
 * The default shaper handles basic Latin ligatures and Arabic joining forms.
 * For complex scripts (Devanagari, Thai, Khmer, Myanmar, etc.), you can
 * provide a custom shaper that uses HarfBuzz, fontkit, or another shaping
 * engine to produce correctly positioned glyphs.
 *
 * ## Creating a custom shaper
 *
 * Implement the {@link shape} method and pass your shaper via
 * {@link DocumentOptions.textShaper} or {@link PdfDocument.setTextShaper}:
 *
 * @example
 * ```ts
 * import { createDocument, TextShaper, ShapedGlyph } from "@criston/sempdf";
 *
 * // Example custom shaper using harfbuzzjs:
 * //
 * // async function createHarfBuzzShaper(harfbuzzInstance: any): TextShaper {
 * //   return {
 * //     shape(text, font, direction, script) {
 * //       const buffer = harfbuzzInstance.createBuffer();
 * //       buffer.addText(text);
 * //       buffer.setDirection(direction === "rtl" ? "rtl" : "ltr");
 * //       if (script) buffer.setScript(script);
 * //       const hbFont = createHarfBuzzFontFromParsedFont(font, harfbuzzInstance);
 * //       harfbuzzInstance.shape(hbFont, buffer);
 * //       const jsonResult = buffer.json();
 * //       buffer.destroy();
 * //       return jsonResult.map((g: any) => ({
 * //         glyphId: g.g,
 * //         xOffset: g.dx,
 * //         yOffset: g.dy,
 * //         xAdvance: g.ax,
 * //         yAdvance: g.ay,
 * //       }));
 * //     }
 * //   };
 * // }
 *
 * // For fontkit-based shaping:
 * //
 * // async function createFontkitShaper(fontData: Uint8Array): TextShaper {
 * //   const fontkit = await import("fontkit");
 * //   const fkFont = fontkit.create(fontData);
 * //   return {
 * //     shape(text, font, direction) {
 * //       const run = fkFont.layout(text);
 * //       return run.glyphs.map((g: any) => ({
 * //         glyphId: g.id,
 * //         xOffset: g.xOffset ?? 0,
 * //         yOffset: g.yOffset ?? 0,
 * //         xAdvance: g.advanceWidth ?? 0,
 * //         yAdvance: g.advanceHeight ?? 0,
 * //       }));
 * //     }
 * //   };
 * // }
 *
 * const doc = createDocument({ textShaper: myCustomShaper });
 * ```
 */
export interface TextShaper {
  /**
   * Shapes a text string into an array of positioned glyphs.
   *
   * @param text - The text string to shape.
   * @param font - The parsed TrueType/OpenType font.
   * @param direction - The text direction ("ltr" or "rtl").
   * @param script - Optional 4-character OpenType script tag (e.g. "deva", "arab", "thai").
   * @returns An array of shaped glyphs with positions and advances.
   */
  shape(
    text: string,
    font: ParsedTrueTypeFont,
    direction: "ltr" | "rtl",
    script?: string,
  ): ShapedGlyph[];
}
