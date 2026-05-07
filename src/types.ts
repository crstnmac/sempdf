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

export interface PdfEmbeddedFont {
  readonly kind: "embedded-font";
  readonly id: string;
  readonly postScriptName: string;
}

export type PdfFont = FontName | PdfEmbeddedFont;

export type BuiltInPageSize = "A4" | "Letter" | "Legal";

export interface CustomPageSize {
  width: number;
  height: number;
}

export type PageSize = BuiltInPageSize | CustomPageSize;

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

export type XmpMetadataInput = string | XmpMetadataOptions;

export interface DocumentPermissions {
  printing?: boolean | undefined;
  modifying?: boolean | undefined;
  copying?: boolean | undefined;
  annotating?: boolean | undefined;
}

export type DocumentEncryptionAlgorithm = "rc4-40" | "rc4-128";
export type DocumentConformanceProfile = "pdfa-1b" | "pdfua-1";
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
export type PdfFigureStructureTag = "Figure" | "Formula" | "Form";
export type PdfStandardStructureTag = PdfTextStructureTag | PdfContainerTag | PdfFigureStructureTag;
export type PdfStructureTag = PdfStandardStructureTag | "Artifact" | (string & {});
export type PdfRoleMap = Record<string, PdfStandardStructureTag>;
export type PdfStructureAttributeValue =
  | string
  | number
  | boolean
  | { readonly name: string }
  | readonly PdfStructureAttributeValue[];
export type PdfBoundingBox = readonly [number, number, number, number];

export interface PdfStructureOptions {
  altText?: string | undefined;
  actualText?: string | undefined;
  language?: string | undefined;
  boundingBox?: PdfBoundingBox | undefined;
  attributes?: Record<string, PdfStructureAttributeValue> | undefined;
}

export interface PdfComplianceIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface DocumentEncryptionOptions {
  userPassword?: string | undefined;
  ownerPassword?: string | undefined;
  permissions?: DocumentPermissions | undefined;
  algorithm?: DocumentEncryptionAlgorithm | undefined;
}

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
}

export interface EmbedTrueTypeFontOptions {
  family?: string | undefined;
}

export interface OutlineOptions {
  expanded?: boolean | undefined;
}

export type PageLabelStyle = "decimal" | "romanUpper" | "romanLower" | "lettersUpper" | "lettersLower";

export interface PageLabelOptions {
  style?: PageLabelStyle | undefined;
  prefix?: string | undefined;
  startAt?: number | undefined;
}

export interface PageOptions {
  size?: PageSize;
}

export type BinaryData = Uint8Array | ArrayBuffer;

export interface GrayColor {
  kind: "gray";
  value: number;
}

export interface RgbColor {
  kind: "rgb";
  r: number;
  g: number;
  b: number;
}

export type PdfColor = GrayColor | RgbColor;

export type TextDirection = "ltr" | "rtl" | "auto";

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

export type TextAlign = "left" | "center" | "right" | "justify";

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

export interface FlowOptions {
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  margin?: number | undefined;
  marginBottom?: number | undefined;
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

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

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

export interface FlowBlockSpacingOptions {
  spaceBefore?: number | undefined;
  spaceAfter?: number | undefined;
}

export interface FlowTextOptions extends Omit<TextBlockOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {}

export interface FlowHeadingOptions extends FlowTextOptions {
  level?: HeadingLevel | undefined;
}

export interface FlowImageOptions extends Omit<JpegImageOptions, "x" | "y" | "width" | "height">, FlowBlockSpacingOptions {
  width?: number | undefined;
  height?: number | undefined;
  maxWidth?: number | undefined;
}

export interface FlowLinkOptions extends Omit<UriLinkOptions, "x" | "y" | "width" | "height" | "tag">, FlowBlockSpacingOptions {
  font?: PdfFont | undefined;
  fallbackFonts?: PdfFont[] | undefined;
  direction?: TextDirection | undefined;
  fontSize?: number | undefined;
  color?: PdfColor | undefined;
  lineHeight?: number | undefined;
  kerning?: boolean | undefined;
  tag?: "Link" | undefined;
}

export interface FlowTableOptions extends Omit<TableOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  width?: number | undefined;
}

export interface TemplatePageOptions extends FlowOptions {
  size?: PageSize | undefined;
  headerHeight?: number | undefined;
  footerHeight?: number | undefined;
}

export interface TemplateRenderContext {
  readonly pageNumber: number;
  readonly totalPages: number;
  readonly title?: string | undefined;
  readonly author?: string | undefined;
}

export type TemplateRunningRegion = "header" | "footer";
export type TemplatePageNumberAlign = "left" | "center" | "right";

export interface TemplatePageNumberOptions {
  region?: TemplateRunningRegion | undefined;
  align?: TemplatePageNumberAlign | undefined;
  format?: ((context: TemplateRenderContext) => string) | undefined;
  options?: FlowTextOptions | undefined;
}

