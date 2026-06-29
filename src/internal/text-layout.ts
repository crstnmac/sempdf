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

/**
 * Text-state / highlight fields that ride from the base options onto each
 * positioned run so the serializer (Ts/Tr/Tz) and highlight pass can honor them.
 * Spacing/font/color are copied explicitly by each call site; these are the
 * formatting extras that would otherwise be dropped.
 */
function carriedRunStyle(
  o: Pick<
    NormalizedTextBaseOptions,
    "rise" | "renderMode" | "strokeColor" | "strokeWidth" | "horizontalScaling" | "highlight"
  >,
): Partial<NormalizedTextOptions> {
  return {
    ...(o.rise !== undefined ? { rise: o.rise } : {}),
    ...(o.renderMode !== undefined ? { renderMode: o.renderMode } : {}),
    ...(o.strokeColor !== undefined ? { strokeColor: o.strokeColor } : {}),
    ...(o.strokeWidth !== undefined ? { strokeWidth: o.strokeWidth } : {}),
    ...(o.horizontalScaling !== undefined ? { horizontalScaling: o.horizontalScaling } : {}),
    ...(o.highlight !== undefined ? { highlight: o.highlight } : {}),
  };
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

  if (options.tateChuYoko !== false && runs.some((r) => hasHorizontalInVerticalChars(r.text))) {
    const tcyGroups = buildTateChuYokoGroups(runs);

    for (const group of tcyGroups) {
      if (group.kind === "vertical") {
        for (const run of group.runs) {
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
              ...(options.leading !== undefined ? { leading: options.leading } : {}),
              ...carriedRunStyle(options)
            },
            ...(run.glyphs ? { glyphs: run.glyphs } : {})
          });
          y -= charHeight;
        }
      } else {
        const combinedText = group.runs.map((r) => r.text).join("");
        const combinedGlyphs = group.runs.every((r) => r.glyphs)
          ? group.runs.flatMap((r) => r.glyphs!)
          : undefined;

        positionedRuns.push({
          text: combinedText,
          options: {
            x: options.x,
            y,
            font: group.runs[0]!.font,
            fontSize: options.fontSize,
            color: options.color,
            kerning: options.kerning,
            ...(options.tag !== undefined ? { tag: options.tag } : {}),
            ...(options.characterSpacing !== undefined ? { characterSpacing: options.characterSpacing } : {}),
            ...(options.wordSpacing !== undefined ? { wordSpacing: options.wordSpacing } : {}),
            ...(options.leading !== undefined ? { leading: options.leading } : {}),
            ...carriedRunStyle(options)
          },
          ...(combinedGlyphs ? { glyphs: combinedGlyphs } : {})
        });
        y -= charHeight * group.runs.length;
      }
    }

    return positionedRuns;
  }

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
        ...(options.leading !== undefined ? { leading: options.leading } : {}),
        ...carriedRunStyle(options)
      },
      ...(run.glyphs ? { glyphs: run.glyphs } : {})
    });
    y -= charHeight;
  }

  return positionedRuns;
}

interface TateChuYokoGroup {
  kind: "vertical" | "horizontal";
  runs: ShapedTextRun[];
}

function buildTateChuYokoGroups(runs: readonly ShapedTextRun[]): TateChuYokoGroup[] {
  const groups: TateChuYokoGroup[] = [];
  let currentHorizontal: ShapedTextRun[] = [];

  for (const run of runs) {
    if (isHorizontalInVertical(run.text)) {
      currentHorizontal.push(run);
    } else {
      if (currentHorizontal.length > 0) {
        groups.push({ kind: "horizontal", runs: currentHorizontal });
        currentHorizontal = [];
      }
      groups.push({ kind: "vertical", runs: [run] });
    }
  }

  if (currentHorizontal.length > 0) {
    groups.push({ kind: "horizontal", runs: currentHorizontal });
  }

  return groups;
}

function hasHorizontalInVerticalChars(text: string): boolean {
  for (const char of codePoints(text)) {
    if (isHorizontalInVertical(char)) return true;
  }
  return false;
}

