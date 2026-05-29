import { PdfEngineError, PdfErrorCode } from "./errors.js";
import {
  parseDocument,
  ParsedPdfDocument,
  type ParseDocumentOptions,
  type ParsedPdfEditableStructureElement,
  type ParsedPdfFormField,
  type ParsedPdfMetadata,
} from "./parser.js";
import { parseImage } from "./internal/image.js";
import { layoutTextBlock, measureTextWidth } from "./internal/text-layout.js";
import type { TextShaper } from "./internal/text-shaper.js";
import {
  parseTrueTypeFont,
  type ParsedTrueTypeFont,
} from "./internal/truetype.js";
import {
  arrayEquals,
  decrementRowSpanOccupancy,
  isPdfDictEntries,
  normalizeEditableAltText,
  sumNumbers,
  toBytes,
} from "./internal/document-helpers.js";
import {
  appendFlattenedParsedFieldOps,
  flattenFormsOnPages,
} from "./internal/form-flatten.js";
import {
  renderTemplateBlocksToFlow,
  renderTemplateDocument,
} from "./internal/template-render.js";
import {
  addAnnotationStructureNode,
  addFlowTextBlockToPage,
  addImageToPage,
  addLinkToPage,
  addTextBlockToPage,
  addTextToPage,
  createStructureNode,
  emitParagraphTextAnnotations,
  ensureBlockLevelParent,
  layoutList,
  layoutTable,
  measurePositionedRunHeight,
  placementBoundingBox,
  pushPositionedTextRuns,
  radioGroupBoundingBox,
} from "./internal/page-helpers.js";
import {
  collectComplianceIssues,
  normalizeAttachmentOptions,
  normalizeCheckBoxOptions,
  normalizeChoiceFieldOptions,
  normalizeContainerStructureTag,
  normalizeDestinationName,
  normalizeDocumentAccessibility,
  normalizeDocumentEncryption,
  normalizeDocumentInfo,
  normalizeFreeTextAnnotationOptions,
  normalizeHighlightAnnotationOptions,
  normalizeListItems,
  normalizeListOptions,
  normalizeNoteAnnotationOptions,
  normalizeSquigglyAnnotationOptions,
  normalizeStrikeOutAnnotationOptions,
  normalizeUnderlineAnnotationOptions,
  normalizeOutlineOptions,
  normalizeOutlineTitle,
  normalizePageLabelOptions,
  normalizePageLinkOptions,
  normalizePathStyle,
  normalizePushButtonOptions,
  normalizeRadioGroupOptions,
  normalizeSignatureFieldOptions,
  normalizeStructureOptions,
  normalizeStructureRole,
  normalizeTableOptions,
  normalizeTableRows,
  normalizeTextBlockOptions,
  normalizeTextFieldOptions,
  normalizeXmpMetadata,
  resolvePageSize,
  validateChoiceFieldValue,
  validatePathCommands,
  validateTextFieldValue,
  validateExtGStateOptions,
  validateTransform,
  validateText,
  type ComplianceCheckInput,
  type NormalizedDocumentAccessibility,
  type NormalizedDocumentEncryption,
  type NormalizedDocumentInfo,
  type NormalizedHighlightAnnotationOptions,
  type NormalizedPageLabelOptions,
  type ResolvedPageSize,
} from "./internal/validation.js";
import {
  serializeDocument,
  serializeDocumentToSink,
  serializeIncrementalUpdate,
  serializeIncrementalUpdateToSink,
} from "./internal/serializer.js";
import {
  estimateSignatureSize,
} from "./internal/incremental-serialize.js";
import type { ByteSink } from "./internal/byte-sink.js";
import type {
  AttachmentOptions,
  BinaryData,
  BmpImageOptions,
  CheckBoxOptions,
  ChoiceFieldOptions,
  CustomPageSize,
  DocumentConformanceProfile,
  ExtGStateOptions,
  SoftMaskHandle,
  SoftMaskOptions,
  DocumentOutputIntentOptions,
  DocumentEncryptionOptions,
  DocumentSignatureOptions,
  DocumentInfo,
  DocumentOptions,
  EmbedTrueTypeFontOptions,
  FlowBlockSpacingOptions,
  FlowCheckBoxOptions,
  FlowChoiceFieldOptions,
  FlowFreeTextOptions,
  FlowHeadingOptions,
  FlowHighlightOptions,
  FlowImageOptions,
  FlowLinkOptions,
  FlowListOptions,
  FlowMarginShorthand,
  FlowNoteOptions,
  FlowOptions,
  FlowPushButtonOptions,
  FlowRadioGroupOptions,
  FlowSignatureFieldOptions,
  FlowSpacingScale,
  FlowTableOptions,
  FlowTextFieldOptions,
  FlowTextOptions,
  FreeTextAnnotationOptions,
  HighlightAnnotationOptions,
  JpegImageOptions,
  ListItem,
  ListOptions,
  NoteAnnotationOptions,
  OutlineOptions,
  PageLabelOptions,
  PageLinkOptions,
  PageOptions,
  PathCommand,
  PathStyle,
  PdfColor,
  PdfComplianceIssue,
  PdfContainerTag,
  PdfEmbeddedFont,
  PdfFont,
  PdfRoleMap,
  PdfStructureOptions,
  PdfStructureTag,
  PngImageOptions,
  PushButtonOptions,
  RadioGroupOptions,
  SignatureFieldOptions,
  SquigglyAnnotationOptions,
  StrikeOutAnnotationOptions,
  TableRow,
  TableOptions,
  TemplateBlock,
  TemplateDocumentOptions,
  TemplateStylesheet,
  TextBlockOptions,
  TextFieldOptions,
  TextOptions,
  Transform,
  UnderlineAnnotationOptions,
  UriLinkOptions,
  XmpMetadataInput,
} from "./types.js";

import type {
  CheckBoxAnnotation,
  ChoiceFieldAnnotation,
  InternalAttachmentModel,
  InternalNamedDestinationModel,
  InternalOutlineModel,
  InternalPageLabelModel,
  InternalPageModel,
  InternalStructureNode,
  RadioGroupAnnotation,
  TextFieldAnnotation,
} from "./internal/page-types.js";
import type { PdfOp } from "./internal/ops.js";
import { createPageModel } from "./internal/page-types.js";

function hashBytes(data: Uint8Array): string {
  const sample = data.slice(0, 64);
  let hash = data.length.toString(36);
  for (const byte of sample) {
    hash += byte.toString(36);
  }
  return hash;
}

const fontCache = new Map<string, ParsedTrueTypeFont>();

export interface PdfDocumentModel {
  /** Document information dictionary values. */
  readonly info: NormalizedDocumentInfo;
  /** XMP metadata packet or structured XMP metadata input. */
  readonly xmpMetadata?: string | undefined;
  /** Password encryption settings for serialized output. */
  readonly encryption?: NormalizedDocumentEncryption | undefined;
  /** BCP 47 language tag for document or structure content. */
  readonly language?: string | undefined;
  /** Whether to emit tagged PDF structure metadata. */
  readonly tagged: boolean;
  /** Mapping from custom structure roles to standard PDF roles. */
  readonly roleMap?: PdfRoleMap | undefined;
  /** Root structure tag to emit, or false to suppress a custom root. */
  readonly structureRoot?: PdfContainerTag | false | undefined;
  /** PDF/A or PDF/UA conformance profile to validate and emit. */
  readonly conformance?: DocumentConformanceProfile | undefined;
  /** Whether eligible streams are compressed with FlateDecode. */
  readonly compress?: boolean | undefined;
  /** Whether to emit compressed object streams and xref streams. */
  readonly objectStreams?: boolean | undefined;
  /** Whether to emit a linearization dictionary for Fast Web View style delivery. */
  readonly linearize?: boolean | undefined;
  /** ICC output intent required by color-managed profiles such as PDF/A. */
  readonly outputIntent?: DocumentOutputIntentOptions | undefined;
  /** Detached digital-signature options for serialized output. */
  readonly signature?: DocumentSignatureOptions | undefined;
  /** Custom text shaper for complex script shaping. */
  readonly textShaper?: TextShaper | undefined;
  /** Embedded fonts. */
  readonly embeddedFonts: readonly ParsedTrueTypeFont[];
  /** Named destinations. */
  readonly namedDestinations: readonly InternalNamedDestinationModel[];
  /** Page labels. */
  readonly pageLabels: readonly InternalPageLabelModel[];
  /** Attachments. */
  readonly attachments: readonly InternalAttachmentModel[];
  /** Outlines. */
  readonly outlines: readonly InternalOutlineModel[];
  /** Pages. */
  readonly pages: readonly InternalPageModel[];
  /** Luminosity soft-mask Form XObjects referenced by ExtGState entries. */
  readonly softMasks?: readonly InternalSoftMaskModel[] | undefined;
  /** Calculation order for form fields. */
  readonly calculationOrder?: string[] | undefined;
}

export interface PdfIncrementalUpdateModel {
  /** Base. */
  readonly base: ParsedPdfDocument;
  /** Appended pages. */
  readonly appendedPages: readonly InternalPageModel[];
  /** Edited pages. */
  readonly editedPages: readonly ExistingPageEdit[];
  /** Embedded fonts. */
  readonly embeddedFonts: readonly ParsedTrueTypeFont[];
  /** Page order. */
  readonly pageOrder: readonly EditablePageEntry[];
  /** Field updates. */
  readonly fieldUpdates: readonly ExistingFieldUpdate[];
  /** Flattened field object ids. */
  readonly flattenedFieldObjectIds: readonly number[];
  /** Structure role updates. */
  readonly structureRoleUpdates: ReadonlyMap<
    number,
    Exclude<PdfStructureTag, "Artifact">
  >;
  /** Structure alt text updates. */
  readonly structureAltTextUpdates: ReadonlyMap<number, string | undefined>;
  /** Structure children order updates. */
  readonly structureChildrenOrderUpdates: ReadonlyMap<
    number,
    readonly number[]
  >;
  /** Has xmp metadata update. */
  readonly hasXmpMetadataUpdate: boolean;
  /** XMP metadata packet or structured XMP metadata input. */
  readonly xmpMetadata?: string | undefined;
  /** Document information dictionary values. */
  readonly info?: NormalizedDocumentInfo | undefined;
  /** Detached digital-signature options for serialized output. */
  readonly signature?: DocumentSignatureOptions | undefined;
  /** Encryption upgrade for the next save. */
  readonly encryption?: NormalizedDocumentEncryption | undefined;
}

export interface ExistingPageEdit {
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
  /** Page. */
  readonly page: InternalPageModel;
}

/**
 * Editable structure element API for changing roles, alt text, language, and order.
 */
export type PdfEditableStructureElement = ParsedPdfEditableStructureElement;

/**
 * Query criteria for finding editable structure elements.
 */
export interface PdfEditableStructureQuery {
  /** Structure role used to tag this content. */
  readonly role?: string | undefined;
  /** Object id of the page associated with this item. */
  readonly pageObjectId?: number | undefined;
  /** Object id of the parent structure element. */
  readonly parentObjectId?: number | undefined;
  /** Whether matched structure elements must have alternate text. */
  readonly hasAltText?: boolean | undefined;
  /** Specific structure element object ids to match. */
  readonly objectIds?: readonly number[] | undefined;
}

/**
 * Options for finding structurally similar tagged elements.
 */
export interface PdfEditableStructureSimilarityOptions {
  /** Search scope used when finding related structure elements. */
  readonly scope?: "document" | "page" | "siblings" | undefined;
}

export interface ExistingTextFieldUpdate {
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
  /** Raw AcroForm field type name. */
  readonly fieldType: "Tx";
  /** Current or default value for the option. */
  readonly value: string;
}

export interface ExistingCheckBoxFieldUpdate {
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
  /** Raw AcroForm field type name. */
  readonly fieldType: "Btn";
  /** Current or default value for the option. */
  readonly value: boolean;
  /** On state name. */
  readonly onStateName?: string | undefined;
}

export interface ExistingChoiceFieldUpdate {
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
  /** Raw AcroForm field type name. */
  readonly fieldType: "Ch";
  /** Current or default value for the option. */
  readonly value: string;
}

export interface ExistingRadioFieldUpdate {
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
  /** Raw AcroForm field type name. */
  readonly fieldType: "Radio";
  /** Current or default value for the option. */
  readonly value: string;
}

export type ExistingFieldUpdate =
  | ExistingTextFieldUpdate
  | ExistingCheckBoxFieldUpdate
  | ExistingChoiceFieldUpdate
  | ExistingRadioFieldUpdate;

interface EditableExistingPageEntry {
  /** Discriminator identifying this value shape. */
  readonly kind: "existing";
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
}

interface EditableAppendedPageEntry {
  /** Discriminator identifying this value shape. */
  readonly kind: "appended";
  /** Page. */
  readonly page: InternalPageModel;
}

type EditablePageEntry = EditableExistingPageEntry | EditableAppendedPageEntry;

/**
 *
 * A builder for grouping tagged PDF content under a shared structure element. It can add text, blocks, lists, tables, images, and nested sections to the same semantic container.
 */
export class PdfStructureContainer {
  /**
   * Creates a structure container bound to a page, embedded fonts, and parent structure node.
   *
   * @param page The internal page model to write into.
   * @param embeddedFonts The embedded font registry used for text layout.
   * @param node The parent structure node for tagged content.
   */
  constructor(
    private readonly page: InternalPageModel,
    private readonly embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
    private readonly node: InternalStructureNode,
  ) {}

  /**
   * Adds tagged text to this structure container.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   */
  text(text: string, options: TextOptions): void {
    addTextToPage(this.page, this.embeddedFonts, text, options, this.node, "P");
  }

  /**
   * Adds a tagged multiline text block to this structure container.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   */
  textBlock(text: string, options: TextBlockOptions): void {
    addTextBlockToPage(
      this.page,
      this.embeddedFonts,
      text,
      options,
      this.node,
      "P",
    );
  }

  /**
   * Adds a tagged list to this structure container.
   *
   * @param items The list items to add.
   * @param options Options that control the operation.
   */
  list(items: readonly ListItem[], options: ListOptions): void {
    const normalizedItems = normalizeListItems(items);
    const normalizedOptions = normalizeListOptions(normalizedItems, options);
    const listNode = createStructureNode(this.page, "L", undefined, this.node);
    layoutList(
      this.page,
      listNode,
      normalizedItems,
      normalizedOptions,
      this.embeddedFonts,
    );
  }

  /**
   * Adds a tagged table to this structure container.
   *
   * @param rows The table rows to add.
   * @param options Options that control the operation.
   */
  table(rows: readonly TableRow[], options: TableOptions): void {
    const normalizedRows = normalizeTableRows(rows);
    const normalizedOptions = normalizeTableOptions(normalizedRows, options);
    layoutTable(
      this.page,
      createStructureNode(
        this.page,
        "Table",
        normalizedOptions.structure,
        this.node,
      ),
      normalizedRows,
      normalizedOptions,
      this.embeddedFonts,
    );
  }

  /**
   * Adds a tagged JPEG image to this structure container.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  jpeg(data: BinaryData, options: JpegImageOptions): void {
    addImageToPage(this.page, "jpeg", data, options, this.node, "Figure");
  }

  /**
   * Adds a tagged PNG image to this structure container.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  png(data: BinaryData, options: PngImageOptions): void {
    addImageToPage(this.page, "png", data, options, this.node, "Figure");
  }

  /**
   * Adds a tagged BMP image to this structure container.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  bmp(data: BinaryData, options: BmpImageOptions): void {
    addImageToPage(this.page, "bmp", data, options, this.node, "Figure");
  }

  /**
   * Adds a tagged JBIG2 image to this structure container.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  jbig2(data: BinaryData, options: import("./types.js").Jbig2ImageOptions): void {
    addImageToPage(this.page, "jbig2", data, options, this.node, "Figure");
  }

  /**
   * Adds a tagged TIFF image to this structure container.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  tiff(data: BinaryData, options: import("./types.js").TiffImageOptions): void {
    addImageToPage(this.page, "tiff", data, options, this.node, "Figure");
  }

  /**
   * Adds a tagged JPEG 2000 image to this structure container.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  jp2(data: BinaryData, options: import("./types.js").Jp2ImageOptions): void {
    addImageToPage(this.page, "jp2", data, options, this.node, "Figure");
  }

  /**
   * Adds a tagged WebP image to this structure container.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  webp(data: BinaryData, options: import("./types.js").WebpImageOptions): void {
    addImageToPage(this.page, "webp", data, options, this.node, "Figure");
  }

  /**
   * Adds a tagged GIF image to this structure container.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  gif(data: BinaryData, options: import("./types.js").GifImageOptions): void {
    addImageToPage(this.page, "gif", data, options, this.node, "Figure");
  }

  /**
   * Adds a tagged SVG graphic to this structure container.
   *
   * @param data The SVG text data.
   * @param options Options that control the operation.
   */
  svg(data: BinaryData | string, options: import("./types.js").SvgImageOptions): void {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    addImageToPage(this.page, "svg", bytes, options, this.node, "Figure");
  }

  /**
   * Adds a tagged URI link annotation to this structure container.
   *
   * @param url The URI target.
   * @param options Options that control the operation.
   */
  link(url: string, options: UriLinkOptions): void {
    addLinkToPage(this.page, url, options, this.node);
  }

