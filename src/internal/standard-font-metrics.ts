// Advance widths for the PDF Standard-14 (base-14) fonts, in 1000-unit em space.
//
// These are the published Adobe Core14 AFM metrics. The library never embeds
// the Standard-14 font programs (the viewer supplies metric-compatible faces),
// so glyph advances cannot be read from a font binary — these tables ARE the
// authoritative source, used to position runs and measure text. Only numeric
// width data is reproduced here (facts, not font outlines).
//
// Each array covers printable ASCII, code points 32..126, so width = TABLE[cp - 32].
// Oblique/Italic-less variants share widths: Helvetica-Oblique == Helvetica,
// Helvetica-BoldOblique == Helvetica-Bold. Courier and its variants are
// monospaced (every glyph 600) and handled by the caller. Symbol and
// ZapfDingbats use non-ASCII glyph sets and fall back to an average width.

const FIRST_CODE_POINT = 32;
const LAST_CODE_POINT = 126;

// prettier-ignore
const HELVETICA: readonly number[] = [
  // 32..47  space ! " # $ % & ' ( ) * + , - . /
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  // 48..57  0-9
  556,556,556,556,556,556,556,556,556,556,
  // 58..64  : ; < = > ? @
  278,278,584,584,584,556,1015,
  // 65..90  A-Z
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  // 91..96  [ \ ] ^ _ `
  278,278,278,469,556,333,
  // 97..122 a-z
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
  // 123..126 { | } ~
  334,260,334,584,
];

// prettier-ignore
const HELVETICA_BOLD: readonly number[] = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,
  333,333,584,584,584,611,975,
  722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  333,278,333,584,556,333,
  556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
  389,280,389,584,
];

// prettier-ignore
const TIMES_ROMAN: readonly number[] = [
  250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,
  278,278,564,564,564,444,921,
  722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,
  333,278,333,469,500,333,
  444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,
  480,200,480,541,
];

// prettier-ignore
const TIMES_BOLD: readonly number[] = [
  250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,
  333,333,570,570,570,500,930,
  722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,
  333,278,333,581,500,333,
  500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,
  394,220,394,520,
];

// prettier-ignore
const TIMES_ITALIC: readonly number[] = [
  250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,
  333,333,675,675,675,500,920,
  611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,611,722,611,500,556,722,611,833,611,556,556,
  389,278,389,422,500,333,
  500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,500,500,389,389,278,500,444,667,444,444,389,
  400,275,400,541,
];

// prettier-ignore
const TIMES_BOLD_ITALIC: readonly number[] = [
  250,389,555,500,500,833,778,278,333,333,500,570,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,
  333,333,570,570,570,500,832,
  667,667,667,722,667,667,722,778,389,500,667,611,889,722,722,611,722,667,556,611,722,667,889,667,611,611,
  333,278,333,570,500,333,
  500,500,444,500,444,333,500,556,278,278,500,278,778,556,500,500,500,389,389,278,556,444,667,500,444,389,
  348,220,348,570,
];

/** Resolves a Standard-14 font name to its width table (undefined = no table). */
function tableForFont(font: string): readonly number[] | undefined {
  switch (font) {
    case "Helvetica":
    case "Helvetica-Oblique":
      return HELVETICA;
    case "Helvetica-Bold":
    case "Helvetica-BoldOblique":
      return HELVETICA_BOLD;
    case "Times-Roman":
      return TIMES_ROMAN;
    case "Times-Bold":
      return TIMES_BOLD;
    case "Times-Italic":
      return TIMES_ITALIC;
    case "Times-BoldItalic":
      return TIMES_BOLD_ITALIC;
    default:
      // Courier* (monospaced) is handled by the caller; Symbol/ZapfDingbats have
      // non-ASCII glyph sets with no meaningful ASCII width.
      return undefined;
  }
}

/**
 * Advance width (1000-unit em) of `codePoint` in a Standard-14 font, or
 * undefined when the font has no per-glyph table (Courier, Symbol, ZapfDingbats)
 * or the code point is outside printable ASCII.
 */
export function standardFontWidth(font: string, codePoint: number): number | undefined {
  if (codePoint < FIRST_CODE_POINT || codePoint > LAST_CODE_POINT) return undefined;
  return tableForFont(font)?.[codePoint - FIRST_CODE_POINT];
}
