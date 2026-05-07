/**
 * Names of the built-in PDF base fonts supported without embedding a font file.
 */
export type FontName =
  | "Courier"
  | "Courier-Bold"
  | "Courier-Oblique"
  | "Courier-BoldOblique"
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-Oblique"
  | "Helvetica-BoldOblique"
  | "Times-Roman"
  | "Times-Bold"
  | "Times-Italic"
  | "Times-BoldItalic"
  | "Symbol"
  | "ZapfDingbats";

/**
 * Font handle returned after embedding a TrueType font in a document.
 */
export interface PdfEmbeddedFont {
  readonly kind: "embedded-font";
  readonly id: string;
  readonly postScriptName: string;
}

/**
 * Font value accepted by text APIs, either built-in or embedded.
 */
export type PdfFont = FontName | PdfEmbeddedFont;

/**
 * Names of page-size presets that can be passed anywhere a PageSize is accepted.
 */
export type BuiltInPageSize =
  | "A0"
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "A5"
  | "A6"
  | "B0"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "B5"
  | "B6"
  | "C4"
  | "C5"
  | "C6"
  | "Letter"
  | "Legal"
  | "Tabloid"
  | "Ledger"
  | "Executive"
  | "Statement"
  | "Folio"
  | "Quarto"
  | "Envelope10"
  | "EnvelopeDL"
  | "EnvelopeC5"
  | "EnvelopeC6"
  | "EnvelopeMonarch";

/**
 * Explicit PDF page dimensions in points.
 */
export interface CustomPageSize {
  width: number;
  height: number;
}

/**
 * Either a built-in page-size name or explicit custom page dimensions.
 */
export type PageSize = BuiltInPageSize | CustomPageSize;

/**
 * Document information dictionary metadata such as title, author, subject, and dates.
 */
export interface DocumentInfo {
  title?: string | undefined;
  author?: string | undefined;
  subject?: string | undefined;
  keywords?: string | string[] | undefined;
  creator?: string | undefined;
  producer?: string | undefined;
  creationDate?: Date | string | undefined;
  modificationDate?: Date | string | undefined;
}

/**
 * Structured XMP metadata fields used to build an XMP packet.
 */
export interface XmpMetadataOptions {
  title?: string | undefined;
  creator?: string | undefined;
  creators?: readonly string[] | undefined;
  creatorTool?: string | undefined;
  producer?: string | undefined;
  createDate?: Date | string | undefined;
  modifyDate?: Date | string | undefined;
  metadataDate?: Date | string | undefined;
}

/**
 * XMP metadata input accepted by document metadata APIs.
 */
export type XmpMetadataInput = string | XmpMetadataOptions;

/**
 * Permission flags used when creating an encrypted PDF.
 */
export interface DocumentPermissions {
  printing?: boolean | undefined;
  modifying?: boolean | undefined;
  copying?: boolean | undefined;
  annotating?: boolean | undefined;
}

/**
 * Supported password-encryption algorithms for generated PDFs.
 */
export type DocumentEncryptionAlgorithm = "rc4-40" | "rc4-128" | "aes-128" | "aes-256";
/**
 * Supported document conformance profiles for PDF/A and PDF/UA output.
 */
export type DocumentConformanceProfile = "pdfa-1b" | "pdfua-1";
/**
 * Standard structure tags for text-like tagged PDF content.
 */
export type PdfTextStructureTag =
  | "P"
  | "H1"
  | "H2"
  | "H3"
  | "H4"
  | "H5"
  | "H6"
  | "Span"
  | "Quote"
  | "Note"
  | "Reference"
  | "BibEntry"
  | "Code"
  | "Lbl"
  | "LBody";
/**
 * Standard structure tags that can contain other tagged PDF elements.
 */
export type PdfContainerTag =
  | "Document"
  | "Part"
  | "Art"
  | "Sect"
  | "Div"
  | "BlockQuote"
  | "Caption"
  | "TOC"
  | "TOCI"
  | "Index"
  | "NonStruct"
  | "Private"
  | "L"
  | "LI"
  | "Lbl"
  | "LBody"
  | "Table"
  | "THead"
  | "TBody"
  | "TFoot"
  | "TR"
  | "TH"
  | "TD"
  | "Link"
  | "Annot";
/**
 * Standard structure tags for figure-like content.
 */
