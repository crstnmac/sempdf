import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { AttachmentOptions, BmpImageOptions, BuiltInPageSize, CheckBoxOptions, ChoiceFieldMode, ChoiceFieldOptions, CustomPageSize, DocumentConformanceProfile, DocumentEncryptionAlgorithm, DocumentEncryptionOptions, DocumentInfo, DocumentPermissions, ExtGStateOptions, FieldActions, FillStyle, FontName, FreeTextAnnotationOptions, HighlightAnnotationOptions, JpegImageOptions, LineCap, LineJoin, ListItem, ListOptions, NoteAnnotationOptions, OutlineOptions, PageLabelOptions, PageLabelStyle, PageLinkOptions, PageSize, ParagraphTextAnnotation, PathCommand, PathStyle, PdfColor, PdfComplianceIssue, PdfComplianceLocation, PdfContainerTag, PdfFigureStructureTag, PdfFont, PdfRoleMap, PdfStandardStructureTag, PdfStructureAttributeValue, PdfStructureOptions, PdfStructureTag, PdfTextStructureTag, PngImageOptions, PushButtonOptions, RadioGroupOptions, SignatureFieldOptions, SquigglyAnnotationOptions, StrikeOutAnnotationOptions, StrokeStyle, TableCell, TableCellBorders, TableCellBorderSide, TableHeaderScope, TableOptions, TextAlign, TextBlockOptions, TextDirection, TextFieldOptions, TextOptions, Transform, UnderlineAnnotationOptions, UriLinkOptions, VerticalAlign, ColorInput, XmpMetadataInput } from "../types.js";
import { PAGE_SIZES, gray, color as resolveColorName } from "../types.js";
import type { InlineTextRun } from "../types.js";
import type { NormalizedImageOptions, NormalizedPathStyle, NormalizedTextOptions } from "./ops.js";
import type { RichRunInput } from "./page-helpers.js";
import { buildXmpMetadataPacket } from "./xmp.js";

const LINE_CAPS: Record<LineCap, 0 | 1 | 2> = {
  butt: 0,
  round: 1,
  projectingSquare: 2
};

const LINE_JOINS: Record<LineJoin, 0 | 1 | 2> = {
  miter: 0,
  round: 1,
  bevel: 2
};

const DEFAULT_FONT = "Helvetica";
const DEFAULT_COLOR = gray(0);

/**
 * Maps a built-in base font family to its bold, italic, and bold-italic
 * variants. Used to resolve the `bold`/`italic` text options to a concrete
 * standard-14 font name. Already-styled names (e.g. `Helvetica-Bold`) are not
 * keys here and are left untouched.
 */
const BUILTIN_FONT_VARIANTS: Partial<
  Record<FontName, { bold?: FontName; italic?: FontName; boldItalic?: FontName }>
> = {
  Helvetica: { bold: "Helvetica-Bold", italic: "Helvetica-Oblique", boldItalic: "Helvetica-BoldOblique" },
  "Times-Roman": { bold: "Times-Bold", italic: "Times-Italic", boldItalic: "Times-BoldItalic" },
  Courier: { bold: "Courier-Bold", italic: "Courier-Oblique", boldItalic: "Courier-BoldOblique" },
};

/** The 14 standard PDF base fonts that may be used without embedding. */
const STANDARD_FONTS: readonly string[] = [
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
  "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
  "Symbol", "ZapfDingbats",
];

/** Levenshtein distance, used to suggest the closest valid font name. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dist[i]![0] = i;
  for (let j = 0; j < cols; j += 1) dist[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i]![j] = Math.min(dist[i - 1]![j]! + 1, dist[i]![j - 1]! + 1, dist[i - 1]![j - 1]! + cost);
    }
  }
  return dist[a.length]![b.length]!;
}

/**
 * Validates that a string font names a standard-14 base font, throwing a
 * helpful "did you mean" error otherwise. Embedded-font handles and registered
 * font families are resolved before this runs, so a string here must be built-in.
 */
export function assertKnownBuiltInFont(font: PdfFont): void {
  if (typeof font !== "string" || STANDARD_FONTS.includes(font)) {
    return;
  }
  const suggestion = [...STANDARD_FONTS]
    .map((name) => ({ name, score: editDistance(font.toLowerCase(), name.toLowerCase()) }))
    .sort((left, right) => left.score - right.score)[0];
  const hint = suggestion && suggestion.score <= Math.max(3, Math.ceil(font.length / 2)) ? ` Did you mean "${suggestion.name}"?` : "";
  throw new PdfEngineError(
    PdfErrorCode.INVALID_FONT,
    `Unknown font "${font}".${hint} Use a standard-14 name (${STANDARD_FONTS.join(", ")}), an embedded font, or register a family with registerFontFamily().`,
    { font },
  );
}

/**
 * Resolves the `bold`/`italic` flags against a built-in font family, returning
 * the matching standard-14 variant. Embedded-font handles and font names with
 * no registered variants are returned unchanged (font-family handles are
 * resolved earlier, before normalization).
 *
 * @param font The requested font.
 * @param bold Whether the bold variant was requested.
 * @param italic Whether the italic variant was requested.
 *
 * @returns The resolved font.
 */
export function resolveStyledFont(font: PdfFont, bold?: boolean, italic?: boolean): PdfFont {
  if (!bold && !italic) {
    return font;
  }
  if (typeof font !== "string") {
    return font;
  }
  const variants = BUILTIN_FONT_VARIANTS[font as FontName];
  if (variants === undefined) {
    return font;
  }
  const picked = bold && italic ? variants.boldItalic : bold ? variants.bold : variants.italic;
  return picked ?? font;
}

export interface NormalizedDocumentInfo {
  title?: string | undefined;
  author?: string | undefined;
  subject?: string | undefined;
  keywords?: string | undefined;
  creator?: string | undefined;
  producer: string;
  creationDate?: string | undefined;
  modificationDate?: string | undefined;
}

export interface NormalizedDocumentPermissions {
  printing: boolean;
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  accessibility: boolean;
  assemble: boolean;
  highQualityPrint: boolean;
  fillForms: boolean;
}

export interface NormalizedDocumentEncryption {
  userPassword: string;
  ownerPassword: string;
  permissions: NormalizedDocumentPermissions;
  algorithm: DocumentEncryptionAlgorithm;
  version: 1 | 2 | 4 | 5;
  revision: 2 | 3 | 4 | 5 | 6;
  keyLengthBytes: 5 | 16 | 32;
  encryptMetadata: boolean;
}

export interface NormalizedDocumentAccessibility {
  tagged: boolean;
  language?: string | undefined;
  roleMap?: PdfRoleMap | undefined;
  structureRoot?: PdfContainerTag | false | undefined;
  conformance?: DocumentConformanceProfile | undefined;
}

export interface ComplianceCheckInput {
  tagged: boolean;
  language?: string | undefined;
  conformance?: DocumentConformanceProfile | undefined;
  hasEncryption: boolean;
  usesBuiltInFonts: boolean;
  /**
   * Content that forced {@link ComplianceCheckInput.usesBuiltInFonts} to be
   * true, used to point the caller at the offending page and text.
   */
  builtInFontUsages?: readonly PdfComplianceLocation[] | undefined;
  hasFigureWithoutAltText: boolean;
  hasTransparency: boolean;
  hasAttachments: boolean;
  xmpMetadata?: string | undefined;
}

export interface NormalizedAttachmentOptions {
  description?: string | undefined;
  mimeType?: string | undefined;
}

export interface NormalizedPageLabelOptions {
  style?: PageLabelStyle | undefined;
  prefix?: string | undefined;
  startAt: number;
}

export interface ResolvedPageSize extends CustomPageSize {}
export type ResolvedTextDirection = Exclude<TextDirection, "auto">;

/**
 * Normalized custom field appearance, representing either a simple
 * normal-appearance string or an appearance dictionary with per-state content.
 */
export interface NormalizedFieldAppearance {
  normal?: string | undefined;
  down?: string | undefined;
  rollover?: string | undefined;
}

export interface NormalizedTextBaseOptions extends NormalizedTextOptions {
  fallbackFonts: PdfFont[];
  direction: TextDirection;
  writingMode?: "horizontal" | "vertical" | undefined;
  tateChuYoko?: boolean | undefined;
}

export interface NormalizedUriLinkOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth: number;
  tag?: "Link" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedPageLinkOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth: number;
  tag?: "Link" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedHighlightAnnotationOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  color: PdfColor;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export type NormalizedUnderlineAnnotationOptions = NormalizedHighlightAnnotationOptions;
export type NormalizedStrikeOutAnnotationOptions = NormalizedHighlightAnnotationOptions;
export type NormalizedSquigglyAnnotationOptions = NormalizedHighlightAnnotationOptions;

export interface NormalizedNoteAnnotationOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  contents: string;
  open: boolean;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedFreeTextAnnotationOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  font: FontName;
  fontSize: number;
  color: PdfColor;
  borderWidth: number;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedTextFieldOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  font: FontName;
  fontSize: number;
  color: PdfColor;
  borderWidth: number;
  value?: string | undefined;
  richValue?: string | undefined;
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  encrypt: boolean;
  appearance?: NormalizedFieldAppearance | undefined;
  actions?: FieldActions | undefined;
  description?: string | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedTextBlockOptions extends NormalizedTextBaseOptions {
  width: number;
  lineHeight: number;
  align: TextAlign;
  height?: number | undefined;
  verticalAlign?: VerticalAlign | undefined;
  maxLines?: number | undefined;
  writingMode?: "horizontal" | "vertical" | undefined;
  tateChuYoko?: boolean | undefined;
}

export interface NormalizedListItem {
  /** Plain body text; for rich items this is the runs' concatenated text. */
  body: string;
  /** Raw inline runs when the item body was given as InlineTextRun[]. */
  richBody?: readonly InlineTextRun[] | undefined;
  /**
   * Prepared rich-run inputs (style precedence and font families resolved).
   * Filled by the document layer before layout; layoutList renders these
   * instead of `body` when present.
   */
  richRuns?: readonly RichRunInput[] | undefined;
  label?: string | undefined;
  children: NormalizedListItem[];
  annotations?: readonly ParagraphTextAnnotation[] | undefined;
}

