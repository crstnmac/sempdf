import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type {
  BinaryData,
  GifImageOptions,
  JpegImageOptions,
  PdfBoundingBox,
  PdfStructureOptions,
  PdfStructureTag,
  PngImageOptions,
  SvgImageOptions,
  TextBlockOptions,
  TextOptions,
  UriLinkOptions,
  WebpImageOptions,
  PathCommand,
  PdfColor,
  ParagraphTextAnnotation
} from "../types.js";
import { decrementRowSpanOccupancy, sumNumbers } from "./document-helpers.js";
import { parseImage } from "./image.js";
import { parseSvg } from "./svg.js";
import {
  allocateStructureGroupId,
  type InternalPageModel,
  type InternalStructureNode
} from "./page-types.js";
import {
  findSubstringRects,
  layoutTextBlock,
  measureTextWidth,
  positionTextRuns,
  type PositionedTextRun,
  type SubstringRect
} from "./text-layout.js";
import {
  layoutInlineRuns,
  type InlineBlockGeometry,
  type InlineDecoration,
  type NormalizedInlineRun
} from "./inline-layout.js";
import type { ParsedTrueTypeFont } from "./truetype.js";
import {
  normalizeHighlightAnnotationOptions,
  normalizeImageOptions,
  normalizeNoteAnnotationOptions,
  normalizeSquigglyAnnotationOptions,
  normalizeStrikeOutAnnotationOptions,
  normalizeTextBaseOptions,
  normalizeTextBlockOptions,
  normalizeUnderlineAnnotationOptions,
  normalizeUriLinkOptions,
  normalizePathStyle,
  validateText,
  type NormalizedTextBaseOptions,
  type NormalizedListItem,
  type NormalizedListOptions,
  type NormalizedRadioGroupOptions,
  type NormalizedTableCell,
  type NormalizedTableOptions,
  type NormalizedTableRow
} from "./validation.js";

const GROUPING_STRUCTURE_ROLES: ReadonlySet<string> = new Set([
  "Document",
  "DocumentFragment",
  "Part",
  "Art",
  "Sect",
  "Div",
  "NonStruct",
  "Private",
  "Aside",
  "TOC",
  "TOCI",
  "Index",
  "BlockQuote"
]);

// PDF/UA-1 (and axesCheck "PossibleInappropriateUseParagraph") expect inline
// structure types like <Link> and <Figure> to live inside a block-level
// container such as <P>. When the caller's parent is missing or a pure
// grouping element, insert an intermediate <P> so PAC does not warn.
export function ensureBlockLevelParent(
  page: InternalPageModel,
  parent: InternalStructureNode | undefined
): InternalStructureNode {
  if (parent !== undefined && !GROUPING_STRUCTURE_ROLES.has(parent.role)) {
    return parent;
  }
  return createStructureNode(page, "P", undefined, parent);
}

export function createStructureNode(
  page: InternalPageModel,
  role: Exclude<PdfStructureTag, "Artifact">,
  options?: PdfStructureOptions,
  parent?: InternalStructureNode
): InternalStructureNode {
  const node: InternalStructureNode = {
    id: allocateStructureGroupId(page),
    role,
    children: [],
    annotationIndexes: [],
    ...(options?.altText === undefined ? {} : { altText: options.altText }),
    ...(options?.actualText === undefined ? {} : { actualText: options.actualText }),
    ...(options?.language === undefined ? {} : { language: options.language }),
    ...(options?.attributes === undefined ? {} : { attributes: options.attributes }),
    ...(options?.mathML === undefined ? {} : { mathML: options.mathML }),
    ...(options?.artifactType === undefined ? {} : { artifactType: options.artifactType }),
    ...(options?.associatedFiles === undefined ? {} : { associatedFiles: options.associatedFiles }),
    ...(options?.phoneme === undefined ? {} : { phoneme: options.phoneme }),
    ...(options?.expansion === undefined ? {} : { expansion: options.expansion })
  };

  if (parent) {
    parent.children.push(node);
  } else {
    page.structureRoots.push(node);
  }

  page.structureNodes.set(node.id, node);
  return node;
}