  /**
   * Creates a nested tagged structure container.
   *
   * @param tag The structure tag to create.
   * @param build An optional callback that receives the created container.
   *
   * @returns The created structure container.
   */
  container(
    tag: PdfContainerTag,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  /**
   * Creates a nested tagged structure container.
   *
   * @param tag The structure tag to create.
   * @param options Options that control the operation.
   * @param build An optional callback that receives the created container.
   *
   * @returns The created structure container.
   */
  container(
    tag: PdfContainerTag,
    options?: PdfStructureOptions,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  /**
   * Creates a nested tagged structure container.
   *
   * @param tag The structure tag to create.
   * @param optionsOrBuild Either structure options or a build callback.
   * @param maybeBuild An optional build callback when options are provided separately.
   *
   * @returns The created structure container.
   */
  container(
    tag: PdfContainerTag,
    optionsOrBuild?:
      | PdfStructureOptions
      | ((container: PdfStructureContainer) => void),
    maybeBuild?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer {
    const options =
      typeof optionsOrBuild === "function" ? undefined : optionsOrBuild;
    const build =
      typeof optionsOrBuild === "function" ? optionsOrBuild : maybeBuild;
    const child = new PdfStructureContainer(
      this.page,
      this.embeddedFonts,
      createStructureNode(
        this.page,
        normalizeContainerStructureTag(tag),
        normalizeStructureOptions(options),
        this.node,
      ),
    );
    if (build) {
      build(child);
    }
    return child;
  }

  /**
   * Creates a nested tagged structure container.
   *
   * @param role The replacement structure role.
   * @param build An optional callback that receives the created container.
   *
   * @returns The created structure container.
   */
  structure(
    role: Exclude<PdfStructureTag, "Artifact">,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  /**
   * Creates a nested tagged structure container.
   *
   * @param role The replacement structure role.
   * @param options Options that control the operation.
   * @param build An optional callback that receives the created container.
   *
   * @returns The created structure container.
   */
  structure(
    role: Exclude<PdfStructureTag, "Artifact">,
    options?: PdfStructureOptions,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  /**
   * Creates a nested tagged structure container.
   *
   * @param role The replacement structure role.
   * @param optionsOrBuild Either structure options or a build callback.
   * @param maybeBuild An optional build callback when options are provided separately.
   *
   * @returns The created structure container.
   */
  structure(
    role: Exclude<PdfStructureTag, "Artifact">,
    optionsOrBuild?:
      | PdfStructureOptions
      | ((container: PdfStructureContainer) => void),
    maybeBuild?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer {
    const options =
      typeof optionsOrBuild === "function" ? undefined : optionsOrBuild;
    const build =
      typeof optionsOrBuild === "function" ? optionsOrBuild : maybeBuild;
    const child = new PdfStructureContainer(
      this.page,
      this.embeddedFonts,
      createStructureNode(
        this.page,
        normalizeStructureRole(role),
        normalizeStructureOptions(options),
        this.node,
      ),
    );
    if (build) {
      build(child);
    }
    return child;
  }

  /**
   * Creates a flow helper that writes into this structure container.
   *
   * @param options Options that control the operation.
   *
   * @returns The created flow helper.
   */
  flow(options: FlowOptions = {}): PdfFlow {
    return new PdfFlow(
      this.page,
      this.embeddedFonts,
      createFlowState(this.page, options),
      this.node,
    );
  }
}

interface FlowState {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Start y. */
  startY: number;
  /** Width in PDF points. */
  width: number;
  /** Horizontal position of the full flow frame. */
  frameX: number;
  /** Number of flow columns. */
  columnCount: number;
  /** Gap between flow columns. */
  columnGap: number;
  /** Zero-based active flow column. */
  columnIndex: number;
  /** Default vertical gap between flow blocks in PDF points. */
  gap: number;
  /** Bottom margin in PDF points. */
  marginBottom: number;
  /** Semantic spacing scale used by flow layout. */
  spacing: RequiredFlowSpacingScale;
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Text direction used for shaping and layout. */
  direction?: FlowOptions["direction"] | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Line height in PDF points. */
  lineHeight?: number | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: FlowOptions["align"] | undefined;
  /** Whether kerning should be applied where supported. */
  kerning?: boolean | undefined;
  /** Text writing mode. */
  writingMode?: "horizontal" | "vertical" | undefined;
}

type HeadingLevelKey = 1 | 2 | 3 | 4 | 5 | 6;
type FlowBlockKind = "paragraph" | "heading" | "table" | "image" | "link";

function computeBlockX(
  baseX: number,
  marginLeft: number,
  innerWidth: number,
  blockWidth: number,
  align: "left" | "center" | "right",
): number {
  const startX = baseX + marginLeft;
  if (align === "center") return startX + (innerWidth - blockWidth) / 2;
  if (align === "right") return startX + (innerWidth - blockWidth);
  return startX;
}

function groupPositionedRunsByLine(
  runs: readonly import("./internal/text-layout.js").PositionedTextRun[],
): import("./internal/text-layout.js").PositionedTextRun[][] {
  const lines: import("./internal/text-layout.js").PositionedTextRun[][] = [];
  for (const run of runs) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0]!.options.y - run.options.y) < 0.001) {
      last.push(run);
    } else {
      lines.push([run]);
    }
  }
  return lines;
}

function resolveConformancePart(
  conformance: DocumentConformanceProfile,
): string | undefined {
  switch (conformance) {
    case "pdfa-1b":
    case "pdfua-1":
      return "1";
    case "pdfa-2b":
    case "pdfua-2":
      return "2";
    case "pdfa-3b":
      return "3";
    case "pdfa-4":
      return "4";
    default:
      return undefined;
  }
}

function computeAlignedX(
  baseX: number,
  innerWidth: number,
  contentWidth: number,
  align: "left" | "center" | "right" | "justify",
): number {
  if (align === "center") return baseX + Math.max((innerWidth - contentWidth) / 2, 0);
  if (align === "right") return baseX + Math.max(innerWidth - contentWidth, 0);
  return baseX;
}

function resolveDefaultSpacingBefore(
  kind: FlowBlockKind,
  level: HeadingLevelKey,
  defaults: RequiredFlowSpacingScale,
): number {
  switch (kind) {
    case "heading":
      return defaults.headingBefore[level];
    case "table":
      return defaults.tableBefore;
    case "image":
      return defaults.imageBefore;
    case "link":
      return defaults.linkBefore;
    case "paragraph":
      return defaults.paragraphBefore;
  }
}

function resolveDefaultSpacingAfter(
  kind: FlowBlockKind,
  level: HeadingLevelKey,
  defaults: RequiredFlowSpacingScale,
): number {
  switch (kind) {
    case "heading":
      return defaults.headingAfter[level];
    case "table":
      return defaults.tableAfter;
    case "image":
      return defaults.imageAfter;
    case "link":
      return defaults.linkAfter;
    case "paragraph":
      return defaults.paragraphAfter;
  }
}

function assertNeverBlock(block: never): never {
  throw new PdfEngineError(
    PdfErrorCode.INTERNAL_ERROR,
    `Unhandled template block: ${JSON.stringify(block)}`,
  );
}

function normalizeTextMarkupOptions(
  subtype: "highlight" | "underline" | "strikeOut" | "squiggly",
  options: HighlightAnnotationOptions,
): NormalizedHighlightAnnotationOptions {
  switch (subtype) {
    case "highlight":
      return normalizeHighlightAnnotationOptions(options);
    case "underline":
      return normalizeUnderlineAnnotationOptions(options);
    case "strikeOut":
      return normalizeStrikeOutAnnotationOptions(options);
    case "squiggly":
      return normalizeSquigglyAnnotationOptions(options);
  }
}

interface RequiredFlowSpacingScale {
  /** Default spacing before paragraph blocks. */
  paragraphBefore: number;
  /** Default spacing after paragraph blocks. */
  paragraphAfter: number;
  /** Default spacing before heading blocks. */
  headingBefore: Record<HeadingLevelKey, number>;
  /** Default spacing after heading blocks. */
  headingAfter: Record<HeadingLevelKey, number>;
  /** Default spacing before table blocks. */
  tableBefore: number;
  /** Default spacing after table blocks. */
  tableAfter: number;
  /** Default spacing before image blocks. */
  imageBefore: number;
  /** Default spacing after image blocks. */
  imageAfter: number;
  /** Default spacing before link blocks. */
  linkBefore: number;
  /** Default spacing after link blocks. */
  linkAfter: number;
}

interface ResolvedBlockSpacing {
  /** Before. */
  before: number;
  /** After. */
  after: number;
  /** Left. */
  left: number;
  /** Right. */
  right: number;
}

interface FlowMarginOptions {
  /** CSS-like margin shorthand in PDF points. */
  margin?: FlowMarginShorthand | undefined;
  /** Top margin in PDF points. */
  marginTop?: number | undefined;
  /** Right margin in PDF points. */
  marginRight?: number | undefined;
  /** Bottom margin in PDF points. */
  marginBottom?: number | undefined;
  /** Left margin in PDF points. */
  marginLeft?: number | undefined;
}

function defaultFlowMargin(size: {
  /** Width in PDF points. */
  width: number; /** Height in PDF points. */
  height: number;
}): number {
  const presets: Array<[number, number, number]> = [
    [595.28, 841.89, 72],
    [612, 792, 72],
    [612, 1008, 72],
  ];
  for (const [w, h, m] of presets) {
    if (Math.abs(size.width - w) < 0.5 && Math.abs(size.height - h) < 0.5) {
      return m;
    }
  }
  const shorter = Math.min(size.width, size.height);
  return Math.max(24, Math.min(72, Math.round(shorter * 0.1)));
}

function resolveMarginShorthand(margin: FlowMarginShorthand | undefined): {
  /** Top. */
  top: number; /** Right. */
  right: number; /** Bottom. */
  bottom: number; /** Left. */
  left: number;
} {
  if (margin === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof margin === "number") {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }
  if (margin.length === 2) {
    const [vertical, horizontal] = margin;
    return {
      top: vertical,
      right: horizontal,
      bottom: vertical,
      left: horizontal,
    };
  }
  const [top, right, bottom, left] = margin;
  return { top, right, bottom, left };
}

const STANDARD_FLOW_SPACING: RequiredFlowSpacingScale = {
  paragraphBefore: 0,
  paragraphAfter: 8,
  headingBefore: {
    1: 0,
    2: 18,
    3: 14,
    4: 10,
    5: 8,
    6: 8,
  },
  headingAfter: {
    1: 14,
    2: 10,
    3: 8,
    4: 6,
    5: 4,
    6: 4,
  },
  tableBefore: 6,
  tableAfter: 14,
  imageBefore: 4,
  imageAfter: 12,
  linkBefore: 0,
  linkAfter: 8,
};

/**
 *
 * A cursor-based layout helper for writing report-style content. It manages vertical flow, spacing, page breaks, headings, paragraphs, links, images, and tables.
 */
export class PdfFlow {
  /**
   * Creates a cursor-based flow writer for a page and optional parent structure node.
   *
   * @param page The internal page model to write into.
   * @param embeddedFonts The embedded font registry used for text layout.
   * @param state The mutable flow state to use.
   * @param parent The parent structure element whose child order should change.
   */
  constructor(
    private page: InternalPageModel,
    private readonly embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
    private state: FlowState,
    private parent: InternalStructureNode | undefined = undefined,
    private overflowHandler: (() => PdfFlow) | undefined = undefined,
  ) {}

  /**
   * Gets the current vertical cursor position.
   *
   * @returns The current cursor y-coordinate.
   */
  get cursorY(): number {
    return this.state.y;
  }

  /**
   * Gets the remaining writable height above the bottom margin.
   *
   * @returns The remaining writable height.
   */
  get remainingHeight(): number {
    return Math.max(this.state.y - this.state.marginBottom, 0);
  }

  /**
   * Gets the zero-based active column index.
   *
   * @returns The current flow column index.
   */
  get columnIndex(): number {
    return this.state.columnIndex;
  }

  /**
   * Gets the total number of flow columns.
   *
   * @returns The flow column count.
   */
  get columnCount(): number {
    return this.state.columnCount;
  }

  /**
   * Advances the flow cursor to the top of the next column on the same page.
   *
   * @returns Whether a next column was available.
   */
  advanceColumn(): boolean {
    if (this.state.columnIndex + 1 >= this.state.columnCount) {
      return false;
    }
    this.state.columnIndex += 1;
    this.state.x =
      this.state.frameX +
      this.state.columnIndex * (this.state.width + this.state.columnGap);
    this.state.y = this.state.startY;
    return true;
  }

  /**
   * Registers a callback used by template rendering when flow content
   * exhausts the last column and needs a fresh page.
   *
   * @param handler Callback that returns the next flow region.
   *
   * @returns This flow helper for chaining.
   */
  setOverflowHandler(handler: (() => PdfFlow) | undefined): this {
    this.overflowHandler = handler;
    return this;
  }

  /**
   * Adds a heading at the current flow cursor.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  heading(
    text: string,
    options: FlowHeadingOptions = {},
    annotations?: readonly import("./types.js").ParagraphTextAnnotation[],
  ): this {
    const level = options.level ?? 1;
    const tag = options.tag ?? `H${level}` as const;
    const fontSize = options.fontSize ?? headingFontSize(level);
    const spacing = this.resolveSpacing("heading", options, level);
    this.applyMarginTop(spacing.before);
    const { height: consumedHeight, runs } = this.writeTextBlock(
      text,
      {
        ...options,
        fontSize,
        lineHeight: options.lineHeight ?? Math.round(fontSize * 1.25),
        tag,
      },
      spacing.left,
      spacing.right,
    );
    if (annotations && annotations.length > 0) {
      this.applyParagraphAnnotations(runs, annotations);
    }
    this.state.y -= consumedHeight + spacing.after;
    return this;
  }

  /**
   * Renders a sequence of template blocks into the flow.
   *
   * @param blocks The template blocks to render.
   * @param stylesheet Optional named styles merged beneath each block's inline options.
   *
   * @returns This flow helper for chaining.
   */
  render(blocks: readonly TemplateBlock[], stylesheet?: TemplateStylesheet): this {
    renderTemplateBlocksToFlow(this, blocks, stylesheet);
    return this;
  }

  /**
   * Estimates the height a template block would consume.
   *
   * @param block The template block to estimate.
   *
   * @returns The estimated height.
   */
  estimate(block: TemplateBlock): number {
    switch (block.type) {
      case "heading": {
        const options = block.options;
        const level = options?.level ?? 1;
        const fontSize = options?.fontSize ?? headingFontSize(level);
        const spacing = this.resolveSpacing("heading", options ?? {}, level);
        return this.estimateTextBlockHeight(block.text, {
          ...options,
          fontSize,
          lineHeight: options?.lineHeight ?? Math.round(fontSize * 1.25),
          tag: options?.tag ?? (`H${level}` as const),
          marginTop: spacing.before,
          marginBottom: spacing.after,
        });
      }
      case "paragraph":
        return this.estimateTextBlockHeight(
          block.text,
          block.options,
        );
      case "table":
        return this.estimateTableHeight(block.rows, block.options);
      case "png":
        return this.estimateImageHeight("png", block.data, block.options);
      case "bmp":
        return this.estimateImageHeight("bmp", block.data, block.options);
      case "jpeg":
        return this.estimateImageHeight("jpeg", block.data, block.options);
      case "jbig2":
        return this.estimateImageHeight("jbig2", block.data, block.options);
      case "tiff":
        return this.estimateImageHeight("tiff", block.data, block.options);
      case "jp2":
        return this.estimateImageHeight("jp2", block.data, block.options);
      case "webp":
        return this.estimateImageHeight("webp", block.data, block.options);
      case "gif":
        return this.estimateImageHeight("gif", block.data, block.options);
      case "svg":
        return this.estimateSvgHeight(block.options);
      case "link":
        return this.estimateLinkHeight(block.options);
      case "section":
        return block.blocks.reduce(
          (sum, child) => sum + this.estimate(child),
          0,
        );
      case "pageBreak":
        return 0;
      case "textField":
      case "checkBox":
      case "choiceField":
      case "pushButton":
      case "signatureField":
        return (block.options?.height ?? 20) + this.state.gap;
      case "radioGroup":
        return 20 + this.state.gap;
      case "highlight":
      case "freeText":
        return block.options.height + this.state.gap;
      case "note":
        return (block.options.height ?? 20) + this.state.gap;
      case "pageLink":
        return block.options.height + this.state.gap;
      case "path":
        return block.height + this.state.gap;
      case "rect":
        return block.height + this.state.gap;
      case "list":
        return this.estimateListHeight(block.items, block.options ?? { width: this.state.width });
      case "custom":
        return block.estimate(this);
      default:
        assertNeverBlock(block);
    }
  }

  /**
   * Adds a paragraph at the current flow cursor.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  paragraph(
    text: string,
    options: FlowTextOptions = {},
    annotations?: readonly import("./types.js").ParagraphTextAnnotation[],
  ): this {
    this.textBlock(text, { ...options, tag: options.tag ?? "P" }, annotations);
    return this;
  }

  /**
   * Adds a text block at the current flow cursor.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   * @param annotations Optional inline annotations anchored to substrings of the rendered text.
   *
   * @returns This flow helper for chaining.
   */
  textBlock(
    text: string,
    options: FlowTextOptions = {},
    annotations?: readonly import("./types.js").ParagraphTextAnnotation[],
  ): this {
    const spacing = this.resolveSpacing("paragraph", options);
    this.applyMarginTop(spacing.before);
    const { height: consumedHeight, runs } = this.writeTextBlock(
      text,
      options,
      spacing.left,
      spacing.right,
    );
    if (annotations && annotations.length > 0) {
      this.applyParagraphAnnotations(runs, annotations);
    }
    this.state.y -= consumedHeight + spacing.after;
    return this;
  }

  /**
   * Adds a PNG image at the current flow cursor.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  png(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image("png", data, options);
  }

  /**
   * Adds a JPEG image at the current flow cursor.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  jpeg(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image("jpeg", data, options);
  }

  /**
   * Adds a BMP image at the current flow cursor.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  bmp(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image("bmp", data, options);
  }

  /**
   * Adds a JBIG2 image at the current flow cursor.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  jbig2(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image("jbig2", data, options);
  }

  /**
   * Adds a TIFF image at the current flow cursor.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  tiff(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image("tiff", data, options);
  }

  /**
   * Adds a JPEG 2000 image at the current flow cursor.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  jp2(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image("jp2", data, options);
  }

  /**
   * Adds a WebP image at the current flow cursor.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  webp(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image("webp", data, options);
  }

  /**
   * Adds a GIF image at the current flow cursor.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  gif(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image("gif", data, options);
  }

  /**
   * Adds an SVG graphic at the current flow cursor.
   *
   * @param data The SVG text data.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  svg(data: BinaryData | string, options: FlowImageOptions = {}): this {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    return this.image("svg", bytes, options);
  }

  /**
   * Adds a text link at the current flow cursor.
   *
   * @param text The text to add.
   * @param url The URI target.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  link(text: string, url: string, options: FlowLinkOptions = {}): this {
    this.advanceColumnIfNeeded(this.estimateLinkHeight(options));
    const spacing = this.resolveSpacing("link", options);
    this.applyMarginTop(spacing.before);
    const font = options.font ?? this.state.font ?? "Helvetica";
    const fallbackFonts =
      options.fallbackFonts ?? this.state.fallbackFonts ?? [];
    const direction = options.direction ?? this.state.direction ?? "ltr";
    const fontSize = options.fontSize ?? this.state.fontSize ?? 12;
    const lineHeight =
      options.lineHeight ??
      this.state.lineHeight ??
      Math.round(fontSize * 1.35);
    const color = options.color ??
      this.state.color ?? { kind: "rgb", r: 0, g: 0, b: 1 };
    const kerning = options.kerning ?? this.state.kerning ?? true;
    const textWidth = Math.max(
      measureTextWidth(
        text,
        { font, fallbackFonts, direction, fontSize, kerning },
        this.embeddedFonts,
      ),
      1,
    );
    const align = options.align ?? "left";
    const innerWidth = Math.max(
      this.state.width - spacing.left - spacing.right,
      1,
    );
    const baseX = this.state.x + spacing.left;
    const linkX = computeAlignedX(baseX, innerWidth, textWidth, align);
    const linkNode = createStructureNode(
      this.page,
      "Link",
      normalizeStructureOptions(options.structure),
      ensureBlockLevelParent(this.page, this.parent),
    );
    addTextToPage(
      this.page,
      this.embeddedFonts,
      text,
      {
        x: linkX,
        y: this.state.y,
        font,
        fallbackFonts,
        direction,
        fontSize,
        color,
        kerning,
        tag: "Span",
      },
      linkNode,
    );
    addLinkToPage(
      this.page,
      url,
      {
        x: linkX,
        y: this.state.y - lineHeight + Math.max((lineHeight - fontSize) / 2, 0),
        width: textWidth,
        height: lineHeight,
        borderWidth: options.borderWidth,
        tag: options.tag ?? "Link",
        structure: options.structure,
      },
      linkNode,
    );
    this.state.y -= lineHeight + spacing.after;
    return this;
  }

  /**
   * Reserves a rectangular region at the current flow cursor and returns its
   * coordinates without emitting any content. Spacing is applied with the
   * `link` defaults so this mirrors {@link link}/{@link pageLink} layout. The
   * cursor advances by the rect height plus trailing spacing.
   *
   * Used by the template engine to defer page-to-page link emission until
   * after every page exists.
   *
   * @param options Options that control the operation.
   *
   * @returns The reserved rect in PDF coordinates.
   */
  reservePageLinkRect(
    options: Omit<PageLinkOptions, "x" | "y"> & FlowBlockSpacingOptions,
  ): { x: number; y: number; width: number; height: number } {
    const spacing = this.resolveSpacing("link", options);
    this.advanceColumnIfNeeded(spacing.before + options.height + spacing.after);
    this.applyMarginTop(spacing.before);
    const innerWidth = Math.max(this.state.width - spacing.left - spacing.right, 1);
    const width = Math.min(options.width, innerWidth);
    const height = options.height;
    const x = this.state.x + spacing.left;
    const y = this.state.y - height;
    this.state.y -= height + spacing.after;
    return { x, y, width, height };
  }

  /**
   * Adds a table at the current flow cursor.
   *
   * @param rows The table rows to add.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  table(rows: readonly TableRow[], options: FlowTableOptions = {}): this {
    this.advanceColumnIfNeeded(this.estimateTableHeight(rows, options));
    const spacing = this.resolveSpacing("table", options);
    this.applyMarginTop(spacing.before);
    const normalizedRows = normalizeTableRows(rows);
    const innerWidth = Math.max(
      this.state.width - spacing.left - spacing.right,
      1,
    );
    const width = options.width ?? innerWidth;
    const normalizedOptions = normalizeTableOptions(normalizedRows, {
      ...flowTextDefaults(this.state),
      ...options,
      x: this.state.x + spacing.left,
      y: this.state.y,
      width,
    });
    const nextY = layoutTable(
      this.page,
      createStructureNode(
        this.page,
        "Table",
        normalizedOptions.structure,
        this.parent,
      ),
      normalizedRows,
      normalizedOptions,
      this.embeddedFonts,
    );
    this.state.y = nextY - spacing.after;
    return this;
  }

  /**
   * Moves the flow cursor downward by the supplied distance.
   *
   * @param distance The distance to move the cursor.
   *
   * @returns This flow helper for chaining.
   */
  moveDown(distance: number = this.state.gap): this {
    if (distance < 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_NUMBER,
        "moveDown distance must be non-negative.",
        { distance },
      );
    }
    this.state.y -= distance;
    return this;
  }

  /**
   * Adds an image of the provided format at the current flow cursor.
   *
   * @param format The image format to add.
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns The result of the operation.
   */
  private image(
    format: "jpeg" | "png" | "bmp" | "jbig2" | "tiff" | "jp2" | "webp" | "gif" | "svg",
    data: BinaryData,
    options: FlowImageOptions,
  ): this {
    const estimatedHeight =
      format === "svg"
        ? this.estimateSvgHeight(options)
        : this.estimateImageHeight(format, data, options);
    this.advanceColumnIfNeeded(estimatedHeight);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);

    if (format === "svg") {
      const innerWidth = Math.max(
        this.state.width - spacing.left - spacing.right,
        1,
      );
      const maxWidth = options.maxWidth ?? innerWidth;
      const width = options.width ?? maxWidth;
      const height = options.height ?? width;
      const align = options.align ?? "left";
      const baseX = this.state.x + spacing.left;
      const x = computeAlignedX(baseX, innerWidth, width, align);
      addImageToPage(
        this.page,
        format,
        data,
        { ...options, x, y: this.state.y - height, width, height },
        this.parent,
        "Figure",
      );
      this.state.y -= height + spacing.after;
      return this;
    }

    const image = parseImage(format, data);
    const innerWidth = Math.max(
      this.state.width - spacing.left - spacing.right,
      1,
    );
    const maxWidth = options.maxWidth ?? innerWidth;
    const width = options.width ?? Math.min(image.pixelWidth, maxWidth);
    const height =
      options.height ?? width * (image.pixelHeight / image.pixelWidth);
    const align = options.align ?? "left";
    const baseX = this.state.x + spacing.left;
    const x = computeAlignedX(baseX, innerWidth, width, align);
    addImageToPage(
      this.page,
      format,
      data,
      {
        ...options,
        x,
        y: this.state.y - height,
        width,
        height,
      },
      this.parent,
      "Figure",
    );
    this.state.y -= height + spacing.after;
    return this;
  }

  /**
   * Estimates the height of a flow text block.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   *
   * @returns The estimated text block height.
   */
  private estimateTextBlockHeight(
    text: string,
    options: FlowTextOptions = {},
  ): number {
    const spacing = this.resolveSpacing("paragraph", options);
    const innerWidth = Math.max(this.state.width - spacing.left - spacing.right, 1);
    const blockWidth = Math.min(options.blockWidth ?? innerWidth, innerWidth);
    const normalized = normalizeTextBlockOptions(text, {
      ...flowTextDefaults(this.state),
      ...options,
      x: this.state.x,
      y: this.state.y,
      width: blockWidth,
    });
    const runs = layoutTextBlock(text, normalized, this.embeddedFonts);
    const lineCount = new Set(runs.map((run) => run.options.y)).size || 1;
    return spacing.before + lineCount * normalized.lineHeight + spacing.after;
  }