export interface NormalizedListOptions extends NormalizedTextBaseOptions {
  width: number;
  lineHeight: number;
  /**
   * The caller's lineHeight, when one was given. Rich item bodies pass this
   * (not the computed default) to the inline layout so an omitted lineHeight
   * auto-expands to the largest run font size, matching richParagraph.
   */
  explicitLineHeight?: number | undefined;
  align: TextAlign;
  ordered: boolean;
  startAt: number;
  bullet: string;
  itemSpacing: number;
  indent: number;
  labelGap: number;
}

export interface NormalizedTableCell {
  text: string;
  /** Raw inline rich-text runs from the cell definition. Resolved into {@link NormalizedTableCell.richRuns} by the table entry points. */
  runs?: readonly InlineTextRun[] | undefined;
  /** Inline runs with per-run styles resolved (fonts, families, defaults). Set by the table entry points; consumed by layout. */
  richRuns?: readonly RichRunInput[] | undefined;
  header: boolean;
  scope?: TableHeaderScope | undefined;
  rowSpan: number;
  colSpan: number;
  structure?: PdfStructureOptions | undefined;
  annotations?: readonly ParagraphTextAnnotation[] | undefined;
  verticalAlign?: VerticalAlign | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  /** Per-cell font: an explicit cell `font` and/or the `bold`/`italic` flags resolved against the table font. Family names are resolved by the table entry points; consumed by layout. */
  font?: PdfFont | undefined;
  color?: PdfColor | undefined;
  align?: TextAlign | undefined;
  background?: PdfColor | undefined;
  border?: NormalizedCellBorders | undefined;
}

/** A resolved single cell-edge border. */
export interface NormalizedCellBorderSide {
  color: PdfColor;
  width: number;
}

/** Resolved per-edge borders for a cell; absent sides are not drawn. */
export interface NormalizedCellBorders {
  top?: NormalizedCellBorderSide | undefined;
  right?: NormalizedCellBorderSide | undefined;
  bottom?: NormalizedCellBorderSide | undefined;
  left?: NormalizedCellBorderSide | undefined;
}

export type NormalizedTableRow = NormalizedTableCell[];

export interface NormalizedTableOptions extends NormalizedTextBaseOptions {
  width: number;
  columnWidths: number[];
  headerRows: number;
  headerColumns: number;
  cellPadding: number;
  borderColor?: PdfColor | undefined;
  borderWidth?: number | undefined;
  borderStyle?: "all" | "horizontal" | "outer" | undefined;
  headerBackground?: PdfColor | undefined;
  zebraColor?: PdfColor | undefined;
  rowGap: number;
  lineHeight: number;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  structure?: PdfStructureOptions | undefined;
  summary?: string | undefined;
}

export interface NormalizedCheckBoxOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth: number;
  checked: boolean;
  readOnly: boolean;
  required: boolean;
  encrypt: boolean;
  appearance?: NormalizedFieldAppearance | undefined;
  actions?: FieldActions | undefined;
  description?: string | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedChoiceFieldOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  options: string[];
  font: FontName;
  fontSize: number;
  color: PdfColor;
  borderWidth: number;
  value?: string | undefined;
  readOnly: boolean;
  required: boolean;
  mode: ChoiceFieldMode;
  editable: boolean;
  encrypt: boolean;
  appearance?: NormalizedFieldAppearance | undefined;
  actions?: FieldActions | undefined;
  description?: string | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedRadioGroupItemOptions {
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedRadioGroupOptions {
  items: NormalizedRadioGroupItemOptions[];
  value?: string | undefined;
  borderWidth: number;
  readOnly: boolean;
  required: boolean;
  encrypt: boolean;
  appearance?: NormalizedFieldAppearance | undefined;
  actions?: FieldActions | undefined;
  description?: string | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedPushButtonOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  font: FontName;
  fontSize: number;
  color: PdfColor;
  borderWidth: number;
  readOnly: boolean;
  encrypt: boolean;
  appearance?: NormalizedFieldAppearance | undefined;
  actions?: FieldActions | undefined;
  description?: string | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedSignatureFieldOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth: number;
  readOnly: boolean;
  required: boolean;
  encrypt: boolean;
  appearance?: NormalizedFieldAppearance | undefined;
  actions?: FieldActions | undefined;
  description?: string | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedOutlineOptions {
  expanded: boolean;
}

function normalizeFieldAppearance(
  appearance: string | { normal?: string; down?: string; rollover?: string } | undefined,
): NormalizedFieldAppearance | undefined {
  if (appearance === undefined) {
    return undefined;
  }
  if (typeof appearance === "string") {
    if (appearance.trim().length === 0) {
      return undefined;
    }
    return { normal: appearance };
  }
  const result: NormalizedFieldAppearance = {};
  let hasAny = false;
  if (appearance.normal !== undefined && appearance.normal.trim().length > 0) {
    result.normal = appearance.normal;
    hasAny = true;
  }
  if (appearance.down !== undefined && appearance.down.trim().length > 0) {
    result.down = appearance.down;
    hasAny = true;
  }
  if (appearance.rollover !== undefined && appearance.rollover.trim().length > 0) {
    result.rollover = appearance.rollover;
    hasAny = true;
  }
  return hasAny ? result : undefined;
}

export function resolvePageSize(size: PageSize | undefined): ResolvedPageSize {
  const pageSize = size ?? "A4";
  if (typeof pageSize === "string") {
    const resolved = PAGE_SIZES[pageSize as BuiltInPageSize];
    if (resolved === undefined) {
      const names = Object.keys(PAGE_SIZES);
      const closest = names
        .map((name) => ({ name, score: editDistance(pageSize.toLowerCase(), name.toLowerCase()) }))
        .sort((left, right) => left.score - right.score)[0];
      const hint = closest && closest.score <= Math.max(3, Math.ceil(pageSize.length / 2)) ? ` Did you mean "${closest.name}"?` : "";
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PAGE_SIZE,
        `Unknown page size "${pageSize}".${hint} Use a preset (${names.join(", ")}) or a { width, height } object.`,
        { size: pageSize },
      );
    }
    return resolved;
  }

  assertFinite(pageSize.width, "width");
  assertFinite(pageSize.height, "height");

  if (pageSize.width <= 0 || pageSize.height <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PAGE_SIZE, "Page dimensions must be greater than zero.", { size: pageSize });
  }

  return { width: pageSize.width, height: pageSize.height };
}

export function normalizeDocumentInfo(info: DocumentInfo | undefined): NormalizedDocumentInfo {
  const keywords = Array.isArray(info?.keywords) ? info.keywords.join(", ") : info?.keywords;
  const normalized: NormalizedDocumentInfo = {
    producer: info?.producer ?? "sempdf"
  };

  if (info?.title !== undefined) normalized.title = info.title;
  if (info?.author !== undefined) normalized.author = info.author;
  if (info?.subject !== undefined) normalized.subject = info.subject;
  if (keywords !== undefined) normalized.keywords = keywords;
  if (info?.creator !== undefined) normalized.creator = info.creator;

  const creationDate = normalizeDate(info?.creationDate);
  const modificationDate = normalizeDate(info?.modificationDate);
  if (creationDate !== undefined) normalized.creationDate = creationDate;
  if (modificationDate !== undefined) normalized.modificationDate = modificationDate;

  return normalized;
}

export function applyDocumentTitleToInfo(title: string | undefined, info: DocumentInfo | undefined): DocumentInfo | undefined {
  if (title === undefined) {
    return info;
  }
  return { title, ...info };
}

export function applyDocumentTitleToXmpMetadata(
  title: string | undefined,
  metadata: XmpMetadataInput | undefined
): XmpMetadataInput | undefined {
  if (title === undefined || typeof metadata === "string") {
    return metadata;
  }
  if (metadata === undefined) {
    return { title };
  }
  return { title, ...metadata };
}

export function normalizeXmpMetadata(metadata: XmpMetadataInput | undefined): string | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  if (typeof metadata !== "string") {
    return buildXmpMetadataPacket(metadata);
  }

  if (metadata.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_METADATA, "XMP metadata must not be empty.");
  }

  return metadata;
}

export function normalizeDocumentEncryption(
  encryption: DocumentEncryptionOptions | undefined
): NormalizedDocumentEncryption | undefined {
  if (encryption === undefined) {
    return undefined;
  }

  const userPassword = encryption.userPassword ?? "";
  const ownerPassword = encryption.ownerPassword ?? encryption.userPassword ?? "";
  if (userPassword === "" && ownerPassword === "") {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_ENCRYPTION,
      "Document encryption requires a user password, an owner password, or both."
    );
  }

  return {
    userPassword,
    ownerPassword,
    permissions: normalizeDocumentPermissions(encryption.permissions),
    encryptMetadata: encryption.encryptMetadata ?? true,
    ...resolveDocumentEncryptionAlgorithm(encryption.algorithm)
  };
}

export function normalizeDocumentAccessibility(options: {
  tagged?: boolean | undefined;
  language?: string | undefined;
  roleMap?: PdfRoleMap | undefined;
  structureRoot?: PdfContainerTag | false | undefined;
  conformance?: DocumentConformanceProfile | undefined;
}): NormalizedDocumentAccessibility {
  return {
    tagged: options.tagged ?? false,
    ...(options.language !== undefined ? { language: normalizeLanguage(options.language) } : {}),
    ...(options.roleMap !== undefined ? { roleMap: normalizeRoleMap(options.roleMap) } : {}),
    ...(options.structureRoot !== undefined ? { structureRoot: options.structureRoot === false ? false : normalizeContainerStructureTag(options.structureRoot) } : {}),
    ...(options.conformance !== undefined ? { conformance: options.conformance } : {})
  };
}

