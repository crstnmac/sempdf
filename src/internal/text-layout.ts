import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { PdfFont } from "../types.js";
import type { EmbeddedTextGlyph, NormalizedTextOptions } from "./ops.js";
import type { ParsedTrueTypeFont } from "./truetype.js";
import { resolveTextDirection, type NormalizedTextBaseOptions, type NormalizedTextBlockOptions, type ResolvedTextDirection } from "./validation.js";

export interface PositionedTextRun {
  readonly text: string;
  readonly options: NormalizedTextOptions;
  readonly glyphs?: readonly EmbeddedTextGlyph[] | undefined;
}

interface ShapedTextRun {
  readonly text: string;
  readonly font: PdfFont;
  readonly advanceWidth: number;
  readonly glyphs?: readonly EmbeddedTextGlyph[] | undefined;
}

interface ShapingToken {
  readonly glyphId: number;
  readonly unicode: string;
  readonly visible: boolean;
  readonly control?: "zwj" | "zwnj" | undefined;
}

export function layoutTextBlock(
  text: string,
  options: NormalizedTextBlockOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): PositionedTextRun[] {
  const paragraphs = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: PositionedTextRun[] = [];
  let y = options.y;
  const lineLimit = options.maxLines ?? Number.POSITIVE_INFINITY;
  let remainingLines = lineLimit;
  let truncated = false;
  const isVertical = options.writingMode === "vertical";

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex]!;
    if (remainingLines <= 0) {
      truncated = true;
      break;
    }

    const wrappedLines = isVertical
      ? wrapParagraphVertical(paragraph, options, embeddedFonts)
      : wrapParagraph(paragraph, options, embeddedFonts);
    if (wrappedLines.length === 0) {
      y -= options.lineHeight;
      continue;
    }

    for (let index = 0; index < wrappedLines.length; index += 1) {
      if (remainingLines <= 0) {
        truncated = true;
        break;
      }

      const textLine = wrappedLines[index]!;
      const isLastLine = index === wrappedLines.length - 1;
      const isLastParagraph = paragraphIndex === paragraphs.length - 1;
      const lineOptions = buildLineOptions(textLine, options, embeddedFonts, y, isLastLine);
      const lineDirection = resolveTextDirection(textLine, options.direction);
      const emitText = (isLastLine && isLastParagraph) || lineDirection === "rtl" ? textLine : `${textLine} `;
      if (isVertical) {
        lines.push(...positionTextRunsVertical(emitText, lineOptions, embeddedFonts));
      } else {
        lines.push(...positionTextRuns(emitText, lineOptions, embeddedFonts));
      }
      y -= options.lineHeight;
      remainingLines -= 1;
    }

    if (truncated) {
      break;
    }
  }

  if (truncated && options.tag !== undefined && options.tag !== "Artifact") {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_TEXT,
      "Tagged text block truncated by maxLines: dropping content from a tagged element breaks the structure tree and PDF/UA compliance.",
      { tag: options.tag, maxLines: lineLimit }
    );
  }

  return lines;
}

export function positionTextRunsVertical(
  text: string,
  options: NormalizedTextBaseOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): PositionedTextRun[] {
  const resolvedDirection = resolveTextDirection(text, options.direction);
  const runs = shapeTextRuns(text, options, embeddedFonts, resolvedDirection);
  const positionedRuns: PositionedTextRun[] = [];
  let y = options.y;
  const charHeight = options.fontSize;

  for (const run of runs) {
    positionedRuns.push({
      text: run.text,
      options: {
        x: options.x,
        y,
        font: run.font,
        fontSize: options.fontSize,
        color: options.color,
        kerning: options.kerning,
        ...(options.tag !== undefined ? { tag: options.tag } : {}),
        ...(options.characterSpacing !== undefined ? { characterSpacing: options.characterSpacing } : {}),
        ...(options.wordSpacing !== undefined ? { wordSpacing: options.wordSpacing } : {}),
        ...(options.leading !== undefined ? { leading: options.leading } : {})
      },
      ...(run.glyphs ? { glyphs: run.glyphs } : {})
    });
    y -= charHeight;
  }

  return positionedRuns;
}