  /**
   * Estimates the height of a flow table.
   *
   * @param rows The table rows to add.
   * @param options Options that control the operation.
   *
   * @returns The estimated table height.
   */
  private estimateTableHeight(
    rows: readonly TableRow[],
    options: FlowTableOptions = {},
  ): number {
    const spacing = this.resolveSpacing("table", options);
    const perRow = this.computeTableRowHeights(rows, options);
    return spacing.before + perRow.reduce((sum, h) => sum + h, 0) + spacing.after;
  }

  /**
   * Returns the rendered height of each row in a table at the current flow position.
   * Heights include cell padding and the trailing `rowGap`. Use this to pre-plan
   * row-by-row page splits when rendering large tables.
   *
   * @param rows The table rows to measure.
   * @param options Options that control the operation.
   *
   * @returns Per-row heights including padding and trailing rowGap.
   */
  estimateTableRowHeights(
    rows: readonly TableRow[],
    options: FlowTableOptions = {},
  ): readonly number[] {
    return this.computeTableRowHeights(rows, options);
  }

  private computeTableRowHeights(
    rows: readonly TableRow[],
    options: FlowTableOptions = {},
  ): number[] {
    const spacing = this.resolveSpacing("table", options);
    const normalizedRows = normalizeTableRows(rows);
    const innerWidth = Math.max(this.state.width - spacing.left - spacing.right, 1);
    const width = options.width ?? innerWidth;
    const normalizedOptions = normalizeTableOptions(normalizedRows, {
      ...flowTextDefaults(this.state),
      ...options,
      x: this.state.x,
      y: this.state.y,
      width,
    });
    const rowSpanOccupancy = new Map<number, number>();
    const heights: number[] = [];

    for (const row of normalizedRows) {
      const cellHeights: number[] = [];
      let columnIndex = 0;

      for (const cell of row) {
        while ((rowSpanOccupancy.get(columnIndex) ?? 0) > 0) {
          columnIndex += 1;
        }

        const startColumn = columnIndex;
        const endColumn = Math.min(
          startColumn + cell.colSpan,
          normalizedOptions.columnWidths.length,
        );
        const cellWidth = sumNumbers(
          normalizedOptions.columnWidths.slice(startColumn, endColumn),
        );
        const textWidth = Math.max(
          1,
          cellWidth - normalizedOptions.cellPadding * 2,
        );
        const runs = layoutTextBlock(
          cell.text,
          {
            ...normalizedOptions,
            x: this.state.x + normalizedOptions.cellPadding,
            y: this.state.y - normalizedOptions.cellPadding,
            width: textWidth,
            tag: "P",
          },
          this.embeddedFonts,
        );
        cellHeights.push(
          measurePositionedRunHeight(runs, normalizedOptions.lineHeight) +
            normalizedOptions.cellPadding * 2,
        );

        if (cell.rowSpan > 1) {
          for (
            let occupiedColumn = startColumn;
            occupiedColumn < endColumn;
            occupiedColumn += 1
          ) {
            rowSpanOccupancy.set(
              occupiedColumn,
              Math.max(
                rowSpanOccupancy.get(occupiedColumn) ?? 0,
                cell.rowSpan - 1,
              ),
            );
          }
        }
        columnIndex = endColumn;
      }

      heights.push(
        Math.max(
          normalizedOptions.lineHeight + normalizedOptions.cellPadding * 2,
          ...cellHeights,
        ) + normalizedOptions.rowGap,
      );
      decrementRowSpanOccupancy(rowSpanOccupancy);
    }

    return heights;
  }

  /**
   * Estimates the height of a flow image.
   *
   * @param format The image format to add.
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns The estimated image height.
   */
  private estimateImageHeight(
    format: "jpeg" | "png" | "bmp" | "jbig2" | "tiff" | "jp2" | "webp" | "gif",
    data: BinaryData,
    options: FlowImageOptions = {},
  ): number {
    const spacing = this.resolveSpacing("image", options);
    const image = parseImage(format, data);
    const innerWidth = Math.max(this.state.width - spacing.left - spacing.right, 1);
    const maxWidth = options.maxWidth ?? innerWidth;
    const safePixelWidth = image.pixelWidth > 0 ? image.pixelWidth : 1;
    const width = options.width ?? Math.min(image.pixelWidth, maxWidth);
    const height =
      options.height ?? width * (image.pixelHeight / safePixelWidth);
    return spacing.before + height + spacing.after;
  }

  private estimateSvgHeight(options: FlowImageOptions = {}): number {
    const spacing = this.resolveSpacing("image", options);
    const innerWidth = Math.max(this.state.width - spacing.left - spacing.right, 1);
    const maxWidth = options.maxWidth ?? innerWidth;
    const width = options.width ?? maxWidth;
    const height = options.height ?? width;
    return spacing.before + height + spacing.after;
  }

  /**
   * Estimates the height of a flow link.
   *
   * @param options Options that control the operation.
   *
   * @returns The estimated link height.
   */
  private estimateLinkHeight(options: FlowLinkOptions = {}): number {
    const spacing = this.resolveSpacing("link", options);
    const fontSize = options.fontSize ?? this.state.fontSize ?? 12;
    const lineHeight =
      options.lineHeight ??
      this.state.lineHeight ??
      Math.round(fontSize * 1.35);
    return spacing.before + lineHeight + spacing.after;
  }

  /**
   * Estimates the height of a flow list.
   *
   * @param items The list items to add.
   * @param options Options that control the operation.
   *
   * @returns The estimated list height.
   */
  private estimateListHeight(
    items: readonly ListItem[],
    options: Omit<ListOptions, "x" | "y">,
  ): number {
    const normalizedItems = normalizeListItems(items);
    const normalizedOptions = normalizeListOptions(normalizedItems, {
      ...flowTextDefaults(this.state),
      x: this.state.x,
      y: this.state.y,
      ...options,
    });
    const itemSpacing = normalizedOptions.itemSpacing ?? 2;
    let height = 0;
    for (const item of normalizedItems) {
      const text = typeof item === "string" ? item : (item.body ?? item.label ?? "");
      const runs = layoutTextBlock(
        text,
        {
          ...normalizedOptions,
          x: this.state.x,
          y: this.state.y,
          tag: "LI",
        },
        this.embeddedFonts,
      );
      height += measurePositionedRunHeight(runs, normalizedOptions.lineHeight) + itemSpacing;
    }
    return height;
  }

  /**
   * Writes a flow text block with optional horizontal margins.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   * @param marginLeft The left margin to apply.
   * @param marginRight The right margin to apply.
   *
   * @returns The result of the operation.
   */
  private writeTextBlock(
    text: string,
    options: FlowTextOptions = {},
    marginLeft = 0,
    marginRight = 0,
  ): { height: number; runs: readonly import("./internal/text-layout.js").PositionedTextRun[] } {
    const innerWidth = Math.max(this.state.width - marginLeft - marginRight, 1);
    const blockWidth = Math.min(options.blockWidth ?? innerWidth, innerWidth);
    const blockAlign = options.blockAlign ?? "left";
    const blockX = computeBlockX(this.state.x, marginLeft, innerWidth, blockWidth, blockAlign);
    if (this.state.columnCount > 1 && options.writingMode !== "vertical") {
      validateText(text);
      const normalized = normalizeTextBlockOptions(text, {
        ...flowTextDefaults(this.state),
        ...options,
        x: blockX,
        y: this.state.y,
        width: blockWidth,
      });
      const createTextStructureNode = (): InternalStructureNode | undefined =>
        normalized.tag === undefined || normalized.tag === "Artifact"
          ? undefined
          : createStructureNode(this.page, normalized.tag, normalized.structure, this.parent);
      let structureNode = createTextStructureNode();
      const laidOutRuns = layoutTextBlock(text, normalized, this.embeddedFonts);
      const lines = groupPositionedRunsByLine(laidOutRuns);
      let placedRuns: import("./internal/text-layout.js").PositionedTextRun[] = [];

      for (const line of lines) {
        if (this.remainingHeight < normalized.lineHeight && this.state.y < this.state.startY) {
          if (!this.advanceColumn()) {
            pushPositionedTextRuns(this.page, placedRuns, structureNode?.id);
            placedRuns = [];
            if (this.advanceFlowRegion()) {
              structureNode = createTextStructureNode();
            }
          }
        }
        const currentInnerWidth = Math.max(this.state.width - marginLeft - marginRight, 1);
        const currentBlockX = computeBlockX(
          this.state.x,
          marginLeft,
          currentInnerWidth,
          blockWidth,
          blockAlign,
        );
        const deltaX = currentBlockX - blockX;
        for (const run of line) {
          placedRuns.push({
            text: run.text,
            options: {
              ...run.options,
              x: run.options.x + deltaX,
              y: this.state.y,
            },
            ...(run.glyphs ? { glyphs: run.glyphs } : {}),
          });
        }
        this.state.y -= normalized.lineHeight;
      }

      pushPositionedTextRuns(this.page, placedRuns, structureNode?.id);
      return { height: 0, runs: placedRuns };
    }
    return addFlowTextBlockToPage(
      this.page,
      this.embeddedFonts,
      text,
      {
        ...flowTextDefaults(this.state),
        ...options,
        x: blockX,
        y: this.state.y,
        width: blockWidth,
      },
      this.parent,
    );
  }

  private applyParagraphAnnotations(
    runs: readonly import("./internal/text-layout.js").PositionedTextRun[],
    annotations: readonly import("./types.js").ParagraphTextAnnotation[],
  ): void {
    emitParagraphTextAnnotations(this.page, runs, annotations, this.embeddedFonts, this.parent);
  }

  /**
   * Applies top spacing when the cursor has already moved below the start position.
   *
   * @param marginTop The top margin to apply.
   */
  private applyMarginTop(marginTop: number): void {
    if (marginTop > 0 && this.state.y < this.state.startY) {
      this.state.y -= marginTop;
    }
  }

  private advanceColumnIfNeeded(height: number): void {
    if (
      this.state.columnCount > 1 &&
      this.state.y < this.state.startY &&
      this.remainingHeight < height
    ) {
      this.advanceFlowRegion();
    }
  }

  private advanceFlowRegion(): boolean {
    if (this.advanceColumn()) {
      return true;
    }
    const next = this.overflowHandler?.();
    if (!next) {
      return false;
    }
    this.page = next.page;
    this.state = next.state;
    this.parent = next.parent;
    this.overflowHandler = next.overflowHandler;
    return true;
  }

  /**
   * Resolves effective flow spacing and horizontal margins for a block.
   *
   * @param kind The flow block kind whose spacing is being resolved.
   * @param options Options that control the operation.
   *
   * @returns The result of the operation.
   */
  private resolveSpacing(
    kind: "paragraph" | "table" | "image" | "link",
    options: FlowMarginOptions,
  ): ResolvedBlockSpacing;
  /**
   * Resolves effective flow spacing and horizontal margins for a block.
   *
   * @param kind The flow block kind whose spacing is being resolved.
   * @param options Options that control the operation.
   * @param level The heading level used for heading spacing.
   *
   * @returns The result of the operation.
   */
  private resolveSpacing(
    kind: "heading",
    options: FlowMarginOptions,
    level: HeadingLevelKey,
  ): ResolvedBlockSpacing;
  /**
   * Resolves effective flow spacing and horizontal margins for a block.
   *
   * @param kind The flow block kind whose spacing is being resolved.
   * @param options Options that control the operation.
   * @param level The heading level used for heading spacing.
   *
   * @returns The result of the operation.
   */
  private resolveSpacing(
    kind: FlowBlockKind,
    options: FlowMarginOptions,
    level: HeadingLevelKey = 1,
  ): ResolvedBlockSpacing {
    const defaults = this.state.spacing;
    const shorthand = resolveMarginShorthand(options.margin);
    const hasShorthand = options.margin !== undefined;
    const left = options.marginLeft ?? (hasShorthand ? shorthand.left : 0);
    const right = options.marginRight ?? (hasShorthand ? shorthand.right : 0);
    const defaultBefore = resolveDefaultSpacingBefore(kind, level, defaults);
    const defaultAfter = resolveDefaultSpacingAfter(kind, level, defaults);
    const before =
      options.marginTop ?? (hasShorthand ? shorthand.top : defaultBefore);
    const after =
      options.marginBottom ?? (hasShorthand ? shorthand.bottom : defaultAfter);
    validateSpacingValue(kind, "before", before);
    validateSpacingValue(kind, "after", after);
    validateSpacingValue(kind, "left", left);
    validateSpacingValue(kind, "right", right);
    return { before, after, left, right };
  }

  /**
   * Renders a section of template blocks within an optional structure container.
   *
   * @param blocks Child blocks to render.
   * @param role Optional structure role (e.g. "Sect", "Div").
   * @param structure Optional structure options.
   *
   * @returns This flow helper for chaining.
   */
  section(
    blocks: readonly TemplateBlock[],
    role?: PdfContainerTag,
    structure?: PdfStructureOptions,
    stylesheet?: TemplateStylesheet,
  ): this {
    if (role) {
      const node = createStructureNode(
        this.page,
        normalizeContainerStructureTag(role),
        normalizeStructureOptions(structure),
        this.parent,
      );
      const savedParent = this.parent;
      this.parent = node;
      renderTemplateBlocksToFlow(this, blocks, stylesheet);
      this.parent = savedParent;
    } else {
      renderTemplateBlocksToFlow(this, blocks, stylesheet);
    }
    return this;
  }

  /**
   * Adds a text form field at the current flow cursor.
   *
   * @param name The fully-qualified field name.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  textField(name: string, options: FlowTextFieldOptions): this {
    this.advanceColumnIfNeeded((options.height ?? 20) + this.state.gap);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);
    const x = options.x ?? this.state.x;
    const width = options.width ?? Math.max(this.state.width - spacing.left - spacing.right, 1);
    const height = options.height;
    const y = options.y ?? this.state.y - height;

    this.registerFieldName(name);
    const normalizedOptions = normalizeTextFieldOptions(name, {
      ...options,
      x,
      y,
      width,
    });
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
      this.parent,
    );
    this.page.annotations.push({
      type: "textField",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
    this.state.y -= height + spacing.after;
    return this;
  }

  /**
   * Adds a checkbox form field at the current flow cursor.
   *
   * @param name The fully-qualified field name.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  checkBox(name: string, options: FlowCheckBoxOptions): this {
    this.advanceColumnIfNeeded((options.height ?? 20) + this.state.gap);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);
    const x = options.x ?? this.state.x;
    const width = options.width ?? Math.max(this.state.width - spacing.left - spacing.right, 1);
    const height = options.height;
    const y = options.y ?? this.state.y - height;

    this.registerFieldName(name);
    const normalizedOptions = normalizeCheckBoxOptions(name, {
      ...options,
      x,
      y,
      width,
    });
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
      this.parent,
    );
    this.page.annotations.push({
      type: "checkBox",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
    this.state.y -= height + spacing.after;
    return this;
  }

  /**
   * Adds a choice form field at the current flow cursor.
   *
   * @param name The fully-qualified field name.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  choiceField(name: string, options: FlowChoiceFieldOptions): this {
    this.advanceColumnIfNeeded((options.height ?? 20) + this.state.gap);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);
    const x = options.x ?? this.state.x;
    const width = options.width ?? Math.max(this.state.width - spacing.left - spacing.right, 1);
    const height = options.height;
    const y = options.y ?? this.state.y - height;

    this.registerFieldName(name);
    const normalizedOptions = normalizeChoiceFieldOptions(name, {
      ...options,
      x,
      y,
      width,
    });
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
      this.parent,
    );
    this.page.annotations.push({
      type: "choiceField",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
    this.state.y -= height + spacing.after;
    return this;
  }

  /**
   * Adds a radio-button group at the current flow cursor.
   *
   * @param name The fully-qualified field name.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  radioGroup(name: string, options: FlowRadioGroupOptions): this {
    this.advanceColumnIfNeeded(20 + this.state.gap);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);

    this.registerFieldName(name);
    const normalizedOptions = normalizeRadioGroupOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      radioGroupBoundingBox(normalizedOptions),
      this.parent,
    );
    this.page.annotations.push({
      type: "radioGroup",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });

    const groupHeight =
      Math.max(...normalizedOptions.items.map((item) => item.y + item.height)) -
      Math.min(...normalizedOptions.items.map((item) => item.y)) +
      spacing.after;
    this.state.y -= groupHeight;
    return this;
  }

  /**
   * Adds a push-button form field at the current flow cursor.
   *
   * @param name The fully-qualified field name.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  pushButton(name: string, options: FlowPushButtonOptions): this {
    this.advanceColumnIfNeeded((options.height ?? 20) + this.state.gap);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);
    const x = options.x ?? this.state.x;
    const width = options.width ?? Math.max(this.state.width - spacing.left - spacing.right, 1);
    const height = options.height;
    const y = options.y ?? this.state.y - height;

    this.registerFieldName(name);
    const normalizedOptions = normalizePushButtonOptions(name, {
      ...options,
      x,
      y,
      width,
    });
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
      this.parent,
    );
    this.page.annotations.push({
      type: "pushButton",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
    this.state.y -= height + spacing.after;
    return this;
  }

  /**
   * Adds a signature form field placeholder at the current flow cursor.
   *
   * @param name The fully-qualified field name.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  signatureField(name: string, options: FlowSignatureFieldOptions): this {
    this.advanceColumnIfNeeded((options.height ?? 40) + this.state.gap);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);
    const x = options.x ?? this.state.x;
    const width = options.width ?? Math.max(this.state.width - spacing.left - spacing.right, 1);
    const height = options.height;
    const y = options.y ?? this.state.y - height;

    this.registerFieldName(name);
    const normalizedOptions = normalizeSignatureFieldOptions(name, {
      ...options,
      x,
      y,
      width,
    });
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
      this.parent,
    );
    this.page.annotations.push({
      type: "signatureField",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
    this.state.y -= height + spacing.after;
    return this;
  }

  /**
   * Adds a highlight annotation at the current flow cursor.
   *
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  highlight(options: FlowHighlightOptions): this {
    return this.flowTextMarkup("highlight", options);
  }

  /**
   * Adds an underline text-markup annotation at the current flow cursor.
   *
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  underline(options: FlowHighlightOptions): this {
    return this.flowTextMarkup("underline", options);
  }

  /**
   * Adds a strike-out text-markup annotation at the current flow cursor.
   *
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  strikeOut(options: FlowHighlightOptions): this {
    return this.flowTextMarkup("strikeOut", options);
  }

  /**
   * Adds a squiggly text-markup annotation at the current flow cursor.
   *
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  squiggly(options: FlowHighlightOptions): this {
    return this.flowTextMarkup("squiggly", options);
  }

  private flowTextMarkup(
    subtype: "highlight" | "underline" | "strikeOut" | "squiggly",
    options: FlowHighlightOptions,
  ): this {
    this.advanceColumnIfNeeded(options.height + this.state.gap);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);
    const x = options.x ?? this.state.x;
    const width = options.width ?? Math.max(this.state.width - spacing.left - spacing.right, 1);
    const height = options.height;
    const y = options.y ?? this.state.y - height;

    const rawOptions = { ...options, x, y, width };
    const normalizedOptions = normalizeTextMarkupOptions(subtype, rawOptions);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
      this.parent,
    );
    this.page.annotations.push({
      type: subtype,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
    this.state.y -= height + spacing.after;
    return this;
  }

  /**
   * Adds a text note annotation at the current flow cursor.
   *
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  note(options: FlowNoteOptions): this {
    this.advanceColumnIfNeeded((options.height ?? 20) + this.state.gap);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);
    const x = options.x ?? this.state.x;
    const width = options.width ?? Math.max(this.state.width - spacing.left - spacing.right, 1);
    const height = options.height ?? 0;
    const y = options.y ?? this.state.y - height;

    const normalizedOptions = normalizeNoteAnnotationOptions({
      ...options,
      x,
      y,
      width: width > 0 ? width : undefined,
      height: height > 0 ? height : undefined,
    });
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
      this.parent,
    );
    this.page.annotations.push({
      type: "note",
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
    this.state.y -= height + spacing.after;
    return this;
  }

  /**
   * Adds a free-text annotation at the current flow cursor.
   *
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  freeText(options: FlowFreeTextOptions): this {
    this.advanceColumnIfNeeded(options.height + this.state.gap);
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);
    const x = options.x ?? this.state.x;
    const width = options.width ?? Math.max(this.state.width - spacing.left - spacing.right, 1);
    const height = options.height;
    const y = options.y ?? this.state.y - height;

    const normalizedOptions = normalizeFreeTextAnnotationOptions({
      ...options,
      x,
      y,
      width,
    });
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
      this.parent,
    );
    this.page.annotations.push({
      type: "freeText",
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
    this.state.y -= height + spacing.after;
    return this;
  }

  /**
   * Adds vector path commands at the current flow cursor.
   *
   * @param commands The vector path commands to add.
   * @param style The drawing style for the path.
   * @param height The vertical extent consumed by the path.
   *
   * @returns This flow helper for chaining.
   */
  path(commands: PathCommand[], style: PathStyle, height: number): this {
    this.advanceColumnIfNeeded(height);
    validatePathCommands(commands);
    this.page.ops.push({
      type: "path",
      commands,
      style: normalizePathStyle(style),
    });
    this.state.y -= height;
    return this;
  }

  /**
   * Adds a rectangle path at the current flow cursor.
   *
   * @param x Horizontal position override.
   * @param y Vertical position override (bottom edge).
   * @param width Width override.
   * @param height Height override.
   * @param style The drawing style for the rectangle.
   *
   * @returns This flow helper for chaining.
   */
  rect(
    x?: number,
    y?: number,
    width?: number,
    height?: number,
    style?: PathStyle,
  ): this {
    const w = width ?? this.state.width;
    const h = height ?? w;
    this.advanceColumnIfNeeded(h);
    const rx = x ?? this.state.x;
    const ry = y ?? this.state.y - h;
    const commands: PathCommand[] = [
      { type: "rect", x: rx, y: ry, width: w, height: h },
    ];
    validatePathCommands(commands);
    this.page.ops.push({
      type: "path",
      commands,
      style: normalizePathStyle(style ?? { paint: "stroke" }),
    });
    this.state.y -= h;
    return this;
  }