export function addFlowTextBlockToPage(
  page: InternalPageModel,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  text: string,
  options: TextBlockOptions,
  parent?: InternalStructureNode
): { height: number; runs: readonly PositionedTextRun[] } {
  validateText(text);
  const normalized = normalizeTextBlockOptions(text, options);
  const structureNode =
    normalized.tag === undefined || normalized.tag === "Artifact"
      ? undefined
      : createStructureNode(page, normalized.tag, normalized.structure, parent);
  const runs = layoutTextBlock(text, normalized, embeddedFonts);
  pushPositionedTextRuns(page, runs, structureNode?.id);
  const lineCount = new Set(runs.map((run) => run.options.y)).size || 1;
  return { height: lineCount * normalized.lineHeight, runs };
}

export function placementBoundingBox(options: {
  x: number;
  y: number;
  width: number;
  height: number;
}): PdfBoundingBox {
  return [options.x, options.y, options.x + options.width, options.y + options.height];
}

export function radioGroupBoundingBox(options: NormalizedRadioGroupOptions): PdfBoundingBox {
  const minX = Math.min(...options.items.map((item) => item.x));
  const minY = Math.min(...options.items.map((item) => item.y));
  const maxX = Math.max(...options.items.map((item) => item.x + item.width));
  const maxY = Math.max(...options.items.map((item) => item.y + item.height));
  return [minX, minY, maxX, maxY];
}

export function withInferredBoundingBox(
  structure: PdfStructureOptions | undefined,
  boundingBox: PdfBoundingBox
): PdfStructureOptions {
  if (structure?.attributes?.BBox !== undefined) {
    return structure;
  }

  return {
    ...structure,
    attributes: {
      ...(structure?.attributes ?? {}),
      BBox: boundingBox
    }
  };
}

export function addTextToPage(
  page: InternalPageModel,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  text: string,
  options: TextOptions,
  parent?: InternalStructureNode,
  defaultTag?: TextOptions["tag"]
): { width: number; height: number } {
  validateText(text);
  const normalized = normalizeTextBaseOptions(options);
  const structureTag = normalized.tag ?? defaultTag;
  const effectiveOptions =
    structureTag !== undefined && normalized.tag === undefined
      ? { ...normalized, tag: structureTag }
      : normalized;
  const structureNode =
    structureTag === undefined || structureTag === "Artifact"
      ? undefined
      : createStructureNode(page, structureTag, normalized.structure, parent);
  const positioned = positionTextRuns(text, effectiveOptions, embeddedFonts);
  pushPositionedTextRuns(page, positioned, structureNode?.id);
  pushTextDecorations(page, positioned, normalized, embeddedFonts);
  return { width: measureTextWidth(text, effectiveOptions, embeddedFonts), height: normalized.fontSize };
}

export function addTextBlockToPage(
  page: InternalPageModel,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  text: string,
  options: TextBlockOptions,
  parent?: InternalStructureNode,
  defaultTag?: TextBlockOptions["tag"]
): { width: number; height: number; lineCount: number } {
  validateText(text);
  const normalized = normalizeTextBlockOptions(text, options);
  const structureTag = normalized.tag ?? defaultTag;
  const effectiveOptions =
    structureTag !== undefined && normalized.tag === undefined
      ? { ...normalized, tag: structureTag }
      : normalized;
  const structureNode =
    structureTag !== undefined && structureTag !== "Artifact"
      ? createStructureNode(page, structureTag, normalized.structure, parent)
      : undefined;
  let runs = layoutTextBlock(text, effectiveOptions, embeddedFonts);
  if (normalized.height !== undefined && normalized.verticalAlign !== undefined && normalized.verticalAlign !== "top") {
    const contentHeight = measurePositionedRunHeight(runs, normalized.lineHeight);
    runs = shiftRunsDown(runs, verticalAlignOffset(normalized.verticalAlign, normalized.height, contentHeight));
  }
  pushPositionedTextRuns(page, runs, structureNode?.id);
  pushTextDecorations(page, runs, normalized, embeddedFonts);
  const lineCount = new Set(runs.map((run) => run.options.y)).size || 1;
  let right = normalized.x;
  for (const run of runs) {
    right = Math.max(right, run.options.x + measureTextWidth(run.text, normalized, embeddedFonts));
  }
  return { width: right - normalized.x, height: lineCount * normalized.lineHeight, lineCount };
}

/** A single inline rich-text run with its per-run style resolved to a `TextOptions`. */
export interface RichRunInput {
  readonly text: string;
  /** Per-run style; `x`/`y` are placeholders filled during layout. */
  readonly options: TextOptions;
  /** Optional link URL wrapping this run. */
  readonly link?: string | undefined;
}