export function positionTextRuns(
  text: string,
  options: NormalizedTextBaseOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): PositionedTextRun[] {
  const resolvedDirection = resolveTextDirection(text, options.direction);
  const runs = shapeTextRuns(text, options, embeddedFonts, resolvedDirection);
  const positionedRuns: PositionedTextRun[] = [];
  const totalWidth = runs.reduce((sum, run) => sum + run.advanceWidth, 0);
  let x = resolvedDirection === "rtl" ? options.x - totalWidth : options.x;

  for (const run of runs) {
    positionedRuns.push({
      text: run.text,
      options: {
        x,
        y: options.y,
        font: run.font,
        fontSize: options.fontSize,
        color: options.color,
        kerning: options.kerning,
        ...(options.tag !== undefined ? { tag: options.tag } : {}),
        ...(options.characterSpacing !== undefined ? { characterSpacing: options.characterSpacing } : {}),
        ...(options.wordSpacing !== undefined ? { wordSpacing: options.wordSpacing } : {}),
        ...(options.leading !== undefined ? { leading: options.leading } : {})
      },
      ...(run.glyphs ? { glyphs: run.glyphs } : {})
    });
    x += run.advanceWidth;
  }

  return positionedRuns;
}

export function measureTextWidth(
  text: string,
  options: Pick<NormalizedTextBaseOptions, "font" | "fallbackFonts" | "direction" | "fontSize" | "characterSpacing" | "wordSpacing" | "kerning">,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): number {
  const resolvedDirection = resolveTextDirection(text, options.direction);
  return shapeTextRuns(text, options, embeddedFonts, resolvedDirection).reduce((total, run) => total + run.advanceWidth, 0);
}

export function makeKerningPairKey(leftGlyphId: number, rightGlyphId: number): number {
  return (leftGlyphId << 16) | rightGlyphId;
}

function shapeTextRuns(
  text: string,
  options: Pick<NormalizedTextBaseOptions, "font" | "fallbackFonts" | "direction" | "fontSize" | "characterSpacing" | "wordSpacing" | "kerning">,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  resolvedDirection: ResolvedTextDirection
): ShapedTextRun[] {
  if (text.length === 0) {
    return [];
  }

  const characters = [...reorderTextForDirection(text, resolvedDirection)];
  const resolvedFonts = characters.map((character) => resolveFontForCharacter(character, options.font, options.fallbackFonts, embeddedFonts));
  const runs: Array<{ text: string; font: PdfFont; hasFollowingCharacter: boolean }> = [];

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    const font = resolvedFonts[index]!;
    const previousRun = runs[runs.length - 1];
    if (previousRun && isSameFont(previousRun.font, font)) {
      previousRun.text += character;
      previousRun.hasFollowingCharacter = index < characters.length - 1;
      continue;
    }

    runs.push({
      text: character,
      font,
      hasFollowingCharacter: index < characters.length - 1
    });
  }

  return runs.map((run) => ({
    text: run.text,
    font: run.font,
    ...(typeof run.font === "string"
      ? {
          advanceWidth:
            measureSingleFontTextWidth(run.text, run.font, options, embeddedFonts)
            + (run.hasFollowingCharacter ? options.characterSpacing ?? 0 : 0)
        }
      : (() => {
          const glyphs = shapeEmbeddedGlyphs(run.text, run.font, embeddedFonts);
          return {
            glyphs,
            advanceWidth:
              measureEmbeddedGlyphWidth(glyphs, run.font, options, embeddedFonts)
              + (run.hasFollowingCharacter ? options.characterSpacing ?? 0 : 0)
          };
        })())
  }));
}

function resolveFontForCharacter(
  character: string,
  primaryFont: PdfFont,
  fallbackFonts: readonly PdfFont[],
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): PdfFont {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_CHARACTER, "Text contains an unsupported character.", {
      character
    });
  }

  if (fontSupportsCodePoint(primaryFont, codePoint, embeddedFonts)) {
    return primaryFont;
  }

  for (const fallbackFont of fallbackFonts) {
    if (fontSupportsCodePoint(fallbackFont, codePoint, embeddedFonts)) {
      return fallbackFont;
    }
  }

  throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_CHARACTER, "Text contains characters not supported by the configured fonts.", {
    character,
    codePoint
  });
}

function fontSupportsCodePoint(font: PdfFont, codePoint: number, embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>): boolean {
  if (typeof font === "string") {
    return supportsBuiltInCodePoint(codePoint);
  }

  if (isShapingControlCodePoint(codePoint)) {
    return true;
  }

  const embeddedFont = embeddedFonts.get(font.id);
  if (!embeddedFont) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FONT, "Embedded font must be registered with the same document via embedTrueTypeFont().", {
      fontId: font.id
    });
  }

  const glyphId = embeddedFont.cmap.getGlyphId(codePoint);
  return glyphId !== 0 || codePoint === 0;
}