  /**
   * Adds a circle path at the current flow cursor.
   *
   * @param cx Center x-coordinate override.
   * @param cy Center y-coordinate override.
   * @param radius Radius override.
   * @param style The drawing style for the circle.
   *
   * @returns This flow helper for chaining.
   */
  circle(
    cx?: number,
    cy?: number,
    radius?: number,
    style?: PathStyle,
  ): this {
    const r = radius ?? Math.min(this.state.width, this.state.y - this.state.marginBottom) / 4;
    this.advanceColumnIfNeeded(r * 2);
    const centerX = cx ?? this.state.x + this.state.width / 2;
    const centerY = cy ?? this.state.y - r;
    const k = (4 * (Math.SQRT2 - 1)) / 3;
    const kr = k * r;
    const commands: PathCommand[] = [
      { type: "moveTo", x: centerX, y: centerY + r },
      { type: "curveTo", x1: centerX + kr, y1: centerY + r, x2: centerX + r, y2: centerY + kr, x3: centerX + r, y3: centerY },
      { type: "curveTo", x1: centerX + r, y1: centerY - kr, x2: centerX + kr, y2: centerY - r, x3: centerX, y3: centerY - r },
      { type: "curveTo", x1: centerX - kr, y1: centerY - r, x2: centerX - r, y2: centerY - kr, x3: centerX - r, y3: centerY },
      { type: "curveTo", x1: centerX - r, y1: centerY + kr, x2: centerX - kr, y2: centerY + r, x3: centerX, y3: centerY + r },
      { type: "closePath" },
    ];
    validatePathCommands(commands);
    this.page.ops.push({
      type: "path",
      commands,
      style: normalizePathStyle(style ?? { paint: "stroke" }),
    });
    this.state.y -= r * 2;
    return this;
  }

  /**
   * Adds a tagged list at the current flow cursor.
   *
   * @param items The list items to add.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  list(items: readonly ListItem[], options: FlowListOptions): this {
    this.advanceColumnIfNeeded(
      this.estimateListHeight(items, {
        ...options,
        width: options.width ?? this.state.width,
      }),
    );
    const spacing = this.resolveSpacing("image", options);
    this.applyMarginTop(spacing.before);
    const normalizedItems = normalizeListItems(items);
    const x = options.x ?? this.state.x + spacing.left;
    const width = options.width ?? Math.max(this.state.width - spacing.left - spacing.right, 1);
    const normalizedOptions = normalizeListOptions(normalizedItems, {
      ...flowTextDefaults(this.state),
      ...options,
      x,
      y: this.state.y,
      width,
    });
    const listNode = createStructureNode(
      this.page,
      "L",
      undefined,
      this.parent,
    );
    const nextY = layoutList(
      this.page,
      listNode,
      normalizedItems,
      normalizedOptions,
      this.embeddedFonts,
    );
    this.state.y = nextY - spacing.after;
    return this;
  }

  /**
   * Registers a potentially dotted field name, tracking parent-child
   * relationships for hierarchical form fields.
   */
  private registerFieldName(name: string): string {
    const lastDot = name.lastIndexOf(".");
    if (lastDot === -1) {
      return name;
    }

    const childName = name.slice(lastDot + 1);
    const parentName = name.slice(0, lastDot);

    if (childName.length === 0 || parentName.length === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_FORM_FIELD_NAME,
        "Dotted form field names must have non-empty segments on both sides of the dot.",
        { name },
      );
    }

    if (name.slice(0, lastDot).includes(".")) {
      this.registerFieldName(parentName);
    }

    this.page.parentFieldKids ??= new Map();

    const kids = this.page.parentFieldKids.get(parentName);
    if (kids) {
      if (!kids.includes(name)) {
        kids.push(name);
      }
    } else {
      this.page.parentFieldKids.set(parentName, [name]);
    }

    return name;
  }
}

function validateSpacingValue(
  kind: string,
  property: string,
  value: number,
): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_NUMBER,
      `${kind} spacing "${property}" must be a finite non-negative number, got ${value}.`,
      { kind, property, value },
    );
  }
}

/**
 *
 * A mutable page builder for placing text, graphics, images, links, annotations, form fields, and structured content on a PDF page.
 */
export class PdfPage {
  /**
   * Creates a page builder around an internal page model and embedded font registry.
   *
   * @param page The internal page model to write into.
   * @param embeddedFonts The embedded font registry used for text layout.
   */
  constructor(
    private readonly page: InternalPageModel,
    private readonly embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  ) {}

  /**
   * Gets the page size.
   *
   * @returns The number of bytes.
   */
  get size(): CustomPageSize {
    return this.page.size;
  }

  /**
   * Adds text to the page.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   */
  text(text: string, options: TextOptions): void {
    addTextToPage(this.page, this.embeddedFonts, text, options);
  }

  /**
   * Adds a multiline text block to the page.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   */
  textBlock(text: string, options: TextBlockOptions): void {
    addTextBlockToPage(this.page, this.embeddedFonts, text, options);
  }

  /**
   * Adds a tagged list to the page.
   *
   * @param items The list items to add.
   * @param options Options that control the operation.
   */
  list(items: readonly ListItem[], options: ListOptions): void {
    const normalizedItems = normalizeListItems(items);
    const normalizedOptions = normalizeListOptions(normalizedItems, options);
    const listNode = createStructureNode(this.page, "L");
    layoutList(
      this.page,
      listNode,
      normalizedItems,
      normalizedOptions,
      this.embeddedFonts,
    );
  }

  /**
   * Adds a tagged table to the page.
   *
   * @param rows The table rows to add.
   * @param options Options that control the operation.
   */
  table(rows: readonly TableRow[], options: TableOptions): void {
    const normalizedRows = normalizeTableRows(rows);
    const normalizedOptions = normalizeTableOptions(normalizedRows, options);
    layoutTable(
      this.page,
      createStructureNode(this.page, "Table", normalizedOptions.structure),
      normalizedRows,
      normalizedOptions,
      this.embeddedFonts,
    );
  }

