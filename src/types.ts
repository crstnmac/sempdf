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
 * Font value accepted by text APIs: a built-in {@link FontName}, an embedded
 * font handle, or the name of a family registered with
 * {@link PdfDocument.registerFontFamily}.
 *
 * The `string & {}` member keeps `FontName` literals in editor autocomplete
 * while still accepting an arbitrary registered family name.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export type PdfFont = FontName | PdfEmbeddedFont | (string & {});

/**
 * The set of faces that make up a font family registered with
 * {@link PdfDocument.registerFontFamily}. Once registered, text APIs can
 * select a face by passing the family name as `font` together with the
 * `bold` and `italic` flags, instead of juggling individual font handles.
 *
 * Each face may be a built-in {@link FontName} or an embedded-font handle.
 * Only `regular` is required; missing faces fall back to the closest
 * available face (bold italic → bold → italic → regular).
 */
export interface FontFamilyFaces {
  /** Face used when neither `bold` nor `italic` is requested. */
  regular: PdfFont;
  /** Face used when `bold` is requested without `italic`. */
  bold?: PdfFont | undefined;
  /** Face used when `italic` is requested without `bold`. */
  italic?: PdfFont | undefined;
  /** Face used when both `bold` and `italic` are requested. */
  boldItalic?: PdfFont | undefined;
}

/**
 * Input accepted by {@link PdfDocument.registerFontFamily}. Each face may be a
 * built-in {@link FontName}, an already-embedded font handle, or **raw font
 * bytes** — bytes are embedded automatically under the family name, so you can
 * register a family in one call without embedding each weight first.
 */
export interface FontFamilyInput {
  /** Face used when neither `bold` nor `italic` is requested. */
  regular: PdfFont | BinaryData;
  /** Face used when `bold` is requested without `italic`. */
  bold?: PdfFont | BinaryData | undefined;
  /** Face used when `italic` is requested without `bold`. */
  italic?: PdfFont | BinaryData | undefined;
  /** Face used when both `bold` and `italic` are requested. */
  boldItalic?: PdfFont | BinaryData | undefined;
}

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
  /** Unique identifier for this structure element (/ID). Required on PDF/UA-1 Note elements. */
  id?: string | undefined;
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

/** Classification shared by content that is explicitly tagged as an Artifact. */
interface ArtifactOptions {
  /** Artifact type written to the marked-content property dictionary. */
  artifactType?: "Pagination" | "Layout" | "Page" | undefined;
  /** Optional artifact subtype, such as Header, Footer, or Watermark. */
  artifactSubtype?: "Header" | "Footer" | "Watermark" | undefined;
}

/**
 * Where a compliance issue was found, so the offending content can be located
 * in the source document.
 */
