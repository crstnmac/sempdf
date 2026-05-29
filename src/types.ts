/**
 * Names of the built-in PDF base fonts supported without embedding a font file.
 */
import { PdfEngineError, PdfErrorCode } from "./errors.js";
import type { TextShaper } from "./internal/text-shaper.js";

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
  /** Discriminator identifying this value shape. */
  readonly kind: "embedded-font";
  /** PDF indirect object number. */
  readonly id: string;
  /** Post script name. */
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
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
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
  /** Document title or display title. */
  title?: string | undefined;
  /** Document author name. */
  author?: string | undefined;
  /** Document subject or summary. */
  subject?: string | undefined;
  /** Document keywords for search and metadata. */
  keywords?: string | string[] | undefined;
  /** Application or person that created the document. */
  creator?: string | undefined;
  /** PDF producer value recorded in metadata. */
  producer?: string | undefined;
  /** Document creation date. */
  creationDate?: Date | string | undefined;
  /** Document modification date. */
  modificationDate?: Date | string | undefined;
}

/**
 * Structured XMP metadata fields used to build an XMP packet.
 */
export interface XmpMetadataOptions {
  /** Document title or display title. */
  title?: string | undefined;
  /** Application or person that created the document. */
  creator?: string | undefined;
  /** Ordered list of document creator names for XMP metadata. */
  creators?: readonly string[] | undefined;
  /** Tool name recorded in XMP metadata. */
  creatorTool?: string | undefined;
  /** PDF producer value recorded in metadata. */
  producer?: string | undefined;
  /** XMP creation date. */
  createDate?: Date | string | undefined;
  /** XMP modification date. */
  modifyDate?: Date | string | undefined;
  /** XMP metadata packet timestamp. */
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
  /** Whether printing is permitted for encrypted output. */
  printing?: boolean | undefined;
  /** Whether document modification is permitted for encrypted output. */
  modifying?: boolean | undefined;
  /** Whether text and graphics copying is permitted for encrypted output. */
  copying?: boolean | undefined;
  /** Whether annotation and form editing is permitted for encrypted output. */
  annotating?: boolean | undefined;
  /** Whether text/graphics extraction for accessibility is permitted (bit 3). */
  accessibility?: boolean | undefined;
  /** Whether document assembly (insert/rotate/delete pages) is permitted (bit 9). */
  assemble?: boolean | undefined;
  /** Whether high-quality printing is permitted (bit 10). */
  highQualityPrint?: boolean | undefined;
  /** Whether filling in form fields is permitted (bit 12). */
  fillForms?: boolean | undefined;
}

/**
 * Supported password-encryption algorithms for generated PDFs.
 */
export type DocumentEncryptionAlgorithm =
  | "rc4-40"
  | "rc4-128"
  | "aes-128"
  | "aes-256"
  | "aes-256-r6";
/**
 * Supported document conformance profiles for PDF/A and PDF/UA output.
 */
export type DocumentConformanceProfile =
  | "pdfa-1b"
  | "pdfa-2b"
  | "pdfa-3b"
  | "pdfa-4"
  | "pdfua-1"
  | "pdfua-2"
  | "wtpdf";
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
export type PdfStandardStructureTag =
  | PdfTextStructureTag
  | PdfContainerTag
  | PdfFigureStructureTag;
/**
 * Any supported standard, custom, or artifact structure tag.
 */
export type PdfStructureTag =
  | PdfStandardStructureTag
  | "Artifact"
  | (string & {});
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
  | {
      /** Name of the item, field, destination, or signer. */
      readonly name: string;
    }
  | readonly PdfStructureAttributeValue[];
/**
 * Bounding box tuple in PDF coordinates: left, bottom, right, top.
 */
export type PdfBoundingBox = readonly [number, number, number, number];

/**
 * Accessibility metadata and attributes for tagged PDF structure elements.
 */
export interface PdfStructureOptions {
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Replacement text exposed to assistive technology. */
  actualText?: string | undefined;
  /** BCP 47 language tag for document or structure content. */
  language?: string | undefined;
  /** Bounding box associated with the structure element. */
  boundingBox?: PdfBoundingBox | undefined;
  /** Structure attributes to emit for the tagged element. */
  attributes?: Record<string, PdfStructureAttributeValue> | undefined;
  /**
   * MathML markup for a Formula structure element.
   * Emitted as an associated file (Subtype application/mathml+xml,
   * AFRelationship=Supplement) and referenced from the StructElem /AF array.
   * Required by PDF/UA Mathematics for accessible mathematical content.
   */
  mathML?: string | undefined;
  /**
   * Artifact type classification for tagged PDF content.
   * "Pagination" for headers/footers, "Layout" for typographic ornaments,
   * "Page" for watermarks. Emitted as /Type in the /Artifact BMC/EMC pair.
   */
  artifactType?: "Pagination" | "Layout" | "Page" | undefined;
  /**
   * Associated files embedded in the structure element.
   * Each file is emitted as an EmbeddedFile stream and Filespec, and
   * referenced from the StructElem /AF array.
   */
  associatedFiles?:
    | Array<{ name: string; data: BinaryData; mimeType?: string }>
    | undefined;
  /**
   * Pronunciation guide for the structure element (/Phoneme).
   * Used by screen readers (PDF/UA accessibility attribute).
   */
  phoneme?: string | undefined;
  /**
   * Abbreviation or acronym expansion for the structure element (/E).
   * Used by screen readers (PDF/UA accessibility attribute).
   */
  expansion?: string | undefined;
}

/**
 * Compliance validation issue returned by document validation.
 */
export interface PdfComplianceIssue {
  /** Stable machine-readable issue or error code. */
  code: string;
  /** Severity of the compliance issue. */
  severity: "error" | "warning";
  /** Human-readable diagnostic message. */
  message: string;
}

/**
 * Password and permission options for encrypting a generated document.
 */
export interface DocumentEncryptionOptions {
  /** Password required to open the document. */
  userPassword?: string | undefined;
  /** Password used to grant owner-level permissions. */
  ownerPassword?: string | undefined;
  /** Permission flags applied to encrypted output. */
  permissions?: DocumentPermissions | undefined;
  /** Encryption algorithm to use when writing encrypted output. */
  algorithm?: DocumentEncryptionAlgorithm | undefined;
  /** Whether to encrypt the metadata stream. Defaults to true. When false, the metadata stream is left unencrypted. */
  encryptMetadata?: boolean | undefined;
}

/**
 * ICC output profile options for generated documents.
 */
export interface DocumentOutputIntentOptions {
  /** ICC profile bytes for the output intent. */
  profile: BinaryData;
  /** Output condition identifier recorded in the output intent. */
  outputConditionIdentifier?: string | undefined;
  /** Document information dictionary values. */
  info?: string | undefined;
  /** Output intent registry name. */
  registryName?: string | undefined;
  /** Fallback device color space for the ICC profile. */
  alternate?: "DeviceRGB" | "DeviceCMYK" | "DeviceGray" | undefined;
  /** Number of color channels in the ICC profile. */
  channels?: 1 | 3 | 4 | undefined;
}

/**
 * Detached digital-signature options for generated documents.
 */
export interface DocumentSignatureOptions {
  /** Signature form field name. */
  fieldName?: string | undefined;
  /** Reason string recorded in the signature dictionary. */
  reason?: string | undefined;
  /** Signing location recorded in the signature dictionary. */
  location?: string | undefined;
  /** Signer contact information recorded in the signature dictionary. */
  contactInfo?: string | undefined;
  /** Name of the item, field, destination, or signer. */
  name?: string | undefined;
  /** Reserved byte length for the serialized signature contents. */
  placeholderBytes?: number | undefined;
  /** Callback that returns CMS/PKCS#7 signature bytes for the prepared PDF byte range. */
  sign: (bytes: Uint8Array) => Uint8Array;
}

/**
 * Top-level options for creating a new PDF document.
 */