function resolveDocumentEncryptionAlgorithm(
  algorithm: DocumentEncryptionAlgorithm | undefined
): Pick<NormalizedDocumentEncryption, "algorithm" | "version" | "revision" | "keyLengthBytes"> {
  switch (algorithm ?? "rc4-128") {
    case "rc4-40":
      return {
        algorithm: "rc4-40",
        version: 1,
        revision: 2,
        keyLengthBytes: 5
      };
    case "rc4-128":
      return {
        algorithm: "rc4-128",
        version: 2,
        revision: 3,
        keyLengthBytes: 16
      };
    case "aes-128":
      return {
        algorithm: "aes-128",
        version: 4,
        revision: 4,
        keyLengthBytes: 16
      };
    case "aes-256":
      return {
        algorithm: "aes-256",
        version: 5,
        revision: 5,
        keyLengthBytes: 32
      };
    case "aes-256-r6":
      return {
        algorithm: "aes-256-r6",
        version: 5,
        revision: 6,
        keyLengthBytes: 32
      };
    default:
      throw new PdfEngineError(PdfErrorCode.INVALID_ENCRYPTION, "Unsupported document encryption algorithm.", {
        algorithm
      });
  }
}

function normalizeLanguage(language: string): string {
  const normalized = language.trim();
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(normalized)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_COMPLIANCE, "Document language must be a valid BCP 47-style tag.", {
      language
    });
  }

  return normalized;
}

function normalizeOptionalStructureText(value: string | undefined, property: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_COMPLIANCE, `Structure ${property} must not be empty.`, {
      [property]: value
    });
  }
  return normalized;
}

export function normalizeStructureOptions(options: PdfStructureOptions | undefined): PdfStructureOptions | undefined {
  if (options === undefined) {
    return undefined;
  }

  const normalized: PdfStructureOptions = {
    ...(options.altText !== undefined ? { altText: normalizeOptionalStructureText(options.altText, "altText") } : {}),
    ...(options.actualText !== undefined ? { actualText: normalizeOptionalStructureText(options.actualText, "actualText") } : {}),
    ...(options.language !== undefined ? { language: normalizeLanguage(options.language) } : {}),
    ...(options.attributes !== undefined || options.boundingBox !== undefined
      ? { attributes: normalizeStructureAttributes({
          ...(options.attributes ?? {}),
          ...(options.boundingBox !== undefined ? { BBox: options.boundingBox } : {})
        }) }
      : {}),
    ...(options.mathML !== undefined ? { mathML: options.mathML } : {}),
    ...(options.phoneme !== undefined ? { phoneme: normalizeOptionalStructureText(options.phoneme, "phoneme") } : {}),
    ...(options.expansion !== undefined ? { expansion: normalizeOptionalStructureText(options.expansion, "expansion") } : {})
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeStructureAttributes(attributes: Record<string, PdfStructureAttributeValue>): Record<string, PdfStructureAttributeValue> {
  const normalized: Record<string, PdfStructureAttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    normalized[normalizeRoleName(key, "attribute key")] = normalizeStructureAttributeValue(value);
  }
  return normalized;
}

function normalizeStructureAttributeValue(value: PdfStructureAttributeValue): PdfStructureAttributeValue {
  if (typeof value === "string") {
    return normalizeOptionalStructureText(value, "attribute value")!;
  }
  if (typeof value === "number") {
    assertFinite(value, "attribute value");
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeStructureAttributeValue(entry));
  }
  if (typeof value === "object" && value !== null && "name" in value) {
    return { name: normalizeRoleName(value.name, "attribute name value") };
  }
  throw new PdfEngineError(PdfErrorCode.INVALID_COMPLIANCE, "Unsupported structure attribute value.", {
    value
  });
}

function normalizeRoleName(role: string, property: string): string {
  const normalized = role.trim();
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(normalized)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_COMPLIANCE, `Structure ${property} must be a valid PDF name-like role.`, {
      [property]: role
    });
  }
  return normalized;
}

export function normalizeStructureRole(role: Exclude<PdfStructureTag, "Artifact">): Exclude<PdfStructureTag, "Artifact"> {
  if (role === "Artifact") {
    throw new PdfEngineError(PdfErrorCode.INVALID_COMPLIANCE, "Artifact is marked content, not a structure element role.", {
      role
    });
  }
  return normalizeRoleName(role, "role") as Exclude<PdfStructureTag, "Artifact">;
}

function normalizeRoleMap(roleMap: PdfRoleMap): PdfRoleMap {
  const normalized: PdfRoleMap = {};
  for (const [source, target] of Object.entries(roleMap)) {
    normalized[normalizeRoleName(source, "roleMap source")] = normalizeStandardStructureTag(target, "roleMap target");
  }
  return normalized;
}

function normalizeStandardStructureTag(tag: PdfStandardStructureTag, property: string): PdfStandardStructureTag {
  return normalizeRoleName(tag, property) as PdfStandardStructureTag;
}

function normalizeTextStructureTag(tag: PdfTextStructureTag | "Artifact" | PdfStructureTag): PdfTextStructureTag | "Artifact" {
  if (tag === "Artifact") {
    return "Artifact";
  }

  if (tag === "Figure" || tag === "Formula" || tag === "Form" || (isContainerStructureTag(tag) && tag !== "Lbl" && tag !== "LBody")) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_COMPLIANCE,
      "Text content may only use text structure tags such as P, H1-H6, Span, Lbl, LBody, or Artifact.",
      { tag }
    );
  }

  return tag as PdfTextStructureTag;
}

export function normalizeContainerStructureTag(tag: PdfContainerTag | PdfStructureTag): PdfContainerTag {
  if (tag === "Artifact" || tag === "Figure" || tag === "Formula" || tag === "Form" || (isTextStructureTag(tag) && tag !== "Lbl" && tag !== "LBody")) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_COMPLIANCE,
      "Tagged containers may only use structural container tags such as Document, Sect, Div, L, LI, Table, or Link.",
      { tag }
    );
  }

  return tag as PdfContainerTag;
}

function normalizeFigureStructureTag(tag: PdfFigureStructureTag | "Artifact" | PdfStructureTag): PdfFigureStructureTag | "Artifact" {
  if (tag !== "Figure" && tag !== "Formula" && tag !== "Form" && tag !== "Artifact") {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_COMPLIANCE,
      "Images may only use Figure, Formula, Form, or Artifact structure tags.",
      { tag }
    );
  }

  return tag as PdfFigureStructureTag | "Artifact";
}

function isTextStructureTag(tag: string): tag is PdfTextStructureTag {
  return tag === "P"
    || tag === "H1"
    || tag === "H2"
    || tag === "H3"
    || tag === "H4"
    || tag === "H5"
    || tag === "H6"
    || tag === "Span"
    || tag === "Quote"
    || tag === "Note"
    || tag === "Reference"
    || tag === "BibEntry"
    || tag === "Code"
    || tag === "Lbl"
    || tag === "LBody";
}

function isContainerStructureTag(tag: string): tag is PdfContainerTag {
  return tag === "Document"
    || tag === "Part"
    || tag === "Art"
    || tag === "Sect"
    || tag === "Div"
    || tag === "BlockQuote"
    || tag === "Caption"
    || tag === "TOC"
    || tag === "TOCI"
    || tag === "Index"
    || tag === "NonStruct"
    || tag === "Private"
    || tag === "L"
    || tag === "LI"
    || tag === "Lbl"
    || tag === "LBody"
    || tag === "Table"
    || tag === "THead"
    || tag === "TBody"
    || tag === "TFoot"
    || tag === "TR"
    || tag === "TH"
    || tag === "TD"
    || tag === "Link"
    || tag === "Annot";
}

/** How many built-in font usages are named in a message before summarizing. */
const BUILTIN_FONT_USAGE_REPORT_LIMIT = 3;

function describeBuiltInFontUsage(location: PdfComplianceLocation): string {
  const parts = [`page ${location.page}`];
  if (location.kind === "annotation") {
    const kind = location.annotation ?? "annotation";
    parts.push(location.name !== undefined ? `${kind} "${location.name}"` : kind);
  } else if (location.font !== undefined) {
    parts.push(`font "${location.font}"`);
  }
  if (location.snippet !== undefined && location.snippet !== "") {
    parts.push(JSON.stringify(location.snippet));
  }
  return parts.join(" · ");
}

/**
 * Appends the offending pages and text snippets to a built-in font message so
 * the caller can find the content without re-walking the document.
 */
function builtInFontIssue(
  code: string,
  message: string,
  usages: readonly PdfComplianceLocation[] | undefined,
): PdfComplianceIssue {
  if (usages === undefined || usages.length === 0) {
    return { code, severity: "error", message };
  }
  const named = usages.slice(0, BUILTIN_FONT_USAGE_REPORT_LIMIT);
  const rest = usages.length - named.length;
  const suffix = rest > 0 ? ` (+${rest} more)` : "";
  return {
    code,
    severity: "error",
    message: `${message} Found at: ${named.map(describeBuiltInFontUsage).join("; ")}${suffix}.`,
    locations: usages,
  };
}

