import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type {
  BinaryData,
  BmpImageOptions,
  JpegImageOptions,
  PdfBoundingBox,
  PdfStructureOptions,
  PdfStructureTag,
  PngImageOptions,
  TextBlockOptions,
  TextOptions,
  UriLinkOptions
} from "../types.js";
import { decrementRowSpanOccupancy, sumNumbers } from "./document-helpers.js";
import { parseImage } from "./image.js";
import {
  allocateStructureGroupId,
  type InternalPageModel,
  type InternalStructureNode
} from "./page-types.js";
import {
  layoutTextBlock,
  measureTextWidth,
  positionTextRuns,
  type PositionedTextRun
} from "./text-layout.js";
import type { ParsedTrueTypeFont } from "./truetype.js";
import {
  normalizeImageOptions,
  normalizeTextBaseOptions,
  normalizeTextBlockOptions,
  normalizeUriLinkOptions,
  validateText,
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
    ...(options?.associatedFiles === undefined ? {} : { associatedFiles: options.associatedFiles })
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
): number {
  validateText(text);
  const normalized = normalizeTextBlockOptions(text, options);
  const structureNode =
    normalized.tag === undefined || normalized.tag === "Artifact"
      ? undefined
      : createStructureNode(page, normalized.tag, normalized.structure, parent);
  const runs = layoutTextBlock(text, normalized, embeddedFonts);
  pushPositionedTextRuns(page, runs, structureNode?.id);
  const lineCount = new Set(runs.map((run) => run.options.y)).size || 1;
  return lineCount * normalized.lineHeight;
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
): void {
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
  pushPositionedTextRuns(
    page,
    positionTextRuns(text, effectiveOptions, embeddedFonts),
    structureNode?.id
  );
}

export function addTextBlockToPage(
  page: InternalPageModel,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  text: string,
  options: TextBlockOptions,
  parent?: InternalStructureNode,
  defaultTag?: TextBlockOptions["tag"]
): void {
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
  pushPositionedTextRuns(page, layoutTextBlock(text, effectiveOptions, embeddedFonts), structureNode?.id);
}

export function addImageToPage(
  page: InternalPageModel,
  format: "jpeg" | "png" | "bmp",
  data: BinaryData,
  options: JpegImageOptions | PngImageOptions | import("../types.js").BmpImageOptions,
  parent?: InternalStructureNode,
  defaultTag?: "Figure"
): void {
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
  page.ops.push({
    type: "image",
    image: parseImage(format, data, options.iccProfile),
    options: {
      ...normalizedOptions,
      ...(structureNode === undefined ? {} : { structureGroupId: structureNode.id })
    }
  });
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

    for (const placed of placedCells) {
      pushPositionedTextRuns(page, placed.runs, placed.node.id);
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