/** Block-level geometry and tagging for a rich-text paragraph. */
export interface RichTextBlock {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly lineHeight?: number | undefined;
  readonly align: "left" | "center" | "right" | "justify";
  readonly direction: "ltr" | "rtl";
  readonly writingMode: "horizontal" | "vertical";
  readonly height?: number | undefined;
  readonly verticalAlign?: "top" | "middle" | "bottom" | undefined;
  readonly tag?: PdfStructureTag | "Artifact" | undefined;
  readonly structure?: PdfStructureOptions | undefined;
}

/**
 * Normalizes rich-text run inputs into laid-out runs, resolving built-in
 * bold/italic and validating each run's text. Shared by the page and flow
 * rich-text paths.
 */
export function normalizeRichRuns(runs: readonly RichRunInput[]): NormalizedInlineRun[] {
  return runs
    .filter((run) => run.text.length > 0)
    .map((run) => {
      validateText(run.text);
      return {
        text: run.text,
        options: normalizeTextBaseOptions(run.options),
        ...(run.link !== undefined ? { link: run.link } : {})
      };
    });
}

/**
 * Downward offset that vertically aligns content of `contentHeight` within a
 * box of `boxHeight`. "top" yields 0; the offset is clamped to be non-negative
 * so overflowing content is never pushed up.
 */
export function verticalAlignOffset(
  align: "top" | "middle" | "bottom",
  boxHeight: number,
  contentHeight: number
): number {
  const slack = Math.max(boxHeight - contentHeight, 0);
  return align === "middle" ? slack / 2 : align === "bottom" ? slack : 0;
}

/** Returns copies of the runs moved down the page (smaller `y`) by `offset`. */
export function shiftRunsDown(
  runs: readonly PositionedTextRun[],
  offset: number
): PositionedTextRun[] {
  if (offset === 0) {
    return [...runs];
  }
  return runs.map((run) => ({
    ...run,
    options: { ...run.options, y: run.options.y - offset }
  }));
}

/** Builds a stroked path op for one underline/strike segment, tagged as an artifact. */
function decorationOp(x: number, baselineY: number, width: number, fontSize: number, kind: "underline" | "strike", color: PdfColor): {
  type: "path";
  commands: PathCommand[];
  style: ReturnType<typeof normalizePathStyle>;
} {
  const offset = kind === "underline" ? -fontSize * 0.12 : fontSize * 0.26;
  const ly = baselineY + offset;
  const thickness = Math.max(fontSize * 0.06, 0.4);
  return {
    type: "path",
    commands: [
      { type: "moveTo", x, y: ly },
      { type: "lineTo", x: x + width, y: ly },
    ],
    style: normalizePathStyle({ paint: "stroke", stroke: { color, width: thickness }, tag: "Artifact" }),
  };
}

/** Draws underline/strike beneath each positioned run sharing the given base style. */
export function pushTextDecorations(
  page: InternalPageModel,
  runs: readonly PositionedTextRun[],
  base: NormalizedTextBaseOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): void {
  if (base.underline !== true && base.strike !== true) {
    return;
  }
  for (const run of runs) {
    const width = measureTextWidth(run.text, base, embeddedFonts);
    if (width <= 0) continue;
    if (base.underline === true) page.ops.push(decorationOp(run.options.x, run.options.y, width, base.fontSize, "underline", base.color));
    if (base.strike === true) page.ops.push(decorationOp(run.options.x, run.options.y, width, base.fontSize, "strike", base.color));
  }
}

/** Draws underline/strike segments produced by the inline layout engine. */
export function pushInlineDecorations(page: InternalPageModel, decorations: readonly InlineDecoration[]): void {
  for (const d of decorations) {
    if (d.width <= 0) continue;
    if (d.underline) page.ops.push(decorationOp(d.x, d.baselineY, d.width, d.fontSize, "underline", d.color));
    if (d.strike) page.ops.push(decorationOp(d.x, d.baselineY, d.width, d.fontSize, "strike", d.color));
  }
}

/** Default line height for a set of runs when none is supplied. */
export function richLineHeight(runs: readonly NormalizedInlineRun[], explicit?: number): number {
  if (explicit !== undefined) {
    return explicit;
  }
  const maxFontSize = runs.reduce((max, run) => Math.max(max, run.options.fontSize), 0);
  return (maxFontSize > 0 ? maxFontSize : 12) * 1.2;
}