export function collectComplianceIssues(input: ComplianceCheckInput): PdfComplianceIssue[] {
  const issues: PdfComplianceIssue[] = [];

  if (input.tagged && input.language === undefined) {
    issues.push({
      code: "TAGGED_LANGUAGE_RECOMMENDED",
      severity: "warning",
      message: "Tagged PDFs should declare a document language."
    });
  }

  if (input.tagged && input.hasFigureWithoutAltText) {
    issues.push({
      code: "FIGURE_ALT_TEXT_RECOMMENDED",
      severity: "warning",
      message: "Tagged figure content should include alt text for accessibility."
    });
  }

  const profile = input.conformance;
  const isPdfa =
    profile === "pdfa-1b" ||
    profile === "pdfa-2b" ||
    profile === "pdfa-3b" ||
    profile === "pdfa-4";
  const isPdfua = profile === "pdfua-1" || profile === "pdfua-2";

  if (isPdfa) {
    if (input.hasEncryption) {
      issues.push({
        code: "PDFA_ENCRYPTION_UNSUPPORTED",
        severity: "error",
        message: `${profile} output cannot be encrypted.`
      });
    }
    if (input.usesBuiltInFonts) {
      issues.push(builtInFontIssue(
        "PDFA_EMBEDDED_FONTS_REQUIRED",
        `${profile} output requires embedded fonts for visible text.`,
        input.builtInFontUsages,
      ));
    }
    // PDF/A-1b: no attachments. PDF/A-2b: only PDF/A files (we cannot verify, conservatively warn).
    // PDF/A-3b and PDF/A-4: arbitrary attachments allowed.
    if (input.hasAttachments && profile === "pdfa-1b") {
      issues.push({
        code: "PDFA_ATTACHMENTS_UNSUPPORTED",
        severity: "error",
        message: "PDF/A-1b output cannot include embedded file attachments."
      });
    }
    if (input.hasAttachments && profile === "pdfa-2b") {
      issues.push({
        code: "PDFA2_ATTACHMENTS_RESTRICTED",
        severity: "warning",
        message: "PDF/A-2b only permits PDF/A-conformant embedded files; ensure attachments comply."
      });
    }
    // PDF/A-1b forbids transparency. PDF/A-2/3/4 allow it.
    if (input.hasTransparency && profile === "pdfa-1b") {
      issues.push({
        code: "PDFA_TRANSPARENCY_UNSUPPORTED",
        severity: "error",
        message: "PDF/A-1b output cannot include transparent image content."
      });
    }
  }

  // PDF/A-4 specific XMP extension schema validation
  if (profile === "pdfa-4") {
    const hasXmp = input.xmpMetadata !== undefined;
    if (!hasXmp) {
      issues.push({
        code: "PDFA4_XMP_REQUIRED",
        severity: "warning",
        message: "PDF/A-4 output should include XMP metadata with pdfaid:part=4 and pdfaid:conformance declarations."
      });
    }
    if (hasXmp) {
      const xmp = typeof input.xmpMetadata === "string" ? input.xmpMetadata : "";
      const hasPdfaidPart = /pdfaid:part>\s*4\s*</.test(xmp);
      const hasPdfaidConf = /pdfaid:conformance>\s*[AB]\s*</.test(xmp);
      if (!hasPdfaidPart) {
        issues.push({
          code: "PDFA4_PART_MISSING",
          severity: "warning",
          message: "PDF/A-4 XMP metadata is missing pdfaid:part=4 declaration."
        });
      }
      if (!hasPdfaidConf) {
        issues.push({
          code: "PDFA4_CONFORMANCE_MISSING",
          severity: "warning",
          message: "PDF/A-4 XMP metadata is missing pdfaid:conformance declaration."
        });
      }
      const hasPdfaExtensionSchemas = /pdfaExtension:schemas/.test(xmp);
      if (!hasPdfaExtensionSchemas) {
        issues.push({
          code: "PDFA4_EXTENSION_SCHEMAS_MISSING",
          severity: "warning",
          message: "PDF/A-4 output may require pdfaExtension:schemas for custom XMP extension metadata."
        });
      }
    }
  }

  if (isPdfua) {
    if (!input.tagged) {
      issues.push({
        code: "PDFUA_TAGGED_REQUIRED",
        severity: "error",
        message: `${profile} output must be tagged.`
      });
    }
    if (input.language === undefined) {
      issues.push({
        code: "PDFUA_LANGUAGE_REQUIRED",
        severity: "error",
        message: `${profile} output must declare a document language.`
      });
    }
    if (input.hasFigureWithoutAltText) {
      issues.push({
        code: "PDFUA_FIGURE_ALT_TEXT_REQUIRED",
        severity: "error",
        message: `${profile} figure content must include alt text.`
      });
    }
    if (input.usesBuiltInFonts) {
      issues.push(builtInFontIssue(
        "PDFUA_EMBEDDED_FONTS_REQUIRED",
        `${profile} output requires embedded fonts for visible text.`,
        input.builtInFontUsages,
      ));
    }
  }

  if (profile === "wtpdf") {
    if (!input.tagged) {
      issues.push({
        code: "WTPDF_TAGGED_REQUIRED",
        severity: "error",
        message: "WTPDF output must be tagged per ISO 32000-2 rules."
      });
    }
    if (input.language === undefined) {
      issues.push({
        code: "WTPDF_LANGUAGE_RECOMMENDED",
        severity: "warning",
        message: "WTPDF output should declare a document language."
      });
    }
    if (input.hasFigureWithoutAltText) {
      issues.push({
        code: "WTPDF_FIGURE_ALT_TEXT_REQUIRED",
        severity: "error",
        message: "WTPDF figure content must include alt text."
      });
    }
    if (input.usesBuiltInFonts) {
      issues.push(builtInFontIssue(
        "WTPDF_EMBEDDED_FONTS_REQUIRED",
        "WTPDF output requires embedded fonts for visible text.",
        input.builtInFontUsages,
      ));
    }
  }

  return issues;
}

export function normalizeTextOptions(text: string, options: TextOptions): NormalizedTextOptions {
  const normalized = normalizeTextBaseOptions(options);

  if (typeof normalized.font === "string") {
    validateBuiltInText(text);
  }

  return {
    x: normalized.x,
    y: normalized.y,
    font: normalized.font,
    fontSize: normalized.fontSize,
    color: normalized.color,
    kerning: normalized.kerning,
    ...(normalized.characterSpacing !== undefined ? { characterSpacing: normalized.characterSpacing } : {}),
    ...(normalized.wordSpacing !== undefined ? { wordSpacing: normalized.wordSpacing } : {}),
    ...(normalized.leading !== undefined ? { leading: normalized.leading } : {}),
    ...(normalized.encoding !== undefined ? { encoding: normalized.encoding } : {}),
    ...(normalized.underline !== undefined ? { underline: normalized.underline } : {}),
    ...(normalized.strike !== undefined ? { strike: normalized.strike } : {}),
    ...(normalized.rise !== undefined ? { rise: normalized.rise } : {}),
    ...(normalized.renderMode !== undefined ? { renderMode: normalized.renderMode } : {}),
    ...(normalized.strokeColor !== undefined ? { strokeColor: normalized.strokeColor } : {}),
    ...(normalized.strokeWidth !== undefined ? { strokeWidth: normalized.strokeWidth } : {}),
    ...(normalized.horizontalScaling !== undefined ? { horizontalScaling: normalized.horizontalScaling } : {})
  };
}

export function normalizeTextBaseOptions(options: TextOptions | TextBlockOptions): NormalizedTextBaseOptions {
  assertFinite(options.x, "x");
  assertFinite(options.y, "y");

  const fontSize = options.fontSize ?? 12;
  assertFinite(fontSize, "fontSize");

  if (fontSize <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Font size must be greater than zero.", { options });
  }

  const encoding = "encoding" in options ? options.encoding : undefined;

  const resolvedFont = resolveStyledFont(options.font ?? DEFAULT_FONT, options.bold, options.italic);
  assertKnownBuiltInFont(resolvedFont);

  // Superscript / subscript are conveniences over `rise` + a reduced font size.
  // An explicit `rise` overrides the computed shift; superscript wins over
  // subscript when both are set. The size shrinks to ~62% (typographic norm).
  let effectiveFontSize = fontSize;
  let rise = normalizeOptionalNumber(options.rise, "rise");
  if (options.superscript === true || options.subscript === true) {
    effectiveFontSize = fontSize * 0.62;
    if (rise === undefined) {
      rise = options.superscript === true ? fontSize * 0.33 : -(fontSize * 0.18);
    }
  }

  const renderMode = options.renderMode;
  const strokeWidth = normalizeOptionalNumber(options.strokeWidth, "strokeWidth");
  const horizontalScaling = normalizeOptionalNumber(options.horizontalScaling, "horizontalScaling");

  const normalized: NormalizedTextBaseOptions = {
    x: options.x,
    y: options.y,
    font: resolvedFont,
    fallbackFonts: options.fallbackFonts ? [...options.fallbackFonts] : [],
    direction: options.direction ?? "ltr",
    fontSize: effectiveFontSize,
    color: normalizeColor(options.color ?? DEFAULT_COLOR),
    kerning: options.kerning ?? true,
    ...(options.writingMode !== undefined ? { writingMode: options.writingMode } : {}),
    ...(options.tag !== undefined ? { tag: normalizeTextStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {}),
    ...(encoding !== undefined ? { encoding } : {}),
    ...(('artifactType' in options && options.artifactType !== undefined) ? { artifactType: options.artifactType } : {}),
    ...(options.underline !== undefined ? { underline: options.underline } : {}),
    ...(options.strike !== undefined ? { strike: options.strike } : {}),
    ...(rise !== undefined ? { rise } : {}),
    ...(renderMode !== undefined ? { renderMode } : {}),
    ...(options.strokeColor !== undefined ? { strokeColor: normalizeColor(options.strokeColor) } : {}),
    ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    ...(horizontalScaling !== undefined ? { horizontalScaling } : {}),
    ...(options.highlight !== undefined ? { highlight: normalizeColor(options.highlight) } : {}),
    tateChuYoko: options.writingMode === "vertical" ? true : undefined,
  };

  const characterSpacing = normalizeOptionalNumber(options.characterSpacing, "characterSpacing");
  const wordSpacing = normalizeOptionalNumber(options.wordSpacing, "wordSpacing");
  const leading = normalizeOptionalNumber("leading" in options ? options.leading : undefined, "leading");

  if (characterSpacing !== undefined) normalized.characterSpacing = characterSpacing;
  if (wordSpacing !== undefined) normalized.wordSpacing = wordSpacing;
  if (leading !== undefined) normalized.leading = leading;

  return normalized;
}

export function normalizeTextBlockOptions(text: string, options: TextBlockOptions): NormalizedTextBlockOptions {
  const normalizedText = normalizeTextBaseOptions(options);

  assertFinite(options.width, "width");
  if (options.width <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Text block width must be greater than zero.", { options });
  }

  const lineHeight = options.lineHeight ?? normalizedText.fontSize * 1.2;
  assertFinite(lineHeight, "lineHeight");
  if (lineHeight <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Text block lineHeight must be greater than zero.", { options });
  }

  const maxLines = normalizeOptionalPositiveNumber(options.maxLines, "maxLines");
  if (maxLines !== undefined && !Number.isInteger(maxLines)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Text block maxLines must be an integer.", { maxLines });
  }

  const height = normalizeOptionalPositiveNumber(options.height, "height");

  return {
    ...normalizedText,
    width: options.width,
    lineHeight,
    align: options.align ?? (resolveTextDirection(text, normalizedText.direction) === "rtl" ? "right" : "left"),
    ...(height !== undefined ? { height } : {}),
    ...(options.verticalAlign !== undefined ? { verticalAlign: options.verticalAlign } : {}),
    ...(maxLines !== undefined ? { maxLines } : {})
  };
}

export function normalizeListItems(items: readonly ListItem[]): NormalizedListItem[] {
  if (items.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Lists must contain at least one item.");
  }

  return items.map((item, index) => normalizeListItem(item, index));
}

export function normalizeListOptions(items: readonly NormalizedListItem[], options: ListOptions): NormalizedListOptions {
  const normalizedText = normalizeTextBaseOptions(options);

  assertFinite(options.width, "width");
  if (options.width <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List width must be greater than zero.", { options });
  }

  const lineHeight = options.lineHeight ?? normalizedText.fontSize * 1.2;
  assertFinite(lineHeight, "lineHeight");
  if (lineHeight <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List lineHeight must be greater than zero.", { options });
  }

  const itemSpacing = normalizeOptionalNumber(options.itemSpacing, "itemSpacing") ?? 2;
  if (itemSpacing < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List itemSpacing must be zero or greater.", { options });
  }

  const indent = normalizeOptionalNumber(options.indent, "indent") ?? normalizedText.fontSize * 2;
  if (indent <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List indent must be greater than zero.", { options });
  }

  const labelGap = normalizeOptionalNumber(options.labelGap, "labelGap") ?? 2;
  if (labelGap < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List labelGap must be zero or greater.", { options });
  }

  const startAt = normalizeOptionalPositiveNumber(options.startAt, "startAt") ?? 1;
  if (!Number.isInteger(startAt)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List startAt must be a positive integer.", { startAt });
  }

  const bullet = options.bullet ?? "-";
  if (bullet.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List bullet labels must not be empty.", { bullet });
  }

  const sampleText = items.map((item) => item.body).find((body) => body.length > 0) ?? bullet;

  return {
    ...normalizedText,
    width: options.width,
    lineHeight,
    ...(options.lineHeight !== undefined ? { explicitLineHeight: options.lineHeight } : {}),
    align: options.align ?? (resolveTextDirection(sampleText, normalizedText.direction) === "rtl" ? "right" : "left"),
    ordered: options.ordered ?? false,
    startAt,
    bullet,
    itemSpacing,
    indent,
    labelGap
  };
}

export function normalizeTableRows(rows: readonly (readonly TableCell[])[]): NormalizedTableRow[] {
  if (rows.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Tables must contain at least one row.");
  }

  return rows.map((row, rowIndex) => {
    if (row.length === 0) {
      throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table rows must contain at least one cell.", {
        rowIndex
      });
    }
    return row.map((cell, cellIndex) => normalizeTableCell(cell, rowIndex, cellIndex));
  });
}