export interface TemplateTextBlock {
  type: "heading" | "paragraph";
  text: string;
  options?: FlowHeadingOptions | FlowTextOptions | undefined;
  keepWithNext?: boolean | undefined;
}

export interface TemplateTableBlock {
  type: "table";
  rows: readonly TableRow[];
  options?: FlowTableOptions | undefined;
  keepWithNext?: boolean | undefined;
}

export interface TemplateImageBlock {
  type: "png" | "jpeg";
  data: BinaryData;
  options?: FlowImageOptions | undefined;
  keepWithNext?: boolean | undefined;
}

export interface TemplateLinkBlock {
  type: "link";
  text: string;
  url: string;
  options?: FlowLinkOptions | undefined;
  keepWithNext?: boolean | undefined;
}

export interface TemplateSectionBlock {
  type: "section";
  role?: PdfContainerTag | undefined;
  structure?: PdfStructureOptions | undefined;
  blocks: readonly TemplateBlock[];
  keepWithNext?: boolean | undefined;
}

export interface TemplatePageBreakBlock {
  type: "pageBreak";
}

export type TemplateBlock =
  | TemplateTextBlock
  | TemplateTableBlock
  | TemplateImageBlock
  | TemplateLinkBlock
  | TemplateSectionBlock
  | TemplatePageBreakBlock;

export interface TemplateDocumentOptions {
  info?: DocumentInfo | undefined;
  xmpMetadata?: XmpMetadataInput | undefined;
  page?: TemplatePageOptions | undefined;
  blocks: readonly TemplateBlock[];
  header?: ((context: TemplateRenderContext) => readonly TemplateBlock[]) | undefined;
  footer?: ((context: TemplateRenderContext) => readonly TemplateBlock[]) | undefined;
  pageNumber?: TemplatePageNumberOptions | undefined;
}

export interface ListItemDefinition {
  body?: string | undefined;
  label?: string | undefined;
  children?: readonly ListItem[] | undefined;
}

export type ListItem = string | ListItemDefinition;

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

export type TableHeaderScope = "row" | "column" | "both";

export interface TableCellDefinition {
  text: string;
  header?: boolean | undefined;
  scope?: TableHeaderScope | undefined;
  rowSpan?: number | undefined;
  colSpan?: number | undefined;
  structure?: PdfStructureOptions | undefined;
}

export type TableCell = string | TableCellDefinition;
export type TableRow = readonly TableCell[];

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

export interface JpegImageOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  altText?: string | undefined;
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface PngImageOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  altText?: string | undefined;
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface UriLinkOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth?: number | undefined;
  tag?: "Link" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface PageLinkOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  borderWidth?: number | undefined;
  tag?: "Link" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

export interface HighlightAnnotationOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: PdfColor | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

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

export type ChoiceFieldMode = "combo" | "list";

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

export interface RadioGroupItemOptions {
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RadioGroupOptions {
  items: RadioGroupItemOptions[];
  value?: string | undefined;
  borderWidth?: number | undefined;
  readOnly?: boolean | undefined;
  required?: boolean | undefined;
  tag?: "Annot" | "Artifact" | undefined;
  structure?: PdfStructureOptions | undefined;
}

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

export interface AttachmentOptions {
  description?: string | undefined;
  mimeType?: string | undefined;
}

export type LineCap = "butt" | "round" | "projectingSquare";

export type LineJoin = "miter" | "round" | "bevel";

export interface StrokeStyle {
  color?: PdfColor | undefined;
  width?: number | undefined;
  lineCap?: LineCap | undefined;
  lineJoin?: LineJoin | undefined;
  miterLimit?: number | undefined;
  dashArray?: number[] | undefined;
  dashPhase?: number | undefined;
}

export interface FillStyle {
  color?: PdfColor | undefined;
}

export interface PathStyle {
  paint: "stroke" | "fill" | "fillStroke";
  stroke?: StrokeStyle | undefined;
  fill?: FillStyle | undefined;
  tag?: "Artifact" | undefined;
}

export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface MoveToCommand {
  type: "moveTo";
  x: number;
  y: number;
}

export interface LineToCommand {
  type: "lineTo";
  x: number;
  y: number;
}

export interface CurveToCommand {
  type: "curveTo";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
}

export interface RectCommand {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClosePathCommand {
  type: "closePath";
}

export type PathCommand =
  | MoveToCommand
  | LineToCommand
  | CurveToCommand
  | RectCommand
  | ClosePathCommand;

export const PAGE_SIZES: Record<BuiltInPageSize, CustomPageSize> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 }
};

export function rgb(r: number, g: number, b: number): RgbColor {
  return { kind: "rgb", r, g, b };
}

export function gray(value: number): GrayColor {
  return { kind: "gray", value };
}
