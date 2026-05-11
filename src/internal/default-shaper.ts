import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { EmbeddedTextGlyph } from "./ops.js";
import type { TextShaper, ShapedGlyph } from "./text-shaper.js";
import { makeKerningPairKey } from "./text-layout.js";
import type { ParsedTrueTypeFont, TrueTypeJoiningForms } from "./truetype.js";

const DEVANAGARI_RANGE_START = 0x0900;
const DEVANAGARI_RANGE_END = 0x097f;
const KHMER_RANGE_START = 0x1780;
const KHMER_RANGE_END = 0x17FF;
const MYANMAR_RANGE_START = 0x1000;
const MYANMAR_RANGE_END = 0x109F;
const DEVA_HALF_FORMS: ReadonlyMap<number, number> = new Map<number, number>([
  [0x0915, 0x0958],
  [0x0916, 0x0959],
  [0x0917, 0x095a],
  [0x091c, 0x095b],
  [0x0921, 0x095c],
  [0x0922, 0x095d],
  [0x0924, 0x095e],
  [0x0928, 0x0929],
  [0x092b, 0x095f],
  [0x092d, 0x092d],
  [0x0930, 0x0931],
  [0x0932, 0x0932],
  [0x0935, 0x0935],
]);

function isDevanagari(codePoint: number): boolean {
  return codePoint >= DEVANAGARI_RANGE_START && codePoint <= DEVANAGARI_RANGE_END;
}

function isKhmer(codePoint: number): boolean {
  return codePoint >= KHMER_RANGE_START && codePoint <= KHMER_RANGE_END;
}

function isMyanmar(codePoint: number): boolean {
  return codePoint >= MYANMAR_RANGE_START && codePoint <= MYANMAR_RANGE_END;
}

function detectScript(text: string): string | undefined {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (isDevanagari(codePoint)) return "deva";
    if (isKhmer(codePoint)) return "khmr";
    if (isMyanmar(codePoint)) return "mymr";
  }
  return undefined;
}

interface ShapingToken {
  glyphId: number;
  unicode: string;
  visible: boolean;
  control?: "zwj" | "zwnj" | undefined;
}

function tokensFromText(text: string, embeddedFont: ParsedTrueTypeFont): ShapingToken[] {
  return [...text].map((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_CHARACTER, "Embedded font text contains an unsupported character.", {
        text
      });
    }

    if (codePoint === 0x200c) {
      return { glyphId: 0, unicode: character, visible: false, control: "zwnj" };
    }

    if (codePoint === 0x200d) {
      return { glyphId: 0, unicode: character, visible: false, control: "zwj" };
    }

    const glyphId = embeddedFont.cmap.getGlyphId(codePoint);
    if (glyphId === 0 && codePoint !== 0) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_CHARACTER, "Embedded font does not contain a glyph for the requested text.", {
        fontId: embeddedFont.id,
        codePoint
      });
    }

    return { glyphId, unicode: character, visible: true };
  });
}