export function normalizeTableOptions(rows: readonly NormalizedTableRow[], options: TableOptions): NormalizedTableOptions {
  const normalizedText = normalizeTextBaseOptions(options);

  assertFinite(options.width, "width");
  if (options.width <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table width must be greater than zero.", { options });
  }

  const columnCount = resolveTableColumnCount(rows);
  const columnWidths = options.columnWidths ? [...options.columnWidths] : new Array(columnCount).fill(options.width / columnCount);
  if (columnWidths.length !== columnCount) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table columnWidths must match the resolved column count.", {
      columnCount,
      columnWidths: columnWidths.length
    });
  }

  let totalWidth = 0;
  for (const [index, width] of columnWidths.entries()) {
    assertFinite(width, `columnWidths[${index}]`);
    if (width <= 0) {
      throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table column widths must be greater than zero.", {
        index,
        width
      });
    }
    totalWidth += width;
  }
  if (Math.abs(totalWidth - options.width) > 0.001) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table column widths must add up to the table width.", {
      width: options.width,
      totalWidth
    });
  }

  const lineHeight = options.lineHeight ?? normalizedText.fontSize * 1.2;
  assertFinite(lineHeight, "lineHeight");
  if (lineHeight <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table lineHeight must be greater than zero.", { options });
  }

  const cellPadding = normalizeOptionalNumber(options.cellPadding, "cellPadding") ?? 2;
  if (cellPadding < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table cellPadding must be zero or greater.", { options });
  }

  const rowGap = normalizeOptionalNumber(options.rowGap, "rowGap") ?? 0;
  if (rowGap < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table rowGap must be zero or greater.", { options });
  }

  const headerRows = normalizeOptionalNonNegativeInteger(options.headerRows, "headerRows") ?? 0;
  const headerColumns = normalizeOptionalNonNegativeInteger(options.headerColumns, "headerColumns") ?? 0;

  const borderWidth = normalizeOptionalNumber(options.borderWidth, "borderWidth");
  if (borderWidth !== undefined && borderWidth < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table borderWidth must be zero or greater.", { borderWidth });
  }
  if (
    options.borders !== undefined &&
    options.borders !== "all" &&
    options.borders !== "horizontal" &&
    options.borders !== "outer" &&
    options.borders !== "none"
  ) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, 'Table borders must be "all", "horizontal", "outer", or "none".', {
      borders: options.borders
    });
  }
  const hasBorderInput = options.borderColor !== undefined || (borderWidth !== undefined && borderWidth > 0);
  const hasBorder = options.borders !== undefined ? options.borders !== "none" : hasBorderInput;
  const borderStyle: "all" | "horizontal" | "outer" = options.borders !== undefined && options.borders !== "none" ? options.borders : "all";

  return {
    ...normalizedText,
    width: options.width,
    columnWidths,
    headerRows,
    headerColumns,
    cellPadding,
    ...(hasBorder
      ? {
          borderColor: normalizeColor(options.borderColor ?? gray(0.6)),
          borderWidth: borderWidth ?? 0.75,
          borderStyle
        }
      : {}),
    ...(options.headerBackground !== undefined ? { headerBackground: normalizeColor(options.headerBackground) } : {}),
    ...(options.zebra !== undefined && options.zebra !== false
      ? { zebraColor: normalizeColor(options.zebra === true ? gray(0.95) : options.zebra) }
      : {}),
    rowGap,
    lineHeight,
    align: options.align ?? "left",
    verticalAlign: options.verticalAlign ?? "top",
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {}),
    ...(options.summary !== undefined ? { summary: options.summary } : {})
  };
}

function normalizeTableCell(cell: TableCell, rowIndex: number, cellIndex: number): NormalizedTableCell {
  const definition = typeof cell === "string" ? { text: cell } : cell;
  if (definition.runs !== undefined) {
    if (definition.text !== undefined) {
      throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table cells accept either text or runs, not both.", {
        rowIndex,
        cellIndex
      });
    }
    if (definition.runs.length === 0) {
      throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table cell runs must not be empty.", {
        rowIndex,
        cellIndex
      });
    }
    for (const run of definition.runs) {
      validateText(run.text);
    }
  } else {
    if (definition.text === undefined || definition.text.trim().length === 0) {
      throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table cell text must not be empty.", {
        rowIndex,
        cellIndex
      });
    }
    validateText(definition.text);
  }

  const rowSpan = definition.rowSpan ?? 1;
  const colSpan = definition.colSpan ?? 1;
  if (!Number.isInteger(rowSpan) || rowSpan <= 0 || !Number.isInteger(colSpan) || colSpan <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table cell rowSpan and colSpan must be positive integers.", {
      rowIndex,
      cellIndex,
      rowSpan,
      colSpan
    });
  }

  return {
    text: definition.text ?? definition.runs!.map((run) => run.text).join(""),
    ...(definition.runs !== undefined ? { runs: definition.runs } : {}),
    header: definition.header ?? false,
    ...(definition.scope !== undefined ? { scope: definition.scope } : {}),
    rowSpan,
    colSpan,
    ...(definition.structure !== undefined ? { structure: normalizeStructureOptions(definition.structure) } : {}),
    ...(definition.annotations !== undefined ? { annotations: definition.annotations } : {}),
    ...(definition.verticalAlign !== undefined ? { verticalAlign: definition.verticalAlign } : {}),
    ...(definition.bold !== undefined ? { bold: definition.bold } : {}),
    ...(definition.italic !== undefined ? { italic: definition.italic } : {}),
    ...(definition.font !== undefined ? { font: definition.font } : {}),
    ...(definition.color !== undefined ? { color: normalizeColor(definition.color) } : {}),
    ...(definition.align !== undefined ? { align: definition.align } : {}),
    ...(definition.background !== undefined ? { background: normalizeColor(definition.background) } : {}),
    ...(definition.border !== undefined
      ? (() => {
          const border = normalizeCellBorders(definition.border!, rowIndex, cellIndex);
          return border !== undefined ? { border } : {};
        })()
      : {})
  };
}

function normalizeCellBorderSide(
  side: boolean | TableCellBorderSide | undefined,
  name: string
): NormalizedCellBorderSide | undefined {
  if (side === undefined || side === false) {
    return undefined;
  }
  if (side === true) {
    return { color: normalizeColor(gray(0.6)), width: 0.75 };
  }
  const width = normalizeOptionalNumber(side.width, `${name}.width`) ?? 0.75;
  if (width < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table cell border width must be zero or greater.", { name, width });
  }
  return { color: normalizeColor(side.color ?? gray(0.6)), width };
}

function normalizeCellBorders(
  border: TableCellBorders,
  rowIndex: number,
  cellIndex: number
): NormalizedCellBorders | undefined {
  const prefix = `border[row ${rowIndex}, cell ${cellIndex}]`;
  const top = normalizeCellBorderSide(border.top, `${prefix}.top`);
  const right = normalizeCellBorderSide(border.right, `${prefix}.right`);
  const bottom = normalizeCellBorderSide(border.bottom, `${prefix}.bottom`);
  const left = normalizeCellBorderSide(border.left, `${prefix}.left`);
  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    return undefined;
  }
  return {
    ...(top !== undefined ? { top } : {}),
    ...(right !== undefined ? { right } : {}),
    ...(bottom !== undefined ? { bottom } : {}),
    ...(left !== undefined ? { left } : {})
  };
}

function resolveTableColumnCount(rows: readonly NormalizedTableRow[]): number {
  return Math.max(...rows.map((row) => row.reduce((sum, cell) => sum + cell.colSpan, 0)));
}