/**
 * Lays out a paragraph of inline rich-text runs onto the page: each run is
 * normalized (resolving built-in bold/italic and defaults), positioned so the
 * runs flow on the same line and wrap together, tagged under a single structure
 * node, and linked where a run carries a URL. Returns the consumed height.
 */
export function addRichTextToPage(
  page: InternalPageModel,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  runs: readonly RichRunInput[],
  block: RichTextBlock,
  parent?: InternalStructureNode
): number {
  const normalizedRuns = normalizeRichRuns(runs);
  const geometry: InlineBlockGeometry = {
    x: block.x,
    y: block.y,
    width: block.width,
    lineHeight: richLineHeight(normalizedRuns, block.lineHeight),
    align: block.align,
    direction: block.direction,
    writingMode: block.writingMode
  };

  const result = layoutInlineRuns(normalizedRuns, geometry, embeddedFonts);
  const offset =
    block.writingMode !== "vertical" && block.height !== undefined && block.verticalAlign !== undefined
      ? verticalAlignOffset(block.verticalAlign, block.height, result.height)
      : 0;
  const structureNode =
    block.tag !== undefined && block.tag !== "Artifact"
      ? createStructureNode(page, block.tag, block.structure, parent)
      : undefined;
  pushPositionedTextRuns(page, shiftRunsDown(result.runs, offset), structureNode?.id);
  for (const link of result.links) {
    addLinkToPage(
      page,
      link.url,
      { x: link.x, y: link.y - offset, width: link.width, height: link.height },
      structureNode
    );
  }
  pushInlineDecorations(
    page,
    offset === 0 ? result.decorations : result.decorations.map((d) => ({ ...d, baselineY: d.baselineY - offset })),
  );
  return result.height;
}

export function addImageToPage(
  page: InternalPageModel,
  format: "jpeg" | "png" | "bmp" | "jbig2" | "tiff" | "jp2" | "webp" | "gif" | "svg",
  data: BinaryData,
  options: JpegImageOptions | PngImageOptions | import("../types.js").BmpImageOptions | import("../types.js").Jbig2ImageOptions | import("../types.js").TiffImageOptions | import("../types.js").Jp2ImageOptions | WebpImageOptions | GifImageOptions | SvgImageOptions,
  parent?: InternalStructureNode,
  defaultTag?: "Figure"
): void {
  if (format === "svg") {
    const svgOptions = options as SvgImageOptions;
    const text = new TextDecoder().decode(
      data instanceof Uint8Array ? data : new Uint8Array(data)
    );
    const svgWidth = svgOptions.width ?? 0;
    const parsed = parseSvg(text, svgWidth > 0 ? svgWidth : undefined, svgOptions.height);
    page.ops.push({
      type: "raw",
      content: parsed.content
    });
    return;
  }

  const normalizedOptions = normalizeImageOptions(options);
  let structureTag:
    | Exclude<NonNullable<ReturnType<typeof normalizeImageOptions>["tag"]>, "Artifact">
    | undefined;
  if (normalizedOptions.tag !== "Artifact") {
    if (normalizedOptions.tag !== undefined) {
      structureTag = normalizedOptions.tag;
    } else if (normalizedOptions.altText !== undefined) {
      structureTag = "Figure";
    } else if (defaultTag !== undefined) {
      structureTag = defaultTag;
    }
  }
  const structureNode =
    structureTag !== undefined
      ? createStructureNode(
          page,
          structureTag,
          {
            ...normalizedOptions.structure,
            attributes: {
              ...(normalizedOptions.structure?.attributes ?? {}),
              // PDF/UA WCAG 1.4.10-1: Figure / Formula / Form structure
              // elements that fit on a single page require a Layout-owned
              // BBox so AT can announce the figure's location.
              O: normalizedOptions.structure?.attributes?.O ?? { name: "Layout" },
              BBox:
                normalizedOptions.structure?.attributes?.BBox
                ?? placementBoundingBox(normalizedOptions),
              Placement:
                normalizedOptions.structure?.attributes?.Placement
                ?? { name: "Block" }
            },
            ...(normalizedOptions.altText === undefined
              ? {}
              : { altText: normalizedOptions.altText })
          },
          parent
        )
      : undefined;
  const iccProfile = "iccProfile" in options ? (options as JpegImageOptions | PngImageOptions).iccProfile : undefined;
  page.ops.push({
    type: "image",
    image: parseImage(format, data, iccProfile),
    options: {
      ...normalizedOptions,
      ...(structureNode === undefined ? {} : { structureGroupId: structureNode.id })
    }
  });
}