export type PdfFigureStructureTag = "Figure" | "Formula" | "Form";
/**
 * Union of standard PDF structure tags supported by the library.
 */
export type PdfStandardStructureTag = PdfTextStructureTag | PdfContainerTag | PdfFigureStructureTag;
/**
 * Any supported standard, custom, or artifact structure tag.
 */
export type PdfStructureTag = PdfStandardStructureTag | "Artifact" | (string & {});
/**
 * Mapping from custom structure roles to standard PDF structure roles.
 */
export type PdfRoleMap = Record<string, PdfStandardStructureTag>;
/**
 * Values accepted in tagged PDF structure attribute dictionaries.
 */
export type PdfStructureAttributeValue =
  | string
  | number
  | boolean
  | { readonly name: string }
  | readonly PdfStructureAttributeValue[];
/**
 * Bounding box tuple in PDF coordinates: left, bottom, right, top.
 */
export type PdfBoundingBox = readonly [number, number, number, number];

/**
 * Accessibility metadata and attributes for tagged PDF structure elements.
 */
export interface PdfStructureOptions {
  altText?: string | undefined;
  actualText?: string | undefined;
  language?: string | undefined;
  boundingBox?: PdfBoundingBox | undefined;
  attributes?: Record<string, PdfStructureAttributeValue> | undefined;
}

/**
 * Compliance validation issue returned by document validation.
 */
export interface PdfComplianceIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

/**
 * Password and permission options for encrypting a generated document.
 */
export interface DocumentEncryptionOptions {
  userPassword?: string | undefined;
  ownerPassword?: string | undefined;
  permissions?: DocumentPermissions | undefined;
  algorithm?: DocumentEncryptionAlgorithm | undefined;
}

/**
 * ICC output profile options for generated documents.
 */
export interface DocumentOutputIntentOptions {
  profile: BinaryData;
  outputConditionIdentifier?: string | undefined;
  info?: string | undefined;
  registryName?: string | undefined;
  alternate?: "DeviceRGB" | "DeviceCMYK" | "DeviceGray" | undefined;
  channels?: 1 | 3 | 4 | undefined;
}

/**
 * Detached digital-signature options for generated documents.
 */
export interface DocumentSignatureOptions {
  fieldName?: string | undefined;
  reason?: string | undefined;
  location?: string | undefined;
  contactInfo?: string | undefined;
  name?: string | undefined;
  placeholderBytes?: number | undefined;
  sign: (bytes: Uint8Array) => Uint8Array;
}

/**
 * Top-level options for creating a new PDF document.
 */
export interface DocumentOptions {
  defaultPageSize?: PageSize;
  info?: DocumentInfo;
  xmpMetadata?: XmpMetadataInput | undefined;
  encryption?: DocumentEncryptionOptions | undefined;
  language?: string | undefined;
  tagged?: boolean | undefined;
  roleMap?: PdfRoleMap | undefined;
  structureRoot?: PdfContainerTag | false | undefined;
  conformance?: DocumentConformanceProfile | undefined;
  compress?: boolean | undefined;
  objectStreams?: boolean | undefined;
  outputIntent?: DocumentOutputIntentOptions | undefined;
  signature?: DocumentSignatureOptions | undefined;
}

/**
 * Options used when registering a TrueType font with a document.
 */
export interface EmbedTrueTypeFontOptions {
  family?: string | undefined;
}

/**
 * Options that control outline item state, such as expansion.
 */
export interface OutlineOptions {
  expanded?: boolean | undefined;
}

/**
 * Supported page-label numbering styles.
 */
export type PageLabelStyle = "decimal" | "romanUpper" | "romanLower" | "lettersUpper" | "lettersLower";

/**
 * Options for assigning logical page labels and numbering styles.
 */
export interface PageLabelOptions {
  style?: PageLabelStyle | undefined;
  prefix?: string | undefined;
  startAt?: number | undefined;
}

/**
 * Options for creating or inserting a page.
 */
export interface PageOptions {
  size?: PageSize;
}

/**
 * Binary input accepted by the library, such as Uint8Array, ArrayBuffer, Buffer, or Blob-like data.
 */
export type BinaryData = Uint8Array | ArrayBuffer;

/**
 * Grayscale color representation used by drawing and text APIs.
 */
export interface GrayColor {
  kind: "gray";
  value: number;
}

/**
 * RGB color representation used by drawing and text APIs.
 */