function applyLigatureSubstitutions(tokens: readonly ShapingToken[], embeddedFont: ParsedTrueTypeFont): ShapingToken[] {
  if (embeddedFont.ligatures.size === 0 || tokens.filter((token) => token.visible).length < 2) {
    return [...tokens];
  }

  const shaped: ShapingToken[] = [];
  for (let index = 0; index < tokens.length; ) {
    const firstToken = tokens[index]!;
    if (!firstToken.visible) {
      shaped.push(firstToken);
      index += 1;
      continue;
    }

    const firstGlyphId = firstToken.glyphId;
    const substitutions = embeddedFont.ligatures.get(firstGlyphId);
    let matched = false;

    if (substitutions) {
      for (const substitution of substitutions) {
        if (substitution.sequence.length > tokens.length - index) {
          continue;
        }

        let isMatch = true;
        for (let glyphIndex = 0; glyphIndex < substitution.sequence.length; glyphIndex += 1) {
          const token = tokens[index + glyphIndex]!;
          if (!token.visible || token.glyphId !== substitution.sequence[glyphIndex]) {
            isMatch = false;
            break;
          }
        }

        if (!isMatch) {
          continue;
        }

        shaped.push({
          glyphId: substitution.glyphId,
          unicode: tokens.slice(index, index + substitution.sequence.length).map((token) => token.unicode).join(""),
          visible: true
        });
        index += substitution.sequence.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      shaped.push(firstToken);
      index += 1;
    }
  }

  return shaped;
}

function isTransparentShapingToken(token: Pick<ShapingToken, "unicode">): boolean {
  return /\p{Mark}/u.test(token.unicode);
}

function findJoiningNeighbor(
  tokens: readonly ShapingToken[],
  startIndex: number,
  step: -1 | 1
): { index?: number | undefined; blocked: boolean } {
  for (let index = startIndex + step; index >= 0 && index < tokens.length; index += step) {
    const token = tokens[index]!;
    if (token.control === "zwnj") {
      return { blocked: true };
    }
    if (token.control === "zwj") {
      continue;
    }
    if (!token.visible || isTransparentShapingToken(token)) {
      continue;
    }
    if (token.unicode.length !== 1) {
      return { blocked: false };
    }
    return { index, blocked: false };
  }
  return { blocked: false };
}

function supportsJoiningAfter(glyphId: number, embeddedFont: ParsedTrueTypeFont): boolean {
  return embeddedFont.joiningForms.initial.has(glyphId) || embeddedFont.joiningForms.medial.has(glyphId);
}

function supportsJoiningBefore(glyphId: number, embeddedFont: ParsedTrueTypeFont): boolean {
  return embeddedFont.joiningForms.final.has(glyphId) || embeddedFont.joiningForms.medial.has(glyphId);
}

function applyJoiningFormSubstitutions(tokens: readonly ShapingToken[], embeddedFont: ParsedTrueTypeFont): ShapingToken[] {
  const { isolated, initial, medial, final } = embeddedFont.joiningForms;
  if (isolated.size === 0 && initial.size === 0 && medial.size === 0 && final.size === 0) {
    return [...tokens];
  }

  let hasJoiningCandidate = false;
  for (const token of tokens) {
    if (
      token.visible
      && (initial.has(token.glyphId)
        || medial.has(token.glyphId)
        || final.has(token.glyphId)
        || isolated.has(token.glyphId))
    ) {
      hasJoiningCandidate = true;
      break;
    }
  }
  if (!hasJoiningCandidate) {
    return [...tokens];
  }

  return tokens.map((token, index) => {
    if (!token.visible || token.unicode.length !== 1 || isTransparentShapingToken(token)) {
      return token;
    }

    const previousNeighbor = findJoiningNeighbor(tokens, index, -1);
    const nextNeighbor = findJoiningNeighbor(tokens, index, 1);
    const joinsPrevious =
      previousNeighbor.index !== undefined
      && !previousNeighbor.blocked
      && supportsJoiningAfter(token.glyphId, embeddedFont)
      && supportsJoiningBefore(tokens[previousNeighbor.index]!.glyphId, embeddedFont);
    const joinsNext =
      nextNeighbor.index !== undefined
      && !nextNeighbor.blocked
      && supportsJoiningBefore(token.glyphId, embeddedFont)
      && supportsJoiningAfter(tokens[nextNeighbor.index]!.glyphId, embeddedFont);

    const substitutedGlyphId =
      (joinsPrevious && joinsNext ? medial.get(token.glyphId) : undefined)
      ?? (joinsPrevious ? initial.get(token.glyphId) : undefined)
      ?? (joinsNext ? final.get(token.glyphId) : undefined)
      ?? (!joinsPrevious && !joinsNext ? isolated.get(token.glyphId) : undefined);

    return substitutedGlyphId === undefined
      ? token
      : { glyphId: substitutedGlyphId, unicode: token.unicode, visible: true };
  });
}

const defaultTextShaper: TextShaper = {
  shape(text, font, direction, script) {
    const detectedScript = script ?? detectScript(text);
    if (detectedScript === "deva") {
      if (font.hasDevanagariFeatures) {
        return shapeDevanagari(text, font);
      }
    } else if (detectedScript === "khmr") {
      if (font.hasKhmerFeatures) {
        return shapeKhmer(text, font);
      }
    } else if (detectedScript === "mymr") {
      if (font.hasMyanmarFeatures) {
        return shapeMyanmar(text, font);
      }
    } else if (detectedScript) {
      throw new PdfEngineError(
        PdfErrorCode.UNSUPPORTED_SCRIPT,
        `The default text shaper does not support the "${detectedScript}" script. Plug in an external text shaper (e.g. harfbuzzjs) via the 'textShaper' document option.`,
        { text, script: detectedScript }
      );
    }

    const tokens = tokensFromText(text, font);
    const ligatureGlyphs = applyLigatureSubstitutions(tokens, font);
    const shapedTokens = applyJoiningFormSubstitutions(ligatureGlyphs, font);
    const visibleGlyphs = shapedTokens.filter((token) => token.visible);

    const result: ShapedGlyph[] = [];
    for (let index = 0; index < visibleGlyphs.length; index += 1) {
      const token = visibleGlyphs[index]!;
      let xAdvance = font.widths[token.glyphId] ?? font.widths[0] ?? font.unitsPerEm;

      if (index > 0) {
        const previous = visibleGlyphs[index - 1]!;
        xAdvance += font.kerningPairs.get(makeKerningPairKey(previous.glyphId, token.glyphId)) ?? 0;
      }

      result.push({
        glyphId: token.glyphId,
        xOffset: 0,
        yOffset: 0,
        xAdvance,
        yAdvance: 0
      });
    }

    return result;
  }
};

function shapeDevanagari(text: string, font: ParsedTrueTypeFont): ShapedGlyph[] {
  const result: ShapedGlyph[] = [];
  const chars = [...text];
  let i = 0;

  while (i < chars.length) {
    const character = chars[i]!;
    const cp = character.codePointAt(0)!;

    if (cp === 0x094D) {
      i += 1;
      continue;
    }

    if (isDevanagariConsonant(cp) && i + 2 < chars.length) {
      const nextCp = chars[i + 1]!.codePointAt(0)!;
      if (nextCp === 0x094D) {
        const afterCp = chars[i + 2]!.codePointAt(0)!;
        if (isDevanagariConsonant(afterCp) || afterCp === 0x0930 || afterCp === 0x092F || afterCp === 0x0935 || afterCp === 0x0930 || afterCp === 0x0932) {
          const halfFormCp = DEVA_HALF_FORMS.get(cp);
          if (halfFormCp !== undefined) {
            const glyphId = font.cmap.getGlyphId(halfFormCp);
            if (glyphId !== 0) {
              const advance = font.widths[glyphId] ?? font.widths[0] ?? font.unitsPerEm;
              result.push({
                glyphId,
                xOffset: 0,
                yOffset: 0,
                xAdvance: advance,
                yAdvance: 0
              });
              i += 2;
              continue;
            }
          }
        }
      }
    }

    if (isDevanagariMark(cp)) {
      i += 1;
      continue;
    }

    const glyphId = font.cmap.getGlyphId(cp);
    if (glyphId !== 0) {
      const advance = font.widths[glyphId] ?? font.widths[0] ?? font.unitsPerEm;
      result.push({
        glyphId,
        xOffset: 0,
        yOffset: 0,
        xAdvance: advance,
        yAdvance: 0
      });
    }

    i += 1;
  }

  return result;
}

function isDevanagariConsonant(cp: number): boolean {
  return (cp >= 0x0915 && cp <= 0x0939) || (cp >= 0x0958 && cp <= 0x095F);
}

function isDevanagariMark(cp: number): boolean {
  return (cp >= 0x0900 && cp <= 0x0914)
    || cp === 0x093C
    || (cp >= 0x093E && cp <= 0x094C)
    || cp === 0x094E
    || cp === 0x094F
    || (cp >= 0x0951 && cp <= 0x0957)
    || (cp >= 0x0960 && cp <= 0x0963)
    || cp === 0x0962
    || cp === 0x0963;
}

function shapeKhmer(text: string, font: ParsedTrueTypeFont): ShapedGlyph[] {
  const result: ShapedGlyph[] = [];
  const chars = [...text];
  let i = 0;

  while (i < chars.length) {
    const character = chars[i]!;
    const cp = character.codePointAt(0)!;

    if (cp === 0x17D2) {
      i += 1;
      continue;
    }

    if (isKhmerCoengSubscript(cp, chars, i, font)) {
      const coengGlyphId = font.cmap.getGlyphId(cp);
      if (coengGlyphId !== 0) {
        const advance = font.widths[coengGlyphId] ?? font.widths[0] ?? font.unitsPerEm;
        result.push({ glyphId: coengGlyphId, xOffset: 0, yOffset: 0, xAdvance: advance, yAdvance: 0 });
      }
      i += 1;
      continue;
    }

    if (isKhmerMark(cp)) {
      i += 1;
      continue;
    }

    const glyphId = font.cmap.getGlyphId(cp);
    if (glyphId !== 0) {
      const advance = font.widths[glyphId] ?? font.widths[0] ?? font.unitsPerEm;
      result.push({ glyphId, xOffset: 0, yOffset: 0, xAdvance: advance, yAdvance: 0 });
    }

    i += 1;
  }

  return result;
}

function isKhmerConsonant(cp: number): boolean {
  return cp >= 0x1780 && cp <= 0x17B3;
}

function isKhmerCoengSubscript(cp: number, chars: string[], i: number, font: ParsedTrueTypeFont): boolean {
  if (!isKhmerConsonant(cp) || i + 1 >= chars.length) return false;
  const nextCp = chars[i + 1]!.codePointAt(0)!;
  if (nextCp !== 0x17D2) return false;
  if (i + 2 >= chars.length) return false;
  const afterCp = chars[i + 2]!.codePointAt(0)!;
  return isKhmerConsonantSubscript(afterCp) && font.cmap.getGlyphId(cp) !== 0;
}

function isKhmerConsonantSubscript(cp: number): boolean {
  return (cp >= 0x1780 && cp <= 0x17B3) || cp === 0x17A2;
}

function isKhmerMark(cp: number): boolean {
  return (cp >= 0x17B6 && cp <= 0x17D3)
    || (cp >= 0x17DD && cp <= 0x17E9);
}

function shapeMyanmar(text: string, font: ParsedTrueTypeFont): ShapedGlyph[] {
  const result: ShapedGlyph[] = [];
  const chars = [...text];
  let i = 0;

  while (i < chars.length) {
    const character = chars[i]!;
    const cp = character.codePointAt(0)!;

    if (cp === 0x1039) {
      i += 1;
      continue;
    }

    if (isMyanmarMark(cp)) {
      i += 1;
      continue;
    }

    if (isMyanmarConsonant(cp) && i + 2 < chars.length) {
      const nextCp = chars[i + 1]!.codePointAt(0)!;
      if (nextCp === 0x1039) {
        const afterCp = chars[i + 2]!.codePointAt(0)!;
        if (isMyanmarConsonant(afterCp)) {
          const glyphId = font.cmap.getGlyphId(cp);
          if (glyphId !== 0) {
            const advance = font.widths[glyphId] ?? font.widths[0] ?? font.unitsPerEm;
            result.push({ glyphId, xOffset: 0, yOffset: 0, xAdvance: advance, yAdvance: 0 });
            i += 2;
            continue;
          }
        }
      }
    }

    const glyphId = font.cmap.getGlyphId(cp);
    if (glyphId !== 0) {
      const advance = font.widths[glyphId] ?? font.widths[0] ?? font.unitsPerEm;
      result.push({ glyphId, xOffset: 0, yOffset: 0, xAdvance: advance, yAdvance: 0 });
    }

    i += 1;
  }

  return result;
}

function isMyanmarConsonant(cp: number): boolean {
  return cp >= 0x1000 && cp <= 0x1021;
}

function isMyanmarMark(cp: number): boolean {
  return (cp >= 0x102B && cp <= 0x103E)
    || (cp >= 0x1056 && cp <= 0x1059)
    || (cp >= 0x1036 && cp <= 0x103A)
    || cp === 0x1031
    || cp === 0x103B
    || cp === 0x103C
    || cp === 0x103D
    || cp === 0x103E;
}

export function createDefaultTextShaper(): TextShaper {
  return defaultTextShaper;
}

export function shapeEmbeddedGlyphsWithShaper(
  text: string,
  font: ParsedTrueTypeFont,
  shaper: TextShaper,
  direction: "ltr" | "rtl"
): EmbeddedTextGlyph[] {
  const shaped = shaper.shape(text, font, direction);
  return shaped.map((glyph) => ({
    glyphId: glyph.glyphId,
    unicode: text,
  }));
}

export { detectScript, isDevanagari, isKhmer, isMyanmar, DEVA_HALF_FORMS, DEVANAGARI_RANGE_START, DEVANAGARI_RANGE_END, KHMER_RANGE_START, KHMER_RANGE_END, MYANMAR_RANGE_START, MYANMAR_RANGE_END };
