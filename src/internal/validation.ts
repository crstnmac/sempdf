import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { AttachmentOptions, BuiltInPageSize, CheckBoxOptions, ChoiceFieldMode, ChoiceFieldOptions, CustomPageSize, DocumentConformanceProfile, DocumentEncryptionAlgorithm, DocumentEncryptionOptions, DocumentInfo, DocumentPermissions, FillStyle, FontName, FreeTextAnnotationOptions, HighlightAnnotationOptions, JpegImageOptions, LineCap, LineJoin, ListItem, ListOptions, NoteAnnotationOptions, OutlineOptions, PageLabelOptions, PageLabelStyle, PageLinkOptions, PageSize, PathCommand, PathStyle, PdfColor, PdfComplianceIssue, PdfContainerTag, PdfFigureStructureTag, PdfFont, PdfRoleMap, PdfStandardStructureTag, PdfStructureAttributeValue, PdfStructureOptions, PdfStructureTag, PdfTextStructureTag, PushButtonOptions, RadioGroupOptions, SignatureFieldOptions, StrokeStyle, TableCell, TableHeaderScope, TableOptions, TextAlign, TextBlockOptions, TextDirection, TextFieldOptions, TextOptions, Transform, UriLinkOptions, XmpMetadataInput } from "../types.js";
import { PAGE_SIZES, gray } from "../types.js";
import type { NormalizedImageOptions, NormalizedPathStyle, NormalizedTextOptions } from "./ops.js";
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
}