  /**
   * Creates a tagged structure container on the page.
   *
   * @param tag The structure tag to create.
   * @param build An optional callback that receives the created container.
   *
   * @returns The created structure container.
   */
  container(
    tag: PdfContainerTag,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  /**
   * Creates a tagged structure container on the page.
   *
   * @param tag The structure tag to create.
   * @param options Options that control the operation.
   * @param build An optional callback that receives the created container.
   *
   * @returns The created structure container.
   */
  container(
    tag: PdfContainerTag,
    options?: PdfStructureOptions,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  /**
   * Creates a tagged structure container on the page.
   *
   * @param tag The structure tag to create.
   * @param optionsOrBuild Either structure options or a build callback.
   * @param maybeBuild An optional build callback when options are provided separately.
   *
   * @returns The created structure container.
   */
  container(
    tag: PdfContainerTag,
    optionsOrBuild?:
      | PdfStructureOptions
      | ((container: PdfStructureContainer) => void),
    maybeBuild?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer {
    const options =
      typeof optionsOrBuild === "function" ? undefined : optionsOrBuild;
    const build =
      typeof optionsOrBuild === "function" ? optionsOrBuild : maybeBuild;
    const container = new PdfStructureContainer(
      this.page,
      this.embeddedFonts,
      createStructureNode(
        this.page,
        normalizeContainerStructureTag(tag),
        normalizeStructureOptions(options),
      ),
    );
    if (build) {
      build(container);
    }
    return container;
  }

  /**
   * Creates a tagged structure container on the page.
   *
   * @param role The replacement structure role.
   * @param build An optional callback that receives the created container.
   *
   * @returns The created structure container.
   */
  structure(
    role: Exclude<PdfStructureTag, "Artifact">,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  /**
   * Creates a tagged structure container on the page.
   *
   * @param role The replacement structure role.
   * @param options Options that control the operation.
   * @param build An optional callback that receives the created container.
   *
   * @returns The created structure container.
   */
  structure(
    role: Exclude<PdfStructureTag, "Artifact">,
    options?: PdfStructureOptions,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  /**
   * Creates a tagged structure container on the page.
   *
   * @param role The replacement structure role.
   * @param optionsOrBuild Either structure options or a build callback.
   * @param maybeBuild An optional build callback when options are provided separately.
   *
   * @returns The created structure container.
   */
  structure(
    role: Exclude<PdfStructureTag, "Artifact">,
    optionsOrBuild?:
      | PdfStructureOptions
      | ((container: PdfStructureContainer) => void),
    maybeBuild?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer {
    const options =
      typeof optionsOrBuild === "function" ? undefined : optionsOrBuild;
    const build =
      typeof optionsOrBuild === "function" ? optionsOrBuild : maybeBuild;
    const container = new PdfStructureContainer(
      this.page,
      this.embeddedFonts,
      createStructureNode(
        this.page,
        normalizeStructureRole(role),
        normalizeStructureOptions(options),
      ),
    );
    if (build) {
      build(container);
    }
    return container;
  }

  /**
   * Creates a cursor-based flow helper for the page.
   *
   * @param options Options that control the operation.
   *
   * @returns The created flow helper.
   */
  flow(options: FlowOptions = {}): PdfFlow {
    return new PdfFlow(
      this.page,
      this.embeddedFonts,
      createFlowState(this.page, options),
    );
  }

  /**
   * Adds vector path commands to the page.
   *
   * @param commands The vector path commands to add.
   * @param style The drawing style for the path.
   */
  path(commands: PathCommand[], style: PathStyle): void {
    validatePathCommands(commands);
    this.page.ops.push({
      type: "path",
      commands,
      style: normalizePathStyle(style),
    });
  }

  /**
   * Adds a JPEG image to the page.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  jpeg(data: BinaryData, options: JpegImageOptions): void {
    addImageToPage(this.page, "jpeg", data, options);
  }

  /**
   * Adds a PNG image to the page.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  png(data: BinaryData, options: PngImageOptions): void {
    addImageToPage(this.page, "png", data, options);
  }

  /**
   * Adds a BMP image to the page.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  bmp(data: BinaryData, options: BmpImageOptions): void {
    addImageToPage(this.page, "bmp", data, options);
  }

  /**
   * Adds a JBIG2 image to the page.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  jbig2(data: BinaryData, options: import("./types.js").Jbig2ImageOptions): void {
    addImageToPage(this.page, "jbig2", data, options);
  }

  /**
   * Adds a TIFF image to the page.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  tiff(data: BinaryData, options: import("./types.js").TiffImageOptions): void {
    addImageToPage(this.page, "tiff", data, options);
  }

  /**
   * Adds a JPEG 2000 image to the page.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  jp2(data: BinaryData, options: import("./types.js").Jp2ImageOptions): void {
    addImageToPage(this.page, "jp2", data, options);
  }

  /**
   * Adds a WebP image to the page.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  webp(data: BinaryData, options: import("./types.js").WebpImageOptions): void {
    addImageToPage(this.page, "webp", data, options);
  }

  /**
   * Adds a GIF image to the page.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  gif(data: BinaryData, options: import("./types.js").GifImageOptions): void {
    addImageToPage(this.page, "gif", data, options);
  }

  /**
   * Adds an SVG graphic to the page.
   *
   * @param data The SVG text data.
   * @param options Options that control the operation.
   */
  svg(data: BinaryData | string, options: import("./types.js").SvgImageOptions): void {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    addImageToPage(this.page, "svg", bytes, options);
  }

  /**
   * Adds a URI link annotation to the page.
   *
   * @param url The URI target.
   * @param options Options that control the operation.
   */
  link(url: string, options: UriLinkOptions): void {
    addLinkToPage(this.page, url, options);
  }

  /**
   * Adds an internal page link annotation.
   *
   * @param target The destination page, outline target, or structure element.
   * @param options Options that control the operation.
   */
  linkToPage(target: PdfPage, options: PageLinkOptions): void {
    const normalizedOptions = normalizePageLinkOptions(options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Link",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "page",
      target: target.page,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a highlight annotation to the page.
   *
   * @param options Options that control the operation.
   */
  highlight(options: HighlightAnnotationOptions): void {
    const normalizedOptions = normalizeHighlightAnnotationOptions(options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "highlight",
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds an underline text-markup annotation to the page.
   *
   * @param options Options that control the operation.
   */
  underline(options: UnderlineAnnotationOptions): void {
    const normalizedOptions = normalizeUnderlineAnnotationOptions(options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "underline",
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a strike-out text-markup annotation to the page.
   *
   * @param options Options that control the operation.
   */
  strikeOut(options: StrikeOutAnnotationOptions): void {
    const normalizedOptions = normalizeStrikeOutAnnotationOptions(options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "strikeOut",
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a squiggly text-markup annotation to the page.
   *
   * @param options Options that control the operation.
   */
  squiggly(options: SquigglyAnnotationOptions): void {
    const normalizedOptions = normalizeSquigglyAnnotationOptions(options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "squiggly",
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a text note annotation to the page.
   *
   * @param options Options that control the operation.
   */
  note(options: NoteAnnotationOptions): void {
    const normalizedOptions = normalizeNoteAnnotationOptions(options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "note",
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a free-text annotation to the page.
   *
   * @param options Options that control the operation.
   */
  freeText(options: FreeTextAnnotationOptions): void {
    const normalizedOptions = normalizeFreeTextAnnotationOptions(options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "freeText",
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Registers a potentially dotted field name, tracking parent-child
   * relationships for hierarchical form fields. Returns the full name.
   */
  private registerFieldName(name: string): string {
    const lastDot = name.lastIndexOf(".");
    if (lastDot === -1) {
      return name;
    }

    const childName = name.slice(lastDot + 1);
    const parentName = name.slice(0, lastDot);

    if (childName.length === 0 || parentName.length === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_FORM_FIELD_NAME,
        "Dotted form field names must have non-empty segments on both sides of the dot.",
        { name },
      );
    }

    if (name.slice(0, lastDot).includes(".")) {
      // Recurse to register intermediate parents
      this.registerFieldName(parentName);
    }

    this.page.parentFieldKids ??= new Map();

    const kids = this.page.parentFieldKids.get(parentName);
    if (kids) {
      if (!kids.includes(name)) {
        kids.push(name);
      }
    } else {
      this.page.parentFieldKids.set(parentName, [name]);
    }

    return name;
  }

  /**
   * Adds a text form field to the page.
   *
   * @param name The name to assign or look up.
   * @param options Options that control the operation.
   */
  textField(name: string, options: TextFieldOptions): void {
    this.registerFieldName(name);
    const normalizedOptions = normalizeTextFieldOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "textField",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a checkbox form field to the page.
   *
   * @param name The name to assign or look up.
   * @param options Options that control the operation.
   */
  checkBox(name: string, options: CheckBoxOptions): void {
    this.registerFieldName(name);
    const normalizedOptions = normalizeCheckBoxOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "checkBox",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a choice form field to the page.
   *
   * @param name The name to assign or look up.
   * @param options Options that control the operation.
   */
  choiceField(name: string, options: ChoiceFieldOptions): void {
    this.registerFieldName(name);
    const normalizedOptions = normalizeChoiceFieldOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "choiceField",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a radio-button group to the page.
   *
   * @param name The name to assign or look up.
   * @param options Options that control the operation.
   */
  radioGroup(name: string, options: RadioGroupOptions): void {
    this.registerFieldName(name);
    const normalizedOptions = normalizeRadioGroupOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      radioGroupBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "radioGroup",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a push-button form field to the page.
   *
   * @param name The name to assign or look up.
   * @param options Options that control the operation.
   */
  pushButton(name: string, options: PushButtonOptions): void {
    this.registerFieldName(name);
    const normalizedOptions = normalizePushButtonOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "pushButton",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a signature form field placeholder to the page.
   *
   * @param name The name to assign or look up.
   * @param options Options that control the operation.
   */
  signatureField(name: string, options: SignatureFieldOptions): void {
    this.registerFieldName(name);
    const normalizedOptions = normalizeSignatureFieldOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      "Annot",
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: "signatureField",
      name,
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Saves the current graphics state.
   */
  saveState(): void {
    this.page.graphicsDepth += 1;
    this.page.ops.push({ type: "saveState" });
  }

  /**
   * Restores the most recently saved graphics state.
   */
  restoreState(): void {
    if (this.page.graphicsDepth === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_GRAPHICS_STATE,
        "restoreState() must be paired with saveState().",
      );
    }

    this.page.graphicsDepth -= 1;
    this.page.ops.push({ type: "restoreState" });
  }

  /**
   * Adds a translation transform to subsequent page operations.
   *
   * @param x The horizontal transform value.
   * @param y The vertical transform value.
   */
  translate(x: number, y: number): void {
    this.transform({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
  }

  /**
   * Adds a scale transform to subsequent page operations.
   *
   * @param x The horizontal transform value.
   * @param y The vertical transform value.
   */
  scale(x: number, y: number = x): void {
    this.transform({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
  }

  /**
   * Adds a rotation transform to subsequent page operations.
   *
   * @param degrees The rotation angle in degrees.
   */
  rotate(degrees: number): void {
    const radians = (degrees * Math.PI) / 180;
    this.transform({
      a: Math.cos(radians),
      b: Math.sin(radians),
      c: -Math.sin(radians),
      d: Math.cos(radians),
      e: 0,
      f: 0,
    });
  }

  /**
   * Adds a raw transformation matrix to subsequent page operations.
   *
   * @param matrix The transformation matrix to apply.
   */
  transform(matrix: Transform): void {
    validateTransform(matrix);
    this.page.ops.push({ type: "transform", matrix });
  }

  /**
   * Sets graphics-state parameters (alpha and/or blend mode) for subsequent
   * painting operations. Emitted as an inline ExtGState entry referenced by
   * the `gs` operator. Pair with {@link saveState}/{@link restoreState} to
   * scope the effect.
   *
   * @param options Alpha and blend-mode options.
   */
  setExtGState(options: ExtGStateOptions): void {
    validateExtGStateOptions(options);
    this.page.ops.push({ type: "extGState", options: { ...options } });
  }

  /**
   * Returns the internal page model used by serializers and editors.
   *
   * @returns The internal page model.
   */
  toInternalModel(): InternalPageModel {
    return this.page;
  }
}

/**
 * Internal model for a luminosity soft-mask Form XObject.
 */
export interface InternalSoftMaskModel {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly ops: PdfOp[];
}

/**
 * Sub-builder for the contents of a luminosity soft-mask Form XObject.
 * Supports path operations only.
 */
export class PdfSoftMaskBuilder {
  constructor(private readonly ops: PdfOp[]) {}

  /**
   * Adds a vector path to the soft-mask form. Painted regions whose
   * luminosity is high (white) become opaque; black becomes transparent.
   */
  path(commands: readonly PathCommand[], style: PathStyle): void {
    const normalized = normalizePathStyle(style);
    validatePathCommands([...commands]);
    this.ops.push({ type: "path", commands: [...commands], style: normalized });
  }

  /** Saves the current graphics state. */
  saveState(): void {
    this.ops.push({ type: "saveState" });
  }

  /** Restores the most recently saved graphics state. */
  restoreState(): void {
    this.ops.push({ type: "restoreState" });
  }

  /** Adds a transformation matrix. */
  transform(matrix: Transform): void {
    validateTransform(matrix);
    this.ops.push({ type: "transform", matrix });
  }
}

/**
 *
 * A handle for an outline entry in a PDF document. It can receive nested child outline items that point to pages or named destinations.
 */
export class PdfOutlineItem {
  /**
   * Creates an outline item handle for an internal outline model.
   *
   * @param outline The internal outline model to wrap.
   */
  constructor(private readonly outline: InternalOutlineModel) {}

  /**
   * Adds a nested outline item below this outline entry.
   *
   * @param title The outline title.
   * @param target The destination page, outline target, or structure element.
   * @param options Options that control the operation.
   *
   * @returns The created child outline item handle.
   */
  addChild(
    title: string,
    target: PdfPage | string,
    options: OutlineOptions = {},
  ): PdfOutlineItem {
    const child = createOutlineModel(title, target, options);
    this.outline.children.push(child);
    return new PdfOutlineItem(child);
  }
}

/**
 *
 * A mutable builder for creating new PDF documents from scratch. It manages pages, fonts, metadata, outlines, attachments, accessibility data, encryption, and serialization.
 */
export class PdfDocument {
  /** Pages added to the document, in insertion order. Each entry is the internal model populated by {@link PdfPage} builders. */
  private readonly pages: InternalPageModel[] = [];

  /** Luminosity soft masks created via {@link createLuminositySoftMask}, in insertion order. */
  private readonly softMasks: InternalSoftMaskModel[] = [];

  /** Counter for generating unique soft-mask keys. */
  private nextSoftMaskId = 0;

  /** TrueType fonts embedded in the document, keyed by their internal font id ({@link ParsedTrueTypeFont.id}). */
  private readonly embeddedFonts = new Map<string, ParsedTrueTypeFont>();

  /** Named destinations registered on the document. Used to populate the Names tree on serialization. */
  private readonly namedDestinations: InternalNamedDestinationModel[] = [];

  /** Per-page label overrides (e.g. roman numerals for front matter). Keyed by the page model the label applies to. */
  private readonly pageLabels = new Map<
    InternalPageModel,
    NormalizedPageLabelOptions
  >();

  /** File attachments registered on the document. Emitted as the Catalog `/AF` array and Names `/EmbeddedFiles` tree. */
  private readonly attachments: InternalAttachmentModel[] = [];

  /** Outline (bookmark) tree nodes in document order. */
  private readonly outlines: InternalOutlineModel[] = [];

  /** Document Info dictionary in its normalized form. Mutable so {@link updateInfo} can patch fields. */
  private info: NormalizedDocumentInfo;

  /** Page size used by {@link addPage} when no explicit `size` is given. Resolved at construction time. */
  private readonly defaultPageSize: ResolvedPageSize;

  /** Tagging, language, role-map, structure-root, and conformance settings. Drives StructTreeRoot emission. */
  private readonly accessibility: NormalizedDocumentAccessibility;

  /** Password encryption settings, if any. Triggers Encrypt dictionary emission and (for AES-256 R=6) `%PDF-2.0` header. */
  private readonly encryption?: NormalizedDocumentEncryption | undefined;

  /** Pre-built XMP metadata packet. Mutable via {@link setXmpMetadata}; auto-generated from {@link info} when undefined. */
  private xmpMetadata?: string | undefined;

  /** When true, content streams and large byte streams are compressed with FlateDecode. Auto-on for embedded fonts/images. */
  private readonly compress?: boolean | undefined;

  /** When true, emits PDF 1.5 cross-reference and object streams (auto-bumps header to `%PDF-1.5`). */
  private readonly objectStreams?: boolean | undefined;

  /** When true, emits a linearization dictionary for Fast Web View style delivery. */
  private readonly linearize?: boolean | undefined;

  /** OutputIntent dictionary settings (ICC profile + condition). Required for PDF/A-1b conformance. */
  private readonly outputIntent?: DocumentOutputIntentOptions | undefined;

  /** Detached signature settings. When set, an empty signature placeholder is reserved and `/ByteRange`/`/Contents` filled at serialize. */
  private readonly signature?: DocumentSignatureOptions | undefined;

  /** Custom text shaper for complex script shaping. */
  private textShaper?: TextShaper | undefined;

  /** Calculation order for form fields. */
  private calculationOrder?: string[] | undefined;

  /** Whether the document has already been serialized. */
  private _finalized = false;

  /** Whether a write is in progress. */
  private _writing = false;

  /** Snapshot of page count captured at finalization time. */
  private _finalizedPageCount = 0;

  /** Cached serialized bytes, returned on subsequent calls when unchanged. */
  private _finalizedBytes?: Uint8Array | undefined;

  /** Reentrant call counter for thread-safety debugging. */
  _lockLevel = 0;

  /** When true, warns about potential concurrent access on reentrant calls. */
  _debugThreadSafe = false;

  /**
   * Creates a new mutable PDF document builder.
   *
   * @param options Options that control the operation.
   */
  constructor(options: DocumentOptions = {}) {
    this.info = normalizeDocumentInfo(options.info);
    this.defaultPageSize = resolvePageSize(options.defaultPageSize);
    this.accessibility = normalizeDocumentAccessibility(options);
    this.encryption = normalizeDocumentEncryption(options.encryption);
    this.xmpMetadata = normalizeXmpMetadata(options.xmpMetadata);
    this.compress = options.compress;
    this.objectStreams = options.objectStreams;
    this.linearize = options.linearize;
    this.outputIntent = options.outputIntent;
    this.signature = options.signature;
    this.textShaper = options.textShaper;
  }

  /**
   * Guards against mutations after the document has been finalized
   * and warns about potential concurrent access.
   */
  private _mutate(): void {
    if (this._finalized) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_OPERATION,
        "Document has been finalized and cannot be modified.",
      );
    }
    if (this._debugThreadSafe) {
      this._lockLevel += 1;
      if (this._lockLevel > 1) {
        console.warn("Potential concurrent access detected");
      }
    }
  }

  /**
   * Releases the thread-safety lock after a mutating method exits.
   */
  private _unlock(): void {
    if (this._debugThreadSafe && this._lockLevel > 0) {
      this._lockLevel -= 1;
    }
  }

  /**
   * Sets a custom text shaper for complex script shaping (Devanagari, Khmer,
   * Myanmar, Arabic, Thai, etc.). When provided, the shaper is called for each
   * text run that requires shaping. If not provided, the default shaper handles
   * basic ligature and joining-form substitution but will throw an
   * UNSUPPORTED_SCRIPT error for scripts it does not support. External shapers
   * such as harfbuzzjs or fontkit can be plugged in to enable full shaping
   * support.
   *
   * @param shaper The custom text shaper to use, or undefined to revert to the default.
   *
   * @example
   * ```ts
   * import { createDocument } from "zeropdf";
   *
   * const doc = createDocument();
   *
   * // Plug in harfbuzzjs for full complex-script shaping:
   * // import { createHarfBuzzShaper } from "harfbuzzjs-shaper";
   * // doc.setTextShaper(createHarfBuzzShaper(harfbuzzInstance));
   * ```
   */
  setTextShaper(shaper: TextShaper | undefined): void {
    this._mutate();
    this.textShaper = shaper;
  }

  /**
   * Adds a page to the document and returns its page builder.
   *
   * @param options Options that control the operation.
   *
   * @returns The new page builder.
   */
  addPage(options: PageOptions = {}): PdfPage {
    this._mutate();
    const page = createPageModel(options.size ?? this.defaultPageSize, options.transparencyGroup, options.tabOrder);
    this.pages.push(page);
    this._unlock();
    return new PdfPage(page, this.embeddedFonts);
  }

  /**
   * Creates a luminosity soft mask backed by a Form XObject. Pass the
   * returned handle to {@link ExtGStateOptions.softMask} via
   * {@link PdfPage.setExtGState} to apply the mask.
   *
   * The mask sub-builder supports path operations only. Painted regions
   * with high luminosity (white) become opaque; black becomes transparent.
   *
   * @param options Mask BBox dimensions.
   * @param build Callback that receives the mask sub-builder.
   *
   * @returns A handle referencing the created soft-mask Form XObject.
   */
  createLuminositySoftMask(
    options: SoftMaskOptions,
    build: (mask: PdfSoftMaskBuilder) => void,
  ): SoftMaskHandle {
    this._mutate();
    const key = `SMask${this.nextSoftMaskId++}`;
    const ops: PdfOp[] = [];
    const builder = new PdfSoftMaskBuilder(ops);
    build(builder);
    this.softMasks.push({ key, width: options.width, height: options.height, ops });
    this._unlock();
    return { key };
  }

  /**
   * Renders a template document into this PDF document.
   *
   * @param options Options that control the operation.
   */
  renderTemplate(options: TemplateDocumentOptions): void {
    this._mutate();
    if (options.info !== undefined) {
      this.updateInfo(options.info);
    }
    if ("xmpMetadata" in options) {
      this.setXmpMetadata(options.xmpMetadata);
    }
    renderTemplateDocument(this, options, {
      title: this.info.title,
      author: this.info.author,
    });
    this._unlock();
  }

  /**
   * Embeds a TrueType font and registers it under the provided name.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns The result of the operation.
   */
  embedTrueTypeFont(
    data: BinaryData,
    options: EmbedTrueTypeFontOptions = {},
  ): PdfEmbeddedFont {
    this._mutate();
    const bytes = toBytes(data);
    const cacheKey = hashBytes(bytes);
    const cached = fontCache.get(cacheKey);
    if (cached) {
      this.embeddedFonts.set(cached.id, cached);
      return cached;
    }
    const font = parseTrueTypeFont(data, { family: options.family, ttcIndex: options.ttcIndex });
    fontCache.set(cacheKey, font);
    this.embeddedFonts.set(font.id, font);
    return font;
  }

  /**
   * Adds a named destination that points to a page.
   *
   * @param name The name to assign or look up.
   * @param target The destination page, outline target, or structure element.
   */
  addNamedDestination(name: string, target: PdfPage): void {
    this._mutate();
    this.namedDestinations.push({
      name: normalizeDestinationName(name),
      target: target.toInternalModel(),
    });
  }

  /**
   * Sets the label style for a page-label range beginning at the target page.
   *
   * @param target The destination page, outline target, or structure element.
   * @param options Options that control the operation.
   */
  setPageLabel(target: PdfPage, options: PageLabelOptions): void {
    this._mutate();
    this.pageLabels.set(
      target.toInternalModel(),
      normalizePageLabelOptions(options),
    );
  }

  /**
   * Embeds a file attachment in the document.
   *
   * @param name The name to assign or look up.
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  attachFile(
    name: string,
    data: BinaryData,
    options: AttachmentOptions = {},
  ): void {
    this._mutate();
    const bytes = toBytes(data);
    if (bytes.length === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_ATTACHMENT,
        "Attachment data must not be empty.",
        {
          name,
        },
      );
    }

    this.attachments.push({
      name,
      bytes,
      options: normalizeAttachmentOptions(name, options),
    });
  }

  /**
   * Merges document information metadata into the current document info dictionary.
   *
   * @param info The document information metadata to merge.
   */
  private updateInfo(info: DocumentInfo): void {
    this.info = normalizeDocumentInfo({
      title: info.title ?? this.info.title,
      author: info.author ?? this.info.author,
      subject: info.subject ?? this.info.subject,
      keywords: info.keywords ?? this.info.keywords,
      creator: info.creator ?? this.info.creator,
      producer: info.producer ?? this.info.producer,
      creationDate: info.creationDate ?? this.info.creationDate,
      modificationDate: info.modificationDate ?? this.info.modificationDate,
    });
  }

  /**
   * Sets or clears the document XMP metadata packet.
   *
   * @param metadata The XMP metadata input, or undefined to clear it.
   */
  setXmpMetadata(metadata: XmpMetadataInput | undefined): void {
    this._mutate();
    this.xmpMetadata = normalizeXmpMetadata(metadata);
  }

  /**
   * Adds a top-level outline item to the document.
   *
   * @param title The outline title.
   * @param target The destination page, outline target, or structure element.
   * @param options Options that control the operation.
   *
   * @returns The created outline item handle.
   */
  addOutline(
    title: string,
    target: PdfPage | string,
    options: OutlineOptions = {},
  ): PdfOutlineItem {
    this._mutate();
    const outline = createOutlineModel(title, target, options);
    this.outlines.push(outline);
    return new PdfOutlineItem(outline);
  }

  /**
   * Sets the calculation order for form fields. The order determines the
   * sequence in which field calculations run when a field value changes.
   *
   * @param fieldNames The ordered list of form field names.
   */
  setCalculationOrder(fieldNames: string[]): void {
    this._mutate();
    if (fieldNames.length === 0) {
      this.calculationOrder = undefined;
      return;
    }
    this.calculationOrder = [...fieldNames];
  }

  /**
   * Flattens form fields into static page content where possible.
   */
  flattenForms(): void {
    this._mutate();
    flattenFormsOnPages(this.pages);
  }

  /**
   * Validates the current document model against enabled compliance rules.
   *
   * @returns The compliance issues found in the current model.
   */
  validateCompliance(): readonly PdfComplianceIssue[] {
    return collectComplianceIssues(
      buildComplianceCheckInput(
        this.pages,
        this.accessibility,
        this.encryption !== undefined,
        this.attachments.length > 0,
        this.xmpMetadata,
      ),
    );
  }

  /**
   * Serializes the document into PDF bytes.
   *
   * @returns The serialized or collected bytes.
   */
  toUint8Array(): Uint8Array {
    if (this._finalized) {
      if (this.pages.length !== this._finalizedPageCount) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_OPERATION,
          "Document has been modified after serialization. Create a new document to produce additional output.",
        );
      }
      return this._finalizedBytes!;
    }
    this._finalized = true;
    this._finalizedPageCount = this.pages.length;
    this._finalizedBytes = this._serializeToBytes();
    return this._finalizedBytes;
  }

  /**
   * Streams the serialized document to a byte sink.
   *
   * @param sink The sink that receives written byte chunks.
   */
  async writeTo(sink: ByteSink): Promise<void> {
    if (this._writing) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_OPERATION,
        "Another write is already in progress.",
      );
    }
    this._writing = true;
    try {
    if (this._finalized) {
      if (this.pages.length !== this._finalizedPageCount) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_OPERATION,
          "Document has been modified after serialization. Create a new document to produce additional output.",
        );
      }
      await serializeDocumentToSink(this.toModel(), sink);
      return;
    }
    this._finalized = true;
    this._finalizedPageCount = this.pages.length;
    this._finalizedBytes = this._serializeToBytes();
    await serializeDocumentToSink(this.toModel(), sink);
    } finally {
      this._writing = false;
    }
  }

  /**
   * Serializes the document into an ArrayBuffer.
   *
   * @returns The serialized PDF data as an ArrayBuffer.
   */
  toArrayBuffer(): ArrayBuffer {
    if (this._finalized) {
      if (this.pages.length !== this._finalizedPageCount) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_OPERATION,
          "Document has been modified after serialization. Create a new document to produce additional output.",
        );
      }
      const bytes = this._finalizedBytes!;
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return buffer;
    }
    this._finalized = true;
    this._finalizedPageCount = this.pages.length;
    this._finalizedBytes = this._serializeToBytes();
    const buffer = new ArrayBuffer(this._finalizedBytes.byteLength);
    new Uint8Array(buffer).set(this._finalizedBytes);
    return buffer;
  }

  /**
   * Serializes the document into a PDF Blob.
   *
   * @returns The serialized PDF data as a Blob.
   */
  toBlob(): Blob {
    if (this._finalized) {
      if (this.pages.length !== this._finalizedPageCount) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_OPERATION,
          "Document has been modified after serialization. Create a new document to produce additional output.",
        );
      }
      return new Blob([this._finalizedBytes! as BlobPart], { type: "application/pdf" });
    }
    this._finalized = true;
    this._finalizedPageCount = this.pages.length;
    this._finalizedBytes = this._serializeToBytes();
    return new Blob([this._finalizedBytes as BlobPart], { type: "application/pdf" });
  }

  /**
   * Internal serialization without finalization checks.
   */
  private _serializeToBytes(): Uint8Array {
    return serializeDocument(this.toModel());
  }

  /**
   * Returns the internal document model used by the serializer.
   *
   * @returns The internal document model.
   */
  toModel(): PdfDocumentModel {
    if (this.pages.length === 0) {
      throw new PdfEngineError(
        PdfErrorCode.EMPTY_PAGE,
        "A PDF document must contain at least one page.",
      );
    }

    validateManagedPages(this.pages, this.embeddedFonts);

    const pageSet = new Set(this.pages);

    const seenDestinations = new Set<string>();
    for (const destination of this.namedDestinations) {
      if (!pageSet.has(destination.target)) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_DESTINATION,
          "Named destinations must target a page from the same document.",
          { name: destination.name },
        );
      }

      if (seenDestinations.has(destination.name)) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_DESTINATION,
          "Named destination names must be unique.",
          {
            name: destination.name,
          },
        );
      }

      seenDestinations.add(destination.name);
    }

    for (const outline of this.outlines) {
      validateOutline(outline, pageSet, seenDestinations);
    }

    const pageLabels: InternalPageLabelModel[] = [];
    for (const [target, options] of this.pageLabels.entries()) {
      if (!pageSet.has(target)) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_PAGE_LABEL,
          "Page labels must target a page from the same document.",
        );
      }

      pageLabels.push({ target, options });
    }

    const attachmentNames = new Set<string>();
    for (const attachment of this.attachments) {
      if (attachmentNames.has(attachment.name)) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_ATTACHMENT,
          "Attachment names must be unique within a document.",
          {
            name: attachment.name,
          },
        );
      }
      attachmentNames.add(attachment.name);
    }

    if (this.calculationOrder !== undefined) {
      const fieldNames = new Set<string>();
      for (const page of this.pages) {
        for (const annotation of page.annotations) {
          if (
            'name' in annotation &&
            (annotation.type === 'textField' ||
              annotation.type === 'checkBox' ||
              annotation.type === 'choiceField' ||
              annotation.type === 'radioGroup' ||
              annotation.type === 'pushButton' ||
              annotation.type === 'signatureField')
          ) {
            fieldNames.add(annotation.name);
          }
        }
      }
      for (const name of this.calculationOrder) {
        if (!fieldNames.has(name)) {
          throw new PdfEngineError(
            PdfErrorCode.INVALID_FORM_FIELD,
            `Calculation order field "${name}" does not exist in the document.`,
            { name },
          );
        }
      }
    }

    const complianceIssues = this.validateCompliance();
    const complianceErrors = complianceIssues.filter(
      (issue) => issue.severity === "error",
    );
    if (complianceErrors.length > 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        complianceErrors[0]!.message,
        {
          issues: complianceErrors,
        },
      );
    }

    const tagged =
      this.accessibility.tagged || hasTaggedPageContent(this.pages);

    return {
      info: this.info,
      ...(this.xmpMetadata === undefined
        ? {}
        : { xmpMetadata: this.xmpMetadata }),
      ...(this.encryption === undefined ? {} : { encryption: this.encryption }),
      ...(this.accessibility.language === undefined
        ? {}
        : { language: this.accessibility.language }),
      tagged,
      ...(this.accessibility.roleMap === undefined
        ? {}
        : { roleMap: this.accessibility.roleMap }),
      ...(this.accessibility.structureRoot === undefined
        ? {}
        : { structureRoot: this.accessibility.structureRoot }),
      ...(this.accessibility.conformance === undefined
        ? {}
        : { conformance: this.accessibility.conformance }),
      ...(this.compress === undefined ? {} : { compress: this.compress }),
      ...(this.objectStreams === undefined
        ? {}
        : { objectStreams: this.objectStreams }),
      ...(this.linearize === undefined ? {} : { linearize: this.linearize }),
      ...(this.outputIntent === undefined
        ? {}
        : { outputIntent: this.outputIntent }),
      ...(this.signature === undefined ? {} : { signature: this.signature }),
      ...(this.calculationOrder === undefined
        ? {}
        : { calculationOrder: this.calculationOrder }),
      ...(this.textShaper === undefined ? {} : { textShaper: this.textShaper }),
      embeddedFonts: [...this.embeddedFonts.values()],
      namedDestinations: this.namedDestinations,
      pageLabels,
      attachments: this.attachments,
      outlines: this.outlines,
      pages: this.pages,
      softMasks: this.softMasks,
    };
  }

  /**
   * Creates a deep clone of this document. The clone is independently
   * modifiable — it copies all pages, fonts, images, metadata, and the
   * structure tree. Embedded font data is reused from the shared font cache
   * (cross-document sharing).
   *
   * @returns A new {@link PdfDocument} instance with a deep copy of the document model.
   */
  clone(): PdfDocument {
    const cloned = new PdfDocument({
      defaultPageSize: this.defaultPageSize,
      info: {
        title: this.info.title,
        author: this.info.author,
        subject: this.info.subject,
        keywords: this.info.keywords,
        creator: this.info.creator,
        producer: this.info.producer,
        creationDate: this.info.creationDate,
        modificationDate: this.info.modificationDate,
      },
      xmpMetadata: this.xmpMetadata,
      language: this.accessibility.language,
      tagged: this.accessibility.tagged,
      roleMap: this.accessibility.roleMap,
      structureRoot: this.accessibility.structureRoot,
      conformance: this.accessibility.conformance,
      compress: this.compress,
      objectStreams: this.objectStreams,
      linearize: this.linearize,
      outputIntent: this.outputIntent,
      textShaper: this.textShaper,
    });

    for (const [key, font] of this.embeddedFonts) {
      cloned.embeddedFonts.set(key, font);
    }

    for (const destination of this.namedDestinations) {
      cloned.namedDestinations.push(destination);
    }

    for (const attachment of this.attachments) {
      cloned.attachments.push(attachment);
    }

    for (const outline of this.outlines) {
      cloned.outlines.push(cloneOutlineModel(outline));
    }

    cloned.calculationOrder = this.calculationOrder
      ? [...this.calculationOrder]
      : undefined;

    const pageMap = new Map<InternalPageModel, InternalPageModel>();
    for (const page of this.pages) {
      const clonedPage = clonePageModel(page, cloned.embeddedFonts);
      pageMap.set(page, clonedPage);
      cloned.pages.push(clonedPage);
    }

    for (let i = 0; i < cloned.namedDestinations.length; i++) {
      const original = this.namedDestinations[i]!;
      const mapped = pageMap.get(original.target);
      if (mapped) {
        cloned.namedDestinations[i] = { name: original.name, target: mapped };
      }
    }

    for (const [originalTarget, options] of this.pageLabels) {
      const mapped = pageMap.get(originalTarget);
      if (mapped) {
        cloned.pageLabels.set(mapped, options);
      }
    }

    remapOutlineTargets(cloned.outlines, pageMap);

    for (const mask of this.softMasks) {
      cloned.softMasks.push({
        key: mask.key,
        width: mask.width,
        height: mask.height,
        ops: mask.ops.map((op) => cloneOp(op)),
      });
    }

    return cloned;
  }

  /**
   * Configures certificate-based (public-key) encryption for the document.
   * Each recipient certificate is a DER-encoded X.509 certificate whose
   * public key is used to encrypt a random 20-byte seed. The /SubFilter
   * /adbe.pkcs7.s5 security handler stores the encrypted seeds in a
   * /Recipients array so each recipient can decrypt the document with
   * their private key.
   *
   * For simplicity this method only implements encryption — existing
   * encrypted files are not decrypted.
   *
   * @param certificates An array of DER-encoded X.509 certificate bytes.
   */
  encryptForRecipients(certificates: Uint8Array[]): void {
    this._mutate();
    if (certificates.length === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_ENCRYPTION,
        "At least one certificate is required for public-key encryption.",
      );
    }

    const seed = generateRandom20ByteSeed();
    const recipients: Array<Uint8Array> = [];

    for (const cert of certificates) {
      const publicKey = parseX509PublicKey(cert);
      if (!publicKey) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_ENCRYPTION,
          "Failed to extract RSA public key from certificate.",
        );
      }
      const encryptedSeed = rsaPkcs1Encrypt(seed, publicKey.n, publicKey.e);
      recipients.push(encryptedSeed);
    }

    const recipientsArray = buildRecipientsPdfArray(recipients);
    (this as Record<string, unknown>)._publicKeyRecipients = recipientsArray;
    (this as Record<string, unknown>)._publicKeySeed = seed;

    this._unlock();
  }

  /**
   * Estimates the byte size needed for a detached-signature placeholder.
   *
   * @param certificateBytes Optional certificate bytes for size estimation.
   *
   * @returns The estimated placeholder size in bytes.
   */
  static estimateSignatureSize(certificateBytes?: Uint8Array | null): number {
    return estimateSignatureSize(certificateBytes);
  }

  /**
   * Serializes the document and writes it to a file path.
   *
   * @param path The file path to write to.
   */
  async writeToFile(path: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    const bytes = this.toUint8Array();
    await writeFile(path, bytes);
  }

  /**
   * Writes all previously added pages to the sink and returns a new
   * {@link PdfPage} for the next page. When called repeatedly this
   * streams pages as they are built, reducing peak memory for
   * very large documents (1000+ pages).
   *
   * @param sink The sink that receives the serialized bytes.
   *
   * @returns A new page builder for continuing to add pages.
   */
  async writeNextPage(sink: ByteSink): Promise<PdfPage> {
    const { serializeDocumentToSink } = await import('./internal/serializer.js');
    const model = this.toModel();
    await serializeDocumentToSink(model, sink);
    const page = createPageModel(this.defaultPageSize);
    this.pages.push(page);
    return new PdfPage(page, this.embeddedFonts);
  }

  /**
   * Returns the number of pages that have been added but not yet
   * written via {@link writeNextPage}.
   */
  get remainingPages(): number {
    return this._finalizedPageCount > 0
      ? this.pages.length - this._finalizedPageCount
      : 0;
  }
}

/**
 *
 * A mutable editor for applying incremental updates to an existing PDF document. It supports page edits, appended pages, form updates, structure changes, embedded resources, and incremental serialization.
 */
export class PdfEditableDocument {
  /** Appended pages. */
  private readonly appendedPages: InternalPageModel[] = [];
  /** Edited pages. */
  private readonly editedPages = new Map<number, InternalPageModel>();
  /** Embedded fonts. */
  private readonly embeddedFonts = new Map<string, ParsedTrueTypeFont>();
  /** Page size used when a page does not specify its own size. */
  private readonly defaultPageSize: ResolvedPageSize;
  /** Page order. */
  private readonly pageOrder: EditablePageEntry[];
  /** Field updates. */
  private readonly fieldUpdates = new Map<number, ExistingFieldUpdate>();
  /** Flattened field object ids. */
  private readonly flattenedFieldObjectIds = new Set<number>();
  /** Editable structure elements. */
  private readonly editableStructureElements: readonly ParsedPdfEditableStructureElement[];
  /** Editable structure element handles. */
  private readonly editableStructureElementHandles = new WeakSet<object>();
  /** Editable structure elements by object id. */
  private readonly editableStructureElementsByObjectId = new Map<
    number,
    ParsedPdfEditableStructureElement
  >();
  /** Editable structure child ids by parent object id. */
  private readonly editableStructureChildIdsByParentObjectId = new Map<
    number,
    readonly number[]
  >();
  /** Structure role updates. */
  private readonly structureRoleUpdates = new Map<
    number,
    Exclude<PdfStructureTag, "Artifact">
  >();
  /** Structure alt text updates. */
  private readonly structureAltTextUpdates = new Map<
    number,
    string | undefined
  >();
  /** Structure children order updates. */
  private readonly structureChildrenOrderUpdates = new Map<
    number,
    readonly number[]
  >();
  /** Updated info. */
  private updatedInfo: NormalizedDocumentInfo | undefined;
  /** Updated xmp metadata. */
  private updatedXmpMetadata?: string | undefined;
  /** Has updated xmp metadata. */
  private hasUpdatedXmpMetadata = false;
  /** Detached digital-signature options for serialized output. */
  private signature?: DocumentSignatureOptions | undefined;
  /** Encryption upgrade options for the next save. */
  private _upgradeEncryption?: NormalizedDocumentEncryption | undefined;
  /** Tagged base. */
  private readonly taggedBase: boolean;
  /** Conformance base. */
  private readonly conformanceBase: DocumentConformanceProfile | undefined;

  /** Whether the document has already been serialized. */
  private _finalized = false;

  /** Whether a write is in progress. */
  private _writing = false;

  /** Snapshot of page count captured at finalization time. */
  private _finalizedPageCount = 0;

  /** Cached serialized bytes, returned on subsequent calls when unchanged. */
  private _finalizedBytes?: Uint8Array | undefined;

  /**
   * Creates an editor around a parsed source PDF.
   *
   * @param base The parsed source PDF to edit.
   */
  constructor(private readonly base: ParsedPdfDocument) {
    this.taggedBase = base.isTagged();
    this.conformanceBase = base.getConformanceProfile();
    this.defaultPageSize = resolvePageSize(
      resolveDefaultEditablePageSize(base),
    );
    this.pageOrder = base.listPages().map((page) => ({
      kind: "existing",
      objectId: page.objectId,
    }));
    this.editableStructureElements = base.listEditableStructureElements();
    for (const element of this.editableStructureElements) {
      indexEditableStructureElement(
        this.editableStructureElementsByObjectId,
        this.editableStructureElementHandles,
        element,
      );
      indexEditableStructureChildOrder(
        this.editableStructureChildIdsByParentObjectId,
        element,
      );
    }
  }

  /**
   * Guards against mutations after the document has been finalized.
   */
  private _mutate(): void {
    if (this._finalized) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_OPERATION,
        "Document has been finalized and cannot be modified.",
      );
    }
  }

  /**
   * Appends a new page and returns its page builder.
   *
   * @param options Options that control the operation.
   *
   * @returns The new page builder.
   */
  addPage(options: PageOptions = {}): PdfPage {
    return this.insertPage(this.pageOrder.length, options);
  }

  /**
   * Inserts a new page at the requested position and returns its page builder.
   *
   * @param index The page index.
   * @param options Options that control the operation.
   *
   * @returns The inserted page builder.
   */
  insertPage(index: number, options: PageOptions = {}): PdfPage {
    this._mutate();
    if (
      (this.taggedBase || this.conformanceBase !== undefined) &&
      index !== this.pageOrder.length
    ) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Tagged or PDF/A incremental editing currently supports appending pages only.",
      );
    }

    assertEditablePageIndex(index, this.pageOrder.length, "insert");
    const page = createPageModel(options.size ?? this.defaultPageSize, undefined, options.tabOrder);
    this.appendedPages.push(page);
    this.pageOrder.splice(index, 0, {
      kind: "appended",
      page,
    });
    return new PdfPage(page, this.embeddedFonts);
  }