export interface DocumentOptions {
  /** Document title applied to the information dictionary, structured XMP metadata, and display-title viewer preference. */
  title?: string | undefined;
  /** Page size used when a page does not specify its own size. */
  defaultPageSize?: PageSize;
  /** Document information dictionary values. */
  info?: DocumentInfo;
  /** XMP metadata packet or structured XMP metadata input. */
  xmpMetadata?: XmpMetadataInput | undefined;
  /** Password encryption settings for serialized output. */
  encryption?: DocumentEncryptionOptions | undefined;
  /** BCP 47 language tag for document or structure content. */
  language?: string | undefined;
  /** Whether to emit tagged PDF structure metadata. */
  tagged?: boolean | undefined;
  /** Mapping from custom structure roles to standard PDF roles. */
  roleMap?: PdfRoleMap | undefined;
  /** Root structure tag to emit, or false to suppress a custom root. */
  structureRoot?: PdfContainerTag | false | undefined;
  /** PDF/A or PDF/UA conformance profile to validate and emit. */
  conformance?: DocumentConformanceProfile | undefined;
  /** Whether eligible streams are compressed with FlateDecode. */
  compress?: boolean | undefined;
  /** Whether to emit compressed object streams and xref streams. */
  objectStreams?: boolean | undefined;
  /**
   * Whether to emit a linearization dictionary for Fast Web View style delivery.
   *
   * @experimental — limited to single-page unencrypted documents. Not compatible
   * with object streams, encryption, or detached signatures.
   */
  linearize?: boolean | undefined;
  /** ICC output intent required by color-managed profiles such as PDF/A. */
  outputIntent?: DocumentOutputIntentOptions | undefined;
  /** Detached digital-signature options for serialized output. */
  signature?: DocumentSignatureOptions | undefined;
  /**
   * Custom text shaper for complex script shaping (Devanagari, Arabic, Thai, etc.).
   * When provided, the shaper is called for each text run that requires shaping.
   * If not provided, the default shaper handles basic ligature and joining-form
   * substitution but will throw an UNSUPPORTED_SCRIPT error for Devanagari and
   * other complex scripts. External shapers such as harfbuzzjs or fontkit can
   * be plugged in to enable full shaping support.
   */
  textShaper?: TextShaper | undefined;
}

/**
 * Options used when registering a TrueType font with a document.
 */
export interface EmbedTrueTypeFontOptions {
  /** Family. */
  family?: string | undefined;
  /** Index of the font to extract from a TrueType Collection (.ttc). Defaults to 0. */
  ttcIndex?: number | undefined;
}

/**
 * Options that control outline item state, such as expansion.
 */
export interface OutlineOptions {
  /** Whether outline items are expanded by default. */
  expanded?: boolean | undefined;
}

/**
 * Supported page-label numbering styles.
 */
export type PageLabelStyle =
  | "decimal"
  | "romanUpper"
  | "romanLower"
  | "lettersUpper"
  | "lettersLower";

/**
 * Options for assigning logical page labels and numbering styles.
 */
export interface PageLabelOptions {
  /** Page-label numbering style. */
  style?: PageLabelStyle | undefined;
  /** Text prefix prepended to page labels. */
  prefix?: string | undefined;
  /** Starting number for ordered output. */
  startAt?: number | undefined;
}

/**
 * Options for creating or inserting a page.
 */
export interface PageOptions {
  /** Page size for the generated page. */
  size?: PageSize;
  /**
   * Transparency group dict applied to the page (ISO 32000-2 § 11.6.6).
   * Required by some workflows when the page contains transparency or blend
   * modes that must compose against an explicit blending color space.
   */
  transparencyGroup?: PageTransparencyGroupOptions | undefined;
  /**
   * Tab order for annotations and form fields on the page.
   * Uses PDF spec values: "R" (row order), "C" (column order), "S" (structure order).
   * Defaults to structure order ("S") for tagged documents, row order otherwise.
   */
  tabOrder?: "R" | "C" | "S" | undefined;
}

/**
 * Page-level transparency group options.
 */
export interface PageTransparencyGroupOptions {
  /** Blending color space. Defaults to DeviceRGB. */
  colorSpace?: "DeviceGray" | "DeviceRGB" | "DeviceCMYK" | undefined;
  /** Whether the group is isolated (/I). Defaults to true for page groups. */
  isolated?: boolean | undefined;
  /** Whether the group is a knockout group (/K). Defaults to false. */
  knockout?: boolean | undefined;
}

/**
 * Binary input accepted by the library.
 *
 * Accepted types:
 * - `Uint8Array`
 * - `ArrayBuffer`
 *
 * Node.js `Buffer` (which extends `Uint8Array`) works directly. Browser `Blob`
 * values must be converted first:
 *
 * @example
 * ```ts
 * // Node.js Buffer — works directly
 * import { readFileSync } from "node:fs";
 * const fontBytes: BinaryData = readFileSync("font.ttf"); // Buffer extends Uint8Array
 *
 * // Browser Blob — convert first
 * const blob = await fetch("image.png").then(r => r.blob());
 * const imageBytes: BinaryData = await blob.arrayBuffer();
 * ```
 */
export type BinaryData = Uint8Array | ArrayBuffer;

/**
 * Grayscale color representation used by drawing and text APIs.
 */
export interface GrayColor {
  /** Discriminator identifying this value shape. */
  kind: "gray";
  /** Current or default value for the option. */
  value: number;
}

/**
 * RGB color representation used by drawing and text APIs.
 */
export interface RgbColor {
  /** Discriminator identifying this value shape. */
  kind: "rgb";
  /** Red channel value normalized from 0 to 1. */
  r: number;
  /** Green channel value normalized from 0 to 1. */
  g: number;
  /** Blue channel value normalized from 0 to 1. */
  b: number;
}

/**
 * CMYK color representation used by drawing and text APIs.
 */
export interface CmykColor {
  /** Discriminator identifying this value shape. */
  kind: "cmyk";
  /** Cyan channel value normalized from 0 to 1. */
  c: number;
  /** Magenta channel value normalized from 0 to 1. */
  m: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Key/black channel value normalized from 0 to 1. */
  k: number;
}

/**
 * Union of supported color representations.
 */
/**
 * Process color used as the alternate color space for a Separation or
 * DeviceN tint transform.
 */
export type ProcessColor = GrayColor | RgbColor | CmykColor;

/**
 * Separation (single-ink spot color) color representation.
 * Emitted as a Separation color space with a Type-2 exponential tint
 * transform mapping the tint scalar to the alternate process color.
 */
export interface SeparationColor {
  /** Discriminator identifying this value shape. */
  kind: "separation";
  /** Spot ink name, e.g. "PANTONE 185 C". Encoded into the PDF name token. */
  name: string;
  /** Tint applied to the spot ink (0..1). */
  tint: number;
  /** Process-color value at full tint, used for the alternate color space. */
  alternate: ProcessColor;
}

/**
 * DeviceN (multi-ink spot color) color representation.
 * Emitted as a DeviceN color space; each tint maps through a Type-2
 * exponential into the alternate process color at full mix.
 */
export interface DeviceNColor {
  /** Discriminator identifying this value shape. */
  kind: "deviceN";
  /** One ink name per channel. */
  names: readonly string[];
  /** Tint per channel (0..1), one entry per name. */
  tints: readonly number[];
  /** Process-color value when all channels are at full tint. */
  alternate: ProcessColor;
}

export type PdfColor = GrayColor | RgbColor | CmykColor | SeparationColor | DeviceNColor;

/**
 * PDF blend mode names defined in ISO 32000-2 § 11.3.5.
 */
export type PdfBlendMode =
  | "Normal"
  | "Multiply"
  | "Screen"
  | "Overlay"
  | "Darken"
  | "Lighten"
  | "ColorDodge"
  | "ColorBurn"
  | "HardLight"
  | "SoftLight"
  | "Difference"
  | "Exclusion"
  | "Hue"
  | "Saturation"
  | "Color"
  | "Luminosity";

/**
 * Graphics-state parameters for fill/stroke alpha and blend mode.
 * Emitted as an inline ExtGState entry referenced by the `gs` operator.
 */
