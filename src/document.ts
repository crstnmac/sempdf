import { PdfEngineError, PdfErrorCode } from './errors.js';
import {
  parseDocument,
  ParsedPdfDocument,
  type ParseDocumentOptions,
  type ParsedPdfEditableStructureElement,
  type ParsedPdfFormField,
  type ParsedPdfMetadata,
} from './parser.js';
import { parseImage } from './internal/image.js';
import {
  layoutTextBlock,
  measureTextWidth,
} from './internal/text-layout.js';
import {
  parseTrueTypeFont,
  type ParsedTrueTypeFont,
} from './internal/truetype.js';
import {
  arrayEquals,
  decrementRowSpanOccupancy,
  isPdfDictEntries,
  normalizeEditableAltText,
  sumNumbers,
  toBytes,
} from './internal/document-helpers.js';
import {
  appendFlattenedParsedFieldOps,
  flattenFormsOnPages,
} from './internal/form-flatten.js';
import {
  renderTemplateBlocksToFlow,
  renderTemplateDocument,
} from './internal/template-render.js';
import {
  addAnnotationStructureNode,
  addFlowTextBlockToPage,
  addImageToPage,
  addLinkToPage,
  addTextBlockToPage,
  addTextToPage,
  createStructureNode,
  layoutList,
  layoutTable,
  measurePositionedRunHeight,
  placementBoundingBox,
  radioGroupBoundingBox,
} from './internal/page-helpers.js';
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
  validateTransform,
  type ComplianceCheckInput,
  type NormalizedDocumentAccessibility,
  type NormalizedDocumentEncryption,
  type NormalizedDocumentInfo,
  type NormalizedPageLabelOptions,
  type ResolvedPageSize,
} from './internal/validation.js';
import {
  serializeDocument,
  serializeDocumentToSink,
  serializeIncrementalUpdate,
  serializeIncrementalUpdateToSink,
} from './internal/serializer.js';
import type { ByteSink } from './internal/byte-sink.js';
import type {
  AttachmentOptions,
  BinaryData,
  CheckBoxOptions,
  ChoiceFieldOptions,
  CustomPageSize,
  DocumentOutputIntentOptions,
  DocumentSignatureOptions,
  DocumentInfo,
  DocumentOptions,
  EmbedTrueTypeFontOptions,
  FlowHeadingOptions,
  FlowImageOptions,
  FlowLinkOptions,
  FlowMarginShorthand,
  FlowOptions,
  FlowSpacingScale,
  FlowTableOptions,
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
  TableRow,
  TableOptions,
  TemplateBlock,
  TemplateDocumentOptions,
  TextBlockOptions,
  TextFieldOptions,
  TextOptions,
  Transform,
  UriLinkOptions,
  XmpMetadataInput,
} from './types.js';

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
} from './internal/page-types.js';
import { createPageModel } from './internal/page-types.js';

export interface PdfDocumentModel {
  readonly info: NormalizedDocumentInfo;
  readonly xmpMetadata?: string | undefined;
  readonly encryption?: NormalizedDocumentEncryption | undefined;
  readonly language?: string | undefined;
  readonly tagged: boolean;
  readonly roleMap?: PdfRoleMap | undefined;
  readonly structureRoot?: PdfContainerTag | false | undefined;
  readonly conformance?: 'pdfa-1b' | 'pdfua-1' | undefined;
  readonly compress?: boolean | undefined;
  readonly objectStreams?: boolean | undefined;
  readonly outputIntent?: DocumentOutputIntentOptions | undefined;
  readonly signature?: DocumentSignatureOptions | undefined;
  readonly embeddedFonts: readonly ParsedTrueTypeFont[];
  readonly namedDestinations: readonly InternalNamedDestinationModel[];
  readonly pageLabels: readonly InternalPageLabelModel[];
  readonly attachments: readonly InternalAttachmentModel[];
  readonly outlines: readonly InternalOutlineModel[];
  readonly pages: readonly InternalPageModel[];
}

export interface PdfIncrementalUpdateModel {
  readonly base: ParsedPdfDocument;
  readonly appendedPages: readonly InternalPageModel[];
  readonly editedPages: readonly ExistingPageEdit[];
  readonly embeddedFonts: readonly ParsedTrueTypeFont[];
  readonly pageOrder: readonly EditablePageEntry[];
  readonly fieldUpdates: readonly ExistingFieldUpdate[];
  readonly flattenedFieldObjectIds: readonly number[];
  readonly structureRoleUpdates: ReadonlyMap<
    number,
    Exclude<PdfStructureTag, 'Artifact'>
  >;
  readonly structureAltTextUpdates: ReadonlyMap<number, string | undefined>;
  readonly structureChildrenOrderUpdates: ReadonlyMap<
    number,
    readonly number[]
  >;
  readonly hasXmpMetadataUpdate: boolean;
  readonly xmpMetadata?: string | undefined;
  readonly info?: NormalizedDocumentInfo | undefined;
  readonly signature?: DocumentSignatureOptions | undefined;
}

export interface ExistingPageEdit {
  readonly objectId: number;
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
  readonly role?: string | undefined;
  readonly pageObjectId?: number | undefined;
  readonly parentObjectId?: number | undefined;
  readonly hasAltText?: boolean | undefined;
  readonly objectIds?: readonly number[] | undefined;
}

/**
 * Options for finding structurally similar tagged elements.
 */
export interface PdfEditableStructureSimilarityOptions {
  readonly scope?: 'document' | 'page' | 'siblings' | undefined;
}

export interface ExistingTextFieldUpdate {
  readonly objectId: number;
  readonly fieldType: 'Tx';
  readonly value: string;
}

export interface ExistingCheckBoxFieldUpdate {
  readonly objectId: number;
  readonly fieldType: 'Btn';
  readonly value: boolean;
  readonly onStateName?: string | undefined;
}

export interface ExistingChoiceFieldUpdate {
  readonly objectId: number;
  readonly fieldType: 'Ch';
  readonly value: string;
}

export interface ExistingRadioFieldUpdate {
  readonly objectId: number;
  readonly fieldType: 'Radio';
  readonly value: string;
}