  /**
   * Returns the current page count including appended and inserted pages.
   *
   * @returns The page count.
   */
  getPageCount(): number {
    return this.pageOrder.length;
  }

  /**
   * Removes a page from the editable page order.
   *
   * @param index The page index.
   */
  removePage(index: number): void {
    this._mutate();
    if (this.taggedBase || this.conformanceBase !== undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Tagged or PDF/A incremental editing does not support removing pages yet.",
      );
    }

    assertEditablePageIndex(index, this.pageOrder.length - 1, "remove");
    const [removed] = this.pageOrder.splice(index, 1);
    if (removed?.kind === "appended") {
      const appendedIndex = this.appendedPages.indexOf(removed.page);
      if (appendedIndex >= 0) {
        this.appendedPages.splice(appendedIndex, 1);
      }
    }
  }

  /**
   * Moves a page from one position to another.
   *
   * @param fromIndex The current page index.
   * @param toIndex The destination page index.
   */
  movePage(fromIndex: number, toIndex: number): void {
    this._mutate();
    if (this.taggedBase || this.conformanceBase !== undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Tagged or PDF/A incremental editing does not support reordering pages yet.",
      );
    }

    assertEditablePageIndex(fromIndex, this.pageOrder.length - 1, "move");
    assertEditablePageIndex(toIndex, this.pageOrder.length - 1, "move");
    if (fromIndex === toIndex) {
      return;
    }

    const [entry] = this.pageOrder.splice(fromIndex, 1);
    if (!entry) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PAGE,
        "Page move index could not be resolved.",
        {
          fromIndex,
          toIndex,
        },
      );
    }

    this.pageOrder.splice(toIndex, 0, entry);
  }

  /**
   * Creates or returns a page builder for editing an existing page.
   *
   * @param index The page index.
   *
   * @returns The editable page builder.
   */
  editPage(index: number): PdfPage {
    this._mutate();
    assertEditablePageIndex(index, this.pageOrder.length - 1, "edit");
    const entry = this.pageOrder[index];
    if (!entry) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PAGE,
        "Editable page could not be resolved.",
        {
          index,
        },
      );
    }

    if (entry.kind === "appended") {
      return new PdfPage(entry.page, this.embeddedFonts);
    }

    const existing = this.editedPages.get(entry.objectId);
    if (existing) {
      return new PdfPage(existing, this.embeddedFonts);
    }

    const overlay = createPageModel(
      resolveEditablePageSize(this.base, entry.objectId),
    );
    this.editedPages.set(entry.objectId, overlay);
    return new PdfPage(overlay, this.embeddedFonts);
  }

  /**
   * Writes raw PDF content operators to an existing page's content stream.
   *
   * @param index The page index.
   * @param content Raw PDF content stream operators (e.g. "BT /F1 12 Tf (Hello) Tj ET").
   * @param mode How to apply the content: replace entirely, append
   *   after existing (wraps existing in q/Q), or prepend before existing
   *   (wraps existing in q/Q).
   */
  writePageContent(
    index: number,
    content: string,
    mode: "replace" | "append" | "prepend",
  ): void {
    this._mutate();
    assertEditablePageIndex(index, this.pageOrder.length - 1, "write content");
    const entry = this.pageOrder[index];
    if (!entry) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PAGE,
        "Editable page could not be resolved.",
        { index },
      );
    }

    if (entry.kind === "appended") {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_OPERATION,
        "writePageContent is only supported on existing pages. Use PdfPage methods directly for appended pages.",
      );
    }

    const page = this.editedPages.get(entry.objectId);
    if (page) {
      page.contentOverlay = { mode, content };
      return;
    }

    const overlay = createPageModel(
      resolveEditablePageSize(this.base, entry.objectId),
    );
    overlay.contentOverlay = { mode, content };
    this.editedPages.set(entry.objectId, overlay);
  }

  /**
   * Embeds a TrueType font for use by appended or edited pages.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   *
   * @returns The result of the operation.
   */
  embedTrueTypeFont(
    data: BinaryData,
    options: EmbedTrueTypeFontOptions = {},
  ): PdfEmbeddedFont {
    this._mutate();
    const bytes = toBytes(data);
    const cacheKey = hashBytes(bytes);
    const cached = fontCache.get(cacheKey);
    if (cached) {
      this.embeddedFonts.set(cached.id, cached);
      return cached;
    }
    const font = parseTrueTypeFont(data, { family: options.family, ttcIndex: options.ttcIndex });
    fontCache.set(cacheKey, font);
    this.embeddedFonts.set(font.id, font);
    return font;
  }

  /**
   * Queues updates to the document information dictionary.
   *
   * @param info The document information metadata to merge.
   */
  updateInfo(info: DocumentInfo): void {
    this._mutate();
    const current =
      this.updatedInfo ??
      normalizeDocumentInfo(
        parsedMetadataToDocumentInfo(this.base.getMetadata()),
      );
    this.updatedInfo = normalizeDocumentInfo({
      title: info.title ?? current.title,
      author: info.author ?? current.author,
      subject: info.subject ?? current.subject,
      keywords: info.keywords ?? current.keywords,
      creator: info.creator ?? current.creator,
      producer: info.producer ?? current.producer,
      creationDate: info.creationDate ?? current.creationDate,
      modificationDate: info.modificationDate ?? current.modificationDate,
    });
  }

  /**
   * Queues an XMP metadata update or removal.
   *
   * @param metadata The XMP metadata input, or undefined to clear it.
   */
  setXmpMetadata(metadata: XmpMetadataInput | undefined): void {
    this._mutate();
    this.updatedXmpMetadata = normalizeXmpMetadata(metadata);
    this.hasUpdatedXmpMetadata = true;
  }

  /**
   * Queues a form field value update by field name.

  /**
   * Queues a form field value update by field name.
   *
   * @param name The name to assign or look up.
   * @param value The value to write or apply.
   */
  setFieldValue(name: string, value: string | boolean): void {
    this._mutate();
    const match = resolveEditableFieldTarget(
      this.base,
      this.pageOrder,
      this.appendedPages,
      name,
    );
    if (match.source === "appended") {
      if (match.annotation.type === "textField") {
        if (typeof value !== "string") {
          throw new PdfEngineError(
            PdfErrorCode.INVALID_FORM_FIELD,
            "Text fields can only be updated with string values.",
            {
              name,
            },
          );
        }

        validateTextFieldValue(value);
        match.annotation.options.value = value;
        return;
      }

      if (match.annotation.type === "checkBox") {
        if (typeof value !== "boolean") {
          throw new PdfEngineError(
            PdfErrorCode.INVALID_FORM_FIELD,
            "Check boxes can only be updated with boolean values.",
            {
              name,
            },
          );
        }

        match.annotation.options.checked = value;
        return;
      }

      if (match.annotation.type === "radioGroup") {
        if (typeof value !== "string") {
          throw new PdfEngineError(
            PdfErrorCode.INVALID_FORM_FIELD,
            "Radio groups can only be updated with string values.",
            {
              name,
            },
          );
        }

        validateChoiceFieldValue(
          value,
          match.annotation.options.items.map((item) => item.value),
        );
        match.annotation.options.value = value;
        return;
      }

      if (typeof value !== "string") {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          "Choice fields can only be updated with string values.",
          {
            name,
          },
        );
      }

      validateChoiceFieldValue(value, match.annotation.options.options);
      match.annotation.options.value = value;
      return;
    }

    if (match.field.fieldType === "Tx") {
      if (typeof value !== "string") {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          "Text fields can only be updated with string values.",
          {
            name,
          },
        );
      }

      validateTextFieldValue(value);
      this.fieldUpdates.set(match.field.objectId, {
        objectId: match.field.objectId,
        fieldType: "Tx",
        value,
      });
      return;
    }

    if (match.field.fieldType === "Btn" && match.field.buttonKind !== "radio") {
      if (typeof value !== "boolean") {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          "Check boxes can only be updated with boolean values.",
          {
            name,
          },
        );
      }

      this.fieldUpdates.set(match.field.objectId, {
        objectId: match.field.objectId,
        fieldType: "Btn",
        value,
        ...(match.onStateName ? { onStateName: match.onStateName } : {}),
      });
      return;
    }

    if (match.field.buttonKind === "radio") {
      if (typeof value !== "string") {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          "Radio groups can only be updated with string values.",
          {
            name,
          },
        );
      }

      validateChoiceFieldValue(value, match.field.options);
      this.fieldUpdates.set(match.field.objectId, {
        objectId: match.field.objectId,
        fieldType: "Radio",
        value,
      });
      return;
    }

    if (match.field.fieldType === "Ch") {
      if (typeof value !== "string") {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          "Choice fields can only be updated with string values.",
          {
            name,
          },
        );
      }

      validateChoiceFieldValue(value, match.field.options);
      this.fieldUpdates.set(match.field.objectId, {
        objectId: match.field.objectId,
        fieldType: "Ch",
        value,
      });
      return;
    }

    throw new PdfEngineError(
      PdfErrorCode.INVALID_FORM_FIELD,
      "Only text fields, choice fields, check boxes, and radio groups can be incrementally updated.",
      {
        name,
        fieldType: match.field.fieldType,
      },
    );
  }

  /**
   * Returns editable tagged structure element handles from the source document.
   *
   * @returns The editable structure element handles.
   */
  listEditableStructureElements(): readonly PdfEditableStructureElement[] {
    if (!this.taggedBase) {
      return [];
    }

    return this.editableStructureElements;
  }

  /**
   * Finds editable tagged structure elements that match the supplied query.
   *
   * @param query The criteria used to match structure elements.
   *
   * @returns The result of the operation.
   */
  findEditableStructureElements(
    query: PdfEditableStructureQuery = {},
  ): readonly PdfEditableStructureElement[] {
    if (!this.taggedBase) {
      return [];
    }

    const objectIdSet = query.objectIds ? new Set(query.objectIds) : undefined;
    return [...this.editableStructureElementsByObjectId.values()].filter(
      (element) => {
        if (query.role !== undefined && element.role !== query.role) {
          return false;
        }
        if (
          query.pageObjectId !== undefined &&
          element.pageObjectId !== query.pageObjectId
        ) {
          return false;
        }
        if (
          query.parentObjectId !== undefined &&
          element.parentObjectId !== query.parentObjectId
        ) {
          return false;
        }
        if (
          query.hasAltText !== undefined &&
          (element.altText !== undefined) !== query.hasAltText
        ) {
          return false;
        }
        if (objectIdSet !== undefined && !objectIdSet.has(element.objectId)) {
          return false;
        }
        return true;
      },
    );
  }

  /**
   * Finds tagged structure elements related to the supplied element.
   *
   * @param target The destination page, outline target, or structure element.
   * @param options Options that control the operation.
   *
   * @returns The result of the operation.
   */
  findSimilarStructureElements(
    target: PdfEditableStructureElement,
    options: PdfEditableStructureSimilarityOptions = {},
  ): readonly PdfEditableStructureElement[] {
    const known = this.requireEditableStructureHandle(target);
    const scope = options.scope ?? "document";
    return this.findEditableStructureElements({
      role: known.role,
      ...(scope === "page" ? { pageObjectId: known.pageObjectId } : {}),
      ...(scope === "siblings" ? { parentObjectId: known.parentObjectId } : {}),
    });
  }

  /**
   * Queues a role update for a tagged structure element.
   *
   * @param target The destination page, outline target, or structure element.
   * @param role The replacement structure role.
   */
  setStructureRole(
    target: PdfEditableStructureElement,
    role: Exclude<PdfStructureTag, "Artifact">,
  ): void {
    this._mutate();
    if (!this.taggedBase) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Structure role updates require a tagged PDF.",
      );
    }

    validateEditableStructureRole(role);
    const known = this.requireEditableStructureHandle(target);

    if (known.role === role) {
      this.structureRoleUpdates.delete(target.objectId);
      return;
    }

    this.structureRoleUpdates.set(target.objectId, role);
  }

  /**
   * Queues role updates for multiple tagged structure elements.
   *
   * @param targets The structure element handles to update.
   * @param role The replacement structure role.
   */
  setStructureRoles(
    targets: readonly PdfEditableStructureElement[],
    role: Exclude<PdfStructureTag, "Artifact">,
  ): void {
    for (const target of targets) {
      this.setStructureRole(target, role);
    }
  }

  /**
   * Queues alternate text updates for a tagged structure element.
   *
   * @param target The destination page, outline target, or structure element.
   * @param altText The replacement alternate text, or undefined to clear it.
   */
  setStructureAltText(
    target: PdfEditableStructureElement,
    altText: string | undefined,
  ): void {
    this._mutate();
    if (!this.taggedBase) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Structure alt-text updates require a tagged PDF.",
      );
    }

    const known = this.requireEditableStructureHandle(target);

    const normalizedAltText = normalizeEditableAltText(altText);
    if (known.altText === normalizedAltText) {
      this.structureAltTextUpdates.delete(target.objectId);
      return;
    }

    this.structureAltTextUpdates.set(target.objectId, normalizedAltText);
  }

  /**
   * Queues a child reading-order update for a tagged structure element.
   *
   * @param orderedChildren The child element handles in the desired reading order.
   */
  setStructureReadingOrder(
    orderedChildren: readonly PdfEditableStructureElement[],
  ): void {
    this._mutate();
    if (!this.taggedBase) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Structure reading-order updates require a tagged PDF.",
      );
    }
    if (orderedChildren.length < 2) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Structure reading-order updates require at least two sibling elements.",
      );
    }

    const resolved = orderedChildren.map((child) =>
      this.requireEditableStructureHandle(child),
    );
    const parentObjectId = resolved[0]?.parentObjectId;
    if (parentObjectId === undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Structure reading order requires sibling elements with a resolvable parent.",
        {
          objectIds: resolved.map((element) => element.objectId),
        },
      );
    }
    if (resolved.some((child) => child.parentObjectId !== parentObjectId)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Structure reading-order updates require sibling elements that share the same parent.",
        {
          objectIds: resolved.map((element) => element.objectId),
        },
      );
    }

    const siblingIds =
      this.editableStructureChildIdsByParentObjectId.get(parentObjectId);
    if (!siblingIds) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Structure reading-order parent could not be resolved.",
        {
          parentObjectId,
        },
      );
    }

    const orderedIds = resolved.map((element) => element.objectId);
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Structure reading-order updates cannot contain duplicate elements.",
        {
          objectIds: orderedIds,
        },
      );
    }
    if (orderedIds.some((objectId) => !siblingIds.includes(objectId))) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Structure reading-order updates must target sibling elements from the same parent.",
        {
          parentObjectId,
          expectedObjectIds: siblingIds,
          actualObjectIds: orderedIds,
        },
      );
    }

    const parent = this.editableStructureElementsByObjectId.get(parentObjectId);
    if (parent && (parent.mcids?.length ?? 0) > 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Structure reading-order updates are not supported for parents with direct MCID content.",
        {
          parentObjectId,
        },
      );
    }

    if (siblingIds.every((objectId, index) => objectId === orderedIds[index])) {
      this.structureChildrenOrderUpdates.delete(parentObjectId);
      return;
    }

    this.structureChildrenOrderUpdates.set(parentObjectId, orderedIds);
  }

  /**
   * Validates that a structure element handle belongs to this editable document.
   *
   * @param target The destination page, outline target, or structure element.
   *
   * @returns The result of the operation.
   */
  private requireEditableStructureHandle(
    target: PdfEditableStructureElement,
  ): ParsedPdfEditableStructureElement {
    if (!this.editableStructureElementHandles.has(target)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Editable structure element handle could not be resolved.",
        {
          objectId: target.objectId,
        },
      );
    }

    const known = this.editableStructureElementsByObjectId.get(target.objectId);
    if (!known || !matchesEditableStructureElementHandle(known, target)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Editable structure element handle could not be resolved.",
        {
          objectId: target.objectId,
        },
      );
    }

    return known;
  }

  /**
   * Sets encryption options for the next save, upgrading the encryption algorithm.
   * New and modified objects will use the new encryption.
   *
   * @param options Encryption options for the next save.
   */
  setEncryption(options: DocumentEncryptionOptions): void {
    this._mutate();
    this._upgradeEncryption = normalizeDocumentEncryption(options);
  }

  /**
   * Adds a detached digital signature as an incremental update.
   *
   * @param options Signature options, including the CMS/PKCS#7 signer callback.
   */
  sign(options: DocumentSignatureOptions): void {
    this._mutate();
    this.signature = options;
  }

  /**
   * Serializes the incremental update into PDF bytes.
   *
   * @returns The serialized or collected bytes.
   */
  toUint8Array(): Uint8Array {
    if (this._finalized) {
      if (this.pageOrder.length !== this._finalizedPageCount) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_OPERATION,
          "Document has been modified after serialization. Create a new document to produce additional output.",
        );
      }
      return this._finalizedBytes!;
    }
    this._finalized = true;
    this._finalizedPageCount = this.pageOrder.length;
    this._finalizedBytes = this._serializeToBytes();
    return this._finalizedBytes;
  }

  /**
   * Streams the incremental update bytes to a byte sink.
   *
   * @param sink The sink that receives written byte chunks.
   */
  async writeTo(sink: ByteSink): Promise<void> {
    if (this._writing) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_OPERATION,
        "Another write is already in progress.",
      );
    }
    this._writing = true;
    try {
    if (this._finalized) {
      if (this.pageOrder.length !== this._finalizedPageCount) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_OPERATION,
          "Document has been modified after serialization. Create a new document to produce additional output.",
        );
      }
      if (
        !hasEditablePageChanges(this.base, this.pageOrder) &&
        this.updatedInfo === undefined &&
        !this.hasUpdatedXmpMetadata &&
        this.fieldUpdates.size === 0 &&
        this.editedPages.size === 0 &&
        this.flattenedFieldObjectIds.size === 0 &&
        this.structureRoleUpdates.size === 0 &&
        this.structureAltTextUpdates.size === 0 &&
        this.structureChildrenOrderUpdates.size === 0 &&
        this.signature === undefined
      ) {
        await sink.write(this.base.getSourceBytes());
        await sink.close();
        return;
      }
      await serializeIncrementalUpdateToSink(this.toIncrementalModel(), sink);
      return;
    }
    this._finalized = true;
    this._finalizedPageCount = this.pageOrder.length;
    this._finalizedBytes = this._serializeToBytes();
    if (
      !hasEditablePageChanges(this.base, this.pageOrder) &&
      this.updatedInfo === undefined &&
      !this.hasUpdatedXmpMetadata &&
      this.fieldUpdates.size === 0 &&
      this.editedPages.size === 0 &&
      this.flattenedFieldObjectIds.size === 0 &&
      this.structureRoleUpdates.size === 0 &&
      this.structureAltTextUpdates.size === 0 &&
      this.structureChildrenOrderUpdates.size === 0 &&
      this.signature === undefined
    ) {
      await sink.write(this.base.getSourceBytes());
      await sink.close();
      return;
    }
    await serializeIncrementalUpdateToSink(this.toIncrementalModel(), sink);
    } finally {
      this._writing = false;
    }
  }

  /**
   * Serializes the incremental update into an ArrayBuffer.
   *
   * @returns The serialized PDF data as an ArrayBuffer.
   */
  toArrayBuffer(): ArrayBuffer {
    if (this._finalized) {
      if (this.pageOrder.length !== this._finalizedPageCount) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_OPERATION,
          "Document has been modified after serialization. Create a new document to produce additional output.",
        );
      }
      const bytes = this._finalizedBytes!;
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return buffer;
    }
    this._finalized = true;
    this._finalizedPageCount = this.pageOrder.length;
    this._finalizedBytes = this._serializeToBytes();
    const buffer = new ArrayBuffer(this._finalizedBytes.byteLength);
    new Uint8Array(buffer).set(this._finalizedBytes);
    return buffer;
  }

  /**
   * Serializes the incremental update into a PDF Blob.
   *
   * @returns The serialized PDF data as a Blob.
   */
  toBlob(): Blob {
    if (this._finalized) {
      if (this.pageOrder.length !== this._finalizedPageCount) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_OPERATION,
          "Document has been modified after serialization. Create a new document to produce additional output.",
        );
      }
      return new Blob([this._finalizedBytes! as BlobPart], { type: "application/pdf" });
    }
    this._finalized = true;
    this._finalizedPageCount = this.pageOrder.length;
    this._finalizedBytes = this._serializeToBytes();
    return new Blob([this._finalizedBytes as BlobPart], { type: "application/pdf" });
  }

  /**
   * Internal serialization without finalization checks.
   */
  private _serializeToBytes(): Uint8Array {
    if (
      !hasEditablePageChanges(this.base, this.pageOrder) &&
      this.updatedInfo === undefined &&
      !this.hasUpdatedXmpMetadata &&
      this.fieldUpdates.size === 0 &&
      this.editedPages.size === 0 &&
      this.flattenedFieldObjectIds.size === 0 &&
      this.structureRoleUpdates.size === 0 &&
      this.structureAltTextUpdates.size === 0 &&
      this.structureChildrenOrderUpdates.size === 0 &&
      this.signature === undefined
    ) {
      return this.base.getSourceBytes();
    }

    return serializeIncrementalUpdate(this.toIncrementalModel());
  }

  /**
   * Queues flattening for all parsed form fields.
   */
  flattenForms(): void {
    this._mutate();
    if (this.taggedBase || this.conformanceBase !== undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        "Tagged or PDF/A incremental editing does not support form flattening yet.",
      );
    }

    flattenFormsOnPages(this.appendedPages);
    for (const entry of this.pageOrder) {
      if (entry.kind !== "existing") {
        continue;
      }

      const retainedFields = this.base
        .listFormFields()
        .filter((field) => field.pageObjectId === entry.objectId);
      if (retainedFields.length === 0) {
        continue;
      }

      const page =
        this.editedPages.get(entry.objectId) ??
        createPageModel(resolveEditablePageSize(this.base, entry.objectId));
      this.editedPages.set(entry.objectId, page);
      for (const field of retainedFields) {
        appendFlattenedParsedFieldOps(this.base, page, field);
        this.flattenedFieldObjectIds.add(field.objectId);
        this.fieldUpdates.delete(field.objectId);
      }
    }

    const retainedEditedPageIds = new Set(
      this.pageOrder
        .filter(
          (entry): entry is EditableExistingPageEntry =>
            entry.kind === "existing",
        )
        .map((entry) => entry.objectId),
    );

    for (const objectId of this.editedPages.keys()) {
      if (!retainedEditedPageIds.has(objectId)) {
        this.editedPages.delete(objectId);
      }
    }

    flattenFormsOnPages(this.editedPages.values());
  }

  /**
   * Builds the internal incremental update model for serialization.
   *
   * @returns The internal incremental update model.
   */
  toIncrementalModel(): PdfIncrementalUpdateModel {
    const retainedEditedPages = this.pageOrder
      .filter(
        (entry): entry is EditableExistingPageEntry =>
          entry.kind === "existing",
      )
      .map((entry) => ({
        objectId: entry.objectId,
        page: this.editedPages.get(entry.objectId),
      }))
      .filter(
        (
          entry,
        ): entry is {
          /** PDF indirect object number for the parsed item. */
          objectId: number; /** Page. */
          page: InternalPageModel;
        } => entry.page !== undefined,
      );

    validateManagedPages(
      [
        ...this.appendedPages,
        ...retainedEditedPages.map((entry) => entry.page),
      ],
      this.embeddedFonts,
      collectRetainedEditableFieldNames(this.base, this.pageOrder),
    );
    validateEditableCompliance(
      this.base,
      [
        ...this.appendedPages,
        ...retainedEditedPages.map((entry) => entry.page),
      ],
      this.updatedXmpMetadata,
      this.hasUpdatedXmpMetadata,
    );
    if (this.pageOrder.length === 0) {
      throw new PdfEngineError(
        PdfErrorCode.EMPTY_PAGE,
        "An edited PDF document must contain at least one page.",
      );
    }

    const retainedFieldIds = new Set(
      listRetainedBaseFields(this.base, this.pageOrder).map(
        (field) => field.objectId,
      ),
    );

    return {
      base: this.base,
      appendedPages: this.appendedPages,
      editedPages: retainedEditedPages,
      embeddedFonts: [...this.embeddedFonts.values()],
      pageOrder: this.pageOrder,
      fieldUpdates: [...this.fieldUpdates.values()].filter((update) =>
        retainedFieldIds.has(update.objectId),
      ),
      flattenedFieldObjectIds: [...this.flattenedFieldObjectIds].filter(
        (objectId) => retainedFieldIds.has(objectId),
      ),
      structureRoleUpdates: new Map(this.structureRoleUpdates),
      structureAltTextUpdates: new Map(this.structureAltTextUpdates),
      structureChildrenOrderUpdates: new Map(
        this.structureChildrenOrderUpdates,
      ),
      hasXmpMetadataUpdate: this.hasUpdatedXmpMetadata,
      ...(this.hasUpdatedXmpMetadata
        ? { xmpMetadata: this.updatedXmpMetadata }
        : {}),
      ...(this.updatedInfo ? { info: this.updatedInfo } : {}),
      ...(this.signature ? { signature: this.signature } : {}),
      ...(this._upgradeEncryption ? { encryption: this._upgradeEncryption } : {}),
    };
  }

  /**
   * Estimates the byte size needed for a detached-signature placeholder.
   *
   * @param certificateBytes Optional certificate bytes for size estimation.
   *
   * @returns The estimated placeholder size in bytes.
   */
  static estimateSignatureSize(certificateBytes?: Uint8Array | null): number {
    return estimateSignatureSize(certificateBytes);
  }

  /**
   * Serializes the incremental update and writes it to a file path.
   *
   * @param path The file path to write to.
   */
  async writeToFile(path: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    const bytes = this.toUint8Array();
    await writeFile(path, bytes);
  }
}