interface ResolvedAnnotationPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function resolveAnnotationPadding(
  padding:
    | number
    | { readonly top?: number; readonly bottom?: number; readonly left?: number; readonly right?: number }
    | undefined,
  defaults: ResolvedAnnotationPadding
): ResolvedAnnotationPadding {
  if (padding === undefined) return defaults;
  if (typeof padding === "number") {
    return { top: padding, bottom: padding, left: padding, right: padding };
  }
  return {
    top: padding.top ?? defaults.top,
    bottom: padding.bottom ?? defaults.bottom,
    left: padding.left ?? defaults.left,
    right: padding.right ?? defaults.right
  };
}

/**
 * Emits inline highlight/note/link annotations at every rect where each
 * annotation's `match` substring appears in the given positioned runs.
 * Used by paragraph, heading, list-item body, and table-cell rendering so all
 * text blocks share the same inline-annotation behavior.
 */
export function emitParagraphTextAnnotations(
  page: InternalPageModel,
  runs: readonly PositionedTextRun[],
  annotations: readonly ParagraphTextAnnotation[],
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  parent?: InternalStructureNode
): void {
  if (annotations.length === 0 || runs.length === 0) return;
  for (const annotation of annotations) {
    const rects = findSubstringRects(runs, annotation.match, annotation.occurrence, embeddedFonts);
    for (const rect of rects) {
      emitParagraphTextAnnotation(page, annotation, rect, parent);
    }
  }
}

function emitParagraphTextAnnotation(
  page: InternalPageModel,
  annotation: ParagraphTextAnnotation,
  rect: SubstringRect,
  parent?: InternalStructureNode
): void {
  if (annotation.type === "highlight") {
    const padding = resolveAnnotationPadding(annotation.padding, { top: 2, bottom: 2, left: 0, right: 0 });
    const annotationIndex = page.annotations.length;
    const placed = normalizeHighlightAnnotationOptions({
      x: rect.x - padding.left,
      y: rect.y - padding.bottom,
      width: rect.width + padding.left + padding.right,
      height: rect.fontSize + padding.top + padding.bottom,
      ...(annotation.color !== undefined ? { color: annotation.color } : {}),
      ...(annotation.tag !== undefined ? { tag: annotation.tag } : {})
    });
    const structureGroupId = addAnnotationStructureNode(
      page,
      "Annot",
      annotationIndex,
      placed.tag,
      placed.structure,
      placementBoundingBox(placed),
      parent
    );
    page.annotations.push({
      type: "highlight",
      options: placed,
      ...(structureGroupId === undefined ? {} : { structureGroupId })
    });
    return;
  }

  if (annotation.type === "underline" || annotation.type === "strikeOut" || annotation.type === "squiggly") {
    emitTextMarkupSubtype(page, annotation, rect, parent);
    return;
  }

  if (annotation.type === "note") {
    const size = annotation.size ?? rect.fontSize + 4;
    const anchor = annotation.anchor ?? "before";
    const x = anchor === "after" ? rect.x + rect.width + 2 : rect.x - size - 2;
    const annotationIndex = page.annotations.length;
    const placed = normalizeNoteAnnotationOptions({
      x,
      y: rect.y,
      width: size,
      height: size,
      contents: annotation.contents,
      ...(annotation.open !== undefined ? { open: annotation.open } : {}),
      ...(annotation.tag !== undefined ? { tag: annotation.tag } : {})
    });
    const structureGroupId = addAnnotationStructureNode(
      page,
      "Annot",
      annotationIndex,
      placed.tag,
      placed.structure,
      placementBoundingBox(placed),
      parent
    );
    page.annotations.push({
      type: "note",
      options: placed,
      ...(structureGroupId === undefined ? {} : { structureGroupId })
    });
    return;
  }

  if (annotation.type === "link") {
    addLinkToPage(
      page,
      annotation.url,
      {
        x: rect.x,
        y: rect.y - 2,
        width: rect.width,
        height: rect.fontSize + 2,
        ...(annotation.borderWidth !== undefined ? { borderWidth: annotation.borderWidth } : {}),
        ...(annotation.tag !== undefined ? { tag: annotation.tag } : {})
      },
      parent
    );
  }
}

