import type { ParsedTrueTypeFont } from "./truetype.js";
import type { NormalizedTextBaseOptions } from "./validation.js";
import { resolveTextDirection } from "./validation.js";
import {
  measureTextWidth,
  positionTextRuns,
  positionTextRunsVertical,
  type PositionedTextRun,
} from "./text-layout.js";

/**
 * A rich-text run after block defaults have been merged in. The `options` hold
 * the fully-resolved per-run style; `x`/`y` on them are placeholders filled in
 * during placement.
 */
export interface NormalizedInlineRun {
  readonly text: string;
  readonly options: NormalizedTextBaseOptions;
  readonly link?: string | undefined;
}

/** Block-level geometry the inline layout flows within. */
export interface InlineBlockGeometry {
  readonly x: number;
  /** Baseline of the first line (horizontal) or top of the first column (vertical). */
  readonly y: number;
  readonly width: number;
  readonly lineHeight: number;
  readonly align: "left" | "center" | "right" | "justify";
  readonly direction: "ltr" | "rtl";
  readonly writingMode: "horizontal" | "vertical";
}

/** A clickable link rectangle produced for a linked run span. */
export interface InlineLinkRect {
  readonly url: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A drawn underline/strike segment for a run, anchored at its text baseline. */
export interface InlineDecoration {
  readonly x: number;
  /** Text baseline y. */
  readonly baselineY: number;
  readonly width: number;
  readonly fontSize: number;
  readonly color: import("../types.js").PdfColor;
  readonly underline: boolean;
  readonly strike: boolean;
  /** Background highlight fill, drawn behind the run before the text/decorations. */
  readonly highlight?: import("../types.js").PdfColor | undefined;
}

export interface InlineLayoutResult {
  readonly runs: PositionedTextRun[];
  readonly links: InlineLinkRect[];
  readonly decorations: InlineDecoration[];
  /** Total space consumed (line count × line height). */
  readonly height: number;
  readonly lineCount: number;
}

/** A measured, style-carrying fragment of a run (a word or a whitespace gap). */
interface Piece {
  readonly text: string;
  readonly isSpace: boolean;
  readonly run: NormalizedInlineRun;
  /** Advance along the main axis (text width horizontally, cell run vertically). */
  readonly mainSize: number;
}

/**
 * A broken line/column of pieces, positioned relative to the block. `mainSize`
 * is the line width (horizontal) or column height (vertical), with trailing
 * whitespace trimmed. `isLast` suppresses justification on the final line.
 */
export interface InlineLine {
  readonly pieces: readonly Piece[];
  readonly mainSize: number;
  readonly isLast: boolean;
}

/** Number of stacked cells a string occupies in vertical writing mode. */
function verticalCellCount(text: string): number {
  return [...text].length;
}

/** Main-axis advance of a fragment for the given writing mode. */
function fragmentMainSize(
  fragment: string,
  run: NormalizedInlineRun,
  writingMode: "horizontal" | "vertical",
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
): number {
  return writingMode === "vertical"
    ? verticalCellCount(fragment) * run.options.fontSize
    : measureTextWidth(fragment, run.options, embeddedFonts);
}

/**
 * Splits the runs into measured word/space pieces, preserving each run's style.
 * Whitespace is kept as its own piece so wrapping can drop it at line breaks.
 */
function tokenize(
  runs: readonly NormalizedInlineRun[],
  writingMode: "horizontal" | "vertical",
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
): Piece[] {
  const pieces: Piece[] = [];
  for (const run of runs) {
    if (run.text.length === 0) {
      continue;
    }
    for (const fragment of run.text.split(/(\s+)/)) {
      if (fragment.length === 0) {
        continue;
      }
      pieces.push({
        text: fragment,
        isSpace: /^\s+$/.test(fragment),
        run,
        mainSize: fragmentMainSize(fragment, run, writingMode, embeddedFonts),
      });
    }
  }
  return pieces;
}

/** Greedy line breaker: packs pieces into lines no longer than `limit` along the main axis. */
export function breakInlineLines(
  runs: readonly NormalizedInlineRun[],
  geometry: Pick<InlineBlockGeometry, "width" | "writingMode">,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
): InlineLine[] {
  const pieces = tokenize(runs, geometry.writingMode, embeddedFonts);
  // Vertical rich text stacks in a single column (no auto column wrap).
  if (geometry.writingMode === "vertical") {
    const trimmed = [...pieces];
    while (trimmed.length > 0 && trimmed.at(-1)!.isSpace) {
      trimmed.pop();
    }
    return trimmed.length > 0
      ? [{ pieces: trimmed, mainSize: trimmed.reduce((s, p) => s + p.mainSize, 0), isLast: true }]
      : [];
  }

  const lines: InlineLine[] = [];
  let current: Piece[] = [];
  let currentSize = 0;

  const flush = (isLast: boolean): void => {
    while (current.length > 0 && current.at(-1)!.isSpace) {
      current.pop();
    }
    if (current.length > 0) {
      lines.push({ pieces: current, mainSize: current.reduce((s, p) => s + p.mainSize, 0), isLast });
    }
    current = [];
    currentSize = 0;
  };

  for (const piece of pieces) {
    if (piece.isSpace) {
      if (current.length > 0) {
        current.push(piece);
        currentSize += piece.mainSize;
      }
      continue;
    }
    const hasWord = current.some((entry) => !entry.isSpace);
    if (hasWord && currentSize + piece.mainSize > geometry.width) {
      flush(false);
    }
    current.push(piece);
    currentSize += piece.mainSize;
  }
  flush(true);
  return lines;
}

function linkRectHeight(fontSize: number): number {
  return fontSize * 1.1;
}

interface PlacedLine {
  readonly runs: PositionedTextRun[];
  readonly links: InlineLinkRect[];
  readonly decorations: InlineDecoration[];
  /**
   * Parallel to `runs`: the link URL each positioned run belongs to (or
   * `undefined` for non-linked runs). Lets callers group a link's visible text
   * into a single `Link` structure element. The Nth contiguous run of a given
   * URL corresponds to the Nth entry of `links`.
   */
  readonly runLinks: (string | undefined)[];
}

/**
 * Places one broken line at a given baseline. Handles horizontal alignment
 * (including justify on non-final lines) and right-to-left ordering. Returns the
 * positioned runs and any link rectangles for contiguous linked spans.
 */
export function placeInlineLine(
  line: InlineLine,
  geometry: InlineBlockGeometry,
  baselineY: number,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
): PlacedLine {
  if (geometry.writingMode === "vertical") {
    return placeVerticalColumn(line, geometry, baselineY, embeddedFonts);
  }

  const runs: PositionedTextRun[] = [];
  const runLinks: (string | undefined)[] = [];
  const links: InlineLinkRect[] = [];
  const decorations: InlineDecoration[] = [];
  const rtl = geometry.direction === "rtl";
  const gaps = line.pieces.filter((p) => p.isSpace).length;
  const slack = Math.max(geometry.width - line.mainSize, 0);
  const justify = geometry.align === "justify" && !line.isLast && gaps > 0;
  const extraPerGap = justify ? slack / gaps : 0;

  // Leading edge of the line within the block.
  let leadOffset = 0;
  if (!justify) {
    if (geometry.align === "center") {
      leadOffset = slack / 2;
    } else if (geometry.align === "right" || (rtl && geometry.align !== "left")) {
      leadOffset = slack;
    }
  }

  const ordered = rtl ? [...line.pieces].reverse() : line.pieces;
  let cursorX = geometry.x + leadOffset;

  let activeUrl: string | undefined;
  let activeStartX = 0;
  let activeFontSize = 0;
  const closeLink = (endX: number): void => {
    if (activeUrl !== undefined) {
      const left = Math.min(activeStartX, endX);
      links.push({
        url: activeUrl,
        x: left,
        y: baselineY - activeFontSize * 0.2,
        width: Math.abs(endX - activeStartX),
        height: linkRectHeight(activeFontSize),
      });
      activeUrl = undefined;
    }
  };

  for (const piece of ordered) {
    const produced = positionTextRuns(
      piece.text,
      { ...piece.run.options, x: cursorX, y: baselineY },
      embeddedFonts,
    );
    runs.push(...produced);
    for (const _piece of produced) {
      runLinks.push(piece.run.link);
    }
    const url = piece.run.link;
    if (url !== activeUrl) {
      closeLink(cursorX);
      if (url !== undefined) {
        activeUrl = url;
        activeStartX = cursorX;
        activeFontSize = piece.run.options.fontSize;
      }
    }
    if (
      piece.run.options.underline === true ||
      piece.run.options.strike === true ||
      piece.run.options.highlight !== undefined
    ) {
      decorations.push({
        x: cursorX,
        baselineY,
        width: piece.mainSize,
        fontSize: piece.run.options.fontSize,
        color: piece.run.options.color,
        underline: piece.run.options.underline === true,
        strike: piece.run.options.strike === true,
        ...(piece.run.options.highlight !== undefined ? { highlight: piece.run.options.highlight } : {}),
      });
    }
    cursorX += piece.mainSize + (piece.isSpace ? extraPerGap : 0);
  }
  closeLink(cursorX);
  return { runs, links, decorations, runLinks };
}

/** Stacks a single vertical column of pieces from the column top downward. */
function placeVerticalColumn(
  line: InlineLine,
  geometry: InlineBlockGeometry,
  columnX: number,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
): PlacedLine {
  const runs: PositionedTextRun[] = [];
  const runLinks: (string | undefined)[] = [];
  const links: InlineLinkRect[] = [];
  let cursorY = geometry.y;
  for (const piece of line.pieces) {
    const produced = positionTextRunsVertical(
      piece.text,
      { ...piece.run.options, x: columnX, y: cursorY },
      embeddedFonts,
    );
    runs.push(...produced);
    for (const _piece of produced) {
      runLinks.push(piece.run.link);
    }
    if (piece.run.link !== undefined && !piece.isSpace) {
      const fontSize = piece.run.options.fontSize;
      links.push({
        url: piece.run.link,
        x: columnX - fontSize / 2,
        y: cursorY - piece.mainSize,
        width: fontSize,
        height: piece.mainSize,
      });
    }
    cursorY -= piece.mainSize;
  }
  return { runs, links, decorations: [], runLinks };
}

/**
 * Lays out a sequence of styled runs as one wrapping paragraph, returning all
 * positioned runs at once. Used by the page API; the flow API breaks the lines
 * itself (via {@link breakInlineLines}/{@link placeInlineLine}) so it can split
 * a paragraph across columns and pages.
 *
 * Horizontal mode supports left/center/right/justify alignment and
 * left-to-right or right-to-left ordering. Vertical mode stacks the runs in a
 * single column.
 */
export function layoutInlineRuns(
  runs: readonly NormalizedInlineRun[],
  geometry: InlineBlockGeometry,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
): InlineLayoutResult {
  const lines = breakInlineLines(runs, geometry, embeddedFonts);
  const positioned: PositionedTextRun[] = [];
  const links: InlineLinkRect[] = [];
  const decorations: InlineDecoration[] = [];

  if (geometry.writingMode === "vertical") {
    let columnX = geometry.x;
    for (const line of lines) {
      const placed = placeInlineLine(line, geometry, columnX, embeddedFonts);
      positioned.push(...placed.runs);
      links.push(...placed.links);
      decorations.push(...placed.decorations);
      columnX -= geometry.lineHeight;
    }
    const tallest = lines.reduce((m, l) => Math.max(m, l.mainSize), 0);
    return { runs: positioned, links, decorations, height: tallest, lineCount: lines.length };
  }

  let y = geometry.y;
  for (const line of lines) {
    const placed = placeInlineLine(line, geometry, y, embeddedFonts);
    positioned.push(...placed.runs);
    links.push(...placed.links);
    decorations.push(...placed.decorations);
    y -= geometry.lineHeight;
  }
  return { runs: positioned, links, decorations, height: lines.length * geometry.lineHeight, lineCount: lines.length };
}

/**
 * Resolves the effective text direction for a set of runs when the caller asked
 * for automatic detection. Concatenates run text and defers to the shared
 * heuristic used by the single-style text path.
 */
export function resolveInlineDirection(
  runs: readonly NormalizedInlineRun[],
  requested: "ltr" | "rtl" | "auto",
): "ltr" | "rtl" {
  if (requested !== "auto") {
    return requested;
  }
  return resolveTextDirection(runs.map((run) => run.text).join(""), "auto");
}