function normalizeOptionalNonNegativeInteger(value: number | undefined, name: string): number | undefined {
  const normalized = normalizeOptionalNumber(value, name);
  if (normalized === undefined) {
    return undefined;
  }
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, `${name} must be a non-negative integer.`, {
      [name]: normalized
    });
  }
  return normalized;
}

export function resolveTextDirection(text: string, direction: TextDirection): ResolvedTextDirection {
  if (direction !== "auto") {
    return direction;
  }

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    if (isRtlCodePoint(codePoint)) {
      return "rtl";
    }

    if (isLtrCodePoint(codePoint)) {
      return "ltr";
    }
  }

  return "ltr";
}

function normalizeListItem(item: ListItem, index: number): NormalizedListItem {
  if (typeof item === "string") {
    validateListItemBody(item, index);
    return {
      body: item,
      children: []
    };
  }

  const richBody = Array.isArray(item.body) ? (item.body as readonly InlineTextRun[]) : undefined;
  const body = richBody !== undefined ? richBody.map((run) => run.text).join("") : ((item.body as string | undefined) ?? "");
  const normalizedLabel = item.label?.trim();
  const children = item.children ? item.children.map((child, childIndex) => normalizeListItem(child, childIndex)) : [];
  if (body.length === 0 && children.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List items must include body text or nested children.", {
      itemIndex: index
    });
  }

  if (richBody !== undefined && item.annotations !== undefined && item.annotations.length > 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_TEXT,
      "List items with a rich (InlineTextRun[]) body cannot also use annotations; set link/underline/highlight on the runs instead.",
      { itemIndex: index }
    );
  }

  if (body.length > 0) {
    validateListItemBody(body, index);
  }

  if (normalizedLabel !== undefined && normalizedLabel.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List item labels must not be empty.", {
      itemIndex: index
    });
  }

  if (normalizedLabel !== undefined) {
    validateText(normalizedLabel);
  }

  return {
    body,
    ...(richBody !== undefined ? { richBody } : {}),
    ...(normalizedLabel !== undefined ? { label: normalizedLabel } : {}),
    children,
    ...(item.annotations !== undefined ? { annotations: item.annotations } : {})
  };
}

function validateListItemBody(body: string, index: number): void {
  if (body.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List item text must not be empty.", {
      itemIndex: index
    });
  }

  validateText(body);
}

export function normalizeTextFieldOptions(fieldName: string, options: TextFieldOptions): NormalizedTextFieldOptions {
  if (fieldName.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Text field names must not be empty.");
  }

  assertFinite(options.x, "x");
  assertFinite(options.y, "y");
  assertFinite(options.width, "width");
  assertFinite(options.height, "height");

  if (options.width <= 0 || options.height <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Text field width and height must be greater than zero.", {
      name: fieldName,
      options
    });
  }

  const fontSize = options.fontSize ?? 12;
  assertFinite(fontSize, "fontSize");
  if (fontSize <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Text field fontSize must be greater than zero.", {
      name: fieldName,
      fontSize
    });
  }

  const borderWidth = options.borderWidth ?? 1;
  assertFinite(borderWidth, "borderWidth");
  if (borderWidth < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Text field borderWidth must not be negative.", {
      name: fieldName,
      borderWidth
    });
  }

  if (options.value !== undefined) {
    validateBuiltInText(options.value);
  }

  return {
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    font: options.font ?? DEFAULT_FONT,
    fontSize,
    color: normalizeColor(options.color ?? DEFAULT_COLOR),
    borderWidth,
    ...(options.value !== undefined ? { value: options.value } : {}),
    ...(options.richValue !== undefined ? { richValue: options.richValue } : {}),
    readOnly: options.readOnly ?? false,
    required: options.required ?? false,
    multiline: options.multiline ?? false,
    encrypt: options.encrypt ?? true,
    ...(options.actions !== undefined ? { actions: options.actions } : {}),
    ...(options.appearance !== undefined ? { appearance: normalizeFieldAppearance(options.appearance) } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeCheckBoxOptions(fieldName: string, options: CheckBoxOptions): NormalizedCheckBoxOptions {
  if (fieldName.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Check box names must not be empty.");
  }

  assertFinite(options.x, "x");
  assertFinite(options.y, "y");
  assertFinite(options.width, "width");
  assertFinite(options.height, "height");

  if (options.width <= 0 || options.height <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Check box width and height must be greater than zero.", {
      name: fieldName,
      options
    });
  }

  const borderWidth = options.borderWidth ?? 1;
  assertFinite(borderWidth, "borderWidth");
  if (borderWidth < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Check box borderWidth must not be negative.", {
      name: fieldName,
      borderWidth
    });
  }

  return {
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    borderWidth,
    checked: options.checked ?? false,
    readOnly: options.readOnly ?? false,
    required: options.required ?? false,
    encrypt: options.encrypt ?? true,
    ...(options.actions !== undefined ? { actions: options.actions } : {}),
    ...(options.appearance !== undefined ? { appearance: normalizeFieldAppearance(options.appearance) } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeChoiceFieldOptions(fieldName: string, options: ChoiceFieldOptions): NormalizedChoiceFieldOptions {
  if (fieldName.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Choice field names must not be empty.");
  }

  assertFinite(options.x, "x");
  assertFinite(options.y, "y");
  assertFinite(options.width, "width");
  assertFinite(options.height, "height");

  if (options.width <= 0 || options.height <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Choice field width and height must be greater than zero.", {
      name: fieldName,
      options
    });
  }

  const fontSize = options.fontSize ?? 12;
  assertFinite(fontSize, "fontSize");
  if (fontSize <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Choice field fontSize must be greater than zero.", {
      name: fieldName,
      fontSize
    });
  }

  const borderWidth = options.borderWidth ?? 1;
  assertFinite(borderWidth, "borderWidth");
  if (borderWidth < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Choice field borderWidth must not be negative.", {
      name: fieldName,
      borderWidth
    });
  }

  if (options.options.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Choice fields must provide at least one option.", {
      name: fieldName
    });
  }

  for (const option of options.options) {
    validateChoiceFieldValue(option);
  }

  if (options.value !== undefined) {
    validateChoiceFieldValue(options.value, options.options);
  }

  return {
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    options: [...options.options],
    font: options.font ?? DEFAULT_FONT,
    fontSize,
    color: normalizeColor(options.color ?? DEFAULT_COLOR),
    borderWidth,
    ...(options.value !== undefined ? { value: options.value } : {}),
    readOnly: options.readOnly ?? false,
    required: options.required ?? false,
    mode: options.mode ?? "combo",
    editable: options.editable ?? false,
    encrypt: options.encrypt ?? true,
    ...(options.actions !== undefined ? { actions: options.actions } : {}),
    ...(options.appearance !== undefined ? { appearance: normalizeFieldAppearance(options.appearance) } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeRadioGroupOptions(fieldName: string, options: RadioGroupOptions): NormalizedRadioGroupOptions {
  if (fieldName.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Radio group names must not be empty.");
  }

  if (options.items.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Radio groups must provide at least one item.", {
      name: fieldName
    });
  }

  const borderWidth = options.borderWidth ?? 1;
  assertFinite(borderWidth, "borderWidth");
  if (borderWidth < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Radio group borderWidth must not be negative.", {
      name: fieldName,
      borderWidth
    });
  }

  const seenValues = new Set<string>();
  const items = options.items.map((item, index) => {
    validateChoiceFieldValue(item.value);
    if (seenValues.has(item.value)) {
      throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Radio group item values must be unique.", {
        name: fieldName,
        value: item.value,
        index
      });
    }
    seenValues.add(item.value);

    assertFinite(item.x, "x");
    assertFinite(item.y, "y");
    assertFinite(item.width, "width");
    assertFinite(item.height, "height");

    if (item.width <= 0 || item.height <= 0) {
      throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Radio group item width and height must be greater than zero.", {
        name: fieldName,
        value: item.value,
        index
      });
    }

    return {
      value: item.value,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height
    };
  });

  if (options.value !== undefined) {
    validateChoiceFieldValue(options.value, items.map((item) => item.value));
  }

  return {
    items,
    ...(options.value !== undefined ? { value: options.value } : {}),
    borderWidth,
    readOnly: options.readOnly ?? false,
    required: options.required ?? false,
    encrypt: options.encrypt ?? true,
    ...(options.actions !== undefined ? { actions: options.actions } : {}),
    ...(options.appearance !== undefined ? { appearance: normalizeFieldAppearance(options.appearance) } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizePushButtonOptions(fieldName: string, options: PushButtonOptions): NormalizedPushButtonOptions {
  if (fieldName.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Push button names must not be empty.");
  }

  const rect = normalizeAnnotationRect(options, "Push button", PdfErrorCode.INVALID_FORM_FIELD);
  const fontSize = options.fontSize ?? 12;
  assertFinite(fontSize, "fontSize");
  if (fontSize <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Push button fontSize must be greater than zero.", {
      name: fieldName,
      fontSize
    });
  }

  const borderWidth = options.borderWidth ?? 1;
  assertFinite(borderWidth, "borderWidth");
  if (borderWidth < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Push button borderWidth must not be negative.", {
      name: fieldName,
      borderWidth
    });
  }

  validateBuiltInText(options.label);

  return {
    ...rect,
    label: options.label,
    font: options.font ?? DEFAULT_FONT,
    fontSize,
    color: normalizeColor(options.color ?? DEFAULT_COLOR),
    borderWidth,
    readOnly: options.readOnly ?? false,
    encrypt: options.encrypt ?? true,
    ...(options.actions !== undefined ? { actions: options.actions } : {}),
    ...(options.appearance !== undefined ? { appearance: normalizeFieldAppearance(options.appearance) } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeSignatureFieldOptions(fieldName: string, options: SignatureFieldOptions): NormalizedSignatureFieldOptions {
  if (fieldName.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Signature field names must not be empty.");
  }

  const rect = normalizeAnnotationRect(options, "Signature field", PdfErrorCode.INVALID_FORM_FIELD);
  const borderWidth = options.borderWidth ?? 1;
  assertFinite(borderWidth, "borderWidth");
  if (borderWidth < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Signature field borderWidth must not be negative.", {
      name: fieldName,
      borderWidth
    });
  }

  return {
    ...rect,
    borderWidth,
    readOnly: options.readOnly ?? false,
    required: options.required ?? false,
    encrypt: options.encrypt ?? true,
    ...(options.actions !== undefined ? { actions: options.actions } : {}),
    ...(options.appearance !== undefined ? { appearance: normalizeFieldAppearance(options.appearance) } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function validateText(text: string): void {
  if (text.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Text content must not be empty.");
  }
}

export function validateTextFieldValue(value: string): void {
  validateBuiltInText(value);
}

export function validateChoiceFieldValue(value: string, allowedOptions?: readonly string[]): void {
  validateBuiltInText(value);

  if (allowedOptions !== undefined && !allowedOptions.includes(value)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FORM_FIELD, "Choice field values must match one of the field options.", {
      value,
      allowedOptions
    });
  }
}

export function normalizePathStyle(style: PathStyle): NormalizedPathStyle {
  const normalized: NormalizedPathStyle = {
    paint: style.paint,
    ...(style.tag !== undefined ? { tag: style.tag } : {})
  };

  if (style.paint === "stroke" || style.paint === "fillStroke") {
    normalized.stroke = normalizeStrokeStyle(style.stroke);
  }

  if (style.paint === "fill" || style.paint === "fillStroke") {
    normalized.fill = normalizeFillStyle(style.fill);
  }

  return normalized;
}

export function validatePathCommands(commands: PathCommand[]): void {
  if (commands.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PATH, "A path must include at least one drawing command.");
  }

  for (const command of commands) {
    switch (command.type) {
      case "moveTo":
      case "lineTo":
        assertFinite(command.x, `${command.type}.x`);
        assertFinite(command.y, `${command.type}.y`);
        break;
      case "curveTo":
        assertFinite(command.x1, "curveTo.x1");
        assertFinite(command.y1, "curveTo.y1");
        assertFinite(command.x2, "curveTo.x2");
        assertFinite(command.y2, "curveTo.y2");
        assertFinite(command.x3, "curveTo.x3");
        assertFinite(command.y3, "curveTo.y3");
        break;
      case "rect":
        assertFinite(command.x, "rect.x");
        assertFinite(command.y, "rect.y");
        assertFinite(command.width, "rect.width");
        assertFinite(command.height, "rect.height");
        break;
      case "closePath":
        break;
      default:
        assertNever(command);
    }
  }
}

export function validateTransform(transform: Transform): void {
  assertFinite(transform.a, "a");
  assertFinite(transform.b, "b");
  assertFinite(transform.c, "c");
  assertFinite(transform.d, "d");
  assertFinite(transform.e, "e");
  assertFinite(transform.f, "f");
}

export function validateExtGStateOptions(options: ExtGStateOptions): void {
  if (
    options.fillAlpha === undefined
    && options.strokeAlpha === undefined
    && options.blendMode === undefined
    && options.softMask === undefined
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_GRAPHICS_STATE,
      "setExtGState requires at least one of fillAlpha, strokeAlpha, blendMode, or softMask."
    );
  }
  if (options.fillAlpha !== undefined) {
    assertFinite(options.fillAlpha, "fillAlpha");
    if (options.fillAlpha < 0 || options.fillAlpha > 1) {
      throw new PdfEngineError(PdfErrorCode.INVALID_GRAPHICS_STATE, "fillAlpha must be between 0 and 1 inclusive.");
    }
  }
  if (options.strokeAlpha !== undefined) {
    assertFinite(options.strokeAlpha, "strokeAlpha");
    if (options.strokeAlpha < 0 || options.strokeAlpha > 1) {
      throw new PdfEngineError(PdfErrorCode.INVALID_GRAPHICS_STATE, "strokeAlpha must be between 0 and 1 inclusive.");
    }
  }
}