function measureSingleFontTextWidth(
  text: string,
  font: PdfFont,
  options: Pick<NormalizedTextBaseOptions, "fontSize" | "characterSpacing" | "wordSpacing" | "kerning">,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): number {
  if (text.length === 0) {
    return 0;
  }

  const glyphCount = [...text].length;
  const spaces = [...text].filter((character) => character === " ").length;

  if (typeof font === "string") {
    let advance = 0;
    for (const character of text) {
      advance += getBuiltInAdvanceWidth(font, character);
    }

    return (advance / 1000) * options.fontSize
      + (options.characterSpacing ?? 0) * Math.max(glyphCount - 1, 0)
      + (options.wordSpacing ?? 0) * spaces;
  }

  return measureEmbeddedGlyphWidth(shapeEmbeddedGlyphs(text, font, embeddedFonts), font, options, embeddedFonts);
}

function measureEmbeddedGlyphWidth(
  glyphs: readonly EmbeddedTextGlyph[],
  font: Exclude<PdfFont, string>,
  options: Pick<NormalizedTextBaseOptions, "fontSize" | "characterSpacing" | "wordSpacing" | "kerning">,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): number {
  const embeddedFont = embeddedFonts.get(font.id);
  if (!embeddedFont) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FONT, "Embedded font must be registered with the same document via embedTrueTypeFont().", {
      fontId: font.id
    });
  }

  let advance = 0;
  let previousGlyphId: number | undefined;
  for (const glyph of glyphs) {
    const glyphId = glyph.glyphId;
    if (options.kerning && previousGlyphId !== undefined) {
      advance += embeddedFont.kerningPairs.get(makeKerningPairKey(previousGlyphId, glyphId)) ?? 0;
    }

    advance += embeddedFont.widths[glyphId] ?? embeddedFont.widths[0] ?? embeddedFont.unitsPerEm;
    previousGlyphId = glyphId;
  }

  const spaces = glyphs.reduce((total, glyph) => total + [...glyph.unicode].filter((character) => character === " ").length, 0);

  return (advance / embeddedFont.unitsPerEm) * options.fontSize
    + (options.characterSpacing ?? 0) * Math.max(glyphs.length - 1, 0)
    + (options.wordSpacing ?? 0) * spaces;
}

function shapeEmbeddedGlyphs(
  text: string,
  font: Exclude<PdfFont, string>,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): EmbeddedTextGlyph[] {
  const embeddedFont = embeddedFonts.get(font.id);
  if (!embeddedFont) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FONT, "Embedded font must be registered with the same document via embedTrueTypeFont().", {
      fontId: font.id
    });
  }

  const tokens: ShapingToken[] = [...text].map((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_CHARACTER, "Embedded font text contains an unsupported character.", {
        text
      });
    }

    if (codePoint === 0x200c) {
      return {
        glyphId: 0,
        unicode: character,
        visible: false,
        control: "zwnj"
      };
    }

    if (codePoint === 0x200d) {
      return {
        glyphId: 0,
        unicode: character,
        visible: false,
        control: "zwj"
      };
    }

    const glyphId = embeddedFont.cmap.getGlyphId(codePoint);
    if (glyphId === 0 && codePoint !== 0) {
      throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_CHARACTER, "Embedded font does not contain a glyph for the requested text.", {
        fontId: embeddedFont.id,
        codePoint
      });
    }

    return {
      glyphId,
      unicode: character,
      visible: true
    };
  });

  const ligatureGlyphs = applyLigatureSubstitutions(tokens, embeddedFont);
  return applyJoiningFormSubstitutions(ligatureGlyphs, embeddedFont)
    .filter((token) => token.visible)
    .map((token) => ({
      glyphId: token.glyphId,
      unicode: token.unicode
    }));
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
      : {
          glyphId: substitutedGlyphId,
          unicode: token.unicode,
          visible: true
        };
  });
}

function supportsJoiningAfter(glyphId: number, embeddedFont: ParsedTrueTypeFont): boolean {
  return embeddedFont.joiningForms.initial.has(glyphId) || embeddedFont.joiningForms.medial.has(glyphId);
}