export interface PdfComplianceLocation {
  /** 1-based page number holding the offending content. */
  page: number;
  /** Whether the content came from a text operation or an annotation. */
  kind: "text" | "annotation";
  /** Built-in font name in use, when the issue is font-related. */
  font?: string | undefined;
  /** Annotation type, for annotation locations. */
  annotation?: string | undefined;
  /** Form field name, when the annotation is a named field. */
  name?: string | undefined;
  /** Leading characters of the offending text, truncated for readability. */
  snippet?: string | undefined;
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
  /**
   * Places in the document that triggered the issue, when the check can
   * attribute it to specific content. Capped at a handful of entries.
   */
  locations?: readonly PdfComplianceLocation[] | undefined;
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
/**
 * Document-wide text defaults applied to {@link PdfPage.text} and
 * {@link PdfPage.textBlock} when the corresponding option is omitted on the
 * call. Per-call options always take precedence.
 */
export interface TextDefaults {
  /** Default font (built-in name, embedded handle, or registered family name). */
  font?: PdfFont | undefined;
  /**
   * Default fonts consulted, in order, for characters the primary font cannot
   * encode. Used by every text path that omits its own `fallbackFonts` — a
   * symbol font listed here covers glyphs (dingbats, arrows, CJK) missing from
   * the body font without threading the option through every call.
   */
  fallbackFonts?: PdfFont[] | undefined;
  /**
   * Default font for code blocks and inline `<code>` runs. Falls back to
   * {@link TextDefaults.font}, then to the built-in `Courier`. Set this to an
   * embedded monospaced family when the document must avoid built-in fonts
   * (PDF/A, PDF/UA, WTPDF) but `font` is proportional.
   */
  codeFont?: PdfFont | undefined;
  /** Default bold flag. */
  bold?: boolean | undefined;
  /** Default italic flag. */
  italic?: boolean | undefined;
  /** Default font size in PDF points. */
  fontSize?: number | undefined;
  /** Default text color. */
  color?: ColorInput | undefined;
  /** Default kerning behavior. */
  kerning?: boolean | undefined;
  /** Default text direction. */
  direction?: TextDirection | undefined;
}

export interface DocumentOptions {
  /** Document title applied to the information dictionary, structured XMP metadata, and display-title viewer preference. */
  title?: string | undefined;
  /** Page size used when a page does not specify its own size. */
  defaultPageSize?: PageSize;
  /** Document-wide text defaults filled in when a text call omits them. */
  defaults?: TextDefaults | undefined;
  /**
   * Document-wide default styling for the {@link PdfPage} shape helpers
   * (`rect`, `line`, `circle`, `ellipse`). Per-call {@link ShapeStyle} fields
   * override these.
   */
  shapeDefaults?: ShapeStyle | undefined;
  /**
   * Solid background color filled behind every page's content (drawn as the
   * first thing on each page, tagged as an artifact). Applies to pages created
   * via {@link PdfDocument.addPage} and {@link PdfDocument.renderTemplate}. A
   * template's own `pageBackground` option overrides this.
   */
  pageBackground?: ColorInput | undefined;
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
  /**
   * Coordinate origin for this page's drawing APIs. "bottom-left" (default) is
   * the native PDF system where `y` grows upward. "top-left" flips `y` so it
   * grows downward from the top edge, matching screen/CSS conventions.
   *
   * Applies to the page drawing, annotation, and form-field methods (`text`,
   * `textBlock`, `richText`, `rect`, `line`, `circle`, `ellipse`, `image`,
   * `path`, `link`, `highlight`, `note`, `freeText`, `textField`, `checkBox`,
   * `choiceField`, `radioGroup`, `pushButton`, `signatureField`, …). The
   * flow/template layout APIs always use bottom-left coordinates.
   */
  origin?: "bottom-left" | "top-left" | undefined;
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
 * Glyph painting mode (the PDF `Tr` text rendering operator):
 * - `"fill"` — fill glyphs with the text color (default).
 * - `"stroke"` — outline glyphs with the stroke color/width (no fill).
 * - `"fillStroke"` — fill and outline.
 * - `"invisible"` — render nothing (e.g. text over a scanned image for search).
 */
export type TextRenderMode = "fill" | "stroke" | "fillStroke" | "invisible";

/**
 * Options for placing a single line of text.
 */
export interface TextOptions extends ArtifactOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /**
   * Selects the bold variant of `font`. For a built-in family (`Helvetica`,
   * `Times-Roman`, `Courier`) this resolves to the matching bold base font.
   * For a font family registered with {@link PdfDocument.registerFontFamily}
   * it selects the registered bold face. Ignored when `font` is an explicit
   * embedded-font handle.
   */
  bold?: boolean | undefined;
  /**
   * Selects the italic/oblique variant of `font`, following the same
   * resolution rules as {@link bold}. Combine with `bold` for bold italic.
   */
  italic?: boolean | undefined;
  /** Draws an underline beneath the text. */
  underline?: boolean | undefined;
  /** Draws a strike-through line over the text. */
  strike?: boolean | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Text direction used for shaping and layout. */
  direction?: TextDirection | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: ColorInput | undefined;
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
   * Built-in font encoding. When set, the font dictionary emits an /Encoding
   * entry with the specified encoding (e.g. /WinAnsiEncoding). When undefined,
   * the default encoding is used.
   */
  encoding?: "winansi" | "macroman" | "pdfdoc" | undefined;
  /**
   * Raises (positive) or lowers (negative) the text baseline, in PDF points
   * (the `Ts` operator). Set directly for fine control, or use the
   * {@link superscript} / {@link subscript} shortcuts.
   */
  rise?: number | undefined;
  /**
   * Renders the text as superscript — raised above the baseline and reduced in
   * size. Convenience over {@link rise} + a smaller {@link fontSize}.
   */
  superscript?: boolean | undefined;
  /** Renders the text as subscript — lowered below the baseline and reduced in size. */
  subscript?: boolean | undefined;
  /** Glyph painting mode (fill, stroke/outline, fillStroke, invisible). Defaults to fill. */
  renderMode?: TextRenderMode | undefined;
  /** Stroke color for `stroke`/`fillStroke` render modes. Defaults to the text color. */
  strokeColor?: ColorInput | undefined;
  /** Stroke width in PDF points for `stroke`/`fillStroke` render modes. Defaults to 1. */
  strokeWidth?: number | undefined;
  /** Horizontal glyph scaling as a percentage (100 = normal; the `Tz` operator). */
  horizontalScaling?: number | undefined;
  /** Background color drawn as a filled rectangle behind the text (inline highlight). */
  highlight?: ColorInput | undefined;
}

/**
 * Horizontal text alignment values.
 */
export type TextAlign = "left" | "center" | "right" | "justify";

/**
 * Vertical alignment of content within a box of known height (a table cell or a
 * text block given an explicit `height`).
 */
export type VerticalAlign = "top" | "middle" | "bottom";

/**
 * Options for laying out wrapped text blocks.
 */
export interface TextBlockOptions extends ArtifactOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Font used to render text. */
  font?: PdfFont | undefined;
  /** Selects the bold variant of `font`. See {@link TextOptions.bold}. */
  bold?: boolean | undefined;
  /** Selects the italic variant of `font`. See {@link TextOptions.italic}. */
  italic?: boolean | undefined;
  /** Draws an underline beneath the text. */
  underline?: boolean | undefined;
  /** Draws a strike-through line over the text. */
  strike?: boolean | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Text direction used for shaping and layout. */
  direction?: TextDirection | undefined;
  /** Font size in PDF points. */
  fontSize?: number | undefined;
  /** Color used for drawing, text, or highlighting. */
  color?: ColorInput | undefined;
  /** Additional spacing between characters in PDF points. */
  characterSpacing?: number | undefined;
  /** Additional spacing between words in PDF points. */
  wordSpacing?: number | undefined;
  /** Line height in PDF points. */
  lineHeight?: number | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: TextAlign | undefined;
  /**
   * Box height in PDF points. When set together with {@link verticalAlign},
   * the wrapped lines are positioned within a box of this height starting at
   * `y` and extending downward. Has no effect unless `verticalAlign` is given.
   */
  height?: number | undefined;
  /**
   * Vertical alignment of the wrapped text within `height`. Requires `height`.
   * Defaults to "top".
   */
  verticalAlign?: VerticalAlign | undefined;
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
  /** Raises (+) or lowers (−) the baseline in PDF points. See {@link TextOptions.rise}. */
  rise?: number | undefined;
  /** Renders the block as superscript. See {@link TextOptions.superscript}. */
  superscript?: boolean | undefined;
  /** Renders the block as subscript. See {@link TextOptions.subscript}. */
  subscript?: boolean | undefined;
  /** Glyph painting mode. See {@link TextOptions.renderMode}. */
  renderMode?: TextRenderMode | undefined;
  /** Stroke color for stroking render modes. See {@link TextOptions.strokeColor}. */
  strokeColor?: ColorInput | undefined;
  /** Stroke width for stroking render modes. See {@link TextOptions.strokeWidth}. */
  strokeWidth?: number | undefined;
  /** Horizontal glyph scaling percentage. See {@link TextOptions.horizontalScaling}. */
  horizontalScaling?: number | undefined;
  /** Background highlight color drawn behind the text. See {@link TextOptions.highlight}. */
  highlight?: ColorInput | undefined;
}

/**
 * A single styled segment of inline rich text. Runs passed together to
 * {@link PdfPage.richText} or {@link PdfFlow.richParagraph} flow on the same
 * line and wrap together as one paragraph; each run carries its own style.
 *
 * Any style omitted on a run inherits from the block-level options
 * ({@link RichTextOptions}). Whitespace between words is taken from the run
 * `text` verbatim — include trailing/leading spaces where you want them
 * between adjacent runs (e.g. `"Hello "` then a bold `"world"`).
 */