export interface RgbColor {
  kind: "rgb";
  r: number;
  g: number;
  b: number;
}

/**
 * CMYK color representation used by drawing and text APIs.
 */
export interface CmykColor {
  kind: "cmyk";
  c: number;
  m: number;
  y: number;
  k: number;
}

/**
 * Union of supported color representations.
 */
export type PdfColor = GrayColor | RgbColor | CmykColor;

/**
 * Text direction options, including automatic RTL detection.
 */
export type TextDirection = "ltr" | "rtl" | "auto";

/**
 * Options for placing a single line of text.
 */
export interface TextOptions {
  x: number;
  y: number;
  font?: PdfFont | undefined;
  fallbackFonts?: PdfFont[] | undefined;
  direction?: TextDirection | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  characterSpacing?: number | undefined;
  wordSpacing?: number | undefined;
  leading?: number | undefined;
  kerning?: boolean | undefined;
  tag?: PdfTextStructureTag | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Horizontal text alignment values.
 */
export type TextAlign = "left" | "center" | "right" | "justify";

/**
 * Options for laying out wrapped text blocks.
 */
export interface TextBlockOptions {
  x: number;
  y: number;
  width: number;
  font?: PdfFont | undefined;
  fallbackFonts?: PdfFont[] | undefined;
  direction?: TextDirection | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  characterSpacing?: number | undefined;
  wordSpacing?: number | undefined;
  lineHeight?: number | undefined;
  align?: TextAlign | undefined;
  maxLines?: number | undefined;
  kerning?: boolean | undefined;
  tag?: PdfTextStructureTag | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Initial layout, typography, and spacing options for a PdfFlow cursor.
 */
export interface FlowOptions {
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  margin?: FlowMarginShorthand | undefined;
  marginTop?: number | undefined;
  marginRight?: number | undefined;
  marginBottom?: number | undefined;
  marginLeft?: number | undefined;
  gap?: number | undefined;
  spacing?: FlowSpacingScale | undefined;
  font?: PdfFont | undefined;
  fallbackFonts?: PdfFont[] | undefined;
  direction?: TextDirection | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  lineHeight?: number | undefined;
  align?: TextAlign | undefined;
  kerning?: boolean | undefined;
}

/**
 * Heading levels supported by flow-authored tagged content.
 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Semantic spacing scale used by flow layout for paragraphs, headings, tables, images, and links.
 */
export interface FlowSpacingScale {
  paragraphBefore?: number | undefined;
  paragraphAfter?: number | undefined;
  headingBefore?: number | Partial<Record<HeadingLevel, number>> | undefined;
  headingAfter?: number | Partial<Record<HeadingLevel, number>> | undefined;
  tableBefore?: number | undefined;
  tableAfter?: number | undefined;
  imageBefore?: number | undefined;
  imageAfter?: number | undefined;
  linkBefore?: number | undefined;
  linkAfter?: number | undefined;
}

/**
 * CSS-like margin shorthand accepted by flow and template APIs.
 */
export type FlowMarginShorthand =
  | number
  | readonly [number, number]
  | readonly [number, number, number, number];

/**
 * Per-block margin options for flow-authored content.
 */
export interface FlowBlockSpacingOptions {
  margin?: FlowMarginShorthand | undefined;
  marginTop?: number | undefined;
  marginRight?: number | undefined;
  marginBottom?: number | undefined;
  marginLeft?: number | undefined;
}

/**
 * Options for placing paragraphs or text blocks through the flow layout API.
 */
export interface FlowTextOptions extends Omit<TextBlockOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  blockWidth?: number | undefined;
  blockAlign?: "left" | "center" | "right" | undefined;
}

/**
 * Flow text options plus heading-level configuration.
 */
export interface FlowHeadingOptions extends FlowTextOptions {
  level?: HeadingLevel | undefined;
}

/**
 * Options for placing images through the flow layout API.
 */
export interface FlowImageOptions extends Omit<JpegImageOptions, "x" | "y" | "width" | "height">, FlowBlockSpacingOptions {
  width?: number | undefined;
  height?: number | undefined;
  maxWidth?: number | undefined;
  align?: "left" | "center" | "right" | undefined;
}

/**
 * Options for placing URI links through the flow layout API.
 */
export interface FlowLinkOptions extends Omit<UriLinkOptions, "x" | "y" | "width" | "height" | "tag">, FlowBlockSpacingOptions {
  font?: PdfFont | undefined;
  fallbackFonts?: PdfFont[] | undefined;
  direction?: TextDirection | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  lineHeight?: number | undefined;
  kerning?: boolean | undefined;
  tag?: "Link" | undefined;
  align?: "left" | "center" | "right" | undefined;
}

/**
 * Options for placing tables through the flow layout API.
 */
export interface FlowTableOptions extends Omit<TableOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  width?: number | undefined;
}