function emitTextMarkupSubtype(
  page: InternalPageModel,
  annotation: { type: "underline" | "strikeOut" | "squiggly"; color?: import("../types.js").PdfColor | undefined; tag?: "Annot" | "Artifact" | undefined },
  rect: SubstringRect,
  parent?: InternalStructureNode
): void {
  const rawOptions = {
    x: rect.x,
    y: rect.y - 2,
    width: rect.width,
    height: rect.fontSize + 2,
    ...(annotation.color !== undefined ? { color: annotation.color } : {}),
    ...(annotation.tag !== undefined ? { tag: annotation.tag } : {})
  };
  const placed =
    annotation.type === "underline"
      ? normalizeUnderlineAnnotationOptions(rawOptions)
      : annotation.type === "strikeOut"
        ? normalizeStrikeOutAnnotationOptions(rawOptions)
        : normalizeSquigglyAnnotationOptions(rawOptions);
  const annotationIndex = page.annotations.length;
  const structureGroupId = addAnnotationStructureNode(
    page,
    "Annot",
    annotationIndex,
    placed.tag,
    placed.structure,
    placementBoundingBox(placed),
    parent
  );
  page.annotations.push({
    type: annotation.type,
    options: placed,
    ...(structureGroupId === undefined ? {} : { structureGroupId })
  } as Parameters<typeof page.annotations.push>[0]);
}

export function addLinkToPage(
  page: InternalPageModel,
  url: string,
  options: UriLinkOptions,
  parent?: InternalStructureNode
): void {
  const normalizedOptions = normalizeUriLinkOptions(url, options);
  let structureGroupId: number | undefined;
  if (normalizedOptions.tag === "Link") {
    const annotationIndex = page.annotations.length;
    const structure = withInferredBoundingBox(
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions)
    );
    const node =
      parent?.role === "Link"
        ? applyStructureOptions(parent, structure)
        : createStructureNode(page, "Link", structure, ensureBlockLevelParent(page, parent));
    node.annotationIndexes.push(annotationIndex);
    structureGroupId = node.id;
  }

  page.annotations.push({
    type: "uri",
    url,
    options: normalizedOptions,
    ...(structureGroupId === undefined ? {} : { structureGroupId })
  });
}

export function addAnnotationStructureNode(
  page: InternalPageModel,
  defaultRole: "Link" | "Annot",
  annotationIndex: number,
  tag: "Link" | "Annot" | "Artifact" | undefined,
  structure: PdfStructureOptions | undefined,
  boundingBox?: PdfBoundingBox,
  parent?: InternalStructureNode
): number | undefined {
  if (tag === "Artifact") {
    return undefined;
  }

  if (tag === undefined) {
    return undefined;
  }

  const role = tag ?? defaultRole;
  const effectiveStructure =
    boundingBox === undefined ? structure : withInferredBoundingBox(structure, boundingBox);
  const node =
    parent?.role === role
      ? applyStructureOptions(parent, effectiveStructure)
      : createStructureNode(page, role, effectiveStructure, parent);
  node.annotationIndexes.push(annotationIndex);
  return node.id;
}

export function applyStructureOptions(
  node: InternalStructureNode,
  options: PdfStructureOptions | undefined
): InternalStructureNode {
  if (options?.altText !== undefined) {
    node.altText = options.altText;
  }
  if (options?.actualText !== undefined) {
    node.actualText = options.actualText;
  }
  if (options?.language !== undefined) {
    node.language = options.language;
  }
  if (options?.attributes !== undefined) {
    node.attributes = {
      ...(node.attributes ?? {}),
      ...options.attributes
    };
  }
  return node;
}

export function pushPositionedTextRuns(
  page: InternalPageModel,
  runs: readonly PositionedTextRun[],
  structureGroupId?: number
): void {
  for (const run of runs) {
    page.ops.push({
      type: "text",
      text: run.text,
      options: {
        ...run.options,
        ...(structureGroupId === undefined ? {} : { structureGroupId })
      },
      ...(run.glyphs ? { glyphs: run.glyphs } : {})
    });
  }
}