export interface InlineTextRun {
  /** Text content of this segment. */
  text: string;
  /** Optional inline semantic structure tag for this run within its rich-text block. */
  tag?: "Span" | "Quote" | "Reference" | "BibEntry" | "Code" | "Artifact" | undefined;
  /** Font for this run (built-in name, embedded handle, or registered family name). */
  font?: PdfFont | undefined;
  /** Selects the bold variant of this run's font. See {@link TextOptions.bold}. */
  bold?: boolean | undefined;
  /** Selects the italic variant of this run's font. See {@link TextOptions.italic}. */
  italic?: boolean | undefined;
  /** Draws an underline beneath this run. */
  underline?: boolean | undefined;
  /** Draws a strike-through line over this run. */
  strike?: boolean | undefined;
  /** Font size in PDF points for this run. */
  fontSize?: number | undefined;
  /** Color for this run. */
  color?: ColorInput | undefined;
  /** Whether kerning is applied for this run. */
  kerning?: boolean | undefined;
  /** Additional spacing between characters in PDF points. */
  characterSpacing?: number | undefined;
  /** When set, wraps this run in a clickable URI link annotation. */
  link?: string | undefined;
  /** Raises (+) or lowers (−) this run's baseline in PDF points. See {@link TextOptions.rise}. */
  rise?: number | undefined;
  /** Renders this run as superscript. See {@link TextOptions.superscript}. */
  superscript?: boolean | undefined;
  /** Renders this run as subscript. See {@link TextOptions.subscript}. */
  subscript?: boolean | undefined;
  /** Glyph painting mode for this run. See {@link TextOptions.renderMode}. */
  renderMode?: TextRenderMode | undefined;
  /** Stroke color for stroking render modes. See {@link TextOptions.strokeColor}. */
  strokeColor?: ColorInput | undefined;
  /** Stroke width for stroking render modes. See {@link TextOptions.strokeWidth}. */
  strokeWidth?: number | undefined;
  /** Horizontal glyph scaling percentage for this run. See {@link TextOptions.horizontalScaling}. */
  horizontalScaling?: number | undefined;
  /** Background highlight color drawn behind this run. See {@link TextOptions.highlight}. */
  highlight?: ColorInput | undefined;
}

/**
 * Options for laying out a paragraph of inline rich-text runs. Coordinates and
 * width behave like {@link TextBlockOptions}; the style fields supply defaults
 * inherited by any {@link InlineTextRun} that omits them.
 *
 * Horizontal writing mode supports left/center/right/justify alignment and
 * left-to-right or right-to-left ordering. Vertical writing mode stacks the
 * runs in a single column.
 */
export interface RichTextOptions extends ArtifactOptions {
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position (baseline of the first line, or top of the column in vertical mode) in PDF points. */
  y: number;
  /** Width in PDF points that runs wrap within (horizontal mode). */
  width: number;
  /** Line height in PDF points (column spacing in vertical mode). Defaults to 1.2 × the largest run font size. */
  lineHeight?: number | undefined;
  /** Horizontal alignment of each line. Defaults to "left". Ignored in vertical mode. */
  align?: "left" | "center" | "right" | "justify" | undefined;
  /**
   * Box height in PDF points. With {@link verticalAlign}, the wrapped lines are
   * positioned within a box of this height starting at `y` and extending
   * downward. Has no effect unless `verticalAlign` is given. Horizontal mode only.
   */
  height?: number | undefined;
  /**
   * Vertical alignment of the wrapped runs within `height`. Requires `height`.
   * Defaults to "top". Horizontal mode only.
   */
  verticalAlign?: VerticalAlign | undefined;
  /**
   * Reading direction for the runs. "auto" detects from the run text.
   * Right-to-left lays each line out from the right edge; this is line-level
   * direction, not full mixed-direction bidirectional reordering.
   */
  direction?: TextDirection | undefined;
  /**
   * Writing mode. "horizontal" (default) flows runs left-to-right and wraps
   * onto new lines. "vertical" stacks the runs top-to-bottom in one column.
   */
  writingMode?: "horizontal" | "vertical" | undefined;
  /** Default font for runs that omit one. */
  font?: PdfFont | undefined;
  /** Fallback fonts for characters the run's font cannot encode. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Default font size for runs that omit one. */
  fontSize?: number | undefined;
  /** Default color for runs that omit one. */
  color?: ColorInput | undefined;
  /** Default kerning behavior for runs that omit it. */
  kerning?: boolean | undefined;
  /** Structure tag used for tagged PDF output. Defaults to "P". */
  tag?: PdfTextStructureTag | "Artifact" | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
}

/** Measured size of a single line of text. */
export interface TextMetrics {
  /** Rendered width in PDF points. */
  width: number;
  /** Height in PDF points (the font size). */
  height: number;
}

/** Measured size of a wrapped block of text. */
export interface BlockTextMetrics {
  /** Width of the longest rendered line in PDF points. */
  width: number;
  /** Total height in PDF points (line count × line height). */
  height: number;
  /** Number of lines after wrapping. */
  lineCount: number;
}

/** Result of {@link PdfPage.placeText}: the drawn size plus the next y to continue at. */
export interface PlacedTextResult extends TextMetrics {
  /** The y at the far edge of the drawn text — where the next element can start (accounts for the page origin). */
  endY: number;
}

/** Result of {@link PdfPage.placeTextBlock}: the drawn block metrics plus the next y to continue at. */
export interface PlacedTextBlockResult extends BlockTextMetrics {
  /** The y below the drawn block — where the next element can start (accounts for the page origin). */
  endY: number;
}

/** Options for {@link PdfDocument.measureText} (position-independent). */
export type MeasureTextOptions = Omit<TextOptions, "x" | "y">;

/** Options for {@link PdfDocument.measureTextBlock} (position-independent). */
export type MeasureTextBlockOptions = Omit<TextBlockOptions, "x" | "y">;

/** Options for {@link PdfDocument.measureRichText} (position-independent). */
export type MeasureRichTextOptions = Omit<RichTextOptions, "x" | "y">;

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
  color?: ColorInput | undefined;
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
 * Semantic spacing scale used by flow layout for paragraphs, headings, tables, images, links, and code blocks.
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
  /** Default spacing before code blocks. */
  codeBefore?: number | undefined;
  /** Default spacing after code blocks. */
  codeAfter?: number | undefined;
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
  /**
   * Minimum number of lines to keep together at the bottom of a region before
   * this paragraph is allowed to break across a column or page. If fewer than
   * this many lines would remain at the bottom, the whole paragraph moves to the
   * next region. Only applies to multi-column flows (single-column paragraphs
   * are never split). Defaults to 1 (no constraint). Fractions are floored.
   */
  orphans?: number | undefined;
  /**
   * Minimum number of lines this paragraph must carry into a new region after a
   * break, so a lone trailing line is never left stranded. Only applies to
   * multi-column flows. Defaults to 1 (no constraint). Fractions are floored.
   */
  widows?: number | undefined;
}

/**
 * Flow text options plus heading-level configuration.
 */