function isHorizontalInVertical(char: string): boolean {
  const cp = char.codePointAt(0);
  if (cp === undefined) return false;

  if (cp >= 0x30 && cp <= 0x39) return true;
  if (cp >= 0x41 && cp <= 0x5a) return true;
  if (cp >= 0x61 && cp <= 0x7a) return true;

  if (cp >= 0x21 && cp <= 0x2f) return true;
  if (cp >= 0x3a && cp <= 0x40) return true;
  if (cp >= 0x5b && cp <= 0x60) return true;
  if (cp >= 0x7b && cp <= 0x7e) return true;

  if (cp >= 0x00c0 && cp <= 0x024f) return true;
  if (cp >= 0xff10 && cp <= 0xff19) return true;
  if (cp >= 0xff21 && cp <= 0xff3a) return true;
  if (cp >= 0xff41 && cp <= 0xff5a) return true;

  return false;
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
        ...(options.leading !== undefined ? { leading: options.leading } : {}),
        ...carriedRunStyle(options)
      },
      ...(run.glyphs ? { glyphs: run.glyphs } : {})
    });
    x += run.advanceWidth;
  }

  return positionedRuns;
}

export interface SubstringRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly fontSize: number;
}

interface LineInfo {
  readonly y: number;
  readonly runs: readonly PositionedTextRun[];
  readonly text: string;
  readonly direction: ResolvedTextDirection;
  readonly startInFull: number;
}

/**
 * Find rendered rectangles for a substring within positioned text runs.
 *
 * Searches the full paragraph text (lines joined in flow order). Each
 * occurrence may span multiple wrapped lines; one rectangle is emitted per
 * line covered. If `occurrence` is provided, only that zero-based occurrence
 * is emitted; otherwise every occurrence is.
 *
 * Embedded-font runs are measured glyph-by-glyph using the actual shaped
 * glyph widths (so ligatures and kerning produce exact x-offsets). Built-in
 * fonts fall back to substring re-measurement.
 *
 * If every line in the paragraph resolves to RTL, the match is reversed so it
 * locates correctly in the visual run text. Pure-LTR and pure-RTL paragraphs
 * are supported; mixed-bidi paragraphs may miss matches that straddle a
 * direction boundary.
 */
export function findSubstringRects(
  runs: readonly PositionedTextRun[],
  match: string,
  occurrence: number | undefined,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): SubstringRect[] {
  if (match.length === 0) {
    return [];
  }

  const linesByY = new Map<number, PositionedTextRun[]>();
  const orderedYs: number[] = [];
  for (const run of runs) {
    const y = run.options.y;
    const existing = linesByY.get(y);
    if (existing) {
      existing.push(run);
    } else {
      linesByY.set(y, [run]);
      orderedYs.push(y);
    }
  }
  orderedYs.sort((a, b) => b - a);

  const lines: LineInfo[] = [];
  let fullText = "";
  for (const y of orderedYs) {
    const sortedRuns = [...linesByY.get(y)!].sort((a, b) => a.options.x - b.options.x);
    const text = sortedRuns.map((run) => run.text).join("");
    const direction = resolveTextDirection(text, "auto");
    lines.push({ y, runs: sortedRuns, text, direction, startInFull: fullText.length });
    fullText += text;
  }

  const allRtl = lines.length > 0 && lines.every((line) => line.direction === "rtl");
  const searchTerm = allRtl ? reverseStringCodePoints(match) : match;

  const rects: SubstringRect[] = [];
  let occurrenceCounter = 0;
  let searchFrom = 0;

  while (searchFrom <= fullText.length) {
    const idx = fullText.indexOf(searchTerm, searchFrom);
    if (idx === -1) {
      break;
    }

    const shouldEmit = occurrence === undefined || occurrence === occurrenceCounter;
    if (shouldEmit) {
      const start = idx;
      const end = idx + searchTerm.length;
      for (const line of lines) {
        const lineEnd = line.startInFull + line.text.length;
        if (lineEnd <= start) continue;
        if (line.startInFull >= end) break;
        const segStart = Math.max(start, line.startInFull) - line.startInFull;
        const segEnd = Math.min(end, lineEnd) - line.startInFull;
        const rect = computeLineRect(line.runs, segStart, segEnd, line.y, embeddedFonts);
        if (rect) {
          rects.push(rect);
        }
      }
    }

    occurrenceCounter += 1;
    searchFrom = idx + Math.max(searchTerm.length, 1);
  }

  return rects;
}

function reverseStringCodePoints(text: string): string {
  return Array.from(text).reverse().join("");
}

