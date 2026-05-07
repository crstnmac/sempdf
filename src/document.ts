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
  positionTextRuns,
  type PositionedTextRun,
} from './internal/text-layout.js';
import {
  parseTrueTypeFont,
  type ParsedTrueTypeFont,
} from './internal/truetype.js';
import type { PdfOp } from './internal/ops.js';
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
  normalizeImageOptions,
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
  normalizeTextBaseOptions,
  normalizeTextBlockOptions,
  normalizeTextFieldOptions,
  normalizeUriLinkOptions,
  normalizeXmpMetadata,
  resolvePageSize,
  validateChoiceFieldValue,
  validatePathCommands,
  validateText,
  validateTextFieldValue,
  validateTransform,
  type ComplianceCheckInput,
  type NormalizedAttachmentOptions,
  type NormalizedCheckBoxOptions,
  type NormalizedChoiceFieldOptions,
  type NormalizedDocumentAccessibility,
  type NormalizedDocumentEncryption,
  type NormalizedDocumentInfo,
  type NormalizedFreeTextAnnotationOptions,
  type NormalizedHighlightAnnotationOptions,
  type NormalizedListItem,
  type NormalizedListOptions,
  type NormalizedNoteAnnotationOptions,
  type NormalizedOutlineOptions,
  type NormalizedPageLabelOptions,
  type NormalizedPageLinkOptions,
  type NormalizedPushButtonOptions,
  type NormalizedRadioGroupOptions,
  type NormalizedSignatureFieldOptions,
  type NormalizedTableCell,
  type NormalizedTableOptions,
  type NormalizedTableRow,
  type NormalizedTextFieldOptions,
  type NormalizedUriLinkOptions,
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
  DocumentInfo,
  DocumentOptions,
  EmbedTrueTypeFontOptions,
  FlowHeadingOptions,
  FlowImageOptions,
  FlowLinkOptions,
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
  PageSize,
  PathCommand,
  PathStyle,
  PdfBoundingBox,
  PdfColor,
  PdfComplianceIssue,
  PdfContainerTag,
  PdfEmbeddedFont,
  PdfFont,
  PdfRoleMap,
  PdfStructureAttributeValue,
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
  TemplateImageBlock,
  TemplateLinkBlock,
  TemplatePageBreakBlock,
  TemplatePageNumberOptions,
  TemplatePageOptions,
  TemplateRenderContext,
  TemplateSectionBlock,
  TemplateTableBlock,
  TemplateTextBlock,
  TextBlockOptions,
  TextFieldOptions,
  TextOptions,
  Transform,
  UriLinkOptions,
  XmpMetadataInput,
} from './types.js';

interface UriLinkAnnotation {
  readonly type: 'uri';
  readonly url: string;
  readonly options: NormalizedUriLinkOptions;
  readonly structureGroupId?: number | undefined;
}

interface PageLinkAnnotation {
  readonly type: 'page';
  readonly target: InternalPageModel;
  readonly options: NormalizedPageLinkOptions;
  readonly structureGroupId?: number | undefined;
}

interface HighlightAnnotation {
  readonly type: 'highlight';
  readonly options: NormalizedHighlightAnnotationOptions;
  readonly structureGroupId?: number | undefined;
}

interface NoteAnnotation {
  readonly type: 'note';
  readonly options: NormalizedNoteAnnotationOptions;
  readonly structureGroupId?: number | undefined;
}

interface FreeTextAnnotation {
  readonly type: 'freeText';
  readonly options: NormalizedFreeTextAnnotationOptions;
  readonly structureGroupId?: number | undefined;
}

interface TextFieldAnnotation {
  readonly type: 'textField';
  readonly name: string;
  readonly options: NormalizedTextFieldOptions;
  readonly structureGroupId?: number | undefined;
}

interface CheckBoxAnnotation {
  readonly type: 'checkBox';
  readonly name: string;
  readonly options: NormalizedCheckBoxOptions;
  readonly structureGroupId?: number | undefined;
}

interface ChoiceFieldAnnotation {
  readonly type: 'choiceField';
  readonly name: string;
  readonly options: NormalizedChoiceFieldOptions;
  readonly structureGroupId?: number | undefined;
}

interface RadioGroupAnnotation {
  readonly type: 'radioGroup';
  readonly name: string;
  readonly options: NormalizedRadioGroupOptions;
  readonly structureGroupId?: number | undefined;
}

interface PushButtonAnnotation {
  readonly type: 'pushButton';
  readonly name: string;
  readonly options: NormalizedPushButtonOptions;
  readonly structureGroupId?: number | undefined;
}

interface SignatureFieldAnnotation {
  readonly type: 'signatureField';
  readonly name: string;
  readonly options: NormalizedSignatureFieldOptions;
  readonly structureGroupId?: number | undefined;
}

type PageAnnotation =
  | UriLinkAnnotation
  | PageLinkAnnotation
  | HighlightAnnotation
  | NoteAnnotation
  | FreeTextAnnotation
  | TextFieldAnnotation
  | CheckBoxAnnotation
  | ChoiceFieldAnnotation
  | RadioGroupAnnotation
  | PushButtonAnnotation
  | SignatureFieldAnnotation;

interface InternalNamedDestinationModel {
  readonly name: string;
  readonly target: InternalPageModel;
}

interface InternalPageLabelModel {
  readonly target: InternalPageModel;
  readonly options: NormalizedPageLabelOptions;
}

interface InternalAttachmentModel {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly options: NormalizedAttachmentOptions;
}

interface PageOutlineTarget {
  readonly type: 'page';
  readonly target: InternalPageModel;
}

interface NamedOutlineTarget {
  readonly type: 'named';
  readonly name: string;
}

type InternalOutlineTarget = PageOutlineTarget | NamedOutlineTarget;

interface InternalOutlineModel {
  readonly title: string;
  readonly target: InternalOutlineTarget;
  readonly options: NormalizedOutlineOptions;
  readonly children: InternalOutlineModel[];
}

interface InternalStructureNode {
  readonly id: number;
  readonly role: Exclude<PdfStructureTag, 'Artifact'>;
  readonly children: InternalStructureNode[];
  readonly annotationIndexes: number[];
  altText?: string | undefined;
  actualText?: string | undefined;
  language?: string | undefined;
  attributes?: Record<string, PdfStructureAttributeValue> | undefined;
}

interface InternalPageModel {
  readonly size: ResolvedPageSize;
  readonly ops: PdfOp[];
  readonly annotations: PageAnnotation[];
  readonly structureRoots: InternalStructureNode[];
  readonly structureNodes: Map<number, InternalStructureNode>;
  graphicsDepth: number;
  nextStructureGroupId: number;
}

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
}

export interface ExistingPageEdit {
  readonly objectId: number;
  readonly page: InternalPageModel;
}

export type PdfEditableStructureElement = ParsedPdfEditableStructureElement;