export interface FlowHeadingOptions extends FlowTextOptions {
  /** Heading level to render and tag. */
  level?: HeadingLevel | undefined;
}

/**
 * A regular-expression colouring rule applied to the visual lines of a code
 * block. Rules are evaluated in order and never overwrite a span already
 * claimed by an earlier rule, so put the most specific patterns first
 * (strings and comments before keywords).
 */
export interface CodeHighlightRule {
  /**
   * Pattern to match within each rendered line. A string matches literally;
   * a `RegExp` is re-created with the `g` flag (and keeps `i`/`u`/`s`).
   * Patterns are matched per visual line, so they cannot span line breaks.
   */
  readonly pattern: RegExp | string;
  /** Color applied to matched text. Defaults to the block's `color`. */
  readonly color?: ColorInput | undefined;
  /** Font applied to matched text. Defaults to the block's `font`. */
  readonly font?: PdfFont | undefined;
}

/**
 * Position of one fragment of a code block that was split across pages or
 * columns, passed to the continuation-label callbacks.
 */
export interface CodeContinuationInfo {
  /** Zero-based fragment index; 0 is the fragment that starts the block. */
  readonly fragmentIndex: number;
  /** Source line number of this fragment's first line. */
  readonly firstLineNumber: number;
  /** Source line number of this fragment's last line. */
  readonly lastLineNumber: number;
  /** Total number of source lines in the whole block. */
  readonly totalLines: number;
}

/**
 * Options for placing a preformatted code block through the flow layout API.
 *
 * Unlike paragraphs, code blocks preserve leading whitespace and hard line
 * breaks verbatim, never re-flow words between lines, and split across pages
 * or columns line-by-line (each fragment repeats the background band).
 */
export interface FlowCodeOptions extends FlowBlockSpacingOptions {
  /** Font used to render the code. Defaults to `Courier`. */
  font?: PdfFont | undefined;
  /** Fallback fonts used when the primary font lacks a glyph. */
  fallbackFonts?: PdfFont[] | undefined;
  /** Font size in PDF points. Defaults to 9. */
  fontSize?: number | undefined;
  /** Baseline-to-baseline distance in points. Defaults to `fontSize * 1.35`. */
  lineHeight?: number | undefined;
  /** Code text color. Defaults to `#1f2328`. */
  color?: ColorInput | undefined;
  /** Whether kerning should be applied. Defaults to `false` so columns align. */
  kerning?: boolean | undefined;
  /** Background fill behind the block. Pass `"none"` to draw no background. */
  background?: ColorInput | "none" | undefined;
  /** Border color. A border is drawn only when this or `borderWidth` is set. */
  borderColor?: ColorInput | undefined;
  /** Border width in points. Defaults to 0.5 when `borderColor` is set. */
  borderWidth?: number | undefined;
  /** Inner padding between the background band and the code, in points. Defaults to 8. */
  padding?: number | undefined;
  /** Spaces a tab expands to. Defaults to 4. */
  tabSize?: number | undefined;
  /**
   * Whether lines wider than the content width soft-wrap onto continuation
   * lines (indented to match the wrapped line's own indentation). When
   * `false`, long lines are clipped to the content width. Defaults to `true`.
   */
  wrap?: boolean | undefined;
  /** Whether to render a line-number gutter. Defaults to `false`. */
  lineNumbers?: boolean | undefined;
  /** Number given to the first line when `lineNumbers` is set. Defaults to 1. */
  firstLineNumber?: number | undefined;
  /** Line-number color. Defaults to a muted grey. */
  lineNumberColor?: ColorInput | undefined;
  /** Gap between the line-number gutter and the code, in points. Defaults to 6. */
  gutterGap?: number | undefined;
  /** Regex colouring rules applied to each rendered line. */
  highlight?: readonly CodeHighlightRule[] | undefined;
  /**
   * Note drawn at the top of every fragment after the first, marking it as the
   * continuation of a block that started on an earlier page or column. Pass a
   * string, or a function for line-aware text. Rendered as an artifact, so it is
   * never read as code. Off by default.
   *
   * @example
   * continuedLabel: ({ firstLineNumber }) => `… continued from line ${firstLineNumber - 1}`
   */
  continuedLabel?: string | ((info: CodeContinuationInfo) => string) | undefined;
  /**
   * Note drawn at the bottom of every fragment that carries on into the next
   * page or column. Rendered as an artifact. Off by default.
   *
   * @example
   * continuesLabel: "continues on next page →"
   */
  continuesLabel?: string | ((info: CodeContinuationInfo) => string) | undefined;
  /** Font size for continuation notes. Defaults to `fontSize * 0.85`. */
  continuationFontSize?: number | undefined;
  /** Color for continuation notes. Defaults to `lineNumberColor`. */
  continuationColor?: ColorInput | undefined;
  /** Alignment of continuation notes within the band. Defaults to `"right"`. */
  continuationAlign?: "left" | "right" | undefined;
  /**
   * Whether a bordered block leaves its border open where it was split — no rule
   * along the bottom of a fragment that continues, none along the top of one
   * that resumes — so the reader sees one listing rather than several boxes.
   * Defaults to `true`.
   */
  openSplitEdges?: boolean | undefined;
  /**
   * Structure tagging. `"Code"` (default) emits a `P` wrapper containing a
   * `Code` element, `"P"` tags the fragment as a plain paragraph, and
   * `"Artifact"` leaves the content untagged.
   */
  tag?: "Code" | "P" | "Artifact" | undefined;
  /** Optional width for the block within the flow column. */
  blockWidth?: number | undefined;
  /** Alignment of the block inside the flow column. */
  blockAlign?: "left" | "center" | "right" | undefined;
}

/**
 * Options for placing a paragraph of inline rich-text runs through the flow
 * layout API. Position and width are supplied by the flow cursor; the
 * remaining fields mirror {@link RichTextOptions}.
 */