export function layoutList(
  page: InternalPageModel,
  listNode: InternalStructureNode,
  items: readonly NormalizedListItem[],
  options: NormalizedListOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): number {
  const listDirection =
    options.direction === "auto" ? resolveListDirection(items, options) : options.direction;
  const labelColumnWidth = Math.max(
    ...items.map((item, index) =>
      measureTextWidth(resolveListItemLabel(item, index, options), options, embeddedFonts)
    )
  );
  const bodyWidth = options.width - labelColumnWidth - options.labelGap;
  if (bodyWidth <= 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_TEXT,
      "List width must leave room for both labels and body text.",
      {
        width: options.width,
        labelColumnWidth,
        labelGap: options.labelGap
      }
    );
  }

  let y = options.y;
  const bodyX =
    listDirection === "rtl" ? options.x : options.x + labelColumnWidth + options.labelGap;
  const labelX =
    listDirection === "rtl" ? options.x + bodyWidth + options.labelGap : options.x;

  for (const [index, item] of items.entries()) {
    const itemNode = createStructureNode(page, "LI", undefined, listNode);
    const labelNode = createStructureNode(page, "Lbl", undefined, itemNode);
    const labelText = resolveListItemLabel(item, index, options);
    const labelRuns = layoutTextBlock(
      labelText,
      {
        ...options,
        x: labelX,
        y,
        width: labelColumnWidth,
        maxLines: 1,
        align: listDirection === "rtl" ? "right" : "left",
        tag: "Lbl"
      },
      embeddedFonts
    );
    pushPositionedTextRuns(page, labelRuns, labelNode.id);

    const bodyNode = createStructureNode(page, "LBody", undefined, itemNode);
    let bodyHeight = 0;

    if (item.body.length > 0) {
      const bodyRuns = layoutTextBlock(
        item.body,
        {
          ...options,
          x: bodyX,
          y,
          width: bodyWidth,
          tag: "LBody"
        },
        embeddedFonts
      );
      pushPositionedTextRuns(page, bodyRuns, bodyNode.id);
      if (item.annotations && item.annotations.length > 0) {
        emitParagraphTextAnnotations(page, bodyRuns, item.annotations, embeddedFonts, bodyNode);
      }
      bodyHeight = measurePositionedRunHeight(bodyRuns, options.lineHeight);
    }

    const labelHeight = measurePositionedRunHeight(labelRuns, options.lineHeight);
    y -= Math.max(labelHeight, bodyHeight || options.lineHeight) + options.itemSpacing;

    if (item.children.length > 0) {
      const childListNode = createStructureNode(page, "L", undefined, bodyNode);
      y = layoutList(
        page,
        childListNode,
        item.children,
        {
          ...options,
          x: bodyX + options.indent,
          y,
          width: bodyWidth - options.indent
        },
        embeddedFonts
      );
    }
  }

  return y;
}

export function layoutTable(
  page: InternalPageModel,
  tableNode: InternalStructureNode,
  rows: readonly NormalizedTableRow[],
  options: NormalizedTableOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>
): number {
  if (options.summary !== undefined) {
    tableNode.summary = options.summary;
  }
  let y = options.y;
  const rowSpanOccupancy = new Map<number, number>();

  for (const [rowIndex, row] of rows.entries()) {
    const rowNode = createStructureNode(page, "TR", undefined, tableNode);
    const placedCells: Array<{
      cell: NormalizedTableCell;
      node: InternalStructureNode;
      x: number;
      width: number;
      runs: readonly PositionedTextRun[];
    }> = [];
    let columnIndex = 0;

    for (const cell of row) {
      while ((rowSpanOccupancy.get(columnIndex) ?? 0) > 0) {
        columnIndex += 1;
      }

      const startColumn = columnIndex;
      const endColumn = Math.min(startColumn + cell.colSpan, options.columnWidths.length);
      if (endColumn - startColumn !== cell.colSpan) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_TEXT,
          "Table cell span exceeds the available columns.",
          { rowIndex, columnIndex, colSpan: cell.colSpan }
        );
      }

      const role = isHeaderTableCell(cell, rowIndex, startColumn, options) ? "TH" : "TD";
      const cellNode = createStructureNode(
        page,
        role,
        buildTableCellStructureOptions(cell, role, rowIndex, startColumn, options),
        rowNode
      );
      const cellX = options.x + sumNumbers(options.columnWidths.slice(0, startColumn));
      const cellWidth = sumNumbers(options.columnWidths.slice(startColumn, endColumn));
      const textWidth = Math.max(1, cellWidth - options.cellPadding * 2);
      const runs = layoutTextBlock(
        cell.text,
        {
          ...options,
          ...(cell.font !== undefined ? { font: cell.font } : {}),
          x: cellX + options.cellPadding,
          y: y - options.cellPadding,
          width: textWidth,
          tag: role
        },
        embeddedFonts
      );
      placedCells.push({ cell, node: cellNode, x: cellX, width: cellWidth, runs });

      if (cell.rowSpan > 1) {
        for (
          let occupiedColumn = startColumn;
          occupiedColumn < endColumn;
          occupiedColumn += 1
        ) {
          rowSpanOccupancy.set(
            occupiedColumn,
            Math.max(rowSpanOccupancy.get(occupiedColumn) ?? 0, cell.rowSpan - 1)
          );
        }
      }
      columnIndex = endColumn;
    }

    const rowHeight = Math.max(
      options.lineHeight + options.cellPadding * 2,
      ...placedCells.map(
        ({ runs }) => measurePositionedRunHeight(runs, options.lineHeight) + options.cellPadding * 2
      )
    );

    const innerHeight = rowHeight - options.cellPadding * 2;
    for (const placed of placedCells) {
      const align = placed.cell.verticalAlign ?? options.verticalAlign;
      const runs =
        align === "top"
          ? placed.runs
          : shiftRunsDown(
              placed.runs,
              verticalAlignOffset(align, innerHeight, measurePositionedRunHeight(placed.runs, options.lineHeight)),
            );
      pushPositionedTextRuns(page, runs, placed.node.id);
      if (placed.cell.annotations && placed.cell.annotations.length > 0) {
        emitParagraphTextAnnotations(page, runs, placed.cell.annotations, embeddedFonts, placed.node);
      }
    }

    decrementRowSpanOccupancy(rowSpanOccupancy);
    y -= rowHeight + options.rowGap;
  }

  return y;
}