/**
 * Creates a new PDF document builder for generating pages, text, graphics, forms, metadata, tagging, and attachments.
 *
 * @param options Document creation options.
 *
 * @returns The new mutable PDF document builder.
 */
export function createDocument(options: DocumentOptions = {}): PdfDocument {
  return new PdfDocument(options);
}

/**
 * Opens an existing PDF for incremental edits such as appending pages, updating fields, changing structure metadata, and preserving existing bytes when possible.
 *
 * @param data The source PDF bytes to edit.
 * @param options Parsing options, including the password for encrypted sources.
 *
 * @returns The mutable incremental editor.
 */
export function editDocument(
  data: BinaryData,
  options: ParseDocumentOptions = {},
): PdfEditableDocument {
  return new PdfEditableDocument(parseDocument(data, options));
}

function createOutlineModel(
  title: string,
  target: PdfPage | string,
  options: OutlineOptions,
): InternalOutlineModel {
  return {
    title: normalizeOutlineTitle(title),
    target:
      typeof target === "string"
        ? {
            type: "named",
            name: normalizeDestinationName(target),
          }
        : {
            type: "page",
            target: target.toInternalModel(),
          },
    options: normalizeOutlineOptions(options),
    children: [],
  };
}

function validateOutline(
  outline: InternalOutlineModel,
  pageSet: ReadonlySet<InternalPageModel>,
  namedDestinations: ReadonlySet<string>,
): void {
  if (outline.target.type === "page" && !pageSet.has(outline.target.target)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OUTLINE,
      "Outline entries must target a page from the same document.",
      {
        title: outline.title,
      },
    );
  }

  if (
    outline.target.type === "named" &&
    !namedDestinations.has(outline.target.name)
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OUTLINE,
      "Outline entries must target an existing named destination.",
      {
        title: outline.title,
        destination: outline.target.name,
      },
    );
  }

  for (const child of outline.children) {
    validateOutline(child, pageSet, namedDestinations);
  }
}

const EDITABLE_STRUCTURE_ROLES = new Set<Exclude<PdfStructureTag, "Artifact">>([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "Span",
  "Quote",
  "Note",
  "Reference",
  "BibEntry",
  "Code",
  "Lbl",
  "LBody",
  "Document",
  "Part",
  "Art",
  "Sect",
  "Div",
  "BlockQuote",
  "Caption",
  "TOC",
  "TOCI",
  "Index",
  "NonStruct",
  "Private",
  "L",
  "LI",
  "Table",
  "THead",
  "TBody",
  "TFoot",
  "TR",
  "TH",
  "TD",
  "Link",
  "Annot",
  "Figure",
  "Formula",
  "Form",
]);

function indexEditableStructureElement(
  output: Map<number, ParsedPdfEditableStructureElement>,
  handles: WeakSet<object>,
  element: ParsedPdfEditableStructureElement,
): void {
  handles.add(element);
  output.set(element.objectId, element);
  for (const child of element.children ?? []) {
    indexEditableStructureElement(output, handles, child);
  }
}

function indexEditableStructureChildOrder(
  output: Map<number, readonly number[]>,
  element: ParsedPdfEditableStructureElement,
): void {
  if (element.parentObjectId !== undefined) {
    const current = output.get(element.parentObjectId) ?? [];
    output.set(element.parentObjectId, [...current, element.objectId]);
  }
  for (const child of element.children ?? []) {
    indexEditableStructureChildOrder(output, child);
  }
}

function validateEditableStructureRole(
  role: string,
): asserts role is Exclude<PdfStructureTag, "Artifact"> {
  if (
    !EDITABLE_STRUCTURE_ROLES.has(role)
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_COMPLIANCE,
      "Unsupported editable structure role.",
      {
        role,
      },
    );
  }
}

function matchesEditableStructureElementHandle(
  expected: ParsedPdfEditableStructureElement,
  actual: PdfEditableStructureElement,
): boolean {
  return (
    expected.objectId === actual.objectId &&
    expected.role === actual.role &&
    expected.parentObjectId === actual.parentObjectId &&
    expected.pageObjectId === actual.pageObjectId &&
    expected.mcid === actual.mcid &&
    arrayEquals(expected.mcids, actual.mcids) &&
    expected.altText === actual.altText &&
    expected.actualText === actual.actualText &&
    expected.language === actual.language
  );
}

function createFlowState(
  page: InternalPageModel,
  options: FlowOptions,
): FlowState {
  const fallback = defaultFlowMargin(page.size);
  const shorthand = resolveMarginShorthand(options.margin);
  const hasShorthand = options.margin !== undefined;
  const top = options.marginTop ?? (hasShorthand ? shorthand.top : fallback);
  const right =
    options.marginRight ?? (hasShorthand ? shorthand.right : fallback);
  const bottomMargin =
    options.marginBottom ?? (hasShorthand ? shorthand.bottom : fallback);
  const leftMargin =
    options.marginLeft ?? (hasShorthand ? shorthand.left : fallback);
  const x = options.x ?? leftMargin;
  const y = options.y ?? page.size.height - top;
  const frameWidth = options.width ?? page.size.width - x - right;
  const columnCount = options.columns?.count ?? 1;
  const columnGap = options.columns?.gap ?? (columnCount > 1 ? 18 : 0);
  if (!Number.isInteger(columnCount) || columnCount < 1) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_NUMBER,
      `Flow columns must be a positive integer, got ${columnCount}.`,
      { columns: columnCount },
    );
  }
  if (!Number.isFinite(columnGap) || columnGap < 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_NUMBER,
      `Flow columns.gap must be a finite non-negative number, got ${columnGap}.`,
      { columnGap },
    );
  }
  const totalColumnGap = columnGap * (columnCount - 1);
  if (!Number.isFinite(frameWidth) || frameWidth <= totalColumnGap) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_NUMBER,
      "Flow width must leave positive space for every column.",
      { width: frameWidth, columns: columnCount, columnGap },
    );
  }
  const columnWidth = (frameWidth - totalColumnGap) / columnCount;

  return {
    x,
    y,
    startY: y,
    width: columnWidth,
    frameX: x,
    columnCount,
    columnGap,
    columnIndex: 0,
    gap: options.gap ?? STANDARD_FLOW_SPACING.paragraphAfter,
    marginBottom: bottomMargin,
    spacing: resolveFlowSpacing(options),
    ...(options.font === undefined ? {} : { font: options.font }),
    ...(options.fallbackFonts === undefined
      ? {}
      : { fallbackFonts: [...options.fallbackFonts] }),
    ...(options.direction === undefined
      ? {}
      : { direction: options.direction }),
    ...(options.fontSize === undefined ? {} : { fontSize: options.fontSize }),
    ...(options.color === undefined ? {} : { color: options.color }),
    ...(options.lineHeight === undefined
      ? {}
      : { lineHeight: options.lineHeight }),
    ...(options.align === undefined ? {} : { align: options.align }),
    ...(options.kerning === undefined ? {} : { kerning: options.kerning }),
    ...(options.writingMode === undefined
      ? {}
      : { writingMode: options.writingMode }),
  };
}

function resolveFlowSpacing(options: FlowOptions): RequiredFlowSpacingScale {
  if (options.gap !== undefined && options.spacing === undefined) {
    return {
      paragraphBefore: 0,
      paragraphAfter: options.gap,
      headingBefore: {
        1: 0,
        2: options.gap,
        3: options.gap,
        4: options.gap,
        5: options.gap,
        6: options.gap,
      },
      headingAfter: {
        1: options.gap,
        2: options.gap,
        3: options.gap,
        4: options.gap,
        5: options.gap,
        6: options.gap,
      },
      tableBefore: options.gap,
      tableAfter: options.gap,
      imageBefore: options.gap,
      imageAfter: options.gap,
      linkBefore: 0,
      linkAfter: options.gap,
    };
  }

  const spacing = options.spacing;
  const gapFallback = spacing === undefined ? options.gap : undefined;
  return {
    paragraphBefore:
      spacing?.paragraphBefore ?? STANDARD_FLOW_SPACING.paragraphBefore,
    paragraphAfter:
      spacing?.paragraphAfter ??
      gapFallback ??
      STANDARD_FLOW_SPACING.paragraphAfter,
    headingBefore: resolveHeadingSpacing(
      spacing?.headingBefore,
      STANDARD_FLOW_SPACING.headingBefore,
      gapFallback,
    ),
    headingAfter: resolveHeadingSpacing(
      spacing?.headingAfter,
      STANDARD_FLOW_SPACING.headingAfter,
      gapFallback,
    ),
    tableBefore: spacing?.tableBefore ?? STANDARD_FLOW_SPACING.tableBefore,
    tableAfter:
      spacing?.tableAfter ?? gapFallback ?? STANDARD_FLOW_SPACING.tableAfter,
    imageBefore: spacing?.imageBefore ?? STANDARD_FLOW_SPACING.imageBefore,
    imageAfter:
      spacing?.imageAfter ?? gapFallback ?? STANDARD_FLOW_SPACING.imageAfter,
    linkBefore: spacing?.linkBefore ?? STANDARD_FLOW_SPACING.linkBefore,
    linkAfter:
      spacing?.linkAfter ?? gapFallback ?? STANDARD_FLOW_SPACING.linkAfter,
  };
}

function resolveHeadingSpacing(
  value: FlowSpacingScale["headingBefore"],
  defaults: Record<HeadingLevelKey, number>,
  legacyGap: number | undefined,
): Record<HeadingLevelKey, number> {
  if (typeof value === "number") {
    return {
      1: value,
      2: value,
      3: value,
      4: value,
      5: value,
      6: value,
    };
  }

  return {
    1: value?.[1] ?? (legacyGap === undefined ? defaults[1] : 0),
    2: value?.[2] ?? legacyGap ?? defaults[2],
    3: value?.[3] ?? legacyGap ?? defaults[3],
    4: value?.[4] ?? legacyGap ?? defaults[4],
    5: value?.[5] ?? legacyGap ?? defaults[5],
    6: value?.[6] ?? legacyGap ?? defaults[6],
  };
}

function flowTextDefaults(state: FlowState): Partial<TextBlockOptions> {
  return {
    ...(state.font === undefined ? {} : { font: state.font }),
    ...(state.fallbackFonts === undefined
      ? {}
      : { fallbackFonts: [...state.fallbackFonts] }),
    ...(state.direction === undefined ? {} : { direction: state.direction }),
    ...(state.fontSize === undefined ? {} : { fontSize: state.fontSize }),
    ...(state.color === undefined ? {} : { color: state.color }),
    ...(state.lineHeight === undefined ? {} : { lineHeight: state.lineHeight }),
    ...(state.align === undefined ? {} : { align: state.align }),
    ...(state.kerning === undefined ? {} : { kerning: state.kerning }),
    ...(state.writingMode === undefined
      ? {}
      : { writingMode: state.writingMode }),
  };
}

function headingFontSize(level: 1 | 2 | 3 | 4 | 5 | 6): number {
  switch (level) {
    case 1:
      return 24;
    case 2:
      return 18;
    case 3:
      return 15;
    default:
      return 12;
  }
}