export interface ExtGStateOptions {
  /** Stroking alpha constant (0..1). Maps to /CA. */
  strokeAlpha?: number | undefined;
  /** Non-stroking (fill) alpha constant (0..1). Maps to /ca. */
  fillAlpha?: number | undefined;
  /** Blend mode applied to subsequent painting operations. Maps to /BM. */
  blendMode?: PdfBlendMode | undefined;
  /**
   * Soft mask reference. When provided, /SMask in the ExtGState references a
   * Form XObject built via {@link PdfDocument.createLuminositySoftMask}.
   * Pass `null` to set /SMask /None (clearing any active mask).
   */
  softMask?: SoftMaskHandle | null | undefined;
}

/**
 * Options for creating a luminosity-based soft mask Form XObject.
 */
export interface SoftMaskOptions {
  /** Width of the mask form's BBox in PDF points. */
  width: number;
  /** Height of the mask form's BBox in PDF points. */
  height: number;
}

/**
 * Opaque handle returned by {@link PdfDocument.createLuminositySoftMask}.
 * Pass to {@link ExtGStateOptions.softMask} to apply the mask.
 */
export interface SoftMaskHandle {
  /** Internal mask key, used by the serializer to resolve the form XObject. */
  readonly key: string;
}

/**
 * Text direction options, including automatic RTL detection.
 */
export type TextDirection = "ltr" | "rtl" | "auto";

/**
 * Options for placing a single line of text.
 */
export interface TextOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Text direction used for shaping and layout. */
  direction?: TextDirection | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Additional spacing between characters in PDF points. */
  characterSpacing?: number | undefined;
  /** Additional spacing between words in PDF points. */
  wordSpacing?: number | undefined;
  /** Text leading value in PDF points. */
  leading?: number | undefined;
  /** Whether kerning should be applied where supported. */
  kerning?: boolean | undefined;
  /**
   * Text writing mode. "horizontal" (default) places characters left-to-right.
   * "vertical" stacks characters top-to-bottom.
   */
  writingMode?: "horizontal" | "vertical" | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfTextStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * Artifact type classification for tagged PDF content.
   * "Pagination" for headers/footers, "Layout" for typographic ornaments,
   * "Page" for watermarks. Emitted as /Type in the /Artifact BMC/EMC pair.
   */
  artifactType?: "Pagination" | "Layout" | "Page" | undefined;
  /**
   * Built-in font encoding. When set, the font dictionary emits an /Encoding
   * entry with the specified encoding (e.g. /WinAnsiEncoding). When undefined,
   * the default encoding is used.
   */
  encoding?: "winansi" | "macroman" | "pdfdoc" | undefined;
}

/**
 * Horizontal text alignment values.
 */
export type TextAlign = "left" | "center" | "right" | "justify";

/**
 * Options for laying out wrapped text blocks.
 */
export interface TextBlockOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Text direction used for shaping and layout. */
  direction?: TextDirection | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Additional spacing between characters in PDF points. */
  characterSpacing?: number | undefined;
  /** Additional spacing between words in PDF points. */
  wordSpacing?: number | undefined;
  /** Line height in PDF points. */
  lineHeight?: number | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: TextAlign | undefined;
  /** Maximum number of lines to render. */
  maxLines?: number | undefined;
  /** Whether kerning should be applied where supported. */
  kerning?: boolean | undefined;
  /**
   * Text writing mode. "horizontal" (default) places characters left-to-right.
   * "vertical" stacks characters top-to-bottom.
   */
  writingMode?: "horizontal" | "vertical" | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfTextStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * Built-in font encoding. When set, the font dictionary emits an /Encoding
   * entry with the specified encoding (e.g. /WinAnsiEncoding). When undefined,
   * the default encoding is used.
   */
  encoding?: "winansi" | "macroman" | "pdfdoc" | undefined;
}

/**
 * Newspaper-style column layout options for flow and template pages.
 */
export interface FlowColumnsOptions {
  /** Number of columns in the flow frame. Defaults to 1 when omitted. */
  count: number;
  /** Gap between columns in PDF points. Defaults to 18 when omitted. */
  gap?: number | undefined;
}

/**
 * Initial layout, typography, and spacing options for a PdfFlow cursor.
 */
export interface FlowOptions {
  /** Horizontal position in PDF points. */
  x?: number | undefined;
  /** Vertical position in PDF points. */
  y?: number | undefined;
  /** Width in PDF points. */
  width?: number | undefined;
  /** Newspaper-style flow columns. */
  columns?: FlowColumnsOptions | undefined;
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
  /** Default vertical gap between flow blocks in PDF points. */
  gap?: number | undefined;
  /** Semantic spacing scale used by flow layout. */
  spacing?: FlowSpacingScale | undefined;
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Text direction used for shaping and layout. */
  direction?: TextDirection | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Line height in PDF points. */
  lineHeight?: number | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: TextAlign | undefined;
  /** Whether kerning should be applied where supported. */
  kerning?: boolean | undefined;
  /**
   * Text writing mode. "horizontal" (default) places characters left-to-right.
   * "vertical" stacks characters top-to-bottom.
   */
  writingMode?: "horizontal" | "vertical" | undefined;
}

/**
 * Heading levels supported by flow-authored tagged content.
 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Semantic spacing scale used by flow layout for paragraphs, headings, tables, images, and links.
 */
export interface FlowSpacingScale {
  /** Default spacing before paragraph blocks. */
  paragraphBefore?: number | undefined;
  /** Default spacing after paragraph blocks. */
  paragraphAfter?: number | undefined;
  /** Default spacing before heading blocks. */
  headingBefore?: number | Partial<Record<HeadingLevel, number>> | undefined;
  /** Default spacing after heading blocks. */
  headingAfter?: number | Partial<Record<HeadingLevel, number>> | undefined;
  /** Default spacing before table blocks. */
  tableBefore?: number | undefined;
  /** Default spacing after table blocks. */
  tableAfter?: number | undefined;
  /** Default spacing before image blocks. */
  imageBefore?: number | undefined;
  /** Default spacing after image blocks. */
  imageAfter?: number | undefined;
  /** Default spacing before link blocks. */
  linkBefore?: number | undefined;
  /** Default spacing after link blocks. */
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

/**
 * Options for placing paragraphs or text blocks through the flow layout API.
 */
export interface FlowTextOptions
  extends Omit<TextBlockOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Optional width for the flow text block within the flow column. */
  blockWidth?: number | undefined;
  /** Alignment of the block inside the flow column. */
  blockAlign?: "left" | "center" | "right" | undefined;
}

/**
 * Flow text options plus heading-level configuration.
 */
export interface FlowHeadingOptions extends FlowTextOptions {
  /** Heading level to render and tag. */
  level?: HeadingLevel | undefined;
}

/**
 * Options for placing images through the flow layout API.
 */
export interface FlowImageOptions
  extends
    Omit<JpegImageOptions, "x" | "y" | "width" | "height">,
    Omit<PngImageOptions, "x" | "y" | "width" | "height">,
    Omit<BmpImageOptions, "x" | "y" | "width" | "height">,
    Omit<TiffImageOptions, "x" | "y" | "width" | "height">,
    Omit<Jp2ImageOptions, "x" | "y" | "width" | "height">,
    FlowBlockSpacingOptions {
  /** Width in PDF points. */
  width?: number | undefined;
  /** Height in PDF points. */
  height?: number | undefined;
  /** Maximum image width in PDF points. */
  maxWidth?: number | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: "left" | "center" | "right" | undefined;
}

/**
 * Options for placing URI links through the flow layout API.
 */
export interface FlowLinkOptions
  extends
    Omit<UriLinkOptions, "x" | "y" | "width" | "height" | "tag">,
    FlowBlockSpacingOptions {
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Text direction used for shaping and layout. */
  direction?: TextDirection | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Line height in PDF points. */
  lineHeight?: number | undefined;
  /** Whether kerning should be applied where supported. */
  kerning?: boolean | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Link" | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: "left" | "center" | "right" | undefined;
}

/**
 * Options for placing tables through the flow layout API.
 */
export interface FlowTableOptions
  extends Omit<TableOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Width in PDF points. */
  width?: number | undefined;
}