export type ExistingFieldUpdate =
  | ExistingTextFieldUpdate
  | ExistingCheckBoxFieldUpdate
  | ExistingChoiceFieldUpdate
  | ExistingRadioFieldUpdate;

interface EditableExistingPageEntry {
  readonly kind: 'existing';
  readonly objectId: number;
}

interface EditableAppendedPageEntry {
  readonly kind: 'appended';
  readonly page: InternalPageModel;
}

type EditablePageEntry = EditableExistingPageEntry | EditableAppendedPageEntry;

/**
 *
 * A builder for grouping tagged PDF content under a shared structure element. It can add text, blocks, lists, tables, images, and nested sections to the same semantic container.
 *
 * @export
 * @class PdfStructureContainer
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
    addTextToPage(this.page, this.embeddedFonts, text, options, this.node, 'P');
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
      'P',
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
    const listNode = createStructureNode(this.page, 'L', undefined, this.node);
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
        'Table',
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
    addImageToPage(this.page, 'jpeg', data, options, this.node, 'Figure');
  }

  /**
   * Adds a tagged PNG image to this structure container.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  png(data: BinaryData, options: PngImageOptions): void {
    addImageToPage(this.page, 'png', data, options, this.node, 'Figure');
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
      typeof optionsOrBuild === 'function' ? undefined : optionsOrBuild;
    const build =
      typeof optionsOrBuild === 'function' ? optionsOrBuild : maybeBuild;
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
    role: Exclude<PdfStructureTag, 'Artifact'>,
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
    role: Exclude<PdfStructureTag, 'Artifact'>,
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
    role: Exclude<PdfStructureTag, 'Artifact'>,
    optionsOrBuild?:
      | PdfStructureOptions
      | ((container: PdfStructureContainer) => void),
    maybeBuild?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer {
    const options =
      typeof optionsOrBuild === 'function' ? undefined : optionsOrBuild;
    const build =
      typeof optionsOrBuild === 'function' ? optionsOrBuild : maybeBuild;
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
  x: number;
  y: number;
  startY: number;
  width: number;
  gap: number;
  marginBottom: number;
  spacing: RequiredFlowSpacingScale;
  font?: PdfFont | undefined;
  fallbackFonts?: PdfFont[] | undefined;
  direction?: FlowOptions['direction'] | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  lineHeight?: number | undefined;
  align?: FlowOptions['align'] | undefined;
  kerning?: boolean | undefined;
}

interface RequiredFlowSpacingScale {
  paragraphBefore: number;
  paragraphAfter: number;
  headingBefore: Record<1 | 2 | 3 | 4 | 5 | 6, number>;
  headingAfter: Record<1 | 2 | 3 | 4 | 5 | 6, number>;
  tableBefore: number;
  tableAfter: number;
  imageBefore: number;
  imageAfter: number;
  linkBefore: number;
  linkAfter: number;
}

interface ResolvedBlockSpacing {
  before: number;
  after: number;
  left: number;
  right: number;
}

interface FlowMarginOptions {
  margin?: FlowMarginShorthand | undefined;
  marginTop?: number | undefined;
  marginRight?: number | undefined;
  marginBottom?: number | undefined;
  marginLeft?: number | undefined;
}

function defaultFlowMargin(size: { width: number; height: number }): number {
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

function resolveMarginShorthand(
  margin: FlowMarginShorthand | undefined,
): { top: number; right: number; bottom: number; left: number } {
  if (margin === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof margin === 'number') {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }
  if (margin.length === 2) {
    const [vertical, horizontal] = margin;
    return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
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
 *
 * @export
 * @class PdfFlow
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
    private readonly page: InternalPageModel,
    private readonly embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
    private readonly state: FlowState,
    private readonly parent: InternalStructureNode | undefined = undefined,
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
   * Adds a heading at the current flow cursor.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  heading(text: string, options: FlowHeadingOptions = {}): this {
    const level = options.level ?? 1;
    const tag = options.tag ?? (`H${level}` as FlowTextOptions['tag']);
    const fontSize = options.fontSize ?? headingFontSize(level);
    const spacing = this.resolveSpacing('heading', options, level);
    this.applyMarginTop(spacing.before);
    const consumedHeight = this.writeTextBlock(text, {
      ...options,
      fontSize,
      lineHeight: options.lineHeight ?? Math.round(fontSize * 1.25),
      tag,
    }, spacing.left, spacing.right);
    this.state.y -= consumedHeight + spacing.after;
    return this;
  }

  /**
   * Renders a sequence of template blocks into the flow.
   *
   * @param blocks The template blocks to render.
   *
   * @returns This flow helper for chaining.
   */
  render(blocks: readonly TemplateBlock[]): this {
    renderTemplateBlocksToFlow(this, blocks);
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
      case 'heading': {
        const options = block.options as FlowHeadingOptions | undefined;
        const level = options?.level ?? 1;
        const fontSize = options?.fontSize ?? headingFontSize(level);
        const spacing = this.resolveSpacing('heading', options ?? {}, level);
        return this.estimateTextBlockHeight(block.text, {
          ...options,
          fontSize,
          lineHeight: options?.lineHeight ?? Math.round(fontSize * 1.25),
          tag: options?.tag ?? (`H${level}` as FlowTextOptions['tag']),
          marginTop: spacing.before,
          marginBottom: spacing.after,
        });
      }
      case 'paragraph':
        return this.estimateTextBlockHeight(
          block.text,
          block.options as FlowTextOptions | undefined,
        );
      case 'table':
        return this.estimateTableHeight(block.rows, block.options);
      case 'png':
        return this.estimateImageHeight('png', block.data, block.options);
      case 'jpeg':
        return this.estimateImageHeight('jpeg', block.data, block.options);
      case 'link':
        return this.estimateLinkHeight(block.options);
      case 'section':
        return block.blocks.reduce(
          (sum, child) => sum + this.estimate(child),
          0,
        );
      case 'pageBreak':
        return this.remainingHeight;
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
  paragraph(text: string, options: FlowTextOptions = {}): this {
    this.textBlock(text, { ...options, tag: options.tag ?? 'P' });
    return this;
  }

  /**
   * Adds a text block at the current flow cursor.
   *
   * @param text The text to add.
   * @param options Options that control the operation.
   *
   * @returns This flow helper for chaining.
   */
  textBlock(text: string, options: FlowTextOptions = {}): this {
    const spacing = this.resolveSpacing('paragraph', options);
    this.applyMarginTop(spacing.before);
    const consumedHeight = this.writeTextBlock(text, options, spacing.left, spacing.right);
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
    return this.image('png', data, options);
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
    return this.image('jpeg', data, options);
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
    const spacing = this.resolveSpacing('link', options);
    this.applyMarginTop(spacing.before);
    const font = options.font ?? this.state.font ?? 'Helvetica';
    const fallbackFonts =
      options.fallbackFonts ?? this.state.fallbackFonts ?? [];
    const direction = options.direction ?? this.state.direction ?? 'ltr';
    const fontSize = options.fontSize ?? this.state.fontSize ?? 12;
    const lineHeight =
      options.lineHeight ??
      this.state.lineHeight ??
      Math.round(fontSize * 1.35);
    const color = options.color ??
      this.state.color ?? { kind: 'rgb', r: 0, g: 0, b: 1 };
    const kerning = options.kerning ?? this.state.kerning ?? true;
    const textWidth = Math.max(
      measureTextWidth(
        text,
        { font, fallbackFonts, direction, fontSize, kerning },
        this.embeddedFonts,
      ),
      1,
    );
    const align = options.align ?? 'left';
    const innerWidth = Math.max(this.state.width - spacing.left - spacing.right, 1);
    const baseX = this.state.x + spacing.left;
    const linkX =
      align === 'center'
        ? baseX + Math.max((innerWidth - textWidth) / 2, 0)
        : align === 'right'
          ? baseX + Math.max(innerWidth - textWidth, 0)
          : baseX;
    const linkNode = createStructureNode(
      this.page,
      'Link',
      normalizeStructureOptions(options.structure),
      this.parent,
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
        tag: 'Span',
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
        tag: options.tag ?? 'Link',
        structure: options.structure,
      },
      linkNode,
    );
    this.state.y -= lineHeight + spacing.after;
    return this;
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
    const spacing = this.resolveSpacing('table', options);
    this.applyMarginTop(spacing.before);
    const normalizedRows = normalizeTableRows(rows);
    const innerWidth = Math.max(this.state.width - spacing.left - spacing.right, 1);
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
        'Table',
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
    format: 'jpeg' | 'png',
    data: BinaryData,
    options: FlowImageOptions,
  ): this {
    const spacing = this.resolveSpacing('image', options);
    this.applyMarginTop(spacing.before);
    const image = parseImage(format, data);
    const innerWidth = Math.max(this.state.width - spacing.left - spacing.right, 1);
    const maxWidth = options.maxWidth ?? innerWidth;
    const width = options.width ?? Math.min(image.pixelWidth, maxWidth);
    const height =
      options.height ?? width * (image.pixelHeight / image.pixelWidth);
    const align = options.align ?? 'left';
    const baseX = this.state.x + spacing.left;
    const x =
      align === 'center'
        ? baseX + Math.max((innerWidth - width) / 2, 0)
        : align === 'right'
          ? baseX + Math.max(innerWidth - width, 0)
          : baseX;
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
      'Figure',
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
    const spacing = this.resolveSpacing('paragraph', options);
    const normalized = normalizeTextBlockOptions(text, {
      ...flowTextDefaults(this.state),
      ...options,
      x: this.state.x,
      y: this.state.y,
      width: this.state.width,
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
    const spacing = this.resolveSpacing('table', options);
    const normalizedRows = normalizeTableRows(rows);
    const width = options.width ?? this.state.width;
    const normalizedOptions = normalizeTableOptions(normalizedRows, {
      ...flowTextDefaults(this.state),
      ...options,
      x: this.state.x,
      y: this.state.y,
      width,
    });
    const rowSpanOccupancy = new Map<number, number>();
    let height = 0;

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
            tag: 'P',
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

      height +=
        Math.max(
          normalizedOptions.lineHeight + normalizedOptions.cellPadding * 2,
          ...cellHeights,
        ) + normalizedOptions.rowGap;
      decrementRowSpanOccupancy(rowSpanOccupancy);
    }

    return spacing.before + height + spacing.after;
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
    format: 'jpeg' | 'png',
    data: BinaryData,
    options: FlowImageOptions = {},
  ): number {
    const spacing = this.resolveSpacing('image', options);
    const image = parseImage(format, data);
    const maxWidth = options.maxWidth ?? this.state.width;
    const width = options.width ?? Math.min(image.pixelWidth, maxWidth);
    const height =
      options.height ?? width * (image.pixelHeight / image.pixelWidth);
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
    const spacing = this.resolveSpacing('link', options);
    const fontSize = options.fontSize ?? this.state.fontSize ?? 12;
    const lineHeight =
      options.lineHeight ??
      this.state.lineHeight ??
      Math.round(fontSize * 1.35);
    return spacing.before + lineHeight + spacing.after;
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
  private writeTextBlock(text: string, options: FlowTextOptions = {}, marginLeft = 0, marginRight = 0): number {
    const innerWidth = Math.max(this.state.width - marginLeft - marginRight, 1);
    const blockWidth = Math.min(options.blockWidth ?? innerWidth, innerWidth);
    const blockAlign = options.blockAlign ?? 'left';
    const blockX =
      blockAlign === 'center'
        ? this.state.x + marginLeft + (innerWidth - blockWidth) / 2
        : blockAlign === 'right'
          ? this.state.x + marginLeft + (innerWidth - blockWidth)
          : this.state.x + marginLeft;
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

  /**
   * Resolves effective flow spacing and horizontal margins for a block.
   *
   * @param kind The flow block kind whose spacing is being resolved.
   * @param options Options that control the operation.
   *
   * @returns The result of the operation.
   */
  private resolveSpacing(
    kind: 'paragraph' | 'table' | 'image' | 'link',
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
    kind: 'heading',
    options: FlowMarginOptions,
    level: 1 | 2 | 3 | 4 | 5 | 6,
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
    kind: 'paragraph' | 'heading' | 'table' | 'image' | 'link',
    options: FlowMarginOptions,
    level: 1 | 2 | 3 | 4 | 5 | 6 = 1,
  ): ResolvedBlockSpacing {
    const defaults = this.state.spacing;
    const shorthand = resolveMarginShorthand(options.margin);
    const hasShorthand = options.margin !== undefined;
    const left = options.marginLeft ?? (hasShorthand ? shorthand.left : 0);
    const right = options.marginRight ?? (hasShorthand ? shorthand.right : 0);
    const defaultBefore =
      kind === 'heading'
        ? defaults.headingBefore[level]
        : kind === 'table'
          ? defaults.tableBefore
          : kind === 'image'
            ? defaults.imageBefore
            : kind === 'link'
              ? defaults.linkBefore
              : defaults.paragraphBefore;
    const defaultAfter =
      kind === 'heading'
        ? defaults.headingAfter[level]
        : kind === 'table'
          ? defaults.tableAfter
          : kind === 'image'
            ? defaults.imageAfter
            : kind === 'link'
              ? defaults.linkAfter
              : defaults.paragraphAfter;
    const explicitTop = options.marginTop;
    const explicitBottom = options.marginBottom;
    const before = explicitTop ?? (hasShorthand ? shorthand.top : defaultBefore);
    const after = explicitBottom ?? (hasShorthand ? shorthand.bottom : defaultAfter);
    return { before, after, left, right };
  }
}

/**
 *
 * A mutable page builder for placing text, graphics, images, links, annotations, form fields, and structured content on a PDF page.
 *
 * @export
 * @class PdfPage
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
    const listNode = createStructureNode(this.page, 'L');
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
      createStructureNode(this.page, 'Table', normalizedOptions.structure),
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
      typeof optionsOrBuild === 'function' ? undefined : optionsOrBuild;
    const build =
      typeof optionsOrBuild === 'function' ? optionsOrBuild : maybeBuild;
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
    role: Exclude<PdfStructureTag, 'Artifact'>,
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
    role: Exclude<PdfStructureTag, 'Artifact'>,
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
    role: Exclude<PdfStructureTag, 'Artifact'>,
    optionsOrBuild?:
      | PdfStructureOptions
      | ((container: PdfStructureContainer) => void),
    maybeBuild?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer {
    const options =
      typeof optionsOrBuild === 'function' ? undefined : optionsOrBuild;
    const build =
      typeof optionsOrBuild === 'function' ? optionsOrBuild : maybeBuild;
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
      type: 'path',
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
    addImageToPage(this.page, 'jpeg', data, options);
  }

  /**
   * Adds a PNG image to the page.
   *
   * @param data The binary image or font data.
   * @param options Options that control the operation.
   */
  png(data: BinaryData, options: PngImageOptions): void {
    addImageToPage(this.page, 'png', data, options);
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
      'Link',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'page',
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
      'Annot',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'highlight',
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
      'Annot',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'note',
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
      'Annot',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'freeText',
      options: normalizedOptions,
      ...(structureGroupId === undefined ? {} : { structureGroupId }),
    });
  }

  /**
   * Adds a text form field to the page.
   *
   * @param name The name to assign or look up.
   * @param options Options that control the operation.
   */
  textField(name: string, options: TextFieldOptions): void {
    const normalizedOptions = normalizeTextFieldOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      'Annot',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'textField',
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
    const normalizedOptions = normalizeCheckBoxOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      'Annot',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'checkBox',
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
    const normalizedOptions = normalizeChoiceFieldOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      'Annot',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'choiceField',
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
    const normalizedOptions = normalizeRadioGroupOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      'Annot',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      radioGroupBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'radioGroup',
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
    const normalizedOptions = normalizePushButtonOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      'Annot',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'pushButton',
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
    const normalizedOptions = normalizeSignatureFieldOptions(name, options);
    const annotationIndex = this.page.annotations.length;
    const structureGroupId = addAnnotationStructureNode(
      this.page,
      'Annot',
      annotationIndex,
      normalizedOptions.tag,
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    this.page.annotations.push({
      type: 'signatureField',
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
    this.page.ops.push({ type: 'saveState' });
  }

  /**
   * Restores the most recently saved graphics state.
   */
  restoreState(): void {
    if (this.page.graphicsDepth === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_GRAPHICS_STATE,
        'restoreState() must be paired with saveState().',
      );
    }

    this.page.graphicsDepth -= 1;
    this.page.ops.push({ type: 'restoreState' });
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
    this.page.ops.push({ type: 'transform', matrix });
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
 *
 * A handle for an outline entry in a PDF document. It can receive nested child outline items that point to pages or named destinations.
 *
 * @export
 * @class PdfOutlineItem
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
 *
 * @export
 * @class PdfDocument
 */
export class PdfDocument {
  private readonly pages: InternalPageModel[] = [];
  private readonly embeddedFonts = new Map<string, ParsedTrueTypeFont>();
  private readonly namedDestinations: InternalNamedDestinationModel[] = [];
  private readonly pageLabels = new Map<
    InternalPageModel,
    NormalizedPageLabelOptions
  >();
  private readonly attachments: InternalAttachmentModel[] = [];
  private readonly outlines: InternalOutlineModel[] = [];
  private info: NormalizedDocumentInfo;
  private readonly defaultPageSize: ResolvedPageSize;
  private readonly accessibility: NormalizedDocumentAccessibility;
  private readonly encryption?: NormalizedDocumentEncryption | undefined;
  private xmpMetadata?: string | undefined;
  private readonly compress?: boolean | undefined;
  private readonly objectStreams?: boolean | undefined;
  private readonly outputIntent?: DocumentOutputIntentOptions | undefined;
  private readonly signature?: DocumentSignatureOptions | undefined;

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
    this.outputIntent = options.outputIntent;
    this.signature = options.signature;
  }

  /**
   * Adds a page to the document and returns its page builder.
   *
   * @param options Options that control the operation.
   *
   * @returns The new page builder.
   */
  addPage(options: PageOptions = {}): PdfPage {
    const page = createPageModel(options.size ?? this.defaultPageSize);
    this.pages.push(page);
    return new PdfPage(page, this.embeddedFonts);
  }

  /**
   * Renders a template document into this PDF document.
   *
   * @param options Options that control the operation.
   */
  renderTemplate(options: TemplateDocumentOptions): void {
    if (options.info !== undefined) {
      this.updateInfo(options.info);
    }
    if ('xmpMetadata' in options) {
      this.setXmpMetadata(options.xmpMetadata);
    }
    renderTemplateDocument(this, options, {
      title: this.info.title,
      author: this.info.author,
    });
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
    const font = parseTrueTypeFont(data, options.family);
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
    const bytes = toBytes(data);
    if (bytes.length === 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_ATTACHMENT,
        'Attachment data must not be empty.',
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
    const outline = createOutlineModel(title, target, options);
    this.outlines.push(outline);
    return new PdfOutlineItem(outline);
  }

  /**
   * Flattens form fields into static page content where possible.
   */
  flattenForms(): void {
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
      ),
    );
  }

  /**
   * Serializes the document into PDF bytes.
   *
   * @returns The serialized or collected bytes.
   */
  toUint8Array(): Uint8Array {
    return serializeDocument(this.toModel());
  }

  /**
   * Streams the serialized document to a byte sink.
   *
   * @param sink The sink that receives written byte chunks.
   */
  async writeTo(sink: ByteSink): Promise<void> {
    await serializeDocumentToSink(this.toModel(), sink);
  }

  /**
   * Serializes the document into an ArrayBuffer.
   *
   * @returns The serialized PDF data as an ArrayBuffer.
   */
  toArrayBuffer(): ArrayBuffer {
    const bytes = this.toUint8Array();
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  /**
   * Serializes the document into a PDF Blob.
   *
   * @returns The serialized PDF data as a Blob.
   */
  toBlob(): Blob {
    return new Blob([new Uint8Array(this.toArrayBuffer())], {
      type: 'application/pdf',
    });
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
        'A PDF document must contain at least one page.',
      );
    }

    validateManagedPages(this.pages, this.embeddedFonts);

    const pageSet = new Set(this.pages);

    const seenDestinations = new Set<string>();
    for (const destination of this.namedDestinations) {
      if (!pageSet.has(destination.target)) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_DESTINATION,
          'Named destinations must target a page from the same document.',
          { name: destination.name },
        );
      }

      if (seenDestinations.has(destination.name)) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_DESTINATION,
          'Named destination names must be unique.',
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
          'Page labels must target a page from the same document.',
        );
      }

      pageLabels.push({ target, options });
    }

    const attachmentNames = new Set<string>();
    for (const attachment of this.attachments) {
      if (attachmentNames.has(attachment.name)) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_ATTACHMENT,
          'Attachment names must be unique within a document.',
          {
            name: attachment.name,
          },
        );
      }
      attachmentNames.add(attachment.name);
    }

    const complianceIssues = this.validateCompliance();
    const complianceErrors = complianceIssues.filter(
      (issue) => issue.severity === 'error',
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
      ...(this.objectStreams === undefined ? {} : { objectStreams: this.objectStreams }),
      ...(this.outputIntent === undefined ? {} : { outputIntent: this.outputIntent }),
      ...(this.signature === undefined ? {} : { signature: this.signature }),
      embeddedFonts: [...this.embeddedFonts.values()],
      namedDestinations: this.namedDestinations,
      pageLabels,
      attachments: this.attachments,
      outlines: this.outlines,
      pages: this.pages,
    };
  }
}