export interface PdfEditableStructureQuery {
  readonly role?: string | undefined;
  readonly pageObjectId?: number | undefined;
  readonly parentObjectId?: number | undefined;
  readonly hasAltText?: boolean | undefined;
  readonly objectIds?: readonly number[] | undefined;
}

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

export class PdfStructureContainer {
  constructor(
    private readonly page: InternalPageModel,
    private readonly embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
    private readonly node: InternalStructureNode,
  ) {}

  text(text: string, options: TextOptions): void {
    addTextToPage(this.page, this.embeddedFonts, text, options, this.node, 'P');
  }

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

  jpeg(data: BinaryData, options: JpegImageOptions): void {
    addImageToPage(this.page, 'jpeg', data, options, this.node, 'Figure');
  }

  png(data: BinaryData, options: PngImageOptions): void {
    addImageToPage(this.page, 'png', data, options, this.node, 'Figure');
  }

  link(url: string, options: UriLinkOptions): void {
    addLinkToPage(this.page, url, options, this.node);
  }

  container(
    tag: PdfContainerTag,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  container(
    tag: PdfContainerTag,
    options?: PdfStructureOptions,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
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

  structure(
    role: Exclude<PdfStructureTag, 'Artifact'>,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  structure(
    role: Exclude<PdfStructureTag, 'Artifact'>,
    options?: PdfStructureOptions,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
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

export class PdfFlow {
  constructor(
    private readonly page: InternalPageModel,
    private readonly embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
    private readonly state: FlowState,
    private readonly parent: InternalStructureNode | undefined = undefined,
  ) {}

  get cursorY(): number {
    return this.state.y;
  }

  get remainingHeight(): number {
    return Math.max(this.state.y - this.state.marginBottom, 0);
  }

  heading(text: string, options: FlowHeadingOptions = {}): this {
    const level = options.level ?? 1;
    const tag = options.tag ?? (`H${level}` as FlowTextOptions['tag']);
    const fontSize = options.fontSize ?? headingFontSize(level);
    const spacing = this.resolveSpacing('heading', options, level);
    this.applySpaceBefore(spacing.before);
    const consumedHeight = this.writeTextBlock(text, {
      ...options,
      fontSize,
      lineHeight: options.lineHeight ?? Math.round(fontSize * 1.25),
      tag,
    });
    this.state.y -= consumedHeight + spacing.after;
    return this;
  }

  render(blocks: readonly TemplateBlock[]): this {
    renderTemplateBlocksToFlow(this, blocks);
    return this;
  }

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
          spaceBefore: spacing.before,
          spaceAfter: spacing.after,
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

  paragraph(text: string, options: FlowTextOptions = {}): this {
    this.textBlock(text, { ...options, tag: options.tag ?? 'P' });
    return this;
  }

  textBlock(text: string, options: FlowTextOptions = {}): this {
    const spacing = this.resolveSpacing('paragraph', options);
    this.applySpaceBefore(spacing.before);
    const consumedHeight = this.writeTextBlock(text, options);
    this.state.y -= consumedHeight + spacing.after;
    return this;
  }

  png(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image('png', data, options);
  }

  jpeg(data: BinaryData, options: FlowImageOptions = {}): this {
    return this.image('jpeg', data, options);
  }

  link(text: string, url: string, options: FlowLinkOptions = {}): this {
    const spacing = this.resolveSpacing('link', options);
    this.applySpaceBefore(spacing.before);
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
        x: this.state.x,
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
        x: this.state.x,
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

  table(rows: readonly TableRow[], options: FlowTableOptions = {}): this {
    const spacing = this.resolveSpacing('table', options);
    this.applySpaceBefore(spacing.before);
    const normalizedRows = normalizeTableRows(rows);
    const width = options.width ?? this.state.width;
    const normalizedOptions = normalizeTableOptions(normalizedRows, {
      ...flowTextDefaults(this.state),
      ...options,
      x: this.state.x,
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

  moveDown(distance: number = this.state.gap): this {
    this.state.y -= distance;
    return this;
  }

  private image(
    format: 'jpeg' | 'png',
    data: BinaryData,
    options: FlowImageOptions,
  ): this {
    const spacing = this.resolveSpacing('image', options);
    this.applySpaceBefore(spacing.before);
    const image = parseImage(format, data);
    const maxWidth = options.maxWidth ?? this.state.width;
    const width = options.width ?? Math.min(image.pixelWidth, maxWidth);
    const height =
      options.height ?? width * (image.pixelHeight / image.pixelWidth);
    addImageToPage(
      this.page,
      format,
      data,
      {
        ...options,
        x: this.state.x,
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

  private estimateLinkHeight(options: FlowLinkOptions = {}): number {
    const spacing = this.resolveSpacing('link', options);
    const fontSize = options.fontSize ?? this.state.fontSize ?? 12;
    const lineHeight =
      options.lineHeight ??
      this.state.lineHeight ??
      Math.round(fontSize * 1.35);
    return spacing.before + lineHeight + spacing.after;
  }

  private writeTextBlock(text: string, options: FlowTextOptions = {}): number {
    return addFlowTextBlockToPage(
      this.page,
      this.embeddedFonts,
      text,
      {
        ...flowTextDefaults(this.state),
        ...options,
        x: this.state.x,
        y: this.state.y,
        width: this.state.width,
      },
      this.parent,
    );
  }

  private applySpaceBefore(spaceBefore: number): void {
    if (spaceBefore > 0 && this.state.y < this.state.startY) {
      this.state.y -= spaceBefore;
    }
  }

  private resolveSpacing(
    kind: 'paragraph' | 'table' | 'image' | 'link',
    options: { spaceBefore?: number | undefined; spaceAfter?: number | undefined },
  ): ResolvedBlockSpacing;
  private resolveSpacing(
    kind: 'heading',
    options: { spaceBefore?: number | undefined; spaceAfter?: number | undefined },
    level: 1 | 2 | 3 | 4 | 5 | 6,
  ): ResolvedBlockSpacing;
  private resolveSpacing(
    kind: 'paragraph' | 'heading' | 'table' | 'image' | 'link',
    options: { spaceBefore?: number | undefined; spaceAfter?: number | undefined },
    level: 1 | 2 | 3 | 4 | 5 | 6 = 1,
  ): ResolvedBlockSpacing {
    const defaults = this.state.spacing;
    switch (kind) {
      case 'heading':
        return {
          before: options.spaceBefore ?? defaults.headingBefore[level],
          after: options.spaceAfter ?? defaults.headingAfter[level],
        };
      case 'table':
        return {
          before: options.spaceBefore ?? defaults.tableBefore,
          after: options.spaceAfter ?? defaults.tableAfter,
        };
      case 'image':
        return {
          before: options.spaceBefore ?? defaults.imageBefore,
          after: options.spaceAfter ?? defaults.imageAfter,
        };
      case 'link':
        return {
          before: options.spaceBefore ?? defaults.linkBefore,
          after: options.spaceAfter ?? defaults.linkAfter,
        };
      case 'paragraph':
        return {
          before: options.spaceBefore ?? defaults.paragraphBefore,
          after: options.spaceAfter ?? defaults.paragraphAfter,
        };
    }
  }
}

export class PdfPage {
  constructor(
    private readonly page: InternalPageModel,
    private readonly embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  ) {}

  get size(): CustomPageSize {
    return this.page.size;
  }

  text(text: string, options: TextOptions): void {
    addTextToPage(this.page, this.embeddedFonts, text, options);
  }

  textBlock(text: string, options: TextBlockOptions): void {
    addTextBlockToPage(this.page, this.embeddedFonts, text, options);
  }

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

  container(
    tag: PdfContainerTag,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  container(
    tag: PdfContainerTag,
    options?: PdfStructureOptions,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
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

  structure(
    role: Exclude<PdfStructureTag, 'Artifact'>,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
  structure(
    role: Exclude<PdfStructureTag, 'Artifact'>,
    options?: PdfStructureOptions,
    build?: (container: PdfStructureContainer) => void,
  ): PdfStructureContainer;
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

  flow(options: FlowOptions = {}): PdfFlow {
    return new PdfFlow(
      this.page,
      this.embeddedFonts,
      createFlowState(this.page, options),
    );
  }

  path(commands: PathCommand[], style: PathStyle): void {
    validatePathCommands(commands);
    this.page.ops.push({
      type: 'path',
      commands,
      style: normalizePathStyle(style),
    });
  }

  jpeg(data: BinaryData, options: JpegImageOptions): void {
    addImageToPage(this.page, 'jpeg', data, options);
  }

  png(data: BinaryData, options: PngImageOptions): void {
    addImageToPage(this.page, 'png', data, options);
  }

  link(url: string, options: UriLinkOptions): void {
    addLinkToPage(this.page, url, options);
  }

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
      ...(structureGroupId !== undefined ? { structureGroupId } : {}),
    });
  }

  saveState(): void {
    this.page.graphicsDepth += 1;
    this.page.ops.push({ type: 'saveState' });
  }

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

  translate(x: number, y: number): void {
    this.transform({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
  }

  scale(x: number, y: number = x): void {
    this.transform({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
  }

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

  transform(matrix: Transform): void {
    validateTransform(matrix);
    this.page.ops.push({ type: 'transform', matrix });
  }

  toInternalModel(): InternalPageModel {
    return this.page;
  }
}

export class PdfOutlineItem {
  constructor(private readonly outline: InternalOutlineModel) {}

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

  constructor(options: DocumentOptions = {}) {
    this.info = normalizeDocumentInfo(options.info);
    this.defaultPageSize = resolvePageSize(options.defaultPageSize);
    this.accessibility = normalizeDocumentAccessibility(options);
    this.encryption = normalizeDocumentEncryption(options.encryption);
    this.xmpMetadata = normalizeXmpMetadata(options.xmpMetadata);
    this.compress = options.compress;
  }

  addPage(options: PageOptions = {}): PdfPage {
    const page = createPageModel(options.size ?? this.defaultPageSize);
    this.pages.push(page);
    return new PdfPage(page, this.embeddedFonts);
  }

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

  embedTrueTypeFont(
    data: BinaryData,
    options: EmbedTrueTypeFontOptions = {},
  ): PdfEmbeddedFont {
    const font = parseTrueTypeFont(data, options.family);
    this.embeddedFonts.set(font.id, font);
    return font;
  }

  addNamedDestination(name: string, target: PdfPage): void {
    this.namedDestinations.push({
      name: normalizeDestinationName(name),
      target: target.toInternalModel(),
    });
  }

  setPageLabel(target: PdfPage, options: PageLabelOptions): void {
    this.pageLabels.set(
      target.toInternalModel(),
      normalizePageLabelOptions(options),
    );
  }

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

  setXmpMetadata(metadata: XmpMetadataInput | undefined): void {
    this.xmpMetadata = normalizeXmpMetadata(metadata);
  }

  addOutline(
    title: string,
    target: PdfPage | string,
    options: OutlineOptions = {},
  ): PdfOutlineItem {
    const outline = createOutlineModel(title, target, options);
    this.outlines.push(outline);
    return new PdfOutlineItem(outline);
  }

  flattenForms(): void {
    flattenFormsOnPages(this.pages);
  }

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

  toUint8Array(): Uint8Array {
    return serializeDocument(this.toModel());
  }

  async writeTo(sink: ByteSink): Promise<void> {
    await serializeDocumentToSink(this.toModel(), sink);
  }

  toArrayBuffer(): ArrayBuffer {
    const bytes = this.toUint8Array();
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  toBlob(): Blob {
    return new Blob([new Uint8Array(this.toArrayBuffer())], {
      type: 'application/pdf',
    });
  }

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
      embeddedFonts: [...this.embeddedFonts.values()],
      namedDestinations: this.namedDestinations,
      pageLabels,
      attachments: this.attachments,
      outlines: this.outlines,
      pages: this.pages,
    };
  }
}

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
  private readonly taggedBase: boolean;
  private readonly conformanceBase: 'pdfa-1b' | 'pdfua-1' | undefined;

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

  addPage(options: PageOptions = {}): PdfPage {
    return this.insertPage(this.pageOrder.length, options);
  }

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

  getPageCount(): number {
    return this.pageOrder.length;
  }

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

  embedTrueTypeFont(
    data: BinaryData,
    options: EmbedTrueTypeFontOptions = {},
  ): PdfEmbeddedFont {
    const font = parseTrueTypeFont(data, options.family);
    this.embeddedFonts.set(font.id, font);
    return font;
  }

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

  setXmpMetadata(metadata: XmpMetadataInput | undefined): void {
    this.updatedXmpMetadata = normalizeXmpMetadata(metadata);
    this.hasUpdatedXmpMetadata = true;
  }

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

  listEditableStructureElements(): readonly PdfEditableStructureElement[] {
    if (!this.taggedBase) {
      return [];
    }

    return this.editableStructureElements;
  }

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

  setStructureRoles(
    targets: readonly PdfEditableStructureElement[],
    role: Exclude<PdfStructureTag, 'Artifact'>,
  ): void {
    for (const target of targets) {
      this.setStructureRole(target, role);
    }
  }

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
      this.structureChildrenOrderUpdates.size === 0
    ) {
      return this.base.getSourceBytes();
    }

    return serializeIncrementalUpdate(this.toIncrementalModel());
  }

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
      this.structureChildrenOrderUpdates.size === 0
    ) {
      await sink.write(this.base.getSourceBytes());
      await sink.close();
      return;
    }

    await serializeIncrementalUpdateToSink(this.toIncrementalModel(), sink);
  }

  toArrayBuffer(): ArrayBuffer {
    const bytes = this.toUint8Array();
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  toBlob(): Blob {
    return new Blob([new Uint8Array(this.toArrayBuffer())], {
      type: 'application/pdf',
    });
  }

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
    };
  }
}

export function createDocument(options: DocumentOptions = {}): PdfDocument {
  return new PdfDocument(options);
}

export function editDocument(
  data: BinaryData,
  options: ParseDocumentOptions = {},
): PdfEditableDocument {
  return new PdfEditableDocument(parseDocument(data, options));
}

function flattenFormsOnPages(pages: Iterable<InternalPageModel>): void {
  for (const page of pages) {
    const retainedAnnotations: PageAnnotation[] = [];
    for (const annotation of page.annotations) {
      if (!isFlattenableFormAnnotation(annotation)) {
        retainedAnnotations.push(annotation);
        continue;
      }

      appendFlattenedAnnotationOps(page, annotation);
    }

    page.annotations.splice(0, page.annotations.length, ...retainedAnnotations);
  }
}

function isFlattenableFormAnnotation(
  annotation: PageAnnotation,
): annotation is
  | TextFieldAnnotation
  | CheckBoxAnnotation
  | ChoiceFieldAnnotation
  | RadioGroupAnnotation
  | PushButtonAnnotation
  | SignatureFieldAnnotation {
  return (
    annotation.type === 'textField' ||
    annotation.type === 'checkBox' ||
    annotation.type === 'choiceField' ||
    annotation.type === 'radioGroup' ||
    annotation.type === 'pushButton' ||
    annotation.type === 'signatureField'
  );
}

function appendFlattenedAnnotationOps(
  page: InternalPageModel,
  annotation:
    | TextFieldAnnotation
    | CheckBoxAnnotation
    | ChoiceFieldAnnotation
    | RadioGroupAnnotation
    | PushButtonAnnotation
    | SignatureFieldAnnotation,
): void {
  const defaultStroke = normalizePathStyle({
    paint: 'stroke',
    stroke: {
      color: { kind: 'gray', value: 0 },
      width: annotation.options.borderWidth,
    },
  });

  switch (annotation.type) {
    case 'textField':
    case 'choiceField':
    case 'pushButton':
    case 'signatureField': {
      const label =
        annotation.type === 'textField' || annotation.type === 'choiceField'
          ? annotation.options.value
          : annotation.type === 'pushButton'
            ? annotation.options.label
            : '[Signature]';

      page.ops.push({
        type: 'path',
        commands: [
          {
            type: 'rect',
            x: annotation.options.x,
            y: annotation.options.y,
            width: annotation.options.width,
            height: annotation.options.height,
          },
        ],
        style: defaultStroke,
      });

      if (label !== undefined && label.length > 0) {
        const font =
          annotation.type === 'signatureField'
            ? 'Helvetica-Oblique'
            : annotation.options.font;
        const fontSize =
          annotation.type === 'signatureField'
            ? 10
            : annotation.options.fontSize;
        const color =
          annotation.type === 'signatureField'
            ? ({ kind: 'gray', value: 0 } as const)
            : annotation.options.color;
        const textY =
          annotation.options.y +
          Math.max(annotation.options.height - fontSize - 4, 2);
        for (const run of positionTextRuns(
          label,
          normalizeTextBaseOptions({
            x: annotation.options.x + 2,
            y: textY,
            font,
            fontSize,
            color,
          }),
          new Map(),
        )) {
          page.ops.push({
            type: 'text',
            text: run.text,
            options: run.options,
            ...(run.glyphs ? { glyphs: run.glyphs } : {}),
          });
        }
      }
      return;
    }
    case 'checkBox': {
      page.ops.push({
        type: 'path',
        commands: [
          {
            type: 'rect',
            x: annotation.options.x,
            y: annotation.options.y,
            width: annotation.options.width,
            height: annotation.options.height,
          },
        ],
        style: defaultStroke,
      });

      if (annotation.options.checked) {
        page.ops.push({
          type: 'path',
          commands: [
            {
              type: 'moveTo',
              x: annotation.options.x + 2,
              y: annotation.options.y + 2,
            },
            {
              type: 'lineTo',
              x: annotation.options.x + annotation.options.width - 2,
              y: annotation.options.y + annotation.options.height - 2,
            },
            {
              type: 'moveTo',
              x: annotation.options.x + 2,
              y: annotation.options.y + annotation.options.height - 2,
            },
            {
              type: 'lineTo',
              x: annotation.options.x + annotation.options.width - 2,
              y: annotation.options.y + 2,
            },
          ],
          style: normalizePathStyle({
            paint: 'stroke',
            stroke: {
              color: { kind: 'gray', value: 0 },
              width: Math.max(annotation.options.borderWidth, 1),
            },
          }),
        });
      }
      return;
    }
    case 'radioGroup': {
      for (const item of annotation.options.items) {
        page.ops.push({
          type: 'path',
          commands: [
            {
              type: 'rect',
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
            },
          ],
          style: defaultStroke,
        });

        if (annotation.options.value === item.value) {
          page.ops.push({
            type: 'path',
            commands: [
              {
                type: 'rect',
                x: item.x + item.width * 0.25,
                y: item.y + item.height * 0.25,
                width: item.width * 0.5,
                height: item.height * 0.5,
              },
            ],
            style: normalizePathStyle({
              paint: 'fill',
              fill: {
                color: { kind: 'gray', value: 0 },
              },
            }),
          });
        }
      }
      return;
    }
    default:
      return assertNever(annotation);
  }
}

function appendFlattenedParsedFieldOps(
  base: ParsedPdfDocument,
  page: InternalPageModel,
  field: ParsedPdfFormField,
): void {
  const rect = normalizeParsedFieldRect(field.rect);
  if (field.fieldType === 'Btn' && field.buttonKind === 'radio') {
    const items = readExistingRadioGroupItems(base, field.objectId);
    if (items.length === 0) {
      return;
    }

    appendFlattenedAnnotationOps(page, {
      type: 'radioGroup',
      name: field.name,
      options: {
        items,
        value: field.value,
        borderWidth: 1,
        readOnly: field.readOnly ?? false,
        required: field.required ?? false,
      },
    });
    return;
  }

  if (!rect) {
    return;
  }

  if (field.fieldType === 'Btn' && field.buttonKind === 'checkBox') {
    appendFlattenedAnnotationOps(page, {
      type: 'checkBox',
      name: field.name,
      options: {
        ...rect,
        borderWidth: 1,
        checked: field.checked ?? false,
        readOnly: field.readOnly ?? false,
        required: field.required ?? false,
      },
    });
    return;
  }

  if (field.fieldType === 'Btn' && field.buttonKind === 'pushButton') {
    appendFlattenedAnnotationOps(page, {
      type: 'pushButton',
      name: field.name,
      options: {
        ...rect,
        label: readExistingPushButtonLabel(base, field.objectId) ?? field.name,
        font: 'Helvetica',
        fontSize: 12,
        color: { kind: 'gray', value: 0 },
        borderWidth: 1,
        readOnly: field.readOnly ?? false,
      },
    });
    return;
  }

  if (field.fieldType === 'Sig') {
    appendFlattenedAnnotationOps(page, {
      type: 'signatureField',
      name: field.name,
      options: {
        ...rect,
        borderWidth: 1,
        readOnly: field.readOnly ?? false,
        required: field.required ?? false,
      },
    });
    return;
  }

  if (field.fieldType === 'Ch') {
    appendFlattenedAnnotationOps(page, {
      type: 'choiceField',
      name: field.name,
      options: {
        ...rect,
        options: [...(field.options ?? [])],
        value: field.value,
        font: 'Helvetica',
        fontSize: 12,
        color: { kind: 'gray', value: 0 },
        borderWidth: 1,
        readOnly: field.readOnly ?? false,
        required: field.required ?? false,
        mode: field.choiceMode ?? 'list',
      },
    });
    return;
  }

  appendFlattenedAnnotationOps(page, {
    type: 'textField',
    name: field.name,
    options: {
      ...rect,
      value: field.value,
      font: 'Helvetica',
      fontSize: 12,
      color: { kind: 'gray', value: 0 },
      borderWidth: 1,
      readOnly: field.readOnly ?? false,
      required: field.required ?? false,
      multiline: field.multiline ?? false,
    },
  });
}

function normalizeParsedFieldRect(
  rect: readonly number[] | undefined,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!rect || rect.length < 4) {
    return undefined;
  }

  const [x1, y1, x2, y2] = rect;
  if (
    x1 === undefined ||
    y1 === undefined ||
    x2 === undefined ||
    y2 === undefined
  ) {
    return undefined;
  }

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function readExistingPushButtonLabel(
  base: ParsedPdfDocument,
  objectId: number,
): string | undefined {
  const dictValue = base.getObject(objectId)?.value;
  if (!isPdfDictEntries(dictValue)) {
    return undefined;
  }

  const mk = dictValue.find(([key]) => key === 'MK')?.[1];
  if (!isPdfDictEntries(mk)) {
    return undefined;
  }

  const ca = mk.find(([key]) => key === 'CA')?.[1];
  return typeof ca === 'object' &&
    ca !== null &&
    'kind' in ca &&
    ca.kind === 'string'
    ? ca.value
    : undefined;
}

function readExistingRadioGroupItems(
  base: ParsedPdfDocument,
  objectId: number,
): RadioGroupOptions['items'] {
  const dictValue = base.getObject(objectId)?.value;
  if (!isPdfDictEntries(dictValue)) {
    return [];
  }

  const kids = dictValue.find(([key]) => key === 'Kids')?.[1];
  if (!Array.isArray(kids)) {
    return [];
  }

  const items: RadioGroupOptions['items'] = [];
  for (const kid of kids) {
    if (
      typeof kid !== 'object' ||
      kid === null ||
      !('kind' in kid) ||
      kid.kind !== 'ref'
    ) {
      continue;
    }

    const widget = base.getObject(kid.objectId)?.value;
    if (!isPdfDictEntries(widget)) {
      continue;
    }

    const rectValue = widget.find(([key]) => key === 'Rect')?.[1];
    const rect = Array.isArray(rectValue)
      ? normalizeParsedFieldRect(
          rectValue.filter(
            (value): value is number => typeof value === 'number',
          ),
        )
      : undefined;
    const value = readExistingRadioWidgetValue(widget);
    if (!rect || !value) {
      continue;
    }

    items.push({
      value,
      ...rect,
    });
  }

  return items;
}

function readExistingRadioWidgetValue(
  dictValue: Array<[string, unknown]>,
): string | undefined {
  const ap = dictValue.find(([key]) => key === 'AP')?.[1];
  if (!isPdfDictEntries(ap)) {
    return undefined;
  }

  const normal = ap.find(([key]) => key === 'N')?.[1];
  if (!isPdfDictEntries(normal)) {
    return undefined;
  }

  const option = normal.find(([key]) => key !== 'Off');
  return option?.[0];
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

function createPageModel(size: PageSize): InternalPageModel {
  return {
    size: resolvePageSize(size),
    ops: [],
    annotations: [],
    structureRoots: [],
    structureNodes: new Map(),
    graphicsDepth: 0,
    nextStructureGroupId: 0,
  };
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

function arrayEquals(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || left.length !== right?.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function normalizeEditableAltText(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function allocateStructureGroupId(page: InternalPageModel): number {
  const structureGroupId = page.nextStructureGroupId;
  page.nextStructureGroupId += 1;
  return structureGroupId;
}

function createFlowState(
  page: InternalPageModel,
  options: FlowOptions,
): FlowState {
  const margin = options.margin ?? 56;
  const x = options.x ?? margin;
  const y = options.y ?? page.size.height - margin;
  const width = options.width ?? page.size.width - (x + margin);

  return {
    x,
    y,
    startY: y,
    width,
    gap: options.gap ?? STANDARD_FLOW_SPACING.paragraphAfter,
    marginBottom:
      'marginBottom' in options && typeof options.marginBottom === 'number'
        ? options.marginBottom
        : margin,
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

function renderTemplateDocument(
  doc: PdfDocument,
  options: TemplateDocumentOptions,
  metadata: Pick<TemplateRenderContext, 'title' | 'author'>,
): void {
  const pages: Array<{ pageNumber: number; page: PdfPage }> = [];
  let current = createTemplatePage(doc, options, 1);
  pages.push({ pageNumber: current.pageNumber, page: current.page });

  for (let index = 0; index < options.blocks.length; index += 1) {
    const block = options.blocks[index]!;
    if (block.type === 'pageBreak') {
      if (current.flow.cursorY < current.startY) {
        current = createTemplatePage(doc, options, current.pageNumber + 1);
        pages.push({ pageNumber: current.pageNumber, page: current.page });
      }
      continue;
    }

    const estimatedHeight = estimateTemplateBlockHeight(block, current.flow);
    const keepWithNext = block.keepWithNext ?? block.type === 'heading';
    const nextEstimatedHeight =
      keepWithNext && options.blocks[index + 1] !== undefined
        ? estimateTemplateBlockHeight(options.blocks[index + 1]!, current.flow)
        : 0;

    if (
      current.flow.remainingHeight < estimatedHeight + nextEstimatedHeight &&
      current.flow.cursorY < current.startY
    ) {
      current = createTemplatePage(doc, options, current.pageNumber + 1);
      pages.push({ pageNumber: current.pageNumber, page: current.page });
    }

    renderTemplateBlockToFlow(current.flow, block);
  }

  renderTemplateRunningRegions(pages, options, metadata);
}

function createTemplatePage(
  doc: PdfDocument,
  options: TemplateDocumentOptions,
  pageNumber: number,
): { pageNumber: number; page: PdfPage; flow: PdfFlow; startY: number } {
  const page = doc.addPage(
    options.page?.size === undefined ? {} : { size: options.page.size },
  );
  const flow = page.flow(bodyFlowOptions(page.size, options));
  return { pageNumber, page, flow, startY: flow.cursorY };
}

function renderTemplateRunningRegions(
  pages: ReadonlyArray<{ pageNumber: number; page: PdfPage }>,
  options: TemplateDocumentOptions,
  metadata: Pick<TemplateRenderContext, 'title' | 'author'>,
): void {
  const totalPages = pages.length;
  for (const { pageNumber, page } of pages) {
    const context = { pageNumber, totalPages, ...metadata };
    if (options.header) {
      page.flow(headerFlowOptions(page.size, options.page)).render(
        options.header(context),
      );
    }
    if (options.footer) {
      page.flow(footerFlowOptions(page.size, options.page)).render(
        options.footer(context),
      );
    }
    renderTemplatePageNumber(page, context, options);
  }
}

function bodyFlowOptions(
  pageSize: ResolvedPageSize,
  options: TemplateDocumentOptions,
): FlowOptions {
  const page = options.page;
  const margin = page?.margin ?? 56;
  const x = page?.x ?? margin;
  const headerHeight = resolveTemplateHeaderHeight(options);
  const footerHeight = resolveTemplateFooterHeight(options);
  return {
    ...page,
    x,
    y: page?.y ?? pageSize.height - margin - headerHeight,
    width: page?.width ?? pageSize.width - (x + margin),
    marginBottom: page?.marginBottom ?? margin + footerHeight,
  };
}

function headerFlowOptions(
  pageSize: ResolvedPageSize,
  options: TemplatePageOptions | undefined,
): FlowOptions {
  const margin = options?.margin ?? 56;
  const x = options?.x ?? margin;
  const headerHeight = options?.headerHeight ?? 32;
  return {
    ...options,
    x,
    y: pageSize.height - margin,
    width: options?.width ?? pageSize.width - (x + margin),
    marginBottom: pageSize.height - margin - headerHeight,
  };
}

function footerFlowOptions(
  pageSize: ResolvedPageSize,
  options: TemplatePageOptions | undefined,
): FlowOptions {
  const margin = options?.margin ?? 56;
  const x = options?.x ?? margin;
  const footerHeight = options?.footerHeight ?? 32;
  return {
    ...options,
    x,
    y: margin + footerHeight,
    width: options?.width ?? pageSize.width - (x + margin),
    marginBottom: margin,
  };
}

function renderTemplatePageNumber(
  page: PdfPage,
  context: TemplateRenderContext,
  options: TemplateDocumentOptions,
): void {
  if (!options.pageNumber) {
    return;
  }

  const pageNumber = options.pageNumber;
  const region = pageNumber.region ?? 'footer';
  const flowOptions =
    region === 'header'
      ? headerFlowOptions(page.size, options.page)
      : footerFlowOptions(page.size, options.page);
  const align = pageNumber.align ?? 'center';
  page.flow(flowOptions).paragraph(
    (pageNumber.format ?? defaultTemplatePageNumberFormat)(context),
    {
      fontSize: 8,
      ...pageNumber.options,
      align,
      tag: pageNumber.options?.tag ?? 'Artifact',
      spaceBefore: pageNumber.options?.spaceBefore ?? 0,
      spaceAfter: pageNumber.options?.spaceAfter ?? 0,
    },
  );
}

function defaultTemplatePageNumberFormat(
  context: TemplateRenderContext,
): string {
  return `Page ${context.pageNumber} of ${context.totalPages}`;
}

function resolveTemplateHeaderHeight(options: TemplateDocumentOptions): number {
  return (
    options.page?.headerHeight ??
    (options.header || options.pageNumber?.region === 'header' ? 32 : 0)
  );
}

function resolveTemplateFooterHeight(options: TemplateDocumentOptions): number {
  if (options.page?.footerHeight !== undefined) {
    return options.page.footerHeight;
  }
  return options.footer ||
    !options.pageNumber ||
    options.pageNumber.region === 'footer'
    ? options.footer || options.pageNumber
      ? 32
      : 0
    : 0;
}

function renderTemplateBlocksToFlow(
  flow: PdfFlow,
  blocks: readonly TemplateBlock[],
): void {
  for (const block of blocks) {
    renderTemplateBlockToFlow(flow, block);
  }
}

function renderTemplateBlockToFlow(flow: PdfFlow, block: TemplateBlock): void {
  switch (block.type) {
    case 'heading':
      flow.heading(block.text, block.options as FlowHeadingOptions | undefined);
      return;
    case 'paragraph':
      flow.paragraph(block.text, block.options as FlowTextOptions | undefined);
      return;
    case 'table':
      flow.table(block.rows, block.options);
      return;
    case 'png':
      flow.png(block.data, block.options);
      return;
    case 'jpeg':
      flow.jpeg(block.data, block.options);
      return;
    case 'link':
      flow.link(block.text, block.url, block.options);
      return;
    case 'section':
      flow.render(block.blocks);
      return;
    case 'pageBreak':
      flow.moveDown(flow.remainingHeight);
      return;
  }
}

function estimateTemplateBlockHeight(
  block: TemplateBlock,
  flow: PdfFlow,
): number {
  return flow.estimate(block);
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

function createStructureNode(
  page: InternalPageModel,
  role: Exclude<PdfStructureTag, 'Artifact'>,
  options?: PdfStructureOptions,
  parent?: InternalStructureNode,
): InternalStructureNode {
  const node: InternalStructureNode = {
    id: allocateStructureGroupId(page),
    role,
    children: [],
    annotationIndexes: [],
    ...(options?.altText === undefined ? {} : { altText: options.altText }),
    ...(options?.actualText === undefined
      ? {}
      : { actualText: options.actualText }),
    ...(options?.language === undefined ? {} : { language: options.language }),
    ...(options?.attributes === undefined
      ? {}
      : { attributes: options.attributes }),
  };

  if (parent) {
    parent.children.push(node);
  } else {
    page.structureRoots.push(node);
  }

  page.structureNodes.set(node.id, node);
  return node;
}

function addFlowTextBlockToPage(
  page: InternalPageModel,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  text: string,
  options: TextBlockOptions,
  parent?: InternalStructureNode,
): number {
  validateText(text);
  const normalized = normalizeTextBlockOptions(text, options);
  const structureNode =
    normalized.tag === undefined || normalized.tag === 'Artifact'
      ? undefined
      : createStructureNode(page, normalized.tag, normalized.structure, parent);
  const runs = layoutTextBlock(text, normalized, embeddedFonts);
  pushPositionedTextRuns(page, runs, structureNode?.id);
  const lineCount = new Set(runs.map((run) => run.options.y)).size || 1;
  return lineCount * normalized.lineHeight;
}

function placementBoundingBox(options: {
  x: number;
  y: number;
  width: number;
  height: number;
}): PdfBoundingBox {
  return [
    options.x,
    options.y,
    options.x + options.width,
    options.y + options.height,
  ];
}

function radioGroupBoundingBox(
  options: NormalizedRadioGroupOptions,
): PdfBoundingBox {
  const minX = Math.min(...options.items.map((item) => item.x));
  const minY = Math.min(...options.items.map((item) => item.y));
  const maxX = Math.max(...options.items.map((item) => item.x + item.width));
  const maxY = Math.max(...options.items.map((item) => item.y + item.height));
  return [minX, minY, maxX, maxY];
}

function withInferredBoundingBox(
  structure: PdfStructureOptions | undefined,
  boundingBox: PdfBoundingBox,
): PdfStructureOptions {
  if (structure?.attributes?.BBox !== undefined) {
    return structure;
  }

  return {
    ...structure,
    attributes: {
      ...(structure?.attributes ?? {}),
      BBox: boundingBox,
    },
  };
}

function addTextToPage(
  page: InternalPageModel,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  text: string,
  options: TextOptions,
  parent?: InternalStructureNode,
  defaultTag?: TextOptions['tag'],
): void {
  validateText(text);
  const normalized = normalizeTextBaseOptions(options);
  const structureTag = normalized.tag ?? defaultTag;
  const effectiveOptions =
    structureTag !== undefined && normalized.tag === undefined
      ? { ...normalized, tag: structureTag }
      : normalized;
  const structureNode =
    structureTag === undefined || structureTag === 'Artifact'
      ? undefined
      : createStructureNode(page, structureTag, normalized.structure, parent);
  pushPositionedTextRuns(
    page,
    positionTextRuns(text, effectiveOptions, embeddedFonts),
    structureNode?.id,
  );
}

function addTextBlockToPage(
  page: InternalPageModel,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
  text: string,
  options: TextBlockOptions,
  parent?: InternalStructureNode,
  defaultTag?: TextBlockOptions['tag'],
): void {
  validateText(text);
  const normalized = normalizeTextBlockOptions(text, options);
  const structureTag = normalized.tag ?? defaultTag;
  const effectiveOptions =
    structureTag !== undefined && normalized.tag === undefined
      ? { ...normalized, tag: structureTag }
      : normalized;
  const structureNode =
    structureTag !== undefined && structureTag !== 'Artifact'
      ? createStructureNode(page, structureTag, normalized.structure, parent)
      : undefined;
  pushPositionedTextRuns(
    page,
    layoutTextBlock(text, effectiveOptions, embeddedFonts),
    structureNode?.id,
  );
}

function addImageToPage(
  page: InternalPageModel,
  format: 'jpeg' | 'png',
  data: BinaryData,
  options: JpegImageOptions | PngImageOptions,
  parent?: InternalStructureNode,
  defaultTag?: 'Figure',
): void {
  const normalizedOptions = normalizeImageOptions(options);
  let structureTag:
    | Exclude<
        NonNullable<ReturnType<typeof normalizeImageOptions>['tag']>,
        'Artifact'
      >
    | undefined;
  if (normalizedOptions.tag !== 'Artifact') {
    if (normalizedOptions.tag !== undefined) {
      structureTag = normalizedOptions.tag;
    } else if (normalizedOptions.altText !== undefined) {
      structureTag = 'Figure';
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
              BBox:
                normalizedOptions.structure?.attributes?.BBox ??
                placementBoundingBox(normalizedOptions),
            },
            ...(normalizedOptions.altText === undefined
              ? {}
              : { altText: normalizedOptions.altText }),
          },
          parent,
        )
      : undefined;
  page.ops.push({
    type: 'image',
    image: parseImage(format, data),
    options: {
      ...normalizedOptions,
      ...(structureNode === undefined
        ? {}
        : { structureGroupId: structureNode.id }),
    },
  });
}

function addLinkToPage(
  page: InternalPageModel,
  url: string,
  options: UriLinkOptions,
  parent?: InternalStructureNode,
): void {
  const normalizedOptions = normalizeUriLinkOptions(url, options);
  let structureGroupId: number | undefined;
  if (normalizedOptions.tag === 'Link') {
    const annotationIndex = page.annotations.length;
    const structure = withInferredBoundingBox(
      normalizedOptions.structure,
      placementBoundingBox(normalizedOptions),
    );
    const node =
      parent?.role === 'Link'
        ? applyStructureOptions(parent, structure)
        : createStructureNode(page, 'Link', structure, parent);
    node.annotationIndexes.push(annotationIndex);
    structureGroupId = node.id;
  }

  page.annotations.push({
    type: 'uri',
    url,
    options: normalizedOptions,
    ...(structureGroupId === undefined ? {} : { structureGroupId }),
  });
}

function addAnnotationStructureNode(
  page: InternalPageModel,
  defaultRole: 'Link' | 'Annot',
  annotationIndex: number,
  tag: 'Link' | 'Annot' | 'Artifact' | undefined,
  structure: PdfStructureOptions | undefined,
  boundingBox?: PdfBoundingBox,
  parent?: InternalStructureNode,
): number | undefined {
  if (tag === 'Artifact') {
    return undefined;
  }

  if (tag === undefined) {
    return undefined;
  }

  const role = tag ?? defaultRole;
  const effectiveStructure =
    boundingBox === undefined
      ? structure
      : withInferredBoundingBox(structure, boundingBox);
  const node =
    parent?.role === role
      ? applyStructureOptions(parent, effectiveStructure)
      : createStructureNode(page, role, effectiveStructure, parent);
  node.annotationIndexes.push(annotationIndex);
  return node.id;
}

function applyStructureOptions(
  node: InternalStructureNode,
  options: PdfStructureOptions | undefined,
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
      ...options.attributes,
    };
  }
  return node;
}

function pushPositionedTextRuns(
  page: InternalPageModel,
  runs: readonly PositionedTextRun[],
  structureGroupId?: number,
): void {
  for (const run of runs) {
    page.ops.push({
      type: 'text',
      text: run.text,
      options: {
        ...run.options,
        ...(structureGroupId === undefined ? {} : { structureGroupId }),
      },
      ...(run.glyphs ? { glyphs: run.glyphs } : {}),
    });
  }
}

function layoutList(
  page: InternalPageModel,
  listNode: InternalStructureNode,
  items: readonly NormalizedListItem[],
  options: NormalizedListOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
): number {
  const listDirection =
    options.direction === 'auto'
      ? resolveListDirection(items, options)
      : options.direction;
  const labelColumnWidth = Math.max(
    ...items.map((item, index) =>
      measureTextWidth(
        resolveListItemLabel(item, index, options),
        options,
        embeddedFonts,
      ),
    ),
  );
  const bodyWidth = options.width - labelColumnWidth - options.labelGap;
  if (bodyWidth <= 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_TEXT,
      'List width must leave room for both labels and body text.',
      {
        width: options.width,
        labelColumnWidth,
        labelGap: options.labelGap,
      },
    );
  }

  let y = options.y;
  const bodyX =
    listDirection === 'rtl'
      ? options.x
      : options.x + labelColumnWidth + options.labelGap;
  const labelX =
    listDirection === 'rtl'
      ? options.x + bodyWidth + options.labelGap
      : options.x;

  for (const [index, item] of items.entries()) {
    const itemNode = createStructureNode(page, 'LI', undefined, listNode);
    const labelNode = createStructureNode(page, 'Lbl', undefined, itemNode);
    const labelText = resolveListItemLabel(item, index, options);
    const labelRuns = layoutTextBlock(
      labelText,
      {
        ...options,
        x: labelX,
        y,
        width: labelColumnWidth,
        maxLines: 1,
        align: listDirection === 'rtl' ? 'right' : 'left',
        tag: 'Lbl',
      },
      embeddedFonts,
    );
    pushPositionedTextRuns(page, labelRuns, labelNode.id);

    const bodyNode = createStructureNode(page, 'LBody', undefined, itemNode);
    let bodyHeight = 0;

    if (item.body.length > 0) {
      const paragraphNode = createStructureNode(page, 'P', undefined, bodyNode);
      const bodyRuns = layoutTextBlock(
        item.body,
        {
          ...options,
          x: bodyX,
          y,
          width: bodyWidth,
          tag: 'P',
        },
        embeddedFonts,
      );
      pushPositionedTextRuns(page, bodyRuns, paragraphNode.id);
      bodyHeight = measurePositionedRunHeight(bodyRuns, options.lineHeight);
    }

    const labelHeight = measurePositionedRunHeight(
      labelRuns,
      options.lineHeight,
    );
    y -=
      Math.max(labelHeight, bodyHeight || options.lineHeight) +
      options.itemSpacing;

    if (item.children.length > 0) {
      const childListNode = createStructureNode(page, 'L', undefined, bodyNode);
      y = layoutList(
        page,
        childListNode,
        item.children,
        {
          ...options,
          x: bodyX + options.indent,
          y,
          width: bodyWidth - options.indent,
        },
        embeddedFonts,
      );
    }
  }

  return y;
}

function layoutTable(
  page: InternalPageModel,
  tableNode: InternalStructureNode,
  rows: readonly NormalizedTableRow[],
  options: NormalizedTableOptions,
  embeddedFonts: ReadonlyMap<string, ParsedTrueTypeFont>,
): number {
  let y = options.y;
  const rowSpanOccupancy = new Map<number, number>();

  for (const [rowIndex, row] of rows.entries()) {
    const rowNode = createStructureNode(page, 'TR', undefined, tableNode);
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
      const endColumn = Math.min(
        startColumn + cell.colSpan,
        options.columnWidths.length,
      );
      if (endColumn - startColumn !== cell.colSpan) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_TEXT,
          'Table cell span exceeds the available columns.',
          {
            rowIndex,
            columnIndex,
            colSpan: cell.colSpan,
          },
        );
      }

      const role = isHeaderTableCell(cell, rowIndex, startColumn, options)
        ? 'TH'
        : 'TD';
      const cellNode = createStructureNode(
        page,
        role,
        buildTableCellStructureOptions(
          cell,
          role,
          rowIndex,
          startColumn,
          options,
        ),
        rowNode,
      );
      const cellX =
        options.x + sumNumbers(options.columnWidths.slice(0, startColumn));
      const cellWidth = sumNumbers(
        options.columnWidths.slice(startColumn, endColumn),
      );
      const textWidth = Math.max(1, cellWidth - options.cellPadding * 2);
      const paragraphNode = createStructureNode(page, 'P', undefined, cellNode);
      const runs = layoutTextBlock(
        cell.text,
        {
          ...options,
          x: cellX + options.cellPadding,
          y: y - options.cellPadding,
          width: textWidth,
          tag: 'P',
        },
        embeddedFonts,
      );
      placedCells.push({
        cell,
        node: paragraphNode,
        x: cellX,
        width: cellWidth,
        runs,
      });

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

    const rowHeight = Math.max(
      options.lineHeight + options.cellPadding * 2,
      ...placedCells.map(
        ({ runs }) =>
          measurePositionedRunHeight(runs, options.lineHeight) +
          options.cellPadding * 2,
      ),
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
  role: 'TH' | 'TD',
  rowIndex: number,
  columnIndex: number,
  options: NormalizedTableOptions,
): PdfStructureOptions {
  const scope =
    cell.scope ??
    (role === 'TH'
      ? inferTableHeaderScope(rowIndex, columnIndex, options)
      : undefined);
  return {
    ...cell.structure,
    attributes: {
      ...cell.structure?.attributes,
      O: { name: 'Table' },
      ...(scope === undefined
        ? {}
        : {
            Scope: {
              name:
                scope === 'row'
                  ? 'Row'
                  : scope === 'column'
                    ? 'Column'
                    : 'Both',
            },
          }),
      ...(cell.rowSpan > 1 ? { RowSpan: cell.rowSpan } : {}),
      ...(cell.colSpan > 1 ? { ColSpan: cell.colSpan } : {}),
    },
  };
}

function inferTableHeaderScope(
  rowIndex: number,
  columnIndex: number,
  options: NormalizedTableOptions,
): 'row' | 'column' | 'both' | undefined {
  const rowHeader = columnIndex < options.headerColumns;
  const columnHeader = rowIndex < options.headerRows;
  if (rowHeader && columnHeader) return 'both';
  if (rowHeader) return 'row';
  if (columnHeader) return 'column';
  return undefined;
}

function isHeaderTableCell(
  cell: NormalizedTableCell,
  rowIndex: number,
  columnIndex: number,
  options: NormalizedTableOptions,
): boolean {
  return (
    cell.header ||
    rowIndex < options.headerRows ||
    columnIndex < options.headerColumns
  );
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function decrementRowSpanOccupancy(occupancy: Map<number, number>): void {
  for (const [columnIndex, remaining] of occupancy.entries()) {
    if (remaining <= 1) {
      occupancy.delete(columnIndex);
    } else {
      occupancy.set(columnIndex, remaining - 1);
    }
  }
}

function measurePositionedRunHeight(
  runs: readonly PositionedTextRun[],
  lineHeight: number,
): number {
  if (runs.length === 0) {
    return 0;
  }

  return new Set(runs.map((run) => run.options.y)).size * lineHeight;
}

function resolveListItemLabel(
  item: NormalizedListItem,
  index: number,
  options: NormalizedListOptions,
): string {
  if (item.label !== undefined) {
    return item.label;
  }

  return options.ordered ? `${options.startAt + index}.` : options.bullet;
}

function resolveListDirection(
  items: readonly NormalizedListItem[],
  options: NormalizedListOptions,
): 'ltr' | 'rtl' {
  const sampleText =
    items.map((item) => item.body).find((body) => body.length > 0) ??
    options.bullet;
  return options.direction === 'auto' && /[\u0590-\u08ff]/u.test(sampleText)
    ? 'rtl'
    : 'ltr';
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

function isPdfDictEntries(value: unknown): value is Array<[string, unknown]> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string',
    )
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled document branch: ${JSON.stringify(value)}`);
}

function toBytes(data: BinaryData): Uint8Array {
  return data instanceof Uint8Array
    ? data.slice()
    : new Uint8Array(data.slice(0));
}