/**
 * Options for placing a text form field through the flow layout API.
 */
export interface FlowTextFieldOptions
  extends Omit<TextFieldOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Horizontal position override in PDF points. */
  x?: number | undefined;
  /** Vertical position override in PDF points. */
  y?: number | undefined;
  /** Width override in PDF points. */
  width?: number | undefined;
}

/**
 * Options for placing a checkbox form field through the flow layout API.
 */
export interface FlowCheckBoxOptions
  extends Omit<CheckBoxOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Horizontal position override in PDF points. */
  x?: number | undefined;
  /** Vertical position override in PDF points. */
  y?: number | undefined;
  /** Width override in PDF points. */
  width?: number | undefined;
}

/**
 * Options for placing a choice form field through the flow layout API.
 */
export interface FlowChoiceFieldOptions
  extends Omit<ChoiceFieldOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Horizontal position override in PDF points. */
  x?: number | undefined;
  /** Vertical position override in PDF points. */
  y?: number | undefined;
  /** Width override in PDF points. */
  width?: number | undefined;
}

/**
 * Options for placing a radio-button group through the flow layout API.
 */
export interface FlowRadioGroupOptions extends Omit<RadioGroupOptions, "items">, FlowBlockSpacingOptions {
  /** Radio-button items in the group with their own positions. */
  items: RadioGroupItemOptions[];
}

/**
 * Options for placing a push-button form field through the flow layout API.
 */
export interface FlowPushButtonOptions
  extends Omit<PushButtonOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Horizontal position override in PDF points. */
  x?: number | undefined;
  /** Vertical position override in PDF points. */
  y?: number | undefined;
  /** Width override in PDF points. */
  width?: number | undefined;
}

/**
 * Options for placing a signature form field through the flow layout API.
 */
export interface FlowSignatureFieldOptions
  extends Omit<SignatureFieldOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Horizontal position override in PDF points. */
  x?: number | undefined;
  /** Vertical position override in PDF points. */
  y?: number | undefined;
  /** Width override in PDF points. */
  width?: number | undefined;
}

/**
 * Options for placing a highlight annotation through the flow layout API.
 */
export interface FlowHighlightOptions
  extends Omit<HighlightAnnotationOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Horizontal position override in PDF points. */
  x?: number | undefined;
  /** Vertical position override in PDF points. */
  y?: number | undefined;
  /** Width override in PDF points. */
  width?: number | undefined;
}

/**
 * Options for placing a text note annotation through the flow layout API.
 */
export interface FlowNoteOptions
  extends Omit<NoteAnnotationOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Horizontal position override in PDF points. */
  x?: number | undefined;
  /** Vertical position override in PDF points. */
  y?: number | undefined;
  /** Width override in PDF points. */
  width?: number | undefined;
}

/**
 * Options for placing a free-text annotation through the flow layout API.
 */
export interface FlowFreeTextOptions
  extends Omit<FreeTextAnnotationOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Horizontal position override in PDF points. */
  x?: number | undefined;
  /** Vertical position override in PDF points. */
  y?: number | undefined;
  /** Width override in PDF points. */
  width?: number | undefined;
}

/**
 * Options for placing a tagged list through the flow layout API.
 */
export interface FlowListOptions extends Omit<ListOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Horizontal position override in PDF points. */
  x?: number | undefined;
  /** Vertical position override in PDF points. */
  y?: number | undefined;
  /** Width override in PDF points. */
  width?: number | undefined;
}

/**
 * Page layout options used by template rendering.
 */
export interface TemplatePageOptions extends FlowOptions {
  /** Page size for the generated page. */
  size?: PageSize | undefined;
  /** Reserved header height in PDF points. */
  headerHeight?: number | undefined;
  /** Reserved footer height in PDF points. */
  footerHeight?: number | undefined;
}

/**
 * Context passed to template header, footer, and page-number callbacks.
 */
export interface TemplateRenderContext {
  /** One-based page number currently being rendered. */
  readonly pageNumber: number;
  /** Total page count in the rendered template document. */
  readonly totalPages: number;
  /** Document title or display title. */
  readonly title?: string | undefined;
  /** Document author name. */
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
  /** Running region where the content is rendered. */
  region?: TemplateRunningRegion | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: TemplatePageNumberAlign | undefined;
  /** Callback that formats the rendered page-number text. */
  format?: ((context: TemplateRenderContext) => string) | undefined;
  /** Options that control this item. */
  options?: FlowTextOptions | undefined;
}

/**
 * Template block for rendering a heading.
 */