export function normalizeImageOptions(options: JpegImageOptions | PngImageOptions | BmpImageOptions | import("../types.js").Jbig2ImageOptions | import("../types.js").TiffImageOptions | import("../types.js").Jp2ImageOptions | {
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  altText?: string | undefined;
  tag?: import("../types.js").PdfFigureStructureTag | "Artifact" | undefined;
  structure?: import("../types.js").PdfStructureOptions | undefined;
  fit?: import("../types.js").ImageFit | undefined;
  position?: import("../types.js").ImagePosition | undefined;
  clip?: import("../types.js").ImageClip | undefined;
}): NormalizedImageOptions {
  assertFinite(options.x, "x");
  assertFinite(options.y, "y");

  if (options.width !== undefined) assertFinite(options.width, "width");
  if (options.height !== undefined) assertFinite(options.height, "height");

  if ((options.width ?? 0) <= 0 || (options.height ?? 0) <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Image placement width and height must be greater than zero.", {
      options
    });
  }

  return {
    x: options.x,
    y: options.y,
    width: options.width ?? 0,
    height: options.height ?? 0,
    ...("altText" in options && typeof options.altText === "string" && options.altText.trim().length > 0
      ? { altText: options.altText.trim() }
      : {}),
    ...("tag" in options && options.tag !== undefined ? { tag: normalizeFigureStructureTag(options.tag) } : {}),
    ...("structure" in options && options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {}),
    ...("fit" in options && options.fit !== undefined ? { fit: normalizeImageFit(options.fit) } : {}),
    ...("position" in options && options.position !== undefined ? { position: normalizeImagePosition(options.position) } : {}),
    ...("clip" in options && options.clip !== undefined ? { clip: normalizeImageClip(options.clip) } : {})
  };
}

const IMAGE_FIT_VALUES: ReadonlySet<string> = new Set(["fill", "contain", "cover"]);
const IMAGE_POSITION_VALUES: ReadonlySet<string> = new Set([
  "center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"
]);
const IMAGE_CLIP_VALUES: ReadonlySet<string> = new Set(["none", "circle", "ellipse"]);

function normalizeImageFit(value: string): import("../types.js").ImageFit {
  if (!IMAGE_FIT_VALUES.has(value)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Image fit must be 'fill', 'contain', or 'cover'.", { fit: value });
  }
  return value as import("../types.js").ImageFit;
}

function normalizeImagePosition(value: string): import("../types.js").ImagePosition {
  if (!IMAGE_POSITION_VALUES.has(value)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Invalid image position.", { position: value });
  }
  return value as import("../types.js").ImagePosition;
}

function normalizeImageClip(value: string): import("../types.js").ImageClip {
  if (!IMAGE_CLIP_VALUES.has(value)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Image clip must be 'none', 'circle', or 'ellipse'.", { clip: value });
  }
  return value as import("../types.js").ImageClip;
}

export function normalizeUriLinkOptions(url: string, options: UriLinkOptions): NormalizedUriLinkOptions {
  validateUri(url);
  return normalizeLinkRect(options);
}

export function normalizePageLinkOptions(options: PageLinkOptions): NormalizedPageLinkOptions {
  return normalizeLinkRect(options);
}