/**
 *
 * A mutable editor for applying incremental updates to an existing PDF document. It supports page edits, appended pages, form updates, structure changes, embedded resources, and incremental serialization.
 *
 * @export
 * @class PdfEditableDocument
 */
export class PdfEditableDocument {
  private readonly appendedPages: InternalPageModel[] = [];
  private readonly editedPages = new Map<number, InternalPageModel>();
  private readonly embeddedFonts = new Map<string, ParsedTrueTypeFont>();
  private readonly defaultPageSize: ResolvedPageSize;
  private readonly pageOrder: EditablePageEntry[];
  private readonly fieldUpdates = new Map<number, ExistingFieldUpdate>();
  private readonly flattenedFieldObjectIds = new Set<number>();
  private readonly editableStructureElements: readonly ParsedPdfEditableStructureElement[];
  private readonly editableStructureElementHandles = new WeakSet<object>();
  private readonly editableStructureElementsByObjectId = new Map<
    number,
    ParsedPdfEditableStructureElement
  >();
  private readonly editableStructureChildIdsByParentObjectId = new Map<
    number,
    readonly number[]
  >();
  private readonly structureRoleUpdates = new Map<
    number,
    Exclude<PdfStructureTag, 'Artifact'>
  >();
  private readonly structureAltTextUpdates = new Map<
    number,
    string | undefined
  >();
  private readonly structureChildrenOrderUpdates = new Map<
    number,
    readonly number[]
  >();
  private updatedInfo: NormalizedDocumentInfo | undefined;
  private updatedXmpMetadata?: string | undefined;
  private hasUpdatedXmpMetadata = false;
  private signature?: DocumentSignatureOptions | undefined;
  private readonly taggedBase: boolean;
  private readonly conformanceBase: 'pdfa-1b' | 'pdfua-1' | undefined;

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
      kind: 'existing',
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
    if (
      (this.taggedBase || this.conformanceBase !== undefined) &&
      index !== this.pageOrder.length
    ) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Tagged or PDF/A incremental editing currently supports appending pages only.',
      );
    }

    assertEditablePageIndex(index, this.pageOrder.length, 'insert');
    const page = createPageModel(options.size ?? this.defaultPageSize);
    this.appendedPages.push(page);
    this.pageOrder.splice(index, 0, {
      kind: 'appended',
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
    if (this.taggedBase || this.conformanceBase !== undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Tagged or PDF/A incremental editing does not support removing pages yet.',
      );
    }

    assertEditablePageIndex(index, this.pageOrder.length - 1, 'remove');
    const [removed] = this.pageOrder.splice(index, 1);
    if (removed?.kind === 'appended') {
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
    if (this.taggedBase || this.conformanceBase !== undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Tagged or PDF/A incremental editing does not support reordering pages yet.',
      );
    }

    assertEditablePageIndex(fromIndex, this.pageOrder.length - 1, 'move');
    assertEditablePageIndex(toIndex, this.pageOrder.length - 1, 'move');
    if (fromIndex === toIndex) {
      return;
    }

    const [entry] = this.pageOrder.splice(fromIndex, 1);
    if (!entry) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PAGE,
        'Page move index could not be resolved.',
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
    assertEditablePageIndex(index, this.pageOrder.length - 1, 'edit');
    const entry = this.pageOrder[index];
    if (!entry) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PAGE,
        'Editable page could not be resolved.',
        {
          index,
        },
      );
    }

    if (entry.kind === 'appended') {
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
    const font = parseTrueTypeFont(data, options.family);
    this.embeddedFonts.set(font.id, font);
    return font;
  }

  /**
   * Queues updates to the document information dictionary.
   *
   * @param info The document information metadata to merge.
   */
  updateInfo(info: DocumentInfo): void {
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
    this.updatedXmpMetadata = normalizeXmpMetadata(metadata);
    this.hasUpdatedXmpMetadata = true;
  }

  /**
   * Queues a form field value update by field name.
   *
   * @param name The name to assign or look up.
   * @param value The value to write or apply.
   */
  setFieldValue(name: string, value: string | boolean): void {
    const match = resolveEditableFieldTarget(
      this.base,
      this.pageOrder,
      this.appendedPages,
      name,
    );
    if (match.source === 'appended') {
      if (match.annotation.type === 'textField') {
        if (typeof value !== 'string') {
          throw new PdfEngineError(
            PdfErrorCode.INVALID_FORM_FIELD,
            'Text fields can only be updated with string values.',
            {
              name,
            },
          );
        }

        validateTextFieldValue(value);
        match.annotation.options.value = value;
        return;
      }

      if (match.annotation.type === 'checkBox') {
        if (typeof value !== 'boolean') {
          throw new PdfEngineError(
            PdfErrorCode.INVALID_FORM_FIELD,
            'Check boxes can only be updated with boolean values.',
            {
              name,
            },
          );
        }

        match.annotation.options.checked = value;
        return;
      }

      if (match.annotation.type === 'radioGroup') {
        if (typeof value !== 'string') {
          throw new PdfEngineError(
            PdfErrorCode.INVALID_FORM_FIELD,
            'Radio groups can only be updated with string values.',
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

      if (typeof value !== 'string') {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          'Choice fields can only be updated with string values.',
          {
            name,
          },
        );
      }

      validateChoiceFieldValue(value, match.annotation.options.options);
      match.annotation.options.value = value;
      return;
    }

    if (match.field.fieldType === 'Tx') {
      if (typeof value !== 'string') {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          'Text fields can only be updated with string values.',
          {
            name,
          },
        );
      }

      validateTextFieldValue(value);
      this.fieldUpdates.set(match.field.objectId, {
        objectId: match.field.objectId,
        fieldType: 'Tx',
        value,
      });
      return;
    }

    if (match.field.fieldType === 'Btn' && match.field.buttonKind !== 'radio') {
      if (typeof value !== 'boolean') {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          'Check boxes can only be updated with boolean values.',
          {
            name,
          },
        );
      }

      this.fieldUpdates.set(match.field.objectId, {
        objectId: match.field.objectId,
        fieldType: 'Btn',
        value,
        ...(match.onStateName ? { onStateName: match.onStateName } : {}),
      });
      return;
    }

    if (match.field.buttonKind === 'radio') {
      if (typeof value !== 'string') {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          'Radio groups can only be updated with string values.',
          {
            name,
          },
        );
      }

      validateChoiceFieldValue(value, match.field.options);
      this.fieldUpdates.set(match.field.objectId, {
        objectId: match.field.objectId,
        fieldType: 'Radio',
        value,
      });
      return;
    }

    if (match.field.fieldType === 'Ch') {
      if (typeof value !== 'string') {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          'Choice fields can only be updated with string values.',
          {
            name,
          },
        );
      }

      validateChoiceFieldValue(value, match.field.options);
      this.fieldUpdates.set(match.field.objectId, {
        objectId: match.field.objectId,
        fieldType: 'Ch',
        value,
      });
      return;
    }

    throw new PdfEngineError(
      PdfErrorCode.INVALID_FORM_FIELD,
      'Only text fields, choice fields, check boxes, and radio groups can be incrementally updated.',
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
    const scope = options.scope ?? 'document';
    return this.findEditableStructureElements({
      role: known.role,
      ...(scope === 'page' ? { pageObjectId: known.pageObjectId } : {}),
      ...(scope === 'siblings' ? { parentObjectId: known.parentObjectId } : {}),
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
    role: Exclude<PdfStructureTag, 'Artifact'>,
  ): void {
    if (!this.taggedBase) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Structure role updates require a tagged PDF.',
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
    role: Exclude<PdfStructureTag, 'Artifact'>,
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
    if (!this.taggedBase) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Structure alt-text updates require a tagged PDF.',
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
    if (!this.taggedBase) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Structure reading-order updates require a tagged PDF.',
      );
    }
    if (orderedChildren.length < 2) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Structure reading-order updates require at least two sibling elements.',
      );
    }

    const resolved = orderedChildren.map((child) =>
      this.requireEditableStructureHandle(child),
    );
    const parentObjectId = resolved[0]?.parentObjectId;
    if (parentObjectId === undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        'Structure reading order requires sibling elements with a resolvable parent.',
        {
          objectIds: resolved.map((element) => element.objectId),
        },
      );
    }
    if (resolved.some((child) => child.parentObjectId !== parentObjectId)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Structure reading-order updates require sibling elements that share the same parent.',
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
        'Structure reading-order parent could not be resolved.',
        {
          parentObjectId,
        },
      );
    }

    const orderedIds = resolved.map((element) => element.objectId);
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Structure reading-order updates cannot contain duplicate elements.',
        {
          objectIds: orderedIds,
        },
      );
    }
    if (orderedIds.some((objectId) => !siblingIds.includes(objectId))) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Structure reading-order updates must target sibling elements from the same parent.',
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
        'Structure reading-order updates are not supported for parents with direct MCID content.',
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
        'Editable structure element handle could not be resolved.',
        {
          objectId: target.objectId,
        },
      );
    }

    const known = this.editableStructureElementsByObjectId.get(target.objectId);
    if (!known || !matchesEditableStructureElementHandle(known, target)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        'Editable structure element handle could not be resolved.',
        {
          objectId: target.objectId,
        },
      );
    }

    return known;
  }

  /**
   * Adds a detached digital signature as an incremental update.
   *
   * @param options Signature options, including the CMS/PKCS#7 signer callback.
   */
  sign(options: DocumentSignatureOptions): void {
    this.signature = options;
  }

  /**
   * Serializes the incremental update into PDF bytes.
   *
   * @returns The serialized or collected bytes.
   */
  toUint8Array(): Uint8Array {
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
   * Streams the incremental update bytes to a byte sink.
   *
   * @param sink The sink that receives written byte chunks.
   */
  async writeTo(sink: ByteSink): Promise<void> {
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
  }

  /**
   * Serializes the incremental update into an ArrayBuffer.
   *
   * @returns The serialized PDF data as an ArrayBuffer.
   */
  toArrayBuffer(): ArrayBuffer {
    const bytes = this.toUint8Array();
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  /**
   * Serializes the incremental update into a PDF Blob.
   *
   * @returns The serialized PDF data as a Blob.
   */
  toBlob(): Blob {
    return new Blob([new Uint8Array(this.toArrayBuffer())], {
      type: 'application/pdf',
    });
  }

  /**
   * Queues flattening for all parsed form fields.
   */
  flattenForms(): void {
    if (this.taggedBase || this.conformanceBase !== undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Tagged or PDF/A incremental editing does not support form flattening yet.',
      );
    }

    flattenFormsOnPages(this.appendedPages);
    for (const entry of this.pageOrder) {
      if (entry.kind !== 'existing') {
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
            entry.kind === 'existing',
        )
        .map((entry) => entry.objectId),
    );

    for (const objectId of [...this.editedPages.keys()]) {
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
          entry.kind === 'existing',
      )
      .map((entry) => ({
        objectId: entry.objectId,
        page: this.editedPages.get(entry.objectId),
      }))
      .filter(
        (entry): entry is { objectId: number; page: InternalPageModel } =>
          entry.page !== undefined,
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
        'An edited PDF document must contain at least one page.',
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
    };
  }
}