export interface TemplateHeadingBlock {
  readonly type: "heading";
  /** Text content to render or inspect. */
  readonly text: string;
  /** Options that control this item. */
  readonly options?: FlowHeadingOptions | undefined;
  /** Stylesheet class name(s) applied beneath inline `options`. */
  readonly class?: string | readonly string[] | undefined;
  /** Inline annotations anchored to substrings of the rendered heading text. */
  readonly annotations?: readonly ParagraphTextAnnotation[] | undefined;
  /** Whether this block should stay on the same page as the following block when possible. */
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Inline annotation anchored to a substring of a paragraph's rendered text.
 *
 * The flow engine searches the laid-out text for `match`. The matching
 * substring's exact rendered position becomes the annotation rectangle, so
 * the annotation covers the precise word(s) regardless of wrapping or font.
 *
 * If `match` spans multiple wrapped lines, one rectangle is emitted per line.
 * If `occurrence` is omitted, every occurrence in the paragraph is annotated.
 */
export type ParagraphTextAnnotation =
  | ParagraphHighlightAnnotation
  | ParagraphUnderlineAnnotation
  | ParagraphStrikeOutAnnotation
  | ParagraphSquigglyAnnotation
  | ParagraphNoteAnnotation
  | ParagraphLinkAnnotation;

/** Highlight a substring of a paragraph. */
export interface ParagraphHighlightAnnotation {
  readonly type: "highlight";
  /** Substring to locate in the rendered paragraph text. */
  readonly match: string;
  /** Zero-based occurrence index to annotate; defaults to every occurrence. */
  readonly occurrence?: number | undefined;
  /** Fill color of the highlight rectangle. */
  readonly color?: PdfColor | undefined;
  /** Extra padding in points added around the rect on each side. Defaults to 2 above/below, 0 left/right. */
  readonly padding?:
    | number
    | { readonly top?: number; readonly bottom?: number; readonly left?: number; readonly right?: number }
    | undefined;
  /** Structure tag override for the highlight annotation. */
  readonly tag?: "Annot" | "Artifact" | undefined;
}

/** Underline a substring of a paragraph (text-markup `/Underline`). */
export interface ParagraphUnderlineAnnotation {
  readonly type: "underline";
  /** Substring to locate in the rendered paragraph text. */
  readonly match: string;
  /** Zero-based occurrence index; defaults to every occurrence. */
  readonly occurrence?: number | undefined;
  /** Stroke color. Defaults to black. */
  readonly color?: PdfColor | undefined;
  /** Structure tag override. */
  readonly tag?: "Annot" | "Artifact" | undefined;
}

/** Strike out a substring of a paragraph (text-markup `/StrikeOut`). */
export interface ParagraphStrikeOutAnnotation {
  readonly type: "strikeOut";
  /** Substring to locate in the rendered paragraph text. */
  readonly match: string;
  /** Zero-based occurrence index; defaults to every occurrence. */
  readonly occurrence?: number | undefined;
  /** Stroke color. Defaults to red. */
  readonly color?: PdfColor | undefined;
  /** Structure tag override. */
  readonly tag?: "Annot" | "Artifact" | undefined;
}

/** Draw a squiggly underline beneath a substring (text-markup `/Squiggly`). */
export interface ParagraphSquigglyAnnotation {
  readonly type: "squiggly";
  /** Substring to locate in the rendered paragraph text. */
  readonly match: string;
  /** Zero-based occurrence index; defaults to every occurrence. */
  readonly occurrence?: number | undefined;
  /** Stroke color. Defaults to red. */
  readonly color?: PdfColor | undefined;
  /** Structure tag override. */
  readonly tag?: "Annot" | "Artifact" | undefined;
}

/** Attach a sticky-note annotation anchored to a substring. */
export interface ParagraphNoteAnnotation {
  readonly type: "note";
  /** Substring to locate in the rendered paragraph text. */
  readonly match: string;
  /** Zero-based occurrence index to annotate; defaults to every occurrence. */
  readonly occurrence?: number | undefined;
  /** Contents of the note. */
  readonly contents: string;
  /** Whether the note pops open by default. */
  readonly open?: boolean | undefined;
  /** Icon anchor relative to the matched text. Defaults to "before". */
  readonly anchor?: "before" | "after" | undefined;
  /** Note icon size in points. Defaults to fontSize + 4. */
  readonly size?: number | undefined;
  /** Structure tag override. */
  readonly tag?: "Annot" | "Artifact" | undefined;
}

/** Wrap a substring in a clickable URI link. */
export interface ParagraphLinkAnnotation {
  readonly type: "link";
  /** Substring to locate in the rendered paragraph text. */
  readonly match: string;
  /** Zero-based occurrence index to annotate; defaults to every occurrence. */
  readonly occurrence?: number | undefined;
  /** Target URI. */
  readonly url: string;
  /** Border width in points. */
  readonly borderWidth?: number | undefined;
  /** Structure tag override. */
  readonly tag?: "Link" | "Artifact" | undefined;
}

/**
 * Template block for rendering a paragraph.
 */
export interface TemplateParagraphBlock {
  readonly type: "paragraph";
  /** Text content to render or inspect. */
  readonly text: string;
  /** Options that control this item. */
  readonly options?: FlowTextOptions | undefined;
  /** Stylesheet class name(s) applied beneath inline `options`. */
  readonly class?: string | readonly string[] | undefined;
  /** Inline annotations anchored to specific substrings of the rendered text. */
  readonly annotations?: readonly ParagraphTextAnnotation[] | undefined;
  /** Whether this block should stay on the same page as the following block when possible. */
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a table.
 */
export interface TemplateTableBlock {
  /** Discriminator identifying this option or command shape. */
  type: "table";
  /** Table rows to render. */
  rows: readonly TableRow[];
  /** Options that control this item. */
  options?: FlowTableOptions | undefined;
  /** Stylesheet class name(s) applied beneath inline `options`. */
  class?: string | readonly string[] | undefined;
  /** Whether this block should stay on the same page as the following block when possible. */
  keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a PNG, JPEG, BMP, JBIG2, TIFF, or JPEG2000 image.
 */
export interface TemplateImageBlock {
  /** Discriminator identifying this option or command shape. */
  type: "png" | "jpeg" | "bmp" | "jbig2" | "tiff" | "jp2" | "webp" | "gif" | "svg";
  /** Binary data for the image, font, PDF, or attachment. */
  data: BinaryData;
  /** Options that control this item. */
  options?: FlowImageOptions | undefined;
  /** Stylesheet class name(s) applied beneath inline `options`. */
  class?: string | readonly string[] | undefined;
  /** Whether this block should stay on the same page as the following block when possible. */
  keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a URI link.
 */
export interface TemplateLinkBlock {
  /** Discriminator identifying this option or command shape. */
  type: "link";
  /** Text content to render or inspect. */
  text: string;
  /** URI target for the link. */
  url: string;
  /** Options that control this item. */
  options?: FlowLinkOptions | undefined;
  /** Stylesheet class name(s) applied beneath inline `options`. */
  class?: string | readonly string[] | undefined;
  /** Whether this block should stay on the same page as the following block when possible. */
  keepWithNext?: boolean | undefined;
}

/**
 * Template block that groups child blocks under a structure container.
 */
export interface TemplateSectionBlock {
  /** Discriminator identifying this option or command shape. */
  type: "section";
  /** Structure role used to tag this content. */
  role?: PdfContainerTag | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /** Child template blocks to render. */
  blocks: readonly TemplateBlock[];
  /** Whether this block should stay on the same page as the following block when possible. */
  keepWithNext?: boolean | undefined;
}

/**
 * Template block that forces a new page.
 */
export interface TemplatePageBreakBlock {
  /** Discriminator identifying this option or command shape. */
  type: "pageBreak";
}

/**
 * Template block for rendering a text form field.
 */
export interface TemplateTextFieldBlock {
  readonly type: "textField";
  readonly name: string;
  readonly options?: Omit<TextFieldOptions, "x" | "y"> | undefined;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a checkbox form field.
 */
export interface TemplateCheckBoxBlock {
  readonly type: "checkBox";
  readonly name: string;
  readonly options?: Omit<CheckBoxOptions, "x" | "y"> | undefined;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a choice form field.
 */
export interface TemplateChoiceFieldBlock {
  readonly type: "choiceField";
  readonly name: string;
  readonly options?: Omit<ChoiceFieldOptions, "x" | "y"> | undefined;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a radio-button group form field.
 */
export interface TemplateRadioGroupBlock {
  readonly type: "radioGroup";
  readonly name: string;
  readonly options?: Omit<RadioGroupOptions, "x" | "y"> | undefined;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a push-button form field.
 */
export interface TemplatePushButtonBlock {
  readonly type: "pushButton";
  readonly name: string;
  readonly options?: Omit<PushButtonOptions, "x" | "y"> | undefined;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a signature form field.
 */
export interface TemplateSignatureFieldBlock {
  readonly type: "signatureField";
  readonly name: string;
  readonly options?: Omit<SignatureFieldOptions, "x" | "y"> | undefined;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a highlight annotation.
 */
export interface TemplateHighlightBlock {
  readonly type: "highlight";
  readonly options: Omit<HighlightAnnotationOptions, "x" | "y">;
  readonly keepWithNext?: undefined;
}

/**
 * Template block for rendering a text note annotation.
 */
export interface TemplateNoteBlock {
  readonly type: "note";
  readonly options: Omit<NoteAnnotationOptions, "x" | "y">;
  readonly keepWithNext?: undefined;
}

/**
 * Template block for rendering a free-text annotation.
 */
export interface TemplateFreeTextBlock {
  readonly type: "freeText";
  readonly options: Omit<FreeTextAnnotationOptions, "x" | "y">;
  readonly keepWithNext?: undefined;
}

/**
 * Template block for rendering a page-to-page link annotation.
 */
export interface TemplatePageLinkBlock {
  readonly type: "pageLink";
  /** One-based page number to link to. */
  readonly target: number;
  readonly options: Omit<PageLinkOptions, "x" | "y">;
  readonly keepWithNext?: undefined;
}

/**
 * Template block for rendering vector path commands.
 */
export interface TemplatePathBlock {
  readonly type: "path";
  readonly commands: PathCommand[];
  readonly style: PathStyle;
  readonly height: number;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a rectangle.
 */
export interface TemplateRectBlock {
  readonly type: "rect";
  readonly width: number;
  readonly height: number;
  readonly style: PathStyle;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a tagged list.
 */
export interface TemplateListBlock {
  readonly type: "list";
  readonly items: ListItem[];
  readonly options?: Omit<ListOptions, "x" | "y"> | undefined;
  /** Stylesheet class name(s) applied beneath inline `options`. */
  readonly class?: string | readonly string[] | undefined;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for user-defined rendering and estimation logic.
 */
export interface TemplateCustomBlock {
  readonly type: "custom";
  /** Renders the block and returns the vertical height consumed. */
  readonly render: (flow: import("./document.js").PdfFlow) => number;
  /** Estimates the vertical height this block will consume. */
  readonly estimate: (flow: import("./document.js").PdfFlow) => number;
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Union of block types accepted by template rendering.
 */
export type TemplateBlock =
  | TemplateHeadingBlock
  | TemplateParagraphBlock
  | TemplateTableBlock
  | TemplateImageBlock
  | TemplateLinkBlock
  | TemplateSectionBlock
  | TemplatePageBreakBlock
  | TemplateTextFieldBlock
  | TemplateCheckBoxBlock
  | TemplateChoiceFieldBlock
  | TemplateRadioGroupBlock
  | TemplatePushButtonBlock
  | TemplateSignatureFieldBlock
  | TemplateHighlightBlock
  | TemplateNoteBlock
  | TemplateFreeTextBlock
  | TemplatePageLinkBlock
  | TemplatePathBlock
  | TemplateRectBlock
  | TemplateListBlock
  | TemplateCustomBlock;

/**
 * Top-level options for rendering a reusable document template.
 */
export interface TemplateAutoOutlineOptions {
  /** Deepest heading level to include (1-6). Default 3. */
  maxLevel?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  /** Whether outline items render expanded by default. */
  expanded?: boolean | undefined;
}

/**
 * Strict layout options for templates that must fail instead of overflowing.
 */
export interface TemplateStrictLayoutOptions {
  /**
   * How to handle content that cannot fit in a fresh flow region.
   * Defaults to "error" when strict layout is enabled.
   */
  oversizedContent?: "error" | "allow" | undefined;
  /** Maximum number of pages the rendered template may produce. */
  maxPages?: number | undefined;
}

/**
 * A reusable set of typographic and spacing properties applied to template
 * blocks through a {@link TemplateStylesheet}. Stylesheet values are merged
 * beneath each block's inline `options`, so inline options always win.
 *
 * Note: `align` accepts the full {@link TextAlign} union; image and link
 * blocks ignore `"justify"` and treat it as `"left"`.
 */
export interface TemplateStyle {
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Line height in PDF points. */
  lineHeight?: number | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: TextAlign | undefined;
  /** Whether kerning should be applied where supported. */
  kerning?: boolean | undefined;
  /** Text direction used for shaping and layout. */
  direction?: TextDirection | undefined;
  /** Text writing mode. */
  writingMode?: "horizontal" | "vertical" | undefined;
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

/**
 * Named styles applied to template blocks. Keys are either *type selectors*
 * matching a block's `type` (`"paragraph"`, `"table"`, `"link"`, `"list"`,
 * `"image"`, plus per-format image types like `"png"`, and per-level headings
 * `"heading"`/`"heading1"`..`"heading6"`) or arbitrary *class names* referenced
 * by a block's `class` field.
 *
 * Resolution cascade for each block (low to high priority): page defaults →
 * matching type selectors (generic before specific) → each class in `class`
 * order → the block's inline `options`. Merging is shallow.
 *
 * @example
 * ```ts
 * styles: {
 *   paragraph: { fontSize: 11, lineHeight: 16 },
 *   heading1: { fontSize: 24, color: rgb(0.1, 0.2, 0.5) },
 *   callout: { color: rgb(0.8, 0, 0), marginTop: 12 },
 * }
 * ```
 */
export interface TemplateStylesheet {
  readonly [selector: string]: TemplateStyle | undefined;
}

/**
 * Top-level options for rendering template blocks into a complete document.
 */
export interface TemplateDocumentOptions {
  /** Document title applied to the information dictionary, structured XMP metadata, and display-title viewer preference. */
  title?: string | undefined;
  /** Document information dictionary values. */
  info?: DocumentInfo | undefined;
  /** XMP metadata packet or structured XMP metadata input. */
  xmpMetadata?: XmpMetadataInput | undefined;
  /** Page. */
  page?: TemplatePageOptions | undefined;
  /** Child template blocks to render. */
  blocks: readonly TemplateBlock[];
  /**
   * Reusable named styles merged beneath each block's inline `options`.
   * See {@link TemplateStylesheet} for the selector and cascade rules.
   */
  styles?: TemplateStylesheet | undefined;
  /** Callback that returns header blocks for each page. */
  header?:
    | ((context: TemplateRenderContext) => readonly TemplateBlock[])
    | undefined;
  /** Callback that returns footer blocks for each page. */
  footer?:
    | ((context: TemplateRenderContext) => readonly TemplateBlock[])
    | undefined;
  /** One-based page number currently being rendered. */
  pageNumber?: TemplatePageNumberOptions | undefined;
  /**
   * When set, auto-generates a bookmarks/outline tree from heading blocks.
   * `true` uses defaults (maxLevel=3, collapsed); pass an object to customise.
   */
  autoOutline?: boolean | TemplateAutoOutlineOptions | undefined;
  /**
   * Enables strict layout checks for fixed templates. When true, oversized
   * content that would overflow a fresh page/column throws instead of being
   * force-placed.
   */
  strictLayout?: boolean | TemplateStrictLayoutOptions | undefined;
}

/**
 * Detailed list item object with optional nested children.
 */
export interface ListItemDefinition {
  /** Primary list item text. */
  body?: string | undefined;
  /** Explicit list marker or button label text. */
  label?: string | undefined;
  /** Nested child list items or structure elements. */
  children?: readonly ListItem[] | undefined;
  /** Inline annotations anchored to substrings of the rendered body text. */
  annotations?: readonly ParagraphTextAnnotation[] | undefined;
}

/**
 * Input shape for list items accepted by page list rendering.
 */
export type ListItem = string | ListItemDefinition;

/**
 * Options for rendering tagged ordered or unordered lists.
 */
export interface ListOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Text direction used for shaping and layout. */
  direction?: TextDirection | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Additional spacing between characters in PDF points. */
  characterSpacing?: number | undefined;
  /** Additional spacing between words in PDF points. */
  wordSpacing?: number | undefined;
  /** Line height in PDF points. */
  lineHeight?: number | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: TextAlign | undefined;
  /** Whether kerning should be applied where supported. */
  kerning?: boolean | undefined;
  /** Whether to render the list with ordered labels. */
  ordered?: boolean | undefined;
  /** Starting number for ordered output. */
  startAt?: number | undefined;
  /** Bullet text used for unordered list items. */
  bullet?: string | undefined;
  /** Vertical spacing between list items in PDF points. */
  itemSpacing?: number | undefined;
  /** List indentation in PDF points. */
  indent?: number | undefined;
  /** Gap between list labels and item bodies in PDF points. */
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
  /** Text content to render or inspect. */
  text: string;
  /** Callback that returns header blocks for each page. */
  header?: boolean | undefined;
  /** Search scope used when finding related structure elements. */
  scope?: TableHeaderScope | undefined;
  /** Number of rows spanned by the cell. */
  rowSpan?: number | undefined;
  /** Number of columns spanned by the cell. */
  colSpan?: number | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /** Inline annotations anchored to substrings of the rendered cell text. */
  annotations?: readonly ParagraphTextAnnotation[] | undefined;
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
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Explicit table column widths in PDF points. */
  columnWidths?: readonly number[] | undefined;
  /** Number of leading rows treated as table headers. */
  headerRows?: number | undefined;
  /** Number of leading columns treated as table headers. */
  headerColumns?: number | undefined;
  /** Padding inside table cells in PDF points. */
  cellPadding?: number | undefined;
  /** Gap between table rows in PDF points. */
  rowGap?: number | undefined;
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Text direction used for shaping and layout. */
  direction?: TextDirection | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Additional spacing between characters in PDF points. */
  characterSpacing?: number | undefined;
  /** Additional spacing between words in PDF points. */
  wordSpacing?: number | undefined;
  /** Line height in PDF points. */
  lineHeight?: number | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: TextAlign | undefined;
  /** Whether kerning should be applied where supported. */
  kerning?: boolean | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * Table summary for accessibility (/Summary attribute on the table
   * structure element). Provides a description of the table for screen readers.
   */
  summary?: string | undefined;
}

/**
 * Options for placing JPEG images on a page.
 */
export interface JpegImageOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * ICC profile bytes used to tag the image's color space as ICCBased
   * (ISO 32000-2 § 8.6.5.5). When provided, the image's ColorSpace becomes
   * [/ICCBased ref] referencing the embedded profile stream.
   */
  iccProfile?: BinaryData | undefined;
}

/**
 * Options for placing PNG images on a page.
 */
export interface PngImageOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * ICC profile bytes used to tag the image's color space as ICCBased.
   */
  iccProfile?: BinaryData | undefined;
}

/**
 * Options for placing BMP images on a page.
 */
export interface BmpImageOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * ICC profile bytes used to tag the image's color space as ICCBased.
   */
  iccProfile?: BinaryData | undefined;
}

/**
 * Options for placing JBIG2 images on a page.
 */
export interface Jbig2ImageOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating an external URI link annotation.
 */
export interface UriLinkOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Annotation or field border width in PDF points. */
  borderWidth?: number | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Link" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating an internal link annotation to another page.
 */
export interface PageLinkOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Annotation or field border width in PDF points. */
  borderWidth?: number | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Link" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for placing TIFF images on a page.
 */
export interface TiffImageOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * ICC profile bytes used to tag the image's color space as ICCBased.
   */
  iccProfile?: BinaryData | undefined;
}

/**
 * Options for placing JPEG 2000 (JP2) images on a page.
 * PDF spec supports JPXDecode filter for JPEG 2000 image data.
 */
export interface Jp2ImageOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * ICC profile bytes used to tag the image's color space as ICCBased.
   */
  iccProfile?: BinaryData | undefined;
}

/**
 * Options for placing WebP images on a page.
 */
export interface WebpImageOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * ICC profile bytes used to tag the image's color space as ICCBased.
   */
  iccProfile?: BinaryData | undefined;
}

/**
 * Options for placing GIF images on a page.
 */
export interface GifImageOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * ICC profile bytes used to tag the image's color space as ICCBased.
   */
  iccProfile?: BinaryData | undefined;
}

/**
 * Options for rendering SVG vector graphics on a page.
 */
export interface SvgImageOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width?: number | undefined;
  /** Height in PDF points. */
  height?: number | undefined;
  /** Alternate text for tagged non-text content. */
  altText?: string | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: PdfFigureStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a URI link annotation.
 */
export interface HighlightAnnotationOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating an underline text-markup annotation. The annotation
 * draws a solid underline beneath the rectangle defined by x/y/width/height
 * (the quad runs along the bottom edge of the rect).
 */
export interface UnderlineAnnotationOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Color used for the underline stroke. Defaults to black. */
  color?: PdfColor | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a strike-out text-markup annotation. Draws a
 * horizontal line through the vertical middle of the rectangle.
 */
export interface StrikeOutAnnotationOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Color used for the strike-out stroke. Defaults to red. */
  color?: PdfColor | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a squiggly text-markup annotation. Draws a wavy
 * underline beneath the rectangle (commonly used to flag spelling or
 * grammar concerns).
 */
export interface SquigglyAnnotationOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Color used for the squiggly stroke. Defaults to red. */
  color?: PdfColor | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a text note annotation.
 */
export interface NoteAnnotationOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width?: number | undefined;
  /** Height in PDF points. */
  height?: number | undefined;
  /** Annotation contents text. */
  contents: string;
  /** Whether the note annotation is initially open. */
  open?: boolean | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a free-text annotation.
 */
export interface FreeTextAnnotationOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Text content to render or inspect. */
  text: string;
  /** Font used to render text. */
  font?: FontName | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Annotation or field border width in PDF points. */
  borderWidth?: number | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * JavaScript actions attached to a form field.
 *
 * Key mapping (ISO 32000-2 Table 217):
 *   - keystroke  → /K (Keystroke action)
 *   - format     → /F (Format action)
 *   - validate   → /V (Validate action)
 *   - calculate  → /C (Calculate action)
 *
 * Each string is raw PDF JavaScript source code. The library
 * emits each non-null action as a PDF stream object referenced
 * from the /AA dictionary on the field annotation.
 */
export interface FieldActions {
  /** Keystroke JS → /K in the /AA dict. */
  keystroke?: string | undefined;
  /** Format JS → /F in the /AA dict. */
  format?: string | undefined;
  /** Validate JS → /V in the /AA dict. */
  validate?: string | undefined;
  /** Calculate JS → /C in the /AA dict. */
  calculate?: string | undefined;
}

/**
 * Options for creating a text form field.
 */
export interface TextFieldOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Current or default value for the option. */
  value?: string | undefined;
  /** Font used to render text. */
  font?: FontName | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Annotation or field border width in PDF points. */
  borderWidth?: number | undefined;
  /** Whether the form field is read-only. */
  readOnly?: boolean | undefined;
  /** Whether the form field is required. */
  required?: boolean | undefined;
  /** Whether the text field accepts multiple lines. */
  multiline?: boolean | undefined;
  /**
   * Rich text value (XML string in XFA rich text format).
   * When set, emitted as /RV in the field dictionary.
   */
  richValue?: string | undefined;
  /**
   * Whether the field value follows document encryption.
   * When false, the field value is not encrypted (useful for searchable fields).
   * Defaults to true (follow document encryption).
   */
  encrypt?: boolean | undefined;
  /**
   * Custom appearance stream content. When provided, this raw PDF content
   * stream is used instead of the auto-generated appearance for the /N
   * (normal) appearance state.
   * Example: `"1 0 0 rg 0 0 16 16 re f"`
   */
  appearance?: string | undefined;
  /**
   * JavaScript actions attached to this field's /AA dictionary.
   * Each action value is raw PDF JavaScript source code.
   */
  actions?: FieldActions | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a checkbox form field widget.
 */
export interface CheckBoxOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Annotation or field border width in PDF points. */
  borderWidth?: number | undefined;
  /** Initial checkbox checked state. */
  checked?: boolean | undefined;
  /** Whether the form field is read-only. */
  readOnly?: boolean | undefined;
  /** Whether the form field is required. */
  required?: boolean | undefined;
  /**
   * Whether the field value follows document encryption.
   * When false, the field value is not encrypted (useful for searchable fields).
   * Defaults to true (follow document encryption).
   */
  encrypt?: boolean | undefined;
  /**
   * Custom appearance stream for the checkbox. Can be a raw PDF content
   * stream string (used for all states), or an object with optional
   * normal (/N), down (/D), and rollover (/R) appearance strings.
   * Example string: `"1 0 0 0 0 1 2 10 14 6 re s"` (a check mark at any size)
   */
  appearance?: string | { normal?: string; down?: string; rollover?: string } | undefined;
  /**
   * JavaScript actions attached to this field's /AA dictionary.
   * Each action value is raw PDF JavaScript source code.
   */
  actions?: FieldActions | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
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
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Options that control this item. */
  options: string[];
  /** Current or default value for the option. */
  value?: string | undefined;
  /** Font used to render text. */
  font?: FontName | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Annotation or field border width in PDF points. */
  borderWidth?: number | undefined;
  /** Whether the form field is read-only. */
  readOnly?: boolean | undefined;
  /** Whether the form field is required. */
  required?: boolean | undefined;
  /** Choice field display mode. */
  mode?: ChoiceFieldMode | undefined;
  /**
   * When true, the combo box allows user to type custom values.
   * When false (default), combo box is select-only.
   * Has no effect on list boxes.
   */
  editable?: boolean | undefined;
  /**
   * Whether the field value follows document encryption.
   * When false, the field value is not encrypted (useful for searchable fields).
   * Defaults to true (follow document encryption).
   */
  encrypt?: boolean | undefined;
  /**
   * Custom appearance stream content for the choice field.
   * Example: `"1 0 0 rg 0 0 100 20 re f"`
   */
  appearance?: string | undefined;
  /**
   * JavaScript actions attached to this field's /AA dictionary.
   * Each action value is raw PDF JavaScript source code.
   */
  actions?: FieldActions | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for a single radio button in a radio group.
 */
export interface RadioGroupItemOptions {
  /** Current or default value for the option. */
  value: string;
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
}

/**
 * Options for creating a radio-button group form field.
 */
export interface RadioGroupOptions {
  /** Radio-button items in the group. */
  items: RadioGroupItemOptions[];
  /** Current or default value for the option. */
  value?: string | undefined;
  /** Annotation or field border width in PDF points. */
  borderWidth?: number | undefined;
  /** Whether the form field is read-only. */
  readOnly?: boolean | undefined;
  /** Whether the form field is required. */
  required?: boolean | undefined;
  /**
   * Whether the field value follows document encryption.
   * When false, the field value is not encrypted (useful for searchable fields).
   * Defaults to true (follow document encryption).
   */
  encrypt?: boolean | undefined;
  /**
   * Custom appearance stream for the radio group. Can be a raw PDF content
   * stream string, or an object with optional normal (/N), down (/D),
   * and rollover (/R) appearance strings.
   */
  appearance?: string | { normal?: string; down?: string; rollover?: string } | undefined;
  /**
   * JavaScript actions attached to this field's /AA dictionary.
   * Each action value is raw PDF JavaScript source code.
   */
  actions?: FieldActions | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a push-button form field.
 */
export interface PushButtonOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Explicit list marker or button label text. */
  label: string;
  /** Font used to render text. */
  font?: FontName | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Annotation or field border width in PDF points. */
  borderWidth?: number | undefined;
  /** Whether the form field is read-only. */
  readOnly?: boolean | undefined;
  /**
   * Whether the field value follows document encryption.
   * When false, the field value is not encrypted (useful for searchable fields).
   * Defaults to true (follow document encryption).
   */
  encrypt?: boolean | undefined;
  /**
   * Custom appearance stream content for the push button.
   * Example: `"1 0 0 rg 0 0 100 20 re f"`
   */
  appearance?: string | undefined;
  /**
   * JavaScript actions attached to this field's /AA dictionary.
   * Each action value is raw PDF JavaScript source code.
   */
  actions?: FieldActions | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options for creating a signature form field.
 */
export interface SignatureFieldOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Annotation or field border width in PDF points. */
  borderWidth?: number | undefined;
  /** Whether the form field is read-only. */
  readOnly?: boolean | undefined;
  /** Whether the form field is required. */
  required?: boolean | undefined;
  /**
   * Whether the field value follows document encryption.
   * When false, the field value is not encrypted (useful for searchable fields).
   * Defaults to true (follow document encryption).
   */
  encrypt?: boolean | undefined;
  /**
   * Custom appearance stream content for the signature field.
   * Example: `"1 0 0 rg 0 0 100 20 re f"`
   */
  appearance?: string | undefined;
  /**
   * JavaScript actions attached to this field's /AA dictionary.
   * Each action value is raw PDF JavaScript source code.
   */
  actions?: FieldActions | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Annot" | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/**
 * Options that describe an embedded file attachment.
 */
export interface AttachmentOptions {
  /** Human-readable attachment description. */
  description?: string | undefined;
  /** MIME type associated with the attachment. */
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
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
  /** Width in PDF points. */
  width?: number | undefined;
  /** Line cap. */
  lineCap?: LineCap | undefined;
  /** Line join. */
  lineJoin?: LineJoin | undefined;
  /** Miter limit. */
  miterLimit?: number | undefined;
  /** Dash array. */
  dashArray?: number[] | undefined;
  /** Dash phase. */
  dashPhase?: number | undefined;
}

/**
 * Fill styling for vector paths.
 */
export interface FillStyle {
  /** Color used for drawing, text, or highlighting. */
  color?: PdfColor | undefined;
}

/**
 * Painting, stroke, fill, transform, and tagging options for vector paths.
 */
export interface PathStyle {
  /** Paint. */
  paint: "stroke" | "fill" | "fillStroke";
  /** Stroke. */
  stroke?: StrokeStyle | undefined;
  /** Fill. */
  fill?: FillStyle | undefined;
  /** Structure tag used for tagged PDF output. */
  tag?: "Artifact" | undefined;
}

/**
 * Affine transform tuple used for graphics and text placement.
 */
export interface Transform {
  /** Horizontal scale component of the affine transform matrix. */
  a: number;
  /** Blue channel value normalized from 0 to 1. */
  b: number;
  /** Cyan channel value normalized from 0 to 1. */
  c: number;
  /** Vertical scale component of the affine transform matrix. */
  d: number;
  /** Horizontal translation component of the affine transform matrix. */
  e: number;
  /** Vertical translation component of the affine transform matrix. */
  f: number;
}

/**
 * Vector path command for moving the current point without drawing.
 */
export interface MoveToCommand {
  /** Discriminator identifying this option or command shape. */
  type: "moveTo";
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
}

/**
 * Vector path command for drawing a straight line.
 */
export interface LineToCommand {
  /** Discriminator identifying this option or command shape. */
  type: "lineTo";
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
}

/**
 * Vector path command for drawing a cubic Bezier curve.
 */
export interface CurveToCommand {
  /** Discriminator identifying this option or command shape. */
  type: "curveTo";
  /** First Bezier control point x-coordinate. */
  x1: number;
  /** First Bezier control point y-coordinate. */
  y1: number;
  /** Second Bezier control point x-coordinate. */
  x2: number;
  /** Second Bezier control point y-coordinate. */
  y2: number;
  /** Ending point x-coordinate. */
  x3: number;
  /** Ending point y-coordinate. */
  y3: number;
}

/**
 * Vector path command for adding a rectangle.
 */
export interface RectCommand {
  /** Discriminator identifying this option or command shape. */
  type: "rect";
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
}

/**
 * Vector path command that closes the current subpath.
 */
export interface ClosePathCommand {
  /** Discriminator identifying this option or command shape. */
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
  EnvelopeMonarch: { width: 279, height: 540 },
};

/**
 * Creates an RGB color object using normalized channel values from 0 to 1.
 *
 * @param r Red channel value from 0 to 1.
 * @param g Green channel value from 0 to 1.
 * @param b Blue channel value from 0 to 1.
 *
 * @returns The RGB color object.
 */
export function rgb(r: number, g: number, b: number): RgbColor {
  return { kind: "rgb", r, g, b };
}

/**
 * Creates a grayscale color object using a normalized value from 0 for black to 1 for white.
 *
 * @param value Gray channel value from 0 to 1.
 *
 * @returns The grayscale color object.
 */
export function gray(value: number): GrayColor {
  return { kind: "gray", value };
}

/**
 * Creates a CMYK color object using normalized channel values from 0 to 1.
 *
 * @param c Cyan channel value from 0 to 1.
 * @param m Magenta channel value from 0 to 1.
 * @param y Yellow channel value from 0 to 1.
 * @param k Key/black channel value from 0 to 1.
 *
 * @returns The CMYK color object.
 */
export function cmyk(c: number, m: number, y: number, k: number): CmykColor {
  return { kind: "cmyk", c, m, y, k };
}

/**
 * Creates a Separation (single-ink spot) color.
 *
 * @param name Spot ink name (e.g. "PANTONE 185 C").
 * @param tint Tint value from 0 to 1.
 * @param alternate Process color at full tint.
 */
export function separation(name: string, tint: number, alternate: ProcessColor): SeparationColor {
  return { kind: "separation", name, tint, alternate };
}

/**
 * Creates a DeviceN (multi-ink spot) color.
 *
 * @param names Ink names, one per channel.
 * @param tints Tint values per channel, one per name (0..1).
 * @param alternate Process color produced when all channels are at full tint.
 */
export function deviceN(names: readonly string[], tints: readonly number[], alternate: ProcessColor): DeviceNColor {
  if (names.length !== tints.length || names.length === 0) {
    throw new PdfEngineError(PdfErrorCode.INVALID_COLOR, "deviceN requires equal-length, non-empty names and tints arrays.");
  }
  return { kind: "deviceN", names: [...names], tints: [...tints], alternate };
}

/**
 * Creates an RGB color object from a CSS-style #RGB or #RRGGBB hex string.
 *
 * @param value The #RGB or #RRGGBB color string to parse.
 *
 * @returns The RGB color object.
 */
export function hex(value: string): RgbColor {
  const trimmed = value.trim().replace(/^#/, "");
  const expanded =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((character) => character + character)
          .join("")
      : trimmed;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_COLOR, `Invalid hex color: "${value}". Expected #RGB or #RRGGBB.`);
  }
  const intValue = Number.parseInt(expanded, 16);
  return {
    kind: "rgb",
    r: ((intValue >> 16) & 0xff) / 255,
    g: ((intValue >> 8) & 0xff) / 255,
    b: (intValue & 0xff) / 255,
  };
}