function supportsJoiningBefore(glyphId: number, embeddedFont: ParsedTrueTypeFont): boolean {
  return embeddedFont.joiningForms.final.has(glyphId) || embeddedFont.joiningForms.medial.has(glyphId);
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

function isTransparentShapingToken(token: Pick<ShapingToken, "unicode">): boolean {
  return /\p{Mark}/u.test(token.unicode);
}

function isShapingControlCodePoint(codePoint: number): boolean {
  return codePoint === 0x200c || codePoint === 0x200d;
}

function wrapParagraph(
  paragraph: string,
  options: NormalizedTextBlockOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): string[] {
  const normalizedParagraph = paragraph.replace(/\t/g, "    ").trim();
  if (normalizedParagraph.length === 0) {
    return [];
  }

  const words = normalizedParagraph.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  const charSpacing = options.characterSpacing ?? 0;
  const spaceWidth = measureTextWidth(" ", options, embeddedFonts);
  let currentLine = "";
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = measureTextWidth(word, options, embeddedFonts);

    if (currentLine.length === 0) {
      if (wordWidth <= options.width) {
        currentLine = word;
        currentWidth = wordWidth;
        continue;
      }

      const brokenWord = breakWord(word, options, embeddedFonts);
      lines.push(...brokenWord.slice(0, -1));
      currentLine = brokenWord[brokenWord.length - 1] ?? "";
      currentWidth = currentLine.length === 0 ? 0 : measureTextWidth(currentLine, options, embeddedFonts);
      continue;
    }

    const candidateWidth = currentWidth + spaceWidth + wordWidth + charSpacing * 2;
    if (candidateWidth <= options.width) {
      currentLine = `${currentLine} ${word}`;
      currentWidth = candidateWidth;
      continue;
    }

    lines.push(currentLine);
    if (wordWidth <= options.width) {
      currentLine = word;
      currentWidth = wordWidth;
      continue;
    }

    const brokenWord = breakWord(word, options, embeddedFonts);
    lines.push(...brokenWord.slice(0, -1));
    currentLine = brokenWord[brokenWord.length - 1] ?? "";
    currentWidth = currentLine.length === 0 ? 0 : measureTextWidth(currentLine, options, embeddedFonts);
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

function wrapParagraphVertical(
  paragraph: string,
  options: NormalizedTextBlockOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): string[] {
  const normalizedParagraph = paragraph.replace(/\t/g, "    ").trim();
  if (normalizedParagraph.length === 0) {
    return [];
  }

  const maxHeight = options.width;
  const charHeight = options.fontSize;
  const maxChars = Math.max(1, Math.floor(maxHeight / charHeight));
  const characters = [...normalizedParagraph];
  const lines: string[] = [];
  let current = "";

  for (const character of characters) {
    if (current.length >= maxChars) {
      lines.push(current);
      current = "";
    }
    current += character;
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [normalizedParagraph];
}

function breakWord(
  word: string,
  options: NormalizedTextBlockOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): string[] {
  const segments: string[] = [];
  let current = "";

  for (const character of word) {
    const candidate = `${current}${character}`;
    const candidateWidth = measureTextWidth(candidate, options, embeddedFonts);
    if (current.length > 0 && candidateWidth > options.width) {
      segments.push(current);
      current = character;
      if (measureTextWidth(current, options, embeddedFonts) > options.width) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_TEXT,
          "Text block width is too small to fit a single character at the configured font size.",
          { character, width: options.width, fontSize: options.fontSize }
        );
      }
      continue;
    }

    if (current.length === 0 && candidateWidth > options.width) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_TEXT,
        "Text block width is too small to fit a single character at the configured font size.",
        { character, width: options.width, fontSize: options.fontSize }
      );
    }

    current = candidate;
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments.length > 0 ? segments : [word];
}

