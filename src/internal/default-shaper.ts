import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { EmbeddedTextGlyph } from "./ops.js";
import type { TextShaper, ShapedGlyph } from "./text-shaper.js";
import { makeKerningPairKey } from "./text-layout.js";
import type { ParsedTrueTypeFont, TrueTypeJoiningForms } from "./truetype.js";

const DEVANAGARI_RANGE_START = 0x0900;
const DEVANAGARI_RANGE_END = 0x097f;
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

function detectScript(text: string): string | undefined {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (isDevanagari(codePoint)) return "deva";
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
    if (detectedScript) {
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

export { detectScript, isDevanagari, DEVA_HALF_FORMS, DEVANAGARI_RANGE_START, DEVANAGARI_RANGE_END };