/**
 * Page layout options used by template rendering.
 */
export interface TemplatePageOptions extends FlowOptions {
  size?: PageSize | undefined;
  headerHeight?: number | undefined;
  footerHeight?: number | undefined;
}

/**
 * Context passed to template header, footer, and page-number callbacks.
 */
export interface TemplateRenderContext {
  readonly pageNumber: number;
  readonly totalPages: number;
  readonly title?: string | undefined;
  readonly author?: string | undefined;
}

/**
 * Callback type for template headers and footers.
 */
export type TemplateRunningRegion = "header" | "footer";
/**
 * Alignment values supported by template page-number output.
 */
export type TemplatePageNumberAlign = "left" | "center" | "right";

/**
 * Options for automatic page-number rendering in templates.
 */
export interface TemplatePageNumberOptions {
  region?: TemplateRunningRegion | undefined;
  align?: TemplatePageNumberAlign | undefined;
  format?: ((context: TemplateRenderContext) => string) | undefined;
  options?: FlowTextOptions | undefined;
}

/**
 * Template block for rendering a heading or paragraph.
 */
export interface TemplateTextBlock {
  type: "heading" | "paragraph";
  text: string;
  options?: FlowHeadingOptions | FlowTextOptions | undefined;
  keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a table.
 */
export interface TemplateTableBlock {
  type: "table";
  rows: readonly TableRow[];
  options?: FlowTableOptions | undefined;
  keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a PNG or JPEG image.
 */
export interface TemplateImageBlock {
  type: "png" | "jpeg";
  data: BinaryData;
  options?: FlowImageOptions | undefined;
  keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a URI link.
 */
export interface TemplateLinkBlock {
  type: "link";
  text: string;
  url: string;
  options?: FlowLinkOptions | undefined;
  keepWithNext?: boolean | undefined;
}

/**
 * Template block that groups child blocks under a structure container.
 */
export interface TemplateSectionBlock {
  type: "section";
  role?: PdfContainerTag | undefined;
  structure?: PdfStructureOptions | undefined;
  blocks: readonly TemplateBlock[];
  keepWithNext?: boolean | undefined;
}

/**
 * Template block that forces a new page.
 */
export interface TemplatePageBreakBlock {
  type: "pageBreak";
}

/**
 * Union of block types accepted by template rendering.
 */
export type TemplateBlock =
  | TemplateTextBlock
  | TemplateTableBlock
  | TemplateImageBlock
  | TemplateLinkBlock
  | TemplateSectionBlock
  | TemplatePageBreakBlock;

/**
 * Top-level options for rendering a reusable document template.
 */
export interface TemplateDocumentOptions {
  info?: DocumentInfo | undefined;
  xmpMetadata?: XmpMetadataInput | undefined;
  page?: TemplatePageOptions | undefined;
  blocks: readonly TemplateBlock[];
  header?: ((context: TemplateRenderContext) => readonly TemplateBlock[]) | undefined;
  footer?: ((context: TemplateRenderContext) => readonly TemplateBlock[]) | undefined;
  pageNumber?: TemplatePageNumberOptions | undefined;
}

/**
 * Detailed list item object with optional nested children.
 */
export interface ListItemDefinition {
  body?: string | undefined;
  label?: string | undefined;
  children?: readonly ListItem[] | undefined;
}

/**
 * Input shape for list items accepted by page list rendering.
 */
export type ListItem = string | ListItemDefinition;

/**
 * Options for rendering tagged ordered or unordered lists.
 */
export interface ListOptions {
  x: number;
  y: number;
  width: number;
  font?: PdfFont | undefined;
  fallbackFonts?: PdfFont[] | undefined;
  direction?: TextDirection | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  characterSpacing?: number | undefined;
  wordSpacing?: number | undefined;
  lineHeight?: number | undefined;
  align?: TextAlign | undefined;
  kerning?: boolean | undefined;
  ordered?: boolean | undefined;
  startAt?: number | undefined;
  bullet?: string | undefined;
  itemSpacing?: number | undefined;
  indent?: number | undefined;
  labelGap?: number | undefined;
}

/**
 * Header scope values for tagged table header cells.
 */
export type TableHeaderScope = "row" | "column" | "both";

/**
 * Detailed table cell object with span, header, scope, and structure options.
 */
export interface TableCellDefinition {
  text: string;
  header?: boolean | undefined;
  scope?: TableHeaderScope | undefined;
  rowSpan?: number | undefined;
  colSpan?: number | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Input shape accepted for individual table cells.
 */
export type TableCell = string | TableCellDefinition;
/**
 * Input shape accepted for table rows.
 */
export type TableRow = readonly TableCell[];

/**
 * Options for rendering tagged tables.
 */
export interface TableOptions {
  x: number;
  y: number;
  width: number;
  columnWidths?: readonly number[] | undefined;
  headerRows?: number | undefined;
  headerColumns?: number | undefined;
  cellPadding?: number | undefined;
  rowGap?: number | undefined;
  font?: PdfFont | undefined;
  fallbackFonts?: PdfFont[] | undefined;
  direction?: TextDirection | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  characterSpacing?: number | undefined;
  wordSpacing?: number | undefined;
  lineHeight?: number | undefined;
  align?: TextAlign | undefined;
  kerning?: boolean | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for placing JPEG images on a page.
 */
export interface JpegImageOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  altText?: string | undefined;
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for placing PNG images on a page.
 */
export interface PngImageOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  altText?: string | undefined;
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating an external URI link annotation.
 */
export interface UriLinkOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth?: number | undefined;
  tag?: "Link" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating an internal link annotation to another page.
 */
export interface PageLinkOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth?: number | undefined;
  tag?: "Link" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a highlight annotation.
 */
export interface HighlightAnnotationOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: PdfColor | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a text note annotation.
 */
export interface NoteAnnotationOptions {
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  contents: string;
  open?: boolean | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a free-text annotation.
 */
export interface FreeTextAnnotationOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  font?: FontName | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  borderWidth?: number | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a text form field.
 */
export interface TextFieldOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  value?: string | undefined;
  font?: FontName | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  borderWidth?: number | undefined;
  readOnly?: boolean | undefined;
  required?: boolean | undefined;
  multiline?: boolean | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a checkbox form field widget.
 */
export interface CheckBoxOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth?: number | undefined;
  checked?: boolean | undefined;
  readOnly?: boolean | undefined;
  required?: boolean | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Choice field display mode for list boxes and combo boxes.
 */
export type ChoiceFieldMode = "combo" | "list";

/**
 * Options for creating a list box or combo box form field.
 */
export interface ChoiceFieldOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  options: string[];
  value?: string | undefined;
  font?: FontName | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  borderWidth?: number | undefined;
  readOnly?: boolean | undefined;
  required?: boolean | undefined;
  mode?: ChoiceFieldMode | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for a single radio button in a radio group.
 */
export interface RadioGroupItemOptions {
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Options for creating a radio-button group form field.
 */
export interface RadioGroupOptions {
  items: RadioGroupItemOptions[];
  value?: string | undefined;
  borderWidth?: number | undefined;
  readOnly?: boolean | undefined;
  required?: boolean | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a push-button form field.
 */
export interface PushButtonOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  font?: FontName | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  borderWidth?: number | undefined;
  readOnly?: boolean | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a signature form field.
 */
export interface SignatureFieldOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth?: number | undefined;
  readOnly?: boolean | undefined;
  required?: boolean | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options that describe an embedded file attachment.
 */
export interface AttachmentOptions {
  description?: string | undefined;
  mimeType?: string | undefined;
}

/**
 * Line-cap styles for stroked vector paths.
 */
export type LineCap = "butt" | "round" | "projectingSquare";

/**
 * Line-join styles for stroked vector paths.
 */
export type LineJoin = "miter" | "round" | "bevel";

/**
 * Stroke styling for vector paths.
 */
export interface StrokeStyle {
  color?: PdfColor | undefined;
  width?: number | undefined;
  lineCap?: LineCap | undefined;
  lineJoin?: LineJoin | undefined;
  miterLimit?: number | undefined;
  dashArray?: number[] | undefined;
  dashPhase?: number | undefined;
}

/**
 * Fill styling for vector paths.
 */
export interface FillStyle {
  color?: PdfColor | undefined;
}

/**
 * Painting, stroke, fill, transform, and tagging options for vector paths.
 */
export interface PathStyle {
  paint: "stroke" | "fill" | "fillStroke";
  stroke?: StrokeStyle | undefined;
  fill?: FillStyle | undefined;
  tag?: "Artifact" | undefined;
}

/**
 * Affine transform tuple used for graphics and text placement.
 */
export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Vector path command for moving the current point without drawing.
 */
export interface MoveToCommand {
  type: "moveTo";
  x: number;
  y: number;
}

/**
 * Vector path command for drawing a straight line.
 */
export interface LineToCommand {
  type: "lineTo";
  x: number;
  y: number;
}

/**
 * Vector path command for drawing a cubic Bezier curve.
 */
export interface CurveToCommand {
  type: "curveTo";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
}

/**
 * Vector path command for adding a rectangle.
 */
export interface RectCommand {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Vector path command that closes the current subpath.
 */
export interface ClosePathCommand {
  type: "closePath";
}

/**
 * Union of vector path commands accepted by page path drawing.
 */
export type PathCommand =
  | MoveToCommand
  | LineToCommand
  | CurveToCommand
  | RectCommand
  | ClosePathCommand;

/**
 * Built-in page size presets expressed in PDF points, keyed by the supported page-size names.
 */
export const PAGE_SIZES: Record<BuiltInPageSize, CustomPageSize> = {
  A0: { width: 2383.94, height: 3370.39 },
  A1: { width: 1683.78, height: 2383.94 },
  A2: { width: 1190.55, height: 1683.78 },
  A3: { width: 841.89, height: 1190.55 },
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  A6: { width: 297.64, height: 419.53 },
  B0: { width: 2834.65, height: 4008.19 },
  B1: { width: 2004.09, height: 2834.65 },
  B2: { width: 1417.32, height: 2004.09 },
  B3: { width: 1000.63, height: 1417.32 },
  B4: { width: 708.66, height: 1000.63 },
  B5: { width: 498.9, height: 708.66 },
  B6: { width: 354.33, height: 498.9 },
  C4: { width: 649.13, height: 918.43 },
  C5: { width: 459.21, height: 649.13 },
  C6: { width: 323.15, height: 459.21 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
  Tabloid: { width: 792, height: 1224 },
  Ledger: { width: 1224, height: 792 },
  Executive: { width: 522, height: 756 },
  Statement: { width: 396, height: 612 },
  Folio: { width: 612, height: 936 },
  Quarto: { width: 610, height: 780 },
  Envelope10: { width: 297, height: 684 },
  EnvelopeDL: { width: 311.81, height: 623.62 },
  EnvelopeC5: { width: 459.21, height: 649.13 },
  EnvelopeC6: { width: 323.15, height: 459.21 },
  EnvelopeMonarch: { width: 279, height: 540 }
};

/**
 * Creates an RGB color object using normalized channel values from 0 to 1.
 */
export function rgb(r: number, g: number, b: number): RgbColor {
  return { kind: "rgb", r, g, b };
}

/**
 * Creates a grayscale color object using a normalized value from 0 for black to 1 for white.
 */
export function gray(value: number): GrayColor {
  return { kind: "gray", value };
}

/**
 * Creates a CMYK color object using normalized channel values from 0 to 1.
 */
export function cmyk(c: number, m: number, y: number, k: number): CmykColor {
  return { kind: "cmyk", c, m, y, k };
}

/**
 * Creates an RGB color object from a CSS-style #RGB or #RRGGBB hex string.
 */
export function hex(value: string): RgbColor {
  const trimmed = value.trim().replace(/^#/, "");
  const expanded =
    trimmed.length === 3
      ? trimmed.split("").map((character) => character + character).join("")
      : trimmed;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Invalid hex color: "${value}". Expected #RGB or #RRGGBB.`);
  }
  const intValue = Number.parseInt(expanded, 16);
  return {
    kind: "rgb",
    r: ((intValue >> 16) & 0xff) / 255,
    g: ((intValue >> 8) & 0xff) / 255,
    b: (intValue & 0xff) / 255
  };
}