function validateManagedPages(
  pages: readonly InternalPageModel[],
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  reservedFieldNames: ReadonlySet<string> = new Set(),
): void {
  const fieldNames = new Set(reservedFieldNames);

  for (const [index, page] of pages.entries()) {
    if (page.ops.length === 0 && page.annotations.length === 0 && page.contentOverlay === undefined) {
      throw new PdfEngineError(
        PdfErrorCode.EMPTY_PAGE,
        "Each page must contain at least one drawing operation or annotation.",
        {
          pageIndex: index,
        },
      );
    }

    if (page.graphicsDepth !== 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_GRAPHICS_STATE,
        "Every saveState() call must be balanced by restoreState().",
        {
          pageIndex: index,
          depth: page.graphicsDepth,
        },
      );
    }

    for (const op of page.ops) {
      if (
        op.type === "text" &&
        typeof op.options.font !== "string" &&
        !embeddedFonts.has(op.options.font.id)
      ) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FONT,
          "Embedded font must be registered with the same document via embedTrueTypeFont().",
          {
            fontId: op.options.font.id,
          },
        );
      }
    }

    for (const annotation of page.annotations) {
      if (
        annotation.type !== "textField" &&
        annotation.type !== "checkBox" &&
        annotation.type !== "choiceField" &&
        annotation.type !== "radioGroup" &&
        annotation.type !== "pushButton" &&
        annotation.type !== "signatureField"
      ) {
        continue;
      }

      if (fieldNames.has(annotation.name)) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          "Form field names must be unique within a document.",
          {
            name: annotation.name,
          },
        );
      }

      fieldNames.add(annotation.name);
    }

    if (page.parentFieldKids) {
      for (const parentName of page.parentFieldKids.keys()) {
        if (fieldNames.has(parentName)) {
          throw new PdfEngineError(
            PdfErrorCode.INVALID_FORM_FIELD_NAME,
            "A form field name used as a parent group cannot also be a terminal field.",
            { name: parentName },
          );
        }
      }
    }
  }
}

function buildComplianceCheckInput(
  pages: readonly InternalPageModel[],
  accessibility: NormalizedDocumentAccessibility,
  hasEncryption: boolean,
  hasAttachments: boolean,
  xmpMetadata?: string | undefined,
): ComplianceCheckInput {
  return {
    tagged: accessibility.tagged || hasTaggedPageContent(pages),
    language: accessibility.language,
    conformance: accessibility.conformance,
    hasEncryption,
    hasAttachments,
    usesBuiltInFonts: usesBuiltInFonts(pages),
    hasFigureWithoutAltText: hasTaggedFiguresWithoutAltText(pages),
    hasTransparency: hasTransparentImageContent(pages),
    xmpMetadata,
  };
}

function validateEditableCompliance(
  base: ParsedPdfDocument,
  mutatedPages: readonly InternalPageModel[],
  updatedXmpMetadata: string | undefined,
  hasUpdatedXmpMetadata: boolean,
): void {
  const tagged = base.isTagged();
  const conformance = base.getConformanceProfile();
  if (!tagged && conformance === undefined) {
    return;
  }

  if (conformance !== undefined && hasUpdatedXmpMetadata) {
    const requirePdfa =
      conformance === "pdfa-1b" ||
      conformance === "pdfa-2b" ||
      conformance === "pdfa-3b" ||
      conformance === "pdfa-4";
    const requirePdfua = conformance === "pdfua-1" || conformance === "pdfua-2";
    const expectedPart = resolveConformancePart(conformance);
    const xmp = updatedXmpMetadata ?? "";
    let ok = true;
    if (requirePdfa) {
      const partRe = new RegExp(String.raw`pdfaid:part>\s*${expectedPart}\s*<`);
      ok = partRe.test(xmp);
      if (ok && conformance !== "pdfa-4") {
        ok = /pdfaid:conformance>\s*B\s*</.test(xmp);
      }
    } else if (requirePdfua) {
      const partRe = new RegExp(String.raw`pdfuaid:part>\s*${expectedPart}\s*<`);
      ok = partRe.test(xmp);
    }
    if (!ok) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        `Incremental ${conformance} edits must retain identification metadata in the XMP packet.`,
      );
    }
  }

  const issues = collectComplianceIssues({
    tagged: tagged || hasTaggedPageContent(mutatedPages),
    language: base.getLanguage(),
    conformance,
    hasEncryption: base.getEncryptionContext() !== undefined,
    hasAttachments: base.listAttachments().length > 0,
    usesBuiltInFonts: usesBuiltInFonts(mutatedPages),
    hasFigureWithoutAltText: hasTaggedFiguresWithoutAltText(mutatedPages),
    hasTransparency: hasTransparentImageContent(mutatedPages),
  });
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_COMPLIANCE,
      errors[0]!.message,
      {
        issues: errors,
      },
    );
  }
}

function hasTaggedPageContent(pages: readonly InternalPageModel[]): boolean {
  return pages.some(
    (page) =>
      page.ops.some(
        (op) =>
          (op.type === "text" && op.options.tag !== undefined) ||
          (op.type === "image" &&
            (op.options.altText !== undefined || op.options.tag !== undefined)),
      ) ||
      page.annotations.some(
        (annotation) => annotation.structureGroupId !== undefined,
      ),
  );
}

function usesBuiltInFonts(pages: readonly InternalPageModel[]): boolean {
  return pages.some(
    (page) =>
      page.ops.some(
        (op) => op.type === "text" && typeof op.options.font === "string",
      ) ||
      page.annotations.some(
        (annotation) =>
          annotation.type === "textField" ||
          annotation.type === "choiceField" ||
          annotation.type === "freeText" ||
          annotation.type === "pushButton",
      ),
  );
}

function hasTaggedFiguresWithoutAltText(
  pages: readonly InternalPageModel[],
): boolean {
  return pages.some((page) =>
    page.ops.some(
      (op) =>
        op.type === "image" &&
        (op.options.tag === "Figure" || op.options.altText !== undefined) &&
        op.options.altText === undefined,
    ),
  );
}

function hasTransparentImageContent(
  pages: readonly InternalPageModel[],
): boolean {
  return pages.some((page) =>
    page.ops.some(
      (op) =>
        op.type === "image" &&
        (op.image.kind === "png" || op.image.kind === "bmp") &&
        (op.image.alphaBytes !== undefined || (op.image.kind === "png" && op.image.mask !== undefined)),
    ),
  );
}

function resolveDefaultEditablePageSize(base: ParsedPdfDocument):
  | {
      /** Width in PDF points. */
      width: number; /** Height in PDF points. */
      height: number;
    }
  | "A4" {
  const lastPage = base.listPages()[base.listPages().length - 1];
  if (lastPage?.mediaBox?.length !== 4) {
    return "A4";
  }

  const [, , width, height] = lastPage.mediaBox;
  if (width === undefined || height === undefined) {
    return "A4";
  }

  return { width, height };
}

function resolveEditablePageSize(
  base: ParsedPdfDocument,
  objectId: number,
):
  | {
      /** Width in PDF points. */
      width: number; /** Height in PDF points. */
      height: number;
    }
  | "A4" {
  const page = base.listPages().find((entry) => entry.objectId === objectId);
  if (page?.mediaBox?.length !== 4) {
    return "A4";
  }

  const [, , width, height] = page.mediaBox;
  if (width === undefined || height === undefined) {
    return "A4";
  }

  return { width, height };
}

function parsedMetadataToDocumentInfo(
  metadata: ParsedPdfMetadata,
): DocumentInfo {
  return {
    ...(metadata.title === undefined ? {} : { title: metadata.title }),
    ...(metadata.author === undefined ? {} : { author: metadata.author }),
    ...(metadata.subject === undefined ? {} : { subject: metadata.subject }),
    ...(metadata.keywords === undefined ? {} : { keywords: metadata.keywords }),
    ...(metadata.creator === undefined ? {} : { creator: metadata.creator }),
    ...(metadata.producer === undefined ? {} : { producer: metadata.producer }),
    ...(metadata.creationDate === undefined
      ? {}
      : { creationDate: metadata.creationDate }),
    ...(metadata.modificationDate === undefined
      ? {}
      : { modificationDate: metadata.modificationDate }),
  };
}

function assertEditablePageIndex(
  index: number,
  maxInclusive: number,
  action: string,
): void {
  if (!Number.isInteger(index) || index < 0 || index > maxInclusive) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PAGE,
      `Page index for ${action} is out of range.`,
      {
        index,
        maxInclusive,
      },
    );
  }
}

function hasEditablePageChanges(
  base: ParsedPdfDocument,
  pageOrder: readonly EditablePageEntry[],
): boolean {
  const basePageObjectIds = base.listPages().map((page) => page.objectId);
  return (
    pageOrder.length !== basePageObjectIds.length ||
    pageOrder.some(
      (entry, index) =>
        entry.kind !== "existing" ||
        entry.objectId !== basePageObjectIds[index],
    )
  );
}

function collectRetainedEditableFieldNames(
  base: ParsedPdfDocument,
  pageOrder: readonly EditablePageEntry[],
): ReadonlySet<string> {
  return new Set(
    listRetainedBaseFields(base, pageOrder).map((field) => field.name),
  );
}

function listRetainedBaseFields(
  base: ParsedPdfDocument,
  pageOrder: readonly EditablePageEntry[],
): readonly ParsedPdfFormField[] {
  const retainedExistingPageIds = new Set(
    pageOrder
      .filter(
        (entry): entry is EditableExistingPageEntry =>
          entry.kind === "existing",
      )
      .map((entry) => entry.objectId),
  );

  return base
    .listFormFields()
    .filter(
      (field) =>
        field.pageObjectId === undefined ||
        retainedExistingPageIds.has(field.pageObjectId),
    );
}

function resolveEditableFieldTarget(
  base: ParsedPdfDocument,
  pageOrder: readonly EditablePageEntry[],
  appendedPages: readonly InternalPageModel[],
  name: string,
):
  | {
      /** Source. */
      source: "existing";
      /** Field. */
      field: ReturnType<typeof listRetainedBaseFields>[number];
      /** On state name. */
      onStateName?: string | undefined;
    }
  | {
      /** Source. */
      source: "appended";
      /** Annotation. */
      annotation:
        | TextFieldAnnotation
        | CheckBoxAnnotation
        | ChoiceFieldAnnotation
        | RadioGroupAnnotation;
    } {
  const matches: Array<
    | {
        /** Source. */
        source: "existing";
        /** Field. */
        field: ReturnType<typeof listRetainedBaseFields>[number];
        /** On state name. */
        onStateName?: string | undefined;
      }
    | {
        /** Source. */
        source: "appended";
        /** Annotation. */
        annotation:
          | TextFieldAnnotation
          | CheckBoxAnnotation
          | ChoiceFieldAnnotation
          | RadioGroupAnnotation;
      }
  > = [];

  for (const field of listRetainedBaseFields(base, pageOrder)) {
    if (field.name !== name) {
      continue;
    }

    matches.push({
      source: "existing",
      field,
      ...(field.fieldType === "Btn"
        ? {
            onStateName: resolveExistingCheckBoxOnStateName(
              base,
              field.objectId,
            ),
          }
        : {}),
    });
  }

  for (const page of appendedPages) {
    for (const annotation of page.annotations) {
      if (
        (annotation.type === "textField" ||
          annotation.type === "checkBox" ||
          annotation.type === "choiceField" ||
          annotation.type === "radioGroup") &&
        annotation.name === name
      ) {
        matches.push({
          source: "appended",
          annotation,
        });
      }
    }
  }

  if (matches.length === 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FORM_FIELD,
      "Form field could not be found in the edited document.",
      {
        name,
      },
    );
  }

  if (matches.length > 1) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FORM_FIELD,
      "Form field names must be unique when updating by name.",
      {
        name,
      },
    );
  }

  const [match] = matches;
  if (!match) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FORM_FIELD,
      "Form field match could not be resolved.",
      {
        name,
      },
    );
  }

  return match;
}

function resolveExistingCheckBoxOnStateName(
  base: ParsedPdfDocument,
  objectId: number,
): string | undefined {
  const fieldValue = base.getObject(objectId)?.value;
  if (!isPdfDictEntries(fieldValue)) {
    return undefined;
  }

  const apEntry = fieldValue.find(([key]) => key === "AP")?.[1];
  if (!isPdfDictEntries(apEntry)) {
    return undefined;
  }

  const normalAppearance = apEntry.find(([key]) => key === "N")?.[1];
  if (!isPdfDictEntries(normalAppearance)) {
    return undefined;
  }

  const onState = normalAppearance.find(([key]) => key !== "Off")?.[0];
  return onState;
}

function cloneOutlineModel(outline: InternalOutlineModel): InternalOutlineModel {
  const children = outline.children.map((child) => cloneOutlineModel(child));
  return {
    title: outline.title,
    target: outline.target,
    options: outline.options,
    children,
  };
}

function remapOutlineTargets(
  outlines: InternalOutlineModel[],
  pageMap: Map<InternalPageModel, InternalPageModel>,
): void {
  for (const outline of outlines) {
    if (outline.target.type === "page") {
      const mapped = pageMap.get(outline.target.target);
      if (mapped) {
        (outline as { target: { type: "page"; target: InternalPageModel } }).target.target = mapped;
      }
    }
    remapOutlineTargets(outline.children, pageMap);
  }
}

function clonePageModel(
  page: InternalPageModel,
  _embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
): InternalPageModel {
  const nodeMap = new Map<number, InternalStructureNode>();
  const clonedRoots = page.structureRoots.map((root) =>
    cloneStructureNode(root, nodeMap),
  );

  const cloned: InternalPageModel = {
    size: { ...page.size },
    ops: page.ops.map((op) => cloneOp(op)),
    annotations: page.annotations.map((ann) => cloneAnnotation(ann)),
    structureRoots: clonedRoots,
    structureNodes: nodeMap,
    graphicsDepth: page.graphicsDepth,
    nextStructureGroupId: page.nextStructureGroupId,
    ...(page.transparencyGroup !== undefined ? { transparencyGroup: { ...page.transparencyGroup } } : {}),
    ...(page.tabOrder !== undefined ? { tabOrder: page.tabOrder } : {}),
    ...(page.contentOverlay !== undefined ? { contentOverlay: { ...page.contentOverlay } } : {}),
    ...(page.parentFieldKids !== undefined ? { parentFieldKids: new Map(page.parentFieldKids) } : {}),
  };

  return cloned;
}

function cloneStructureNode(
  node: InternalStructureNode,
  nodeMap: Map<number, InternalStructureNode>,
): InternalStructureNode {
  const children = node.children.map((child) =>
    cloneStructureNode(child, nodeMap),
  );
  const clonedNode: InternalStructureNode = {
    id: node.id,
    role: node.role,
    children,
    annotationIndexes: [...node.annotationIndexes],
    ...(node.altText !== undefined ? { altText: node.altText } : {}),
    ...(node.actualText !== undefined ? { actualText: node.actualText } : {}),
    ...(node.language !== undefined ? { language: node.language } : {}),
    ...(node.attributes !== undefined ? { attributes: node.attributes } : {}),
    ...(node.mathML !== undefined ? { mathML: node.mathML } : {}),
    ...(node.artifactType !== undefined ? { artifactType: node.artifactType } : {}),
    ...(node.associatedFiles !== undefined ? { associatedFiles: [...node.associatedFiles] } : {}),
    ...(node.phoneme !== undefined ? { phoneme: node.phoneme } : {}),
    ...(node.expansion !== undefined ? { expansion: node.expansion } : {}),
    ...(node.summary !== undefined ? { summary: node.summary } : {}),
  };
  nodeMap.set(node.id, clonedNode);
  return clonedNode;
}

function cloneAnnotation(
  ann: InternalPageModel["annotations"][number],
): InternalPageModel["annotations"][number] {
  return structuredClone(ann);
}

function cloneOp(op: PdfOp): PdfOp {
  return structuredClone(op);
}

// --- Public-Key Encryption Helpers ---

interface RsaPublicKey {
  n: bigint;
  e: bigint;
}

function generateRandom20ByteSeed(): Uint8Array {
  const seed = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    seed[i] = Math.floor(Math.random() * 256);
  }
  return seed;
}

function parseX509PublicKey(der: Uint8Array): RsaPublicKey | undefined {
  try {
    let offset = 0;

    function readLength(): number {
      const first = der[offset++]!;
      if (first < 0x80) {
        return first;
      }
      const numBytes = first & 0x7f;
      let length = 0;
      for (let i = 0; i < numBytes; i++) {
        length = (length << 8) | der[offset++]!;
      }
      return length;
    }

    function readTag(expected: number): number {
      if (der[offset] !== expected) {
        throw new Error(`Expected tag 0x${expected.toString(16)}`);
      }
      offset++;
      return readLength();
    }

    // Skip outer SEQUENCE of certificate
    readTag(0x30);

    // Skip tbsCertificate SEQUENCE
    readTag(0x30);
    // Skip version
    const peek = der[offset];
    if (peek === 0xA0) {
      offset++;
      readLength();
    }
    // Skip serialNumber INTEGER
    readTag(0x02);
    offset += (readLength()); // Reading it again - already read by readTag
    // Actually need to track: readTag returns the length
    
    // Let me just scan for the public key within the SPKI structure
    // Search for the OID 1.2.840.113549.1.1.1 (RSA) within the bit string
    
    // Simple approach: parse the SubjectPublicKeyInfo
    // After the certificate, there's signatureAlgorithm, then signatureValue
    
    // Actually, let's use a simpler approach - find the BIT STRING containing the public key
    // The public key is in SubjectPublicKeyInfo: SEQUENCE { AlgorithmIdentifier, BIT STRING }
    
    // Reset and do proper parsing
    return parseSimpleSpki(der);
  } catch {
    return undefined;
  }
}

function parseSimpleSpki(der: Uint8Array): RsaPublicKey | undefined {
  // The RSA public key is stored in a SubjectPublicKeyInfo structure
  // Search for the RSA OID (1.2.840.113549.1.1.1)
  const rsaOid = Uint8Array.from([0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01]);
  
  let oidIndex = -1;
  for (let i = 0; i < der.length - rsaOid.length; i++) {
    let match = true;
    for (let j = 0; j < rsaOid.length; j++) {
      if (der[i + j] !== rsaOid[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      oidIndex = i;
      break;
    }
  }
  
  if (oidIndex < 0) {
    return undefined;
  }
  
  // After the OID should be NULL (0x05 0x00), then BIT STRING (0x03) containing the RSAPublicKey SEQUENCE
  // The BIT STRING tag follows: skip past OID + possible NULL
  let pos = oidIndex + rsaOid.length;
  if (der[pos] === 0x05 && der[pos + 1] === 0x00) {
    pos += 2; // Skip NULL
  }
  
  // Find BIT STRING tag (0x03)
  while (pos < der.length && der[pos] !== 0x03) {
    pos++;
  }
  
  if (pos >= der.length || der[pos] !== 0x03) {
    return undefined;
  }
  
  pos++; // Skip tag
  // Read BIT STRING length
  let bitStringLen = der[pos++]!;
  if (bitStringLen > 0x80) {
    const numBytes = bitStringLen & 0x7f;
    bitStringLen = 0;
    for (let i = 0; i < numBytes; i++) {
      bitStringLen = (bitStringLen << 8) | der[pos++]!;
    }
  }
  
  // Skip unused bits byte (should be 0)
  pos++;
  bitStringLen--;
  
  // Now we're at the RSAPublicKey SEQUENCE
  if (der[pos] !== 0x30) {
    return undefined;
  }
  pos++; // Skip 0x30
  // Read SEQUENCE length
  let seqLen = der[pos++]!;
  if (seqLen >= 0x80) {
    const numBytes = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < numBytes; i++) {
      seqLen = (seqLen << 8) | der[pos++]!;
    }
  }
  
  // Read modulus INTEGER
  if (der[pos] !== 0x02) {
    return undefined;
  }
  pos++;
  let modLen = der[pos++]!;
  if (modLen >= 0x80) {
    const numBytes = modLen & 0x7f;
    modLen = 0;
    for (let i = 0; i < numBytes; i++) {
      modLen = (modLen << 8) | der[pos++]!;
    }
  }
  
  const n = bytesToBigInt(der.subarray(pos, pos + modLen));
  pos += modLen;
  
  // Read exponent INTEGER
  if (der[pos] !== 0x02) {
    return undefined;
  }
  pos++;
  let expLen = der[pos++]!;
  if (expLen >= 0x80) {
    const numBytes = expLen & 0x7f;
    expLen = 0;
    for (let i = 0; i < numBytes; i++) {
      expLen = (expLen << 8) | der[pos++]!;
    }
  }
  
  const e = bytesToBigInt(der.subarray(pos, pos + expLen));
  
  return { n, e };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xFFn);
    v >>= 8n;
  }
  return bytes;
}

function i2osp(value: bigint, length: number): Uint8Array {
  if (value >= (1n << BigInt(length * 8))) {
    throw new Error("Integer too large");
  }
  return bigIntToBytes(value, length);
}

function rsaPkcs1Encrypt(
  message: Uint8Array,
  n: bigint,
  e: bigint,
): Uint8Array {
  const k = Math.ceil(n.toString(16).length / 2); // byte length of modulus
  if (message.length > k - 11) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_ENCRYPTION,
      "Message too long for RSA key size.",
    );
  }

  // PKCS#1 v1.5 encoding: EM = 0x00 || 0x02 || PS || 0x00 || M
  const psLen = k - message.length - 3;
  const em = new Uint8Array(k);
  em[0] = 0x00;
  em[1] = 0x02;
  for (let i = 2; i < 2 + psLen; i++) {
    em[i] = Math.floor(Math.random() * 255) + 1;
  }
  em[2 + psLen] = 0x00;
  em.set(message, 2 + psLen + 1);

  // Compute c = EM^e mod n
  const m = bytesToBigInt(em);
  const c = modPow(m, e, n);
  return i2osp(c, k);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * base) % mod;
    }
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function buildRecipientsPdfArray(encryptedSeeds: Uint8Array[]): Uint8Array {
  const totalLen = encryptedSeeds.reduce((sum, s) => sum + s.length, 0);
  const result = new Uint8Array(totalLen + (encryptedSeeds.length - 1));
  let offset = 0;
  for (let i = 0; i < encryptedSeeds.length; i++) {
    result.set(encryptedSeeds[i]!, offset);
    offset += encryptedSeeds[i]!.length;
    if (i < encryptedSeeds.length - 1) {
      result[offset] = 0x0A; // line separator
      offset++;
    }
  }
  return result;
}