function buildTableCellStructureOptions(
  cell: NormalizedTableCell,
  role: "TH" | "TD",
  rowIndex: number,
  columnIndex: number,
  options: NormalizedTableOptions
): PdfStructureOptions {
  const scope =
    cell.scope ?? (role === "TH" ? inferTableHeaderScope(rowIndex, columnIndex, options) : undefined);
  return {
    ...cell.structure,
    attributes: {
      ...cell.structure?.attributes,
      O: { name: "Table" },
      ...(scope === undefined
        ? {}
        : {
            Scope: {
              name: scope === "row" ? "Row" : scope === "column" ? "Column" : "Both"
            }
          }),
      ...(cell.rowSpan > 1 ? { RowSpan: cell.rowSpan } : {}),
      ...(cell.colSpan > 1 ? { ColSpan: cell.colSpan } : {})
    }
  };
}

function inferTableHeaderScope(
  rowIndex: number,
  columnIndex: number,
  options: NormalizedTableOptions
): "row" | "column" | "both" | undefined {
  const inHeaderColumn = columnIndex < options.headerColumns;
  const inHeaderRow = rowIndex < options.headerRows;
  // Corner cell sits in both a header row and a header column. PDF/UA auditors
  // typically expect Column scope here (header rows dominate visually for AT
  // navigation). Authors can still override via cell.scope.
  if (inHeaderRow) return "column";
  if (inHeaderColumn) return "row";
  return undefined;
}

function isHeaderTableCell(
  cell: NormalizedTableCell,
  rowIndex: number,
  columnIndex: number,
  options: NormalizedTableOptions
): boolean {
  return cell.header || rowIndex < options.headerRows || columnIndex < options.headerColumns;
}

export function measurePositionedRunHeight(
  runs: readonly PositionedTextRun[],
  lineHeight: number
): number {
  if (runs.length === 0) {
    return 0;
  }

  return new Set(runs.map((run) => run.options.y)).size * lineHeight;
}

export function resolveListItemLabel(
  item: NormalizedListItem,
  index: number,
  options: NormalizedListOptions
): string {
  if (item.label !== undefined) {
    return item.label;
  }

  return options.ordered ? `${options.startAt + index}.` : options.bullet;
}

export function resolveListDirection(
  items: readonly NormalizedListItem[],
  options: NormalizedListOptions
): "ltr" | "rtl" {
  const sampleText =
    items.map((item) => item.body).find((body) => body.length > 0) ?? options.bullet;
  return options.direction === "auto" && /[\u0590-\u08ff]/u.test(sampleText) ? "rtl" : "ltr";
}