function computeLineRect(
  lineRuns: readonly PositionedTextRun[],
  segStartInLine: number,
  segEndInLine: number,
  y: number,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): SubstringRect | undefined {
  let cursor = 0;
  let rectLeft: number | undefined;
  let rectRight = 0;
  let rectFontSize = 0;

  for (const run of lineRuns) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= segStartInLine) continue;
    if (runStart >= segEndInLine) break;

    const localStart = Math.max(segStartInLine, runStart) - runStart;
    const localEnd = Math.min(segEndInLine, runEnd) - runStart;
    const { prefixWidth, segWidth } = measureRunSubstring(run, localStart, localEnd, embeddedFonts);
    const segX = run.options.x + prefixWidth;

    if (rectLeft === undefined || segX < rectLeft) {
      rectLeft = segX;
    }
    const segRight = segX + segWidth;
    if (segRight > rectRight) {
      rectRight = segRight;
    }
    rectFontSize = Math.max(rectFontSize, run.options.fontSize);
  }

  if (rectLeft === undefined || rectFontSize === 0) {
    return undefined;
  }

  return { x: rectLeft, y, width: Math.max(rectRight - rectLeft, 0), fontSize: rectFontSize };
}

function measureRunSubstring(
  run: PositionedTextRun,
  charStart: number,
  charEnd: number,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): { prefixWidth: number; segWidth: number } {
  const runFont = run.options.font;
  if (run.glyphs && typeof runFont !== "string") {
    const embedded = embeddedFonts.get(runFont.id);
    if (embedded) {
      return measureRunSubstringWithGlyphs(run, embedded, charStart, charEnd);
    }
  }

  const measureOpts: Pick<
    NormalizedTextBaseOptions,
    "font" | "fallbackFonts" | "direction" | "fontSize" | "characterSpacing" | "wordSpacing" | "kerning"
  > = {
    font: runFont,
    fallbackFonts: [],
    direction: "ltr",
    fontSize: run.options.fontSize,
    kerning: run.options.kerning,
    ...(run.options.characterSpacing !== undefined ? { characterSpacing: run.options.characterSpacing } : {}),
    ...(run.options.wordSpacing !== undefined ? { wordSpacing: run.options.wordSpacing } : {}),
  };
  const prefix = run.text.slice(0, charStart);
  const seg = run.text.slice(charStart, charEnd);
  return {
    prefixWidth: prefix.length === 0 ? 0 : measureTextWidth(prefix, measureOpts, embeddedFonts),
    segWidth: seg.length === 0 ? 0 : measureTextWidth(seg, measureOpts, embeddedFonts),
  };
}