function buildLineOptions(
  text: string,
  options: NormalizedTextBlockOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  y: number,
  isLastLine: boolean
): NormalizedTextBaseOptions {
  const baseWidth = measureTextWidth(text, options, embeddedFonts);
  const resolvedDirection = resolveTextDirection(text, options.direction);
  let leftX = options.x;
  let wordSpacing = options.wordSpacing;

  if (options.align === "center") {
    leftX += Math.max((options.width - baseWidth) / 2, 0);
  } else if (options.align === "right") {
    leftX += Math.max(options.width - baseWidth, 0);
  } else if (options.align === "justify" && !isLastLine) {
    const gaps = countWordGaps(text);
    if (gaps > 0 && baseWidth < options.width) {
      const extraSpacing = (options.width - baseWidth) / gaps;
      wordSpacing = (wordSpacing ?? 0) + extraSpacing;
    }
  }

  return {
    x: resolvedDirection === "rtl" ? leftX + baseWidth : leftX,
    y,
    font: options.font,
    fallbackFonts: [...options.fallbackFonts],
    direction: options.direction,
    fontSize: options.fontSize,
    color: options.color,
    kerning: options.kerning,
    ...(options.tag !== undefined ? { tag: options.tag } : {}),
    ...(options.characterSpacing !== undefined ? { characterSpacing: options.characterSpacing } : {}),
    ...(wordSpacing !== undefined ? { wordSpacing } : {}),
    ...(options.leading !== undefined ? { leading: options.leading } : {})
  };
}

function reorderTextForDirection(text: string, direction: ResolvedTextDirection): string {
  if (direction === "ltr") {
    return text;
  }

  const segments = segmentTextForRtl(text);
  return segments
    .reverse()
    .map((segment) => (segment.direction === "rtl" ? [...segment.text].reverse().join("") : segment.text))
    .join("");
}

function segmentTextForRtl(text: string): Array<{ text: string; direction: ResolvedTextDirection }> {
  const segments: Array<{ text: string; direction: ResolvedTextDirection }> = [];

  for (const character of text) {
    const direction = classifyCharacterDirection(character);
    const lastSegment = segments.at(-1);
    if (lastSegment && (direction === "neutral" || lastSegment.direction === direction)) {
      lastSegment.text += character;
      continue;
    }

    if (direction === "neutral" && !lastSegment) {
      segments.push({ text: character, direction: "rtl" });
      continue;
    }

    segments.push({ text: character, direction: direction === "neutral" ? "rtl" : direction });
  }

  return segments;
}

function classifyCharacterDirection(character: string): ResolvedTextDirection | "neutral" {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    return "neutral";
  }

  if (isRtlCharacter(codePoint)) {
    return "rtl";
  }

  if (isNeutralCharacter(character, codePoint)) {
    return "neutral";
  }

  return "ltr";
}

function isRtlCharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0x0590 && codePoint <= 0x08ff)
    || (codePoint >= 0xfb1d && codePoint <= 0xfdff)
    || (codePoint >= 0xfe70 && codePoint <= 0xfeff)
    || (codePoint >= 0x10800 && codePoint <= 0x10fff)
  );
}

function isNeutralCharacter(character: string, codePoint: number): boolean {
  return /\s/u.test(character)
    || (codePoint >= 0x2000 && codePoint <= 0x206f)
    || (codePoint >= 0x0021 && codePoint <= 0x002f)
    || (codePoint >= 0x003a && codePoint <= 0x0040)
    || (codePoint >= 0x005b && codePoint <= 0x0060)
    || (codePoint >= 0x007b && codePoint <= 0x007e);
}

function countWordGaps(text: string): number {
  let spaces = 0;
  for (const character of text) {
    if (character === " ") {
      spaces += 1;
    }
  }
  return spaces;
}

function getBuiltInAdvanceWidth(font: PdfFont & string, character: string): number {
  if (font.startsWith("Courier")) {
    return character === "\t" ? 2400 : 600;
  }

  if (character === " ") {
    return 278;
  }
  if (character === "\t") {
    return 1112;
  }

  if ("il.,'!:;|".includes(character)) {
    return 278;
  }

  if (String.raw`[](){}\/`.includes(character)) {
    return 333;
  }

  if ("MW@%&".includes(character)) {
    return font.startsWith("Times") ? 889 : 944;
  }

  if (character >= "0" && character <= "9") {
    return 556;
  }

  if (character >= "A" && character <= "Z") {
    return font.startsWith("Times") ? 667 : 722;
  }

  if (character >= "a" && character <= "z") {
    return font.startsWith("Times") ? 444 : 556;
  }

  return 500;
}

function supportsBuiltInCodePoint(codePoint: number): boolean {
  const isAsciiPrintable = codePoint >= 0x20 && codePoint <= 0x7e;
  const isWhitespaceEscape = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
  return isAsciiPrintable || isWhitespaceEscape;
}

function isSameFont(left: PdfFont, right: PdfFont): boolean {
  if (typeof left === "string" || typeof right === "string") {
    return left === right;
  }

  return left.id === right.id;
}