export function normalizeHighlightAnnotationOptions(options: HighlightAnnotationOptions): NormalizedHighlightAnnotationOptions {
  return {
    ...normalizeAnnotationRect(options, "Highlight"),
    color: normalizeColor(options.color ?? { kind: "rgb", r: 1, g: 1, b: 0 }),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeUnderlineAnnotationOptions(options: UnderlineAnnotationOptions): NormalizedUnderlineAnnotationOptions {
  return {
    ...normalizeAnnotationRect(options, "Underline"),
    color: normalizeColor(options.color ?? { kind: "rgb", r: 0, g: 0, b: 0 }),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeStrikeOutAnnotationOptions(options: StrikeOutAnnotationOptions): NormalizedStrikeOutAnnotationOptions {
  return {
    ...normalizeAnnotationRect(options, "StrikeOut"),
    color: normalizeColor(options.color ?? { kind: "rgb", r: 0.85, g: 0.15, b: 0.15 }),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeSquigglyAnnotationOptions(options: SquigglyAnnotationOptions): NormalizedSquigglyAnnotationOptions {
  return {
    ...normalizeAnnotationRect(options, "Squiggly"),
    color: normalizeColor(options.color ?? { kind: "rgb", r: 0.85, g: 0.15, b: 0.15 }),
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeNoteAnnotationOptions(options: NoteAnnotationOptions): NormalizedNoteAnnotationOptions {
  assertFinite(options.x, "x");
  assertFinite(options.y, "y");
  const width = options.width ?? 18;
  const height = options.height ?? 18;
  assertFinite(width, "width");
  assertFinite(height, "height");
  if (width <= 0 || height <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_ANNOTATION, "Note annotation width and height must be greater than zero.", {
      options
    });
  }

  validateBuiltInText(options.contents);

  return {
    x: options.x,
    y: options.y,
    width,
    height,
    contents: options.contents,
    open: options.open ?? false,
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeFreeTextAnnotationOptions(options: FreeTextAnnotationOptions): NormalizedFreeTextAnnotationOptions {
  const rect = normalizeAnnotationRect(options, "Free text");
  const fontSize = options.fontSize ?? 12;
  assertFinite(fontSize, "fontSize");
  if (fontSize <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_ANNOTATION, "Free text fontSize must be greater than zero.", {
      fontSize
    });
  }

  const borderWidth = options.borderWidth ?? 1;
  assertFinite(borderWidth, "borderWidth");
  if (borderWidth < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_ANNOTATION, "Free text borderWidth must not be negative.", {
      borderWidth
    });
  }

  validateBuiltInText(options.text);

  return {
    ...rect,
    text: options.text,
    font: options.font ?? DEFAULT_FONT,
    fontSize,
    color: normalizeColor(options.color ?? DEFAULT_COLOR),
    borderWidth,
    ...(options.tag !== undefined ? { tag: normalizeAnnotationStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

export function normalizeDestinationName(name: string): string {
  if (name.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_DESTINATION, "Named destination names must not be empty.");
  }

  return name;
}

export function normalizeOutlineTitle(title: string): string {
  if (title.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_OUTLINE, "Outline titles must not be empty.");
  }

  return title;
}

export function normalizeOutlineOptions(options: OutlineOptions | undefined): NormalizedOutlineOptions {
  return {
    expanded: options?.expanded ?? true
  };
}

function normalizeDocumentPermissions(permissions: DocumentPermissions | undefined): NormalizedDocumentPermissions {
  return {
    printing: permissions?.printing ?? true,
    modifying: permissions?.modifying ?? true,
    copying: permissions?.copying ?? true,
    annotating: permissions?.annotating ?? true,
    accessibility: permissions?.accessibility ?? true,
    assemble: permissions?.assemble ?? true,
    highQualityPrint: permissions?.highQualityPrint ?? true,
    fillForms: permissions?.fillForms ?? true
  };
}

export function normalizePageLabelOptions(options: PageLabelOptions | undefined): NormalizedPageLabelOptions {
  const prefix = options?.prefix;
  if (prefix !== undefined) {
    validateBuiltInText(prefix);
  }

  const startAt = options?.startAt ?? 1;
  assertFinite(startAt, "startAt");
  if (!Number.isInteger(startAt) || startAt <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PAGE_LABEL, "Page label startAt must be a positive integer.", {
      startAt
    });
  }

  if (options?.style === undefined && prefix === undefined) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PAGE_LABEL, "Page labels must include a numbering style, a prefix, or both.");
  }

  return {
    ...(options?.style !== undefined ? { style: options.style } : {}),
    ...(prefix !== undefined ? { prefix } : {}),
    startAt
  };
}

export function normalizeAttachmentOptions(name: string, options: AttachmentOptions | undefined): NormalizedAttachmentOptions {
  if (name.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_ATTACHMENT, "Attachment names must not be empty.");
  }

  validateBuiltInText(name);

  if (options?.description !== undefined) {
    validateBuiltInText(options.description);
  }

  if (options?.mimeType !== undefined) {
    if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(options.mimeType)) {
      throw new PdfEngineError(PdfErrorCode.INVALID_ATTACHMENT, "Attachment mimeType must be a valid media type.", {
        mimeType: options.mimeType
      });
    }
  }

  return {
    ...(options?.description !== undefined ? { description: options.description } : {}),
    ...(options?.mimeType !== undefined ? { mimeType: options.mimeType } : {})
  };
}

function normalizeAnnotationRect(
  options: { x: number; y: number; width: number; height: number },
  label: string,
  code: PdfErrorCode = PdfErrorCode.INVALID_ANNOTATION
): { x: number; y: number; width: number; height: number } {
  assertFinite(options.x, "x");
  assertFinite(options.y, "y");
  assertFinite(options.width, "width");
  assertFinite(options.height, "height");

  if (options.width <= 0 || options.height <= 0) {
    throw new PdfEngineError(code, `${label} annotation width and height must be greater than zero.`, {
      options
    });
  }

  return {
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height
  };
}

function normalizeLinkRect(options: UriLinkOptions | PageLinkOptions): NormalizedUriLinkOptions {
  const rect = normalizeAnnotationRect(options, "Link", PdfErrorCode.INVALID_LINK);
  const borderWidth = options.borderWidth ?? 0;
  assertFinite(borderWidth, "borderWidth");
  if (borderWidth < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_LINK, "Link annotation borderWidth must not be negative.", {
      borderWidth
    });
  }

  return {
    ...rect,
    borderWidth,
    ...("tag" in options && options.tag !== undefined ? { tag: normalizeLinkStructureTag(options.tag) } : {}),
    ...("structure" in options && options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

function normalizeLinkStructureTag(tag: "Link" | "Artifact" | PdfStructureTag): "Link" | "Artifact" {
  if (tag !== "Link" && tag !== "Artifact") {
    throw new PdfEngineError(PdfErrorCode.INVALID_COMPLIANCE, "Link annotations may only use the Link or Artifact structure tags.", {
      tag
    });
  }
  return tag as "Link" | "Artifact";
}

function normalizeAnnotationStructureTag(tag: "Annot" | "Artifact" | PdfStructureTag): "Annot" | "Artifact" {
  if (tag !== "Annot" && tag !== "Artifact") {
    throw new PdfEngineError(PdfErrorCode.INVALID_COMPLIANCE, "Annotations may only use the Annot or Artifact structure tags.", {
      tag
    });
  }
  return tag as "Annot" | "Artifact";
}

export function normalizeColor(color: ColorInput): PdfColor {
  if (typeof color === "string") {
    return resolveColorName(color);
  }
  if (color.kind === "gray") {
    assertRange(color.value, "gray.value");
    return color;
  }

  if (color.kind === "rgb") {
    assertRange(color.r, "rgb.r");
    assertRange(color.g, "rgb.g");
    assertRange(color.b, "rgb.b");
    return color;
  }

  if (color.kind === "cmyk") {
    assertRange(color.c, "cmyk.c");
    assertRange(color.m, "cmyk.m");
    assertRange(color.y, "cmyk.y");
    assertRange(color.k, "cmyk.k");
    return color;
  }

  if (color.kind === "separation") {
    if (!color.name) {
      throw new PdfEngineError(PdfErrorCode.INVALID_COLOR, "Separation color requires a non-empty ink name.");
    }
    assertRange(color.tint, "separation.tint");
    normalizeColor(color.alternate);
    return color;
  }

  // deviceN
  if (color.names.length !== color.tints.length || color.names.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_COLOR, "DeviceN color requires equal-length, non-empty names and tints arrays.");
  }
  color.tints.forEach((tint, index) => assertRange(tint, `deviceN.tints[${index}]`));
  normalizeColor(color.alternate);
  return color;
}

function normalizeStrokeStyle(style: StrokeStyle | undefined): NonNullable<NormalizedPathStyle["stroke"]> {
  const normalized: NonNullable<NormalizedPathStyle["stroke"]> = {
    color: normalizeColor(style?.color ?? DEFAULT_COLOR),
    width: normalizeStrokeWidth(style?.width),
    lineCap: style?.lineCap ? LINE_CAPS[style.lineCap] : 0,
    lineJoin: style?.lineJoin ? LINE_JOINS[style.lineJoin] : 0
  };

  const miterLimit = normalizeOptionalPositiveNumber(style?.miterLimit, "miterLimit");
  const dashArray = normalizeDashArray(style?.dashArray);
  const dashPhase = normalizeOptionalNumber(style?.dashPhase, "dashPhase");
  if (miterLimit !== undefined) normalized.miterLimit = miterLimit;
  if (dashArray !== undefined) normalized.dashArray = dashArray;
  if (dashPhase !== undefined) normalized.dashPhase = dashPhase;

  return normalized;
}

function normalizeFillStyle(style: FillStyle | undefined): NonNullable<NormalizedPathStyle["fill"]> {
  return {
    color: normalizeColor(style?.color ?? DEFAULT_COLOR)
  };
}

function normalizeStrokeWidth(value: number | undefined): number {
  const width = value ?? 1;
  assertFinite(width, "stroke.width");
  if (width <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PATH, "Stroke width must be greater than zero.", { width });
  }
  return width;
}

function normalizeDashArray(value: number[] | undefined): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_DASH_PATTERN, "Dash arrays must contain at least one entry.");
  }

  const normalized = value.map((entry, index) => {
    assertFinite(entry, `dashArray[${index}]`);
    if (entry < 0) {
      throw new PdfEngineError(PdfErrorCode.INVALID_DASH_PATTERN, "Dash values must not be negative.", { dashArray: value });
    }
    return entry;
  });

  if (normalized.every((entry) => entry === 0)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_DASH_PATTERN, "Dash arrays cannot be all zeros.", { dashArray: value });
  }

  return normalized;
}

function normalizeOptionalNumber(value: number | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  assertFinite(value, label);
  return value;
}

function normalizeOptionalPositiveNumber(value: number | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  assertFinite(value, label);
  if (value <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_NUMBER, `${label} must be greater than zero.`, { value });
  }
  return value;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_NUMBER, `${label} must be a finite number.`, { value });
  }
}

function assertRange(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value > 1) {
    throw new PdfEngineError(PdfErrorCode.INVALID_COLOR, `${label} must be between 0 and 1.`, { value });
  }
}

function isRtlCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0590 && codePoint <= 0x08ff)
    || (codePoint >= 0xfb1d && codePoint <= 0xfdff)
    || (codePoint >= 0xfe70 && codePoint <= 0xfeff)
    || (codePoint >= 0x10800 && codePoint <= 0x10fff)
  );
}

function isLtrCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0041 && codePoint <= 0x005a)
    || (codePoint >= 0x0061 && codePoint <= 0x007a)
    || (codePoint >= 0x00c0 && codePoint <= 0x02af)
    || (codePoint >= 0x0370 && codePoint <= 0x058f)
    || (codePoint >= 0x0900 && codePoint <= 0x1fff)
    || (codePoint >= 0x2000 && codePoint <= 0x2bff)
    || (codePoint >= 0x1e00 && codePoint <= 0x1eff)
    || (codePoint >= 0xff21 && codePoint <= 0xff5a)
    || (codePoint >= 0x0030 && codePoint <= 0x0039)
  );
}

function validateUri(value: string): void {
  if (value.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_LINK, "Link annotation URL must not be empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PdfEngineError(PdfErrorCode.INVALID_LINK, "Link annotation URL must be a valid absolute URL.", {
      url: value
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "mailto:") {
    throw new PdfEngineError(PdfErrorCode.INVALID_LINK, "Only http, https, and mailto URLs are supported for link annotations.", {
      protocol: parsed.protocol
    });
  }
}

function validateBuiltInText(text: string): void {
  if (!supportsBuiltInEncoding(text)) {
    throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_CHARACTER, "Text contains characters not supported by the built-in fonts.", { text });
  }
}

function supportsBuiltInEncoding(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      return false;
    }

    const isAsciiPrintable = codePoint >= 0x20 && codePoint <= 0x7e;
    const isWhitespaceEscape = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;

    if (!isAsciiPrintable && !isWhitespaceEscape) {
      return false;
    }
  }

  return true;
}

function normalizeDate(value: Date | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  const year = value.getUTCFullYear().toString().padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const seconds = String(value.getUTCSeconds()).padStart(2, "0");
  return `D:${year}${month}${day}${hours}${minutes}${seconds}Z`;
}

function assertNever(value: never): never {
  throw new PdfEngineError(PdfErrorCode.INVALID_COMPLIANCE, `Unhandled path command: ${JSON.stringify(value)}`);
}