function measureRunSubstringWithGlyphs(
  run: PositionedTextRun,
  embedded: ParsedTrueTypeFont,
  charStart: number,
  charEnd: number
): { prefixWidth: number; segWidth: number } {
  const fontSize = run.options.fontSize;
  const upe = embedded.unitsPerEm || 1;
  const charSpacing = run.options.characterSpacing ?? 0;
  const wordSpacing = run.options.wordSpacing ?? 0;
  const kerning = run.options.kerning;

  let advanceUnits = 0;
  let additivePoints = 0;
  let lastGlyphId: number | undefined;
  let charCursor = 0;
  let prefixWidth: number | undefined;
  let segEndWidth: number | undefined;

  const totalChars = run.glyphs!.reduce((sum, g) => sum + g.unicode.length, 0);
  const safeStart = Math.max(0, Math.min(charStart, totalChars));
  const safeEnd = Math.max(safeStart, Math.min(charEnd, totalChars));

  for (let i = 0; i < run.glyphs!.length; i += 1) {
    const glyph = run.glyphs![i]!;
    const glyphStartChar = charCursor;
    const glyphEndChar = charCursor + glyph.unicode.length;

    if (prefixWidth === undefined && glyphStartChar >= safeStart) {
      prefixWidth = (advanceUnits / upe) * fontSize + additivePoints;
    }

    if (kerning && lastGlyphId !== undefined) {
      const pair = embedded.kerningPairs.get(makeKerningPairKey(lastGlyphId, glyph.glyphId));
      if (pair !== undefined) {
        advanceUnits += pair;
      }
    }
    advanceUnits += embedded.widths[glyph.glyphId] ?? embedded.widths[0] ?? upe;
    if (i > 0) {
      additivePoints += charSpacing;
    }
    for (const ch of glyph.unicode) {
      if (ch === " ") additivePoints += wordSpacing;
    }

    charCursor = glyphEndChar;
    lastGlyphId = glyph.glyphId;

    if (segEndWidth === undefined && charCursor >= safeEnd) {
      segEndWidth = (advanceUnits / upe) * fontSize + additivePoints;
    }
  }

  const fullWidth = (advanceUnits / upe) * fontSize + additivePoints;
  const resolvedPrefix = prefixWidth ?? fullWidth;
  const resolvedSegEnd = segEndWidth ?? fullWidth;
  return { prefixWidth: resolvedPrefix, segWidth: Math.max(resolvedSegEnd - resolvedPrefix, 0) };
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

  const characters = codePoints(reorderTextForDirection(text, resolvedDirection));
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

  const glyphCount = codePoints(text).length;
  const spaces = codePoints(text).filter((character) => character === " ").length;

  if (typeof font === "string") {
    let advance = 0;
    for (const character of codePoints(text)) {
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

  const spaces = glyphs.reduce((total, glyph) => total + codePoints(glyph.unicode).filter((character) => character === " ").length, 0);

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

  const tokens: ShapingToken[] = codePoints(text).map((character) => {
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
  return codePoint === 0x200c || codePoint === 0x200d || codePoint === 0x202a || codePoint === 0x202b || codePoint === 0x202c;
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

  const hasThai = containsThaiScript(normalizedParagraph);
  const words = hasThai
    ? segmentThaiWords(normalizedParagraph)
    : normalizedParagraph.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  const charSpacing = options.characterSpacing ?? 0;
  const spaceWidth = measureTextWidth(" ", options, embeddedFonts);
  let currentLine = "";
  let currentWidth = 0;

  for (const rawWord of words) {
    const softHyphenSegments = rawWord.split("\u00AD").filter((s) => s.length > 0);
    const word = softHyphenSegments.join("");
    const wordWidth = measureTextWidth(word, options, embeddedFonts);

    if (currentLine.length === 0) {
      if (wordWidth <= options.width) {
        currentLine = word;
        currentWidth = wordWidth;
        continue;
      }

      if (softHyphenSegments.length > 1) {
        const softBreak = breakWordAtSoftHyphens(softHyphenSegments, options, embeddedFonts);
        if (softBreak) {
          if (softBreak.prefix.length > 0) {
            lines.push(softBreak.prefix);
          }
          currentLine = softBreak.suffix;
          currentWidth = currentLine.length === 0 ? 0 : measureTextWidth(currentLine, options, embeddedFonts);
          continue;
        }
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

    if (softHyphenSegments.length > 1) {
      const softBreak = breakWordAtSoftHyphens(softHyphenSegments, options, embeddedFonts);
      if (softBreak) {
        if (softBreak.prefix.length > 0) {
          lines.push(softBreak.prefix);
        }
        currentLine = softBreak.suffix;
        currentWidth = currentLine.length === 0 ? 0 : measureTextWidth(currentLine, options, embeddedFonts);
        continue;
      }
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

function breakWordAtSoftHyphens(
  segments: string[],
  options: NormalizedTextBlockOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): { prefix: string; suffix: string } | undefined {
  for (let breakAt = segments.length - 1; breakAt >= 1; breakAt -= 1) {
    const prefixParts = segments.slice(0, breakAt);
    const suffixParts = segments.slice(breakAt);
    const prefix = prefixParts.join("") + "-";
    const suffix = suffixParts.join("");
    const prefixWidth = measureTextWidth(prefix, options, embeddedFonts);

    if (prefixWidth <= options.width) {
      return { prefix, suffix };
    }
  }

  return undefined;
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
  const characters = codePoints(normalizedParagraph);
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

  for (const character of codePoints(word)) {
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
    ...(options.leading !== undefined ? { leading: options.leading } : {}),
    ...carriedRunStyle(options)
  };
}

function reorderTextForDirection(text: string, direction: ResolvedTextDirection): string {
  const annotated = splitByBidiEmbedding(text, direction);
  const reordered = annotated.map((segment) =>
    segment.direction === "rtl" ? segmentRtlText(segment.text) : segment.text
  );
  return direction === "rtl" ? reordered.reverse().join("") : reordered.join("");
}

function segmentRtlText(text: string): string {
  const segments = splitByCharacterDirection(text);
  return segments
    .reverse()
    .map((segment) => (segment.direction === "rtl" ? codePoints(segment.text).reverse().join("") : segment.text))
    .join("");
}

function splitByBidiEmbedding(
  text: string,
  baseDirection: ResolvedTextDirection
): Array<{ text: string; direction: ResolvedTextDirection }> {
  const annotated: Array<{ text: string; direction: ResolvedTextDirection }> = [];
  let current = "";
  let currentDirection = baseDirection;
  const stack: ResolvedTextDirection[] = [];

  for (const character of codePoints(text)) {
    const cp = character.codePointAt(0)!;

    if (cp === 0x202a) {
      if (current.length > 0) {
        annotated.push({ text: current, direction: currentDirection });
        current = "";
      }
      stack.push(currentDirection);
      currentDirection = "ltr";
      continue;
    }
    if (cp === 0x202b) {
      if (current.length > 0) {
        annotated.push({ text: current, direction: currentDirection });
        current = "";
      }
      stack.push(currentDirection);
      currentDirection = "rtl";
      continue;
    }
    if (cp === 0x202c) {
      if (current.length > 0) {
        annotated.push({ text: current, direction: currentDirection });
        current = "";
      }
      if (stack.length > 0) {
        currentDirection = stack.pop()!;
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    annotated.push({ text: current, direction: currentDirection });
  }

  return annotated;
}

function splitByCharacterDirection(text: string): Array<{ text: string; direction: ResolvedTextDirection }> {
  const segments: Array<{ text: string; direction: ResolvedTextDirection }> = [];

  for (const character of codePoints(text)) {
    const charDirection = classifyCharacterDirection(character);
    const lastSegment = segments.at(-1);
    if (lastSegment && (charDirection === "neutral" || lastSegment.direction === charDirection)) {
      lastSegment.text += character;
      continue;
    }

    if (charDirection === "neutral" && !lastSegment) {
      segments.push({ text: character, direction: "rtl" });
      continue;
    }

    segments.push({ text: character, direction: charDirection === "neutral" ? "rtl" : charDirection });
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
  for (const character of codePoints(text)) {
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

function codePoints(text: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const cp = text.codePointAt(index);
    if (cp === undefined) {
      break;
    }
    result.push(String.fromCodePoint(cp));
    if (cp > 0xFFFF) {
      index += 1;
    }
  }
  return result;
}

const THAI_RANGE_START = 0x0e00;
const THAI_RANGE_END = 0x0e7f;

function isThai(codePoint: number): boolean {
  return codePoint >= THAI_RANGE_START && codePoint <= THAI_RANGE_END;
}

function containsThaiScript(text: string): boolean {
  for (const character of codePoints(text)) {
    const cp = character.codePointAt(0);
    if (cp !== undefined && isThai(cp)) {
      return true;
    }
  }
  return false;
}

const COMMON_THAI_WORDS = new Set([
  "\u0e01\u0e31\u0e1a",
  "\u0e44\u0e14\u0e49",
  "\u0e44\u0e21\u0e48",
  "\u0e41\u0e25\u0e30",
  "\u0e41\u0e25\u0e49\u0e27",
  "\u0e43\u0e19",
  "\u0e17\u0e35\u0e48",
  "\u0e21\u0e35",
  "\u0e04\u0e27\u0e32\u0e21",
  "\u0e01\u0e32\u0e23",
  "\u0e02\u0e2d\u0e07",
  "\u0e40\u0e1b\u0e47\u0e19",
  "\u0e44\u0e14\u0e49\u0e23\u0e31\u0e1a",
  "\u0e15\u0e32\u0e21",
  "\u0e2d\u0e22\u0e48\u0e32\u0e07",
  "\u0e08\u0e32\u0e01",
  "\u0e2b\u0e23\u0e37\u0e2d",
  "\u0e2b\u0e23\u0e37\u0e2d\u0e27\u0e48\u0e32",
  "\u0e40\u0e21\u0e37\u0e48\u0e2d",
  "\u0e42\u0e14\u0e22",
  "\u0e16\u0e36\u0e07",
  "\u0e16\u0e49\u0e32",
  "\u0e21\u0e32\u0e01",
  "\u0e19\u0e35\u0e49",
  "\u0e19\u0e31\u0e49\u0e19",
  "\u0e19\u0e31\u0e48\u0e19",
  "\u0e1a\u0e17",
  "\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21",
  "\u0e1a\u0e38\u0e04\u0e04\u0e25",
  "\u0e1b\u0e23\u0e30\u0e40\u0e17\u0e28",
  "\u0e1c\u0e21",
  "\u0e1c\u0e39\u0e49",
  "\u0e1e\u0e23\u0e30",
  "\u0e1e\u0e23\u0e30\u0e40\u0e08\u0e49\u0e32",
  "\u0e21\u0e31\u0e19",
  "\u0e23\u0e27\u0e21",
  "\u0e23\u0e30\u0e2b\u0e27\u0e48\u0e32\u0e07",
  "\u0e27\u0e34\u0e18\u0e35",
  "\u0e27\u0e48\u0e32",
  "\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a",
  "\u0e2a\u0e48\u0e27\u0e19",
  "\u0e2b\u0e19\u0e36\u0e48\u0e07",
  "\u0e2b\u0e23\u0e37\u0e2d",
  "\u0e2d\u0e22\u0e48\u0e32\u0e07",
  "\u0e40\u0e01\u0e35\u0e48\u0e22\u0e27",
  "\u0e40\u0e01\u0e35\u0e48\u0e22\u0e27\u0e01\u0e31\u0e1a",
  "\u0e40\u0e02\u0e49\u0e32",
  "\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07",
  "\u0e40\u0e0a\u0e48\u0e19",
  "\u0e40\u0e0a\u0e48\u0e19\u0e40\u0e14\u0e35\u0e22\u0e27",
  "\u0e40\u0e14\u0e47\u0e01",
  "\u0e40\u0e19\u0e37\u0e48\u0e2d\u0e07",
  "\u0e40\u0e19\u0e37\u0e48\u0e2d\u0e07\u0e08\u0e32\u0e01",
  "\u0e40\u0e1b\u0e25\u0e48\u0e32",
  "\u0e40\u0e1e\u0e23\u0e32\u0e30",
  "\u0e40\u0e21\u0e37\u0e48\u0e2d",
  "\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e01\u0e48\u0e2d\u0e19",
  "\u0e40\u0e21\u0e48\u0e37\u0e2d",
  "\u0e40\u0e27\u0e25\u0e32",
  "\u0e40\u0e2a\u0e23\u0e47\u0e08",
  "\u0e40\u0e2b\u0e21\u0e37\u0e2d\u0e19",
  "\u0e40\u0e2b\u0e25\u0e48\u0e32",
  "\u0e41\u0e15\u0e48",
  "\u0e41\u0e15\u0e48\u0e25\u0e30",
  "\u0e41\u0e1a\u0e1a",
  "\u0e41\u0e25\u0e49\u0e27\u0e01\u0e47",
  "\u0e41\u0e2a\u0e14\u0e07",
  "\u0e42\u0e14\u0e22",
  "\u0e43\u0e19",
  "\u0e43\u0e2b\u0e0d\u0e48",
  "\u0e43\u0e2b\u0e49",
]);

function segmentThaiWords(text: string): string[] {
  const chars = codePoints(text);
  const words: string[] = [];
  let current = "";

  for (const character of chars) {
    const cp = character.codePointAt(0)!;

    if (!isThai(cp)) {
      if (current.length > 0) {
        words.push(...segmentThaiToWords(current));
        current = "";
      }
      const lastWord = words[words.length - 1];
      if (lastWord !== undefined && !isThai(lastWord.codePointAt(0)!)) {
        words[words.length - 1] = lastWord + character;
      } else {
        words.push(character);
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    words.push(...segmentThaiToWords(current));
  }

  return words.filter((w) => w.length > 0);
}

function segmentThaiToWords(thaiText: string): string[] {
  const chars = codePoints(thaiText);
  if (chars.length === 0) {
    return [];
  }

  const words: string[] = [];
  let i = 0;

  while (i < chars.length) {
    let bestLen = 0;

    for (let len = Math.min(chars.length - i, 20); len >= 1; len -= 1) {
      const candidate = chars.slice(i, i + len).join("");
      if (COMMON_THAI_WORDS.has(candidate)) {
        bestLen = len;
        break;
      }
    }

    if (bestLen > 0) {
      words.push(chars.slice(i, i + bestLen).join(""));
      i += bestLen;
    } else {
      words.push(chars[i]!);
      i += 1;
    }
  }

  return words;
}