export interface FlowRichTextOptions
  extends Omit<RichTextOptions, "x" | "y" | "width">, FlowBlockSpacingOptions {
  /** Optional width for the flow text block within the flow column. */
  blockWidth?: number | undefined;
  /** Alignment of the block inside the flow column. */
  blockAlign?: "left" | "center" | "right" | undefined;
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
  color?: ColorInput | undefined;
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
 * Template block that converts an HTML fragment into blocks at render time.
 * Expanded before pagination, so the headings inside it still feed the TOC and
 * auto-outline and every generated block paginates normally.
 */
export interface TemplateHtmlBlock {
  readonly type: "html";
  /** HTML to convert. Tag soup is tolerated; scripts and styles are dropped. */
  readonly html: string;
  /** Conversion and styling options. */
  readonly options?: import("./internal/html-blocks.js").HtmlToBlocksOptions | undefined;
  /** Stylesheet class name(s) applied to the generated blocks' own selectors. */
  readonly class?: string | readonly string[] | undefined;
  /** Whether this block should stay on the same page as the following block when possible. */
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a preformatted code block: monospaced text with
 * indentation and hard line breaks preserved, drawn on a background band that
 * repeats on each page or column the block spans.
 */
export interface TemplateCodeBlock {
  readonly type: "code";
  /** Source text to render. Tabs are expanded; `\r\n` and `\r` are normalized. */
  readonly code: string;
  /** Optional language label, recorded on the structure element as its expansion text. */
  readonly language?: string | undefined;
  /** Options that control this block. */
  readonly options?: FlowCodeOptions | undefined;
  /** Stylesheet class name(s) applied beneath inline `options`. */
  readonly class?: string | readonly string[] | undefined;
  /** Whether this block should stay on the same page as the following block when possible. */
  readonly keepWithNext?: boolean | undefined;
}

/**
 * Template block for rendering a paragraph of inline rich-text runs, mixing
 * fonts, weights, sizes, colors, and links on the same wrapping lines.
 */
export interface TemplateRichParagraphBlock {
  readonly type: "richParagraph";
  /** The styled inline runs to lay out together. */
  readonly runs: readonly InlineTextRun[];
  /** Options that control this block. */
  readonly options?: FlowRichTextOptions | undefined;
  /** Inline annotations anchored to specific substrings of the rendered text. */
  readonly annotations?: readonly ParagraphTextAnnotation[] | undefined;
  /** Stylesheet class name(s) applied beneath inline `options`. */
  readonly class?: string | readonly string[] | undefined;
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
 * Per-heading-level style overrides for TOC entries. Keyed by level (1-6);
 * unset fields fall back to the TOC's base options.
 */
export interface TemplateTocEntryStyle {
  /** Font for entries at this level. */
  font?: PdfFont | undefined;
  /** Font size in points for entries at this level. */
  fontSize?: number | undefined;
  /** Text color for the title and page number at this level. */
  color?: ColorInput | undefined;
}

/**
 * Options for a table-of-contents block.
 */
export interface TemplateTocOptions {
  /** Deepest heading level to include (1-6). Defaults to 3. */
  maxLevel?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  /** Font used for entries. Defaults to the flow font. */
  font?: PdfFont | undefined;
  /** Entry font size in points. Defaults to 11. */
  fontSize?: number | undefined;
  /** Per-level style overrides (e.g. a larger, darker level 1). Keyed by heading level. */
  levelStyles?: { readonly [level: number]: TemplateTocEntryStyle } | undefined;
  /**
   * When true, each entry is prefixed with a hierarchical section number (e.g.
   * "1", "1.2") tagged as a `Lbl`. Defaults to false.
   */
  numbering?: boolean | undefined;
  /** Vertical space per entry in points. Defaults to `fontSize * 1.6`. */
  lineHeight?: number | undefined;
  /** Points of indentation added per heading level below level 1. Defaults to 16. */
  indent?: number | undefined;
  /** Whether each entry links to its heading's page. Defaults to true. */
  link?: boolean | undefined;
  /** Whether to show the resolved page number for each entry. Defaults to true. */
  pageNumbers?: boolean | undefined;
  /**
   * Decorative leader drawn between the entry title and its page number:
   * `"dots"` (default) a dotted leader, `"line"` a thin rule, `"none"` nothing.
   * The leader is emitted as an artifact, so it is not announced by AT.
   */
  leader?: "dots" | "line" | "none" | undefined;
  /** Color of the leader dots/rule. Defaults to a light gray. */
  leaderColor?: ColorInput | undefined;
}

/**
 * Options for a cross-reference block.
 */
export interface TemplateCrossRefOptions {
  /** Font used for the reference text. Defaults to the flow font. */
  font?: PdfFont | undefined;
  /** Font size in points. Defaults to the flow font size. */
  fontSize?: number | undefined;
  /** Whether the reference links to its target's page. Defaults to true. */
  link?: boolean | undefined;
  /**
   * Whether the resolved target page number is appended. When `text` contains
   * the placeholder `{page}`, the number is substituted there instead. Defaults
   * to true.
   */
  pageNumbers?: boolean | undefined;
}

/**
 * Template block that renders a cross-reference to a named {@link
 * TemplateBlockControls.anchor} elsewhere in the document. The target page
 * number is resolved after the whole document is laid out, so a reference may
 * point forward or backward.
 */
export interface TemplateCrossRefBlock {
  readonly type: "crossRef";
  /** Name of the target {@link TemplateBlockControls.anchor}. */
  readonly to: string;
  /**
   * Reference text. May contain the placeholder `{page}`, replaced by the
   * resolved page number. Defaults to `"see page {page}"`.
   */
  readonly text?: string | undefined;
  readonly options?: TemplateCrossRefOptions | undefined;
}

/**
 * Template block that renders a table of contents from the document's
 * top-level heading blocks. Entries are collected from the surrounding
 * template's headings (up to `maxLevel`); page numbers and links are resolved
 * after the whole document has been laid out, so a TOC may appear before the
 * content it references.
 */
export interface TemplateTocBlock {
  readonly type: "toc";
  readonly options?: TemplateTocOptions | undefined;
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
  readonly options?: FlowListOptions | undefined;
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
 * Pagination controls carried by every template block. Applied by the
 * document-level template paginator ({@link PdfDocument.renderTemplate}).
 * Merged into {@link TemplateBlock} by intersection so each block type gains
 * them without redeclaring.
 */
export interface TemplateBlockControls {
  /**
   * Force a page break (or advance to the next column) before this block,
   * unless the flow cursor is already at the top of a fresh region.
   */
  readonly breakBefore?: boolean | undefined;
  /** Force a page break (or advance to the next column) after this block. */
  readonly breakAfter?: boolean | undefined;
  /**
   * Keep this block whole — never split its content across a page or column
   * boundary. Paragraphs, which may otherwise split line-by-line across
   * columns, are placed as a unit instead.
   */
  readonly keepTogether?: boolean | undefined;
  /**
   * Registers a named destination at this block's page, referenceable by a
   * {@link TemplateCrossRefBlock}. The name must be unique within the template.
   */
  readonly anchor?: string | undefined;
  /**
   * Footnote text anchored to this block. A numbered marker is appended to the
   * block (for text blocks: `heading`/`paragraph`), and the note is rendered at
   * the bottom of the page the block lands on. Notes are numbered document-wide
   * in reading order.
   */
  readonly footnote?: string | undefined;
}

/**
 * Union of block types accepted by template rendering.
 */
export type TemplateBlock = (
  | TemplateHeadingBlock
  | TemplateParagraphBlock
  | TemplateRichParagraphBlock
  | TemplateCodeBlock
  | TemplateHtmlBlock
  | TemplateTableBlock
  | TemplateImageBlock
  | TemplateLinkBlock
  | TemplateSectionBlock
  | TemplatePageBreakBlock
  | TemplateTocBlock
  | TemplateCrossRefBlock
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
  | TemplateCustomBlock
) & TemplateBlockControls;

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
  color?: ColorInput | undefined;
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
 * `"code"`, `"image"`, plus per-format image types like `"png"`, and per-level
 * headings `"heading"`/`"heading1"`..`"heading6"`) or arbitrary *class names*
 * referenced by a block's `class` field.
 *
 * A stylesheet carries the shared typographic fields only; code-specific
 * visuals (`background`, `padding`, `lineNumbers`, `highlight`, …) belong in a
 * {@link TemplateCodeBlock}'s inline `options`.
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
 * Options for a document watermark drawn behind every page's content.
 */
export interface TemplateWatermarkOptions {
  /** Watermark text. */
  text: string;
  /** Font size in points. Defaults to an automatic size that spans the page diagonally. */
  fontSize?: number | undefined;
  /** Font. Defaults to Helvetica-Bold. */
  font?: PdfFont | undefined;
  /** Text color. Defaults to a medium gray. */
  color?: ColorInput | undefined;
  /** Fill opacity (0-1). Defaults to 0.15. */
  opacity?: number | undefined;
  /** Rotation in degrees, counter-clockwise about the page center. Defaults to 45. */
  rotation?: number | undefined;
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
   * Named font families to register before rendering. Keys are family names;
   * values are the faces that make up each family. Each face may be a built-in
   * {@link FontName}, a handle from {@link PdfDocument.embedTrueTypeFont}, or
   * raw TrueType/OpenType bytes (embedded automatically under the family name).
   * Registered families are available by name in template blocks, styles, and
   * the `defaultFont` option.
   *
   * ```ts
   * doc.renderTemplate({
   *   blocks: [...],
   *   fonts: {
   *     Inter: {
   *       regular: interRegularBytes,
   *       bold: interBoldBytes
   *     }
   *   }
   * });
   * ```
   */
  fonts?: Record<string, FontFamilyInput> | undefined;
  /**
   * Reusable named styles merged beneath each block's inline `options`.
   * See {@link TemplateStylesheet} for the selector and cascade rules.
   */
  styles?: TemplateStylesheet | undefined;
  /**
   * Fills every page with a solid background color, drawn behind all other
   * content (including the watermark and background blocks). Emitted as an
   * artifact so it stays out of the reading order.
   */
  pageBackground?: ColorInput | undefined;
  /**
   * A diagonal watermark drawn centered behind every page's content (e.g.
   * "DRAFT", "CONFIDENTIAL"). Pass a string for defaults, or an options object
   * to control size, color, opacity, and rotation. Always tagged as an artifact.
   */
  watermark?: string | TemplateWatermarkOptions | undefined;
  /**
   * Callback that returns master-page background blocks for each page (e.g. a
   * full-bleed tint, rule, or logo). Rendered as a flow from the top content
   * edge and drawn behind all other content. Tag background blocks as
   * `"Artifact"` to keep them out of the reading order. For a centered text
   * watermark prefer {@link TemplateDocumentOptions.watermark}.
   */
  background?:
    | ((context: TemplateRenderContext) => readonly TemplateBlock[])
    | undefined;
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
  /**
   * Primary list item text. A plain string renders with the list's base
   * style; an array of {@link InlineTextRun} renders a rich paragraph
   * (mixed bold/italic/font/size/color/link runs) inside the item's LBody.
   */
  body?: string | readonly InlineTextRun[] | undefined;
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
  color?: ColorInput | undefined;
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
  /** Text content to render or inspect. Either `text` or `runs` must be provided. */
  text?: string | undefined;
  /**
   * Inline rich-text runs rendered instead of `text`: mixed fonts, sizes,
   * colors, bold/italic, underline/strike, and links wrap together inside the
   * cell. Run styles omitted fall back to the cell, then table, style.
   */
  runs?: readonly InlineTextRun[] | undefined;
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
  /**
   * Vertical alignment of this cell's content within the row height, overriding
   * {@link TableOptions.verticalAlign}.
   */
  verticalAlign?: VerticalAlign | undefined;
  /** Renders the cell text in the bold face of the table font (built-in variant or registered family face). */
  bold?: boolean | undefined;
  /** Renders the cell text in the italic face of the table font (built-in variant or registered family face). */
  italic?: boolean | undefined;
  /** Font for this cell, overriding {@link TableOptions.font}. Accepts a built-in name, embedded handle, or registered family name (combined with the cell `bold`/`italic` flags). */
  font?: PdfFont | undefined;
  /** Text color for this cell, overriding {@link TableOptions.color}. */
  color?: ColorInput | undefined;
  /** Horizontal text alignment for this cell, overriding {@link TableOptions.align}. */
  align?: TextAlign | undefined;
  /** Background fill for this cell, overriding `headerBackground`/`zebra` striping. */
  background?: ColorInput | undefined;
  /**
   * Per-edge borders for this cell, drawn on top of the table-level
   * {@link TableOptions.borders}. Use it to add a border on any specific cell,
   * or rule a whole row by setting the same side on each cell in that row.
   */
  border?: TableCellBorders | undefined;
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
 * Selects which border lines a table draws.
 */
export type TableBorderStyle = "all" | "horizontal" | "outer" | "none";

/**
 * Styling for one edge of a table cell. `width` defaults to 0.75; `color`
 * defaults to a medium gray.
 */
export interface TableCellBorderSide {
  /** Line color. Defaults to a medium gray. */
  color?: ColorInput | undefined;
  /** Line width in PDF points. Defaults to 0.75. */
  width?: number | undefined;
}

/**
 * Per-edge borders for a single table cell, overriding (and drawn on top of)
 * the table-level {@link TableOptions.borders}. Each side accepts `true` (draw
 * with the default gray/0.75 line) or a {@link TableCellBorderSide} for an
 * explicit color and width. Set borders on a row's cells to rule that row.
 */
export interface TableCellBorders {
  /** Top edge. */
  top?: boolean | TableCellBorderSide | undefined;
  /** Right edge. */
  right?: boolean | TableCellBorderSide | undefined;
  /** Bottom edge. */
  bottom?: boolean | TableCellBorderSide | undefined;
  /** Left edge. */
  left?: boolean | TableCellBorderSide | undefined;
}

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
  /**
   * Table column widths in PDF points. Provide an explicit array (must sum to
   * `width`), or `"auto"` to size columns to their content — each column takes
   * its natural un-wrapped width scaled to fill `width`, shrinking toward its
   * longest-word width when content is too wide. Defaults to equal columns.
   */
  columnWidths?: readonly number[] | "auto" | undefined;
  /** Number of leading rows treated as table headers. */
  headerRows?: number | undefined;
  /**
   * Number of trailing rows treated as a table footer. When a table is split
   * across pages by the template paginator, these rows repeat at the bottom of
   * every slice (mirroring how `headerRows` repeat at the top). Defaults to 0.
   */
  footerRows?: number | undefined;
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
  color?: ColorInput | undefined;
  /** Additional spacing between characters in PDF points. */
  characterSpacing?: number | undefined;
  /** Additional spacing between words in PDF points. */
  wordSpacing?: number | undefined;
  /** Line height in PDF points. */
  lineHeight?: number | undefined;
  /** Horizontal alignment for laid-out content. */
  align?: TextAlign | undefined;
  /**
   * Vertical alignment of each cell's content within its row height. Applies to
   * cells shorter than the tallest cell in the row. Defaults to "top". Can be
   * overridden per cell via {@link TableCellDefinition.verticalAlign}.
   */
  verticalAlign?: VerticalAlign | undefined;
  /** Whether kerning should be applied where supported. */
  kerning?: boolean | undefined;
  /** Additional structure metadata for tagged PDF output. */
  structure?: PdfStructureOptions | undefined;
  /**
   * Table summary for accessibility (/Summary attribute on the table
   * structure element). Provides a description of the table for screen readers.
   */
  summary?: string | undefined;
  /**
   * Color of the border lines. Setting this (or `borderWidth`, or `borders`)
   * draws borders. Drawn as an artifact (not part of the structure tree).
   * Defaults to a medium gray when borders are enabled without a color.
   */
  borderColor?: ColorInput | undefined;
  /** Width of the border lines in PDF points. Defaults to 0.75 when borders are enabled. */
  borderWidth?: number | undefined;
  /**
   * Which border lines to draw:
   * - `"all"` — full grid around every cell (default when a border color/width is set).
   * - `"horizontal"` — horizontal rules between rows plus top and bottom edges; no vertical lines.
   * - `"outer"` — a single frame around the whole table.
   * - `"none"` — no borders, even if `borderColor`/`borderWidth` are set.
   *
   * When omitted, defaults to `"all"` if `borderColor`/`borderWidth` is set, otherwise `"none"`.
   */
  borders?: TableBorderStyle | undefined;
  /** Background fill behind header cells (header rows/columns and cells marked `header: true`). */
  headerBackground?: ColorInput | undefined;
  /**
   * Alternate-row striping for body rows: `true` fills every second body row
   * with a light gray, or pass a color. Header rows are not striped.
   */
  zebra?: boolean | ColorInput | undefined;
}

/** How an image fills its placement box. See {@link ImageFitOptions.fit}. */
export type ImageFit = "fill" | "contain" | "cover";

/** Alignment of an image within its box for `contain`/`cover`. */
export type ImagePosition =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** Shape an image is clipped to within its box. */
export type ImageClip = "none" | "circle" | "ellipse";

/**
 * Fit, positioning, and clipping controls shared by all raster image
 * placements. The image is always laid out inside its `width`×`height` box.
 */
export interface ImageFitOptions extends ArtifactOptions {
  /**
   * How the image fills its box:
   * - `"fill"` (default) — stretch to the box, ignoring aspect ratio.
   * - `"contain"` — scale to fit inside the box, preserving aspect (letterboxed).
   * - `"cover"` — scale to cover the box, preserving aspect (overflow cropped).
   */
  fit?: ImageFit | undefined;
  /** Alignment within the box when `fit` leaves slack or overflow. Defaults to `"center"`. */
  position?: ImagePosition | undefined;
  /**
   * Clip the image to a shape inscribed in its box: `"ellipse"` fills the box,
   * `"circle"` uses the smaller box dimension (centered). Defaults to `"none"`.
   */
  clip?: ImageClip | undefined;
}

/**
 * Options for placing JPEG images on a page.
 */
export interface JpegImageOptions extends ImageFitOptions {
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
export interface PngImageOptions extends ImageFitOptions {
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
export interface BmpImageOptions extends ImageFitOptions {
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
export interface Jbig2ImageOptions extends ImageFitOptions {
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
export interface TiffImageOptions extends ImageFitOptions {
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
export interface Jp2ImageOptions extends ImageFitOptions {
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
export interface WebpImageOptions extends ImageFitOptions {
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
export interface GifImageOptions extends ImageFitOptions {
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
  color?: ColorInput | undefined;
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
  color?: ColorInput | undefined;
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
  color?: ColorInput | undefined;
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
  color?: ColorInput | undefined;
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
  color?: ColorInput | undefined;
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
  /**
   * Field description, emitted as `/TU` (the field's user-facing name).
   * Assistive technology reads it as the field's accessible name, and it
   * satisfies the "form fields have a description" accessibility check.
   */
  description?: string | undefined;
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
  color?: ColorInput | undefined;
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
  /**
   * Field description, emitted as `/TU` (the field's user-facing name).
   * Assistive technology reads it as the field's accessible name, and it
   * satisfies the "form fields have a description" accessibility check.
   */
  description?: string | undefined;
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
  /**
   * Field description, emitted as `/TU` (the field's user-facing name).
   * Assistive technology reads it as the field's accessible name, and it
   * satisfies the "form fields have a description" accessibility check.
   */
  description?: string | undefined;
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
  color?: ColorInput | undefined;
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
  /**
   * Field description, emitted as `/TU` (the field's user-facing name).
   * Assistive technology reads it as the field's accessible name, and it
   * satisfies the "form fields have a description" accessibility check.
   */
  description?: string | undefined;
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
  /**
   * Field description, emitted as `/TU` (the field's user-facing name).
   * Assistive technology reads it as the field's accessible name, and it
   * satisfies the "form fields have a description" accessibility check.
   */
  description?: string | undefined;
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
  color?: ColorInput | undefined;
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
  /**
   * Field description, emitted as `/TU` (the field's user-facing name).
   * Assistive technology reads it as the field's accessible name, and it
   * satisfies the "form fields have a description" accessibility check.
   */
  description?: string | undefined;
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
  color?: ColorInput | undefined;
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
  color?: ColorInput | undefined;
}

/**
 * Painting, stroke, fill, transform, and tagging options for vector paths.
 */
export interface PathStyle extends ArtifactOptions {
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
 * Simplified styling for the {@link PdfPage} shape helpers (`rect`, `line`,
 * `circle`, `ellipse`). The paint mode is inferred: a `fill` and `stroke`
 * together paint both; `fill` alone fills; otherwise the shape is stroked.
 */
export interface ShapeStyle extends ArtifactOptions {
  /** Fill color. Presence enables fill painting. */
  fill?: ColorInput | undefined;
  /** Stroke color. Defaults to black when only `lineWidth` is set. */
  stroke?: ColorInput | undefined;
  /** Stroke width in PDF points. */
  lineWidth?: number | undefined;
  /** Line cap for stroked shapes. */
  lineCap?: LineCap | undefined;
  /** Line join for stroked shapes. */
  lineJoin?: LineJoin | undefined;
  /** Dash pattern for stroked shapes. */
  dashArray?: number[] | undefined;
  /** Structure tag; use "Artifact" to mark decorative shapes. */
  tag?: "Artifact" | undefined;
}

/**
 * Options for the auto-detecting {@link PdfPage.image} method. The raster
 * format (PNG, JPEG, GIF, BMP, TIFF, WebP, JPEG 2000) is sniffed from the data.
 */
export type ImageOptions = JpegImageOptions;

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

/** Named colors accepted anywhere a {@link ColorInput} is expected. */
export type NamedColor =
  | "black" | "white" | "gray" | "grey" | "silver"
  | "red" | "green" | "blue"
  | "yellow" | "cyan" | "magenta"
  | "orange" | "purple" | "pink" | "brown"
  | "navy" | "teal" | "lime" | "maroon" | "olive";

const NAMED_COLORS: Record<NamedColor, readonly [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  yellow: [255, 255, 0], cyan: [0, 255, 255], magenta: [255, 0, 255],
  orange: [255, 165, 0], purple: [128, 0, 128], pink: [255, 192, 203], brown: [165, 42, 42],
  navy: [0, 0, 128], teal: [0, 128, 128], lime: [0, 255, 0], maroon: [128, 0, 0], olive: [128, 128, 0],
};

/**
 * Resolves a {@link NamedColor} to an RGB color. Also accepts a `#RGB`/`#RRGGBB`
 * hex string. Throws {@link PdfErrorCode.INVALID_COLOR} for an unknown name.
 *
 * @param name A named color or hex string.
 *
 * @returns The RGB color.
 */
export function color(name: NamedColor | string): RgbColor {
  if (name.startsWith("#")) {
    return hex(name);
  }
  if (/^hsla?\(/i.test(name.trim())) {
    const parts = name.match(/-?\d*\.?\d+/g);
    if (parts === null || parts.length < 3) {
      throw new PdfEngineError(PdfErrorCode.INVALID_COLOR, `Invalid HSL color: "${name}".`);
    }
    // CSS HSL: hue in degrees, saturation and lightness as 0–100 (percent).
    return hsl(parseFloat(parts[0]!), parseFloat(parts[1]!) / 100, parseFloat(parts[2]!) / 100);
  }
  const rgb255 = NAMED_COLORS[name as NamedColor];
  if (rgb255 === undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_COLOR,
      `Unknown color name: "${name}". Use one of ${Object.keys(NAMED_COLORS).join(", ")}, a #hex string, or rgb()/cmyk()/gray().`,
    );
  }
  return { kind: "rgb", r: rgb255[0] / 255, g: rgb255[1] / 255, b: rgb255[2] / 255 };
}

/**
 * Normalizes an HSL saturation/lightness component. Accepts a `0–1` fraction, a
 * percentage string (`"87%"`), or a `0–100` number (values above 1 are treated
 * as percentages). Clamped to `[0, 1]`.
 */
function normalizeHslComponent(value: number | string): number {
  const parsed =
    typeof value === "string"
      ? value.trim().endsWith("%")
        ? parseFloat(value) / 100
        : parseFloat(value)
      : value > 1
        ? value / 100
        : value;
  return Math.min(1, Math.max(0, Number.isFinite(parsed) ? parsed : 0));
}

/**
 * Creates a color from HSL. Converted to an {@link RgbColor} for output (HSL is
 * not a native PDF color space).
 *
 * @param h Hue in degrees; wrapped into [0, 360).
 * @param s Saturation as a `0–1` fraction, a percentage string (`"87%"`), or a `0–100` number.
 * @param l Lightness as a `0–1` fraction, a percentage string (`"80%"`), or a `0–100` number.
 *
 * @returns The equivalent RGB color.
 */
export function hsl(h: number, s: number | string, l: number | string): RgbColor {
  const hue = ((h % 360) + 360) % 360;
  const sat = normalizeHslComponent(s);
  const light = normalizeHslComponent(l);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { kind: "rgb", r: r + m, g: g + m, b: b + m };
}

/**
 * A color accepted by drawing and text APIs: a structured {@link PdfColor} or a
 * {@link NamedColor} string (resolved to RGB during normalization).
 */
export type ColorInput = PdfColor | NamedColor;

/**
 * PDF user-space unit. All coordinate and size options are expressed in points,
 * where one point equals 1/72 inch. Use the converters below to author layouts
 * in physical units without computing the point math by hand.
 */

/**
 * Converts millimetres to points (1 mm = 72 / 25.4 pt).
 *
 * @param value Length in millimetres.
 *
 * @returns The equivalent length in points.
 */
export function mm(value: number): number {
  return (value * 72) / 25.4;
}

/**
 * Converts centimetres to points (1 cm = 72 / 2.54 pt).
 *
 * @param value Length in centimetres.
 *
 * @returns The equivalent length in points.
 */
export function cm(value: number): number {
  return (value * 72) / 2.54;
}

/**
 * Converts inches to points (1 in = 72 pt).
 *
 * @param value Length in inches.
 *
 * @returns The equivalent length in points.
 */
export function inch(value: number): number {
  return value * 72;
}

/**
 * Identity converter for points. Provided for symmetry with {@link mm},
 * {@link cm}, and {@link inch} so unit intent stays explicit at call sites.
 *
 * @param value Length in points.
 *
 * @returns The same length in points.
 */
export function pt(value: number): number {
  return value;
}