export interface NormalizedDocumentEncryption {
  userPassword: string;
  ownerPassword: string;
  permissions: NormalizedDocumentPermissions;
  algorithm: DocumentEncryptionAlgorithm;
  version: 1 | 2;
  revision: 2 | 3;
  keyLengthBytes: 5 | 16;
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
  hasFigureWithoutAltText: boolean;
  hasTransparency: boolean;
  hasAttachments: boolean;
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
export interface NormalizedTextBaseOptions extends NormalizedTextOptions {
  fallbackFonts: PdfFont[];
  direction: TextDirection;
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
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedTextBlockOptions extends NormalizedTextBaseOptions {
  width: number;
  lineHeight: number;
  align: TextAlign;
  maxLines?: number | undefined;
}

export interface NormalizedListItem {
  body: string;
  label?: string | undefined;
  children: NormalizedListItem[];
}

export interface NormalizedListOptions extends NormalizedTextBaseOptions {
  width: number;
  lineHeight: number;
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
  header: boolean;
  scope?: TableHeaderScope | undefined;
  rowSpan: number;
  colSpan: number;
  structure?: PdfStructureOptions | undefined;
}

export type NormalizedTableRow = NormalizedTableCell[];

export interface NormalizedTableOptions extends NormalizedTextBaseOptions {
  width: number;
  columnWidths: number[];
  headerRows: number;
  headerColumns: number;
  cellPadding: number;
  rowGap: number;
  lineHeight: number;
  align: TextAlign;
  structure?: PdfStructureOptions | undefined;
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
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface NormalizedOutlineOptions {
  expanded: boolean;
}

export function resolvePageSize(size: PageSize | undefined): ResolvedPageSize {
  const pageSize = size ?? "A4";
  if (typeof pageSize === "string") {
    return PAGE_SIZES[pageSize as BuiltInPageSize];
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
    producer: info?.producer ?? "pdf-editing-lib"
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

  const userPassword = encryption.userPassword;
  const ownerPassword = encryption.ownerPassword;
  if (userPassword === undefined && ownerPassword === undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_ENCRYPTION,
      "Document encryption requires a user password, an owner password, or both."
    );
  }

  return {
    userPassword: userPassword ?? "",
    ownerPassword: ownerPassword ?? userPassword ?? "",
    permissions: normalizeDocumentPermissions(encryption.permissions),
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
      : {})
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

  if (input.conformance === "pdfa-1b") {
    if (input.hasEncryption) {
      issues.push({
        code: "PDFA_ENCRYPTION_UNSUPPORTED",
        severity: "error",
        message: "PDF/A-1b output cannot be encrypted."
      });
    }

    if (input.usesBuiltInFonts) {
      issues.push({
        code: "PDFA_EMBEDDED_FONTS_REQUIRED",
        severity: "error",
        message: "PDF/A-1b output requires embedded fonts for visible text."
      });
    }

    if (input.hasAttachments) {
      issues.push({
        code: "PDFA_ATTACHMENTS_UNSUPPORTED",
        severity: "error",
        message: "PDF/A-1b output cannot include embedded file attachments."
      });
    }

    if (input.hasTransparency) {
      issues.push({
        code: "PDFA_TRANSPARENCY_UNSUPPORTED",
        severity: "error",
        message: "PDF/A-1b output cannot include transparent image content."
      });
    }
  }

  if (input.conformance === "pdfua-1") {
    if (!input.tagged) {
      issues.push({
        code: "PDFUA_TAGGED_REQUIRED",
        severity: "error",
        message: "PDF/UA-1 output must be tagged."
      });
    }
    if (input.language === undefined) {
      issues.push({
        code: "PDFUA_LANGUAGE_REQUIRED",
        severity: "error",
        message: "PDF/UA-1 output must declare a document language."
      });
    }
    if (input.hasFigureWithoutAltText) {
      issues.push({
        code: "PDFUA_FIGURE_ALT_TEXT_REQUIRED",
        severity: "error",
        message: "PDF/UA-1 figure content must include alt text."
      });
    }
    if (input.usesBuiltInFonts) {
      issues.push({
        code: "PDFUA_EMBEDDED_FONTS_REQUIRED",
        severity: "error",
        message: "PDF/UA-1 output requires embedded fonts for visible text."
      });
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
    ...(normalized.leading !== undefined ? { leading: normalized.leading } : {})
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

  const normalized: NormalizedTextBaseOptions = {
    x: options.x,
    y: options.y,
    font: options.font ?? DEFAULT_FONT,
    fallbackFonts: options.fallbackFonts ? [...options.fallbackFonts] : [],
    direction: options.direction ?? "ltr",
    fontSize,
    color: normalizeColor(options.color ?? DEFAULT_COLOR),
    kerning: options.kerning ?? true,
    ...(options.tag !== undefined ? { tag: normalizeTextStructureTag(options.tag) } : {}),
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
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

  return {
    ...normalizedText,
    width: options.width,
    lineHeight,
    align: options.align ?? (resolveTextDirection(text, normalizedText.direction) === "rtl" ? "right" : "left"),
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

  const itemSpacing = normalizeOptionalNumber(options.itemSpacing, "itemSpacing") ?? normalizedText.fontSize * 0.35;
  if (itemSpacing < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List itemSpacing must be zero or greater.", { options });
  }

  const indent = normalizeOptionalNumber(options.indent, "indent") ?? normalizedText.fontSize * 2;
  if (indent <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List indent must be greater than zero.", { options });
  }

  const labelGap = normalizeOptionalNumber(options.labelGap, "labelGap") ?? normalizedText.fontSize * 0.5;
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

  const cellPadding = normalizeOptionalNumber(options.cellPadding, "cellPadding") ?? normalizedText.fontSize * 0.35;
  if (cellPadding < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table cellPadding must be zero or greater.", { options });
  }

  const rowGap = normalizeOptionalNumber(options.rowGap, "rowGap") ?? 0;
  if (rowGap < 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table rowGap must be zero or greater.", { options });
  }

  const headerRows = normalizeOptionalNonNegativeInteger(options.headerRows, "headerRows") ?? 0;
  const headerColumns = normalizeOptionalNonNegativeInteger(options.headerColumns, "headerColumns") ?? 0;

  return {
    ...normalizedText,
    width: options.width,
    columnWidths,
    headerRows,
    headerColumns,
    cellPadding,
    rowGap,
    lineHeight,
    align: options.align ?? "left",
    ...(options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
}

function normalizeTableCell(cell: TableCell, rowIndex: number, cellIndex: number): NormalizedTableCell {
  const definition = typeof cell === "string" ? { text: cell } : cell;
  validateText(definition.text);
  if (definition.text.trim().length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "Table cell text must not be empty.", {
      rowIndex,
      cellIndex
    });
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
    text: definition.text,
    header: definition.header ?? false,
    ...(definition.scope !== undefined ? { scope: definition.scope } : {}),
    rowSpan,
    colSpan,
    ...(definition.structure !== undefined ? { structure: normalizeStructureOptions(definition.structure) } : {})
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

  const body = item.body ?? "";
  const normalizedLabel = item.label?.trim();
  const children = item.children ? item.children.map((child, childIndex) => normalizeListItem(child, childIndex)) : [];
  if (body.length === 0 && children.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_TEXT, "List items must include body text or nested children.", {
      itemIndex: index
    });
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
    ...(normalizedLabel !== undefined ? { label: normalizedLabel } : {}),
    children
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
    readOnly: options.readOnly ?? false,
    required: options.required ?? false,
    multiline: options.multiline ?? false,
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

export function normalizeImageOptions(options: JpegImageOptions): NormalizedImageOptions {
  assertFinite(options.x, "x");
  assertFinite(options.y, "y");
  assertFinite(options.width, "width");
  assertFinite(options.height, "height");

  if (options.width <= 0 || options.height <= 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_IMAGE, "Image placement width and height must be greater than zero.", {
      options
    });
  }

  return {
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    ...("altText" in options && typeof options.altText === "string" && options.altText.trim().length > 0
      ? { altText: options.altText.trim() }
      : {}),
    ...("tag" in options && options.tag !== undefined ? { tag: normalizeFigureStructureTag(options.tag) } : {}),
    ...("structure" in options && options.structure !== undefined ? { structure: normalizeStructureOptions(options.structure) } : {})
  };
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
    annotating: permissions?.annotating ?? true
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

export function normalizeColor(color: PdfColor): PdfColor {
  if (color.kind === "gray") {
    assertRange(color.value, "gray.value");
    return color;
  }

  assertRange(color.r, "rgb.r");
  assertRange(color.g, "rgb.g");
  assertRange(color.b, "rgb.b");
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
  throw new Error(`Unhandled path command: ${JSON.stringify(value)}`);
}