/**
 * Creates a new PDF document builder for generating pages, text, graphics, forms, metadata, tagging, and attachments.
 */
export function createDocument(options: DocumentOptions = {}): PdfDocument {
  return new PdfDocument(options);
}

/**
 * Opens an existing PDF for incremental edits such as appending pages, updating fields, changing structure metadata, and preserving existing bytes when possible.
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
      typeof target === 'string'
        ? {
            type: 'named',
            name: normalizeDestinationName(target),
          }
        : {
            type: 'page',
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
  if (outline.target.type === 'page' && !pageSet.has(outline.target.target)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OUTLINE,
      'Outline entries must target a page from the same document.',
      {
        title: outline.title,
      },
    );
  }

  if (
    outline.target.type === 'named' &&
    !namedDestinations.has(outline.target.name)
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OUTLINE,
      'Outline entries must target an existing named destination.',
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

const EDITABLE_STRUCTURE_ROLES = new Set<Exclude<PdfStructureTag, 'Artifact'>>([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'Span',
  'Quote',
  'Note',
  'Reference',
  'BibEntry',
  'Code',
  'Lbl',
  'LBody',
  'Document',
  'Part',
  'Art',
  'Sect',
  'Div',
  'BlockQuote',
  'Caption',
  'TOC',
  'TOCI',
  'Index',
  'NonStruct',
  'Private',
  'L',
  'LI',
  'Table',
  'THead',
  'TBody',
  'TFoot',
  'TR',
  'TH',
  'TD',
  'Link',
  'Annot',
  'Figure',
  'Formula',
  'Form',
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
): asserts role is Exclude<PdfStructureTag, 'Artifact'> {
  if (
    !EDITABLE_STRUCTURE_ROLES.has(role as Exclude<PdfStructureTag, 'Artifact'>)
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_COMPLIANCE,
      'Unsupported editable structure role.',
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
  const right = options.marginRight ?? (hasShorthand ? shorthand.right : fallback);
  const bottomMargin = options.marginBottom ?? (hasShorthand ? shorthand.bottom : fallback);
  const leftMargin = options.marginLeft ?? (hasShorthand ? shorthand.left : fallback);
  const x = options.x ?? leftMargin;
  const y = options.y ?? page.size.height - top;
  const width = options.width ?? page.size.width - x - right;

  return {
    x,
    y,
    startY: y,
    width,
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
  return {
    paragraphBefore:
      spacing?.paragraphBefore ?? STANDARD_FLOW_SPACING.paragraphBefore,
    paragraphAfter:
      spacing?.paragraphAfter ?? options.gap ?? STANDARD_FLOW_SPACING.paragraphAfter,
    headingBefore: resolveHeadingSpacing(
      spacing?.headingBefore,
      STANDARD_FLOW_SPACING.headingBefore,
      options.gap,
    ),
    headingAfter: resolveHeadingSpacing(
      spacing?.headingAfter,
      STANDARD_FLOW_SPACING.headingAfter,
      options.gap,
    ),
    tableBefore: spacing?.tableBefore ?? STANDARD_FLOW_SPACING.tableBefore,
    tableAfter: spacing?.tableAfter ?? options.gap ?? STANDARD_FLOW_SPACING.tableAfter,
    imageBefore: spacing?.imageBefore ?? STANDARD_FLOW_SPACING.imageBefore,
    imageAfter: spacing?.imageAfter ?? options.gap ?? STANDARD_FLOW_SPACING.imageAfter,
    linkBefore: spacing?.linkBefore ?? STANDARD_FLOW_SPACING.linkBefore,
    linkAfter: spacing?.linkAfter ?? options.gap ?? STANDARD_FLOW_SPACING.linkAfter,
  };
}

function resolveHeadingSpacing(
  value: FlowSpacingScale['headingBefore'],
  defaults: Record<1 | 2 | 3 | 4 | 5 | 6, number>,
  legacyGap: number | undefined,
): Record<1 | 2 | 3 | 4 | 5 | 6, number> {
  if (typeof value === 'number') {
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
    if (page.ops.length === 0 && page.annotations.length === 0) {
      throw new PdfEngineError(
        PdfErrorCode.EMPTY_PAGE,
        'Each page must contain at least one drawing operation or annotation.',
        {
          pageIndex: index,
        },
      );
    }

    if (page.graphicsDepth !== 0) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_GRAPHICS_STATE,
        'Every saveState() call must be balanced by restoreState().',
        {
          pageIndex: index,
          depth: page.graphicsDepth,
        },
      );
    }

    for (const op of page.ops) {
      if (
        op.type === 'text' &&
        typeof op.options.font !== 'string' &&
        !embeddedFonts.has(op.options.font.id)
      ) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FONT,
          'Embedded font must be registered with the same document via embedTrueTypeFont().',
          {
            fontId: op.options.font.id,
          },
        );
      }
    }

    for (const annotation of page.annotations) {
      if (
        annotation.type !== 'textField' &&
        annotation.type !== 'checkBox' &&
        annotation.type !== 'choiceField' &&
        annotation.type !== 'radioGroup' &&
        annotation.type !== 'pushButton' &&
        annotation.type !== 'signatureField'
      ) {
        continue;
      }

      if (fieldNames.has(annotation.name)) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_FORM_FIELD,
          'Form field names must be unique within a document.',
          {
            name: annotation.name,
          },
        );
      }

      fieldNames.add(annotation.name);
    }
  }
}

function buildComplianceCheckInput(
  pages: readonly InternalPageModel[],
  accessibility: NormalizedDocumentAccessibility,
  hasEncryption: boolean,
  hasAttachments: boolean,
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

  if (conformance === 'pdfa-1b' && hasUpdatedXmpMetadata) {
    if (
      updatedXmpMetadata === undefined ||
      !/pdfaid:part>\s*1\s*</.test(updatedXmpMetadata) ||
      !/pdfaid:conformance>\s*B\s*</.test(updatedXmpMetadata)
    ) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_COMPLIANCE,
        'Incremental PDF/A-1b edits must retain PDF/A identification metadata in the XMP packet.',
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
  const errors = issues.filter((issue) => issue.severity === 'error');
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
          (op.type === 'text' && op.options.tag !== undefined) ||
          (op.type === 'image' &&
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
        (op) => op.type === 'text' && typeof op.options.font === 'string',
      ) ||
      page.annotations.some(
        (annotation) =>
          annotation.type === 'textField' ||
          annotation.type === 'choiceField' ||
          annotation.type === 'freeText' ||
          annotation.type === 'pushButton',
      ),
  );
}

function hasTaggedFiguresWithoutAltText(
  pages: readonly InternalPageModel[],
): boolean {
  return pages.some((page) =>
    page.ops.some(
      (op) =>
        op.type === 'image' &&
        (op.options.tag === 'Figure' || op.options.altText !== undefined) &&
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
        op.type === 'image' &&
        op.image.kind === 'png' &&
        (op.image.alphaBytes !== undefined || op.image.mask !== undefined),
    ),
  );
}

function resolveDefaultEditablePageSize(
  base: ParsedPdfDocument,
): { width: number; height: number } | 'A4' {
  const lastPage = base.listPages()[base.listPages().length - 1];
  if (lastPage?.mediaBox?.length !== 4) {
    return 'A4';
  }

  const [, , width, height] = lastPage.mediaBox;
  if (width === undefined || height === undefined) {
    return 'A4';
  }

  return { width, height };
}

function resolveEditablePageSize(
  base: ParsedPdfDocument,
  objectId: number,
): { width: number; height: number } | 'A4' {
  const page = base.listPages().find((entry) => entry.objectId === objectId);
  if (page?.mediaBox?.length !== 4) {
    return 'A4';
  }

  const [, , width, height] = page.mediaBox;
  if (width === undefined || height === undefined) {
    return 'A4';
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
        entry.kind !== 'existing' ||
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
          entry.kind === 'existing',
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
      source: 'existing';
      field: ReturnType<typeof listRetainedBaseFields>[number];
      onStateName?: string | undefined;
    }
  | {
      source: 'appended';
      annotation:
        | TextFieldAnnotation
        | CheckBoxAnnotation
        | ChoiceFieldAnnotation
        | RadioGroupAnnotation;
    } {
  const matches: Array<
    | {
        source: 'existing';
        field: ReturnType<typeof listRetainedBaseFields>[number];
        onStateName?: string | undefined;
      }
    | {
        source: 'appended';
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
      source: 'existing',
      field,
      ...(field.fieldType === 'Btn'
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
        (annotation.type === 'textField' ||
          annotation.type === 'checkBox' ||
          annotation.type === 'choiceField' ||
          annotation.type === 'radioGroup') &&
        annotation.name === name
      ) {
        matches.push({
          source: 'appended',
          annotation,
        });
      }
    }
  }

  if (matches.length === 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FORM_FIELD,
      'Form field could not be found in the edited document.',
      {
        name,
      },
    );
  }

  if (matches.length > 1) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FORM_FIELD,
      'Form field names must be unique when updating by name.',
      {
        name,
      },
    );
  }

  const [match] = matches;
  if (!match) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FORM_FIELD,
      'Form field match could not be resolved.',
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

  const apEntry = fieldValue.find(([key]) => key === 'AP')?.[1];
  if (!isPdfDictEntries(apEntry)) {
    return undefined;
  }

  const normalAppearance = apEntry.find(([key]) => key === 'N')?.[1];
  if (!isPdfDictEntries(normalAppearance)) {
    return undefined;
  }

  const onState = normalAppearance.find(([key]) => key !== 'Off')?.[0];
  return onState;
}
