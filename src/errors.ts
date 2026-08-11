/**
 * Stable error-code enum used by PdfEngineError to classify failures.
 */
export enum PdfErrorCode {
  /** Attachment data or metadata is invalid. */
  INVALID_ATTACHMENT = "INVALID_ATTACHMENT",
  /** Annotation options or geometry are invalid. */
  INVALID_ANNOTATION = "INVALID_ANNOTATION",
  /** The requested output violates an enabled compliance profile. */
  INVALID_COMPLIANCE = "INVALID_COMPLIANCE",
  /** A named destination or page target is invalid. */
  INVALID_DESTINATION = "INVALID_DESTINATION",
  /** Encryption options or encrypted data are invalid. */
  INVALID_ENCRYPTION = "INVALID_ENCRYPTION",
  /** The operation would create or serialize a document without pages. */
  EMPTY_PAGE = "EMPTY_PAGE",
  /** A color value is outside the supported range or shape. */
  INVALID_COLOR = "INVALID_COLOR",
  /** A vector path dash pattern is invalid. */
  INVALID_DASH_PATTERN = "INVALID_DASH_PATTERN",
  /** A font name, embedded font, or font program is invalid. */
  INVALID_FONT = "INVALID_FONT",
  /** A form field definition or update is invalid. */
  INVALID_FORM_FIELD = "INVALID_FORM_FIELD",
  /** A form field name is invalid due to naming conflicts (e.g. parent vs terminal). */
  INVALID_FORM_FIELD_NAME = "INVALID_FORM_FIELD_NAME",
  /** Graphics state operations are unbalanced or invalid. */
  INVALID_GRAPHICS_STATE = "INVALID_GRAPHICS_STATE",
  /** Image data or image placement options are invalid. */
  INVALID_IMAGE = "INVALID_IMAGE",
  /** A link target or link rectangle is invalid. */
  INVALID_LINK = "INVALID_LINK",
  /** Document metadata or XMP metadata is invalid. */
  INVALID_METADATA = "INVALID_METADATA",
  /** A numeric API argument is invalid. */
  INVALID_NUMBER = "INVALID_NUMBER",
  /** An outline item or outline target is invalid. */
  INVALID_OUTLINE = "INVALID_OUTLINE",
  /** A page reference, page index, or page edit is invalid. */
  INVALID_PAGE = "INVALID_PAGE",
  /** A page-label range is invalid. */
  INVALID_PAGE_LABEL = "INVALID_PAGE_LABEL",
  /** The source PDF is malformed or unsupported for the requested operation. */
  INVALID_PDF = "INVALID_PDF",
  /** A page size name or custom page dimensions are invalid. */
  INVALID_PAGE_SIZE = "INVALID_PAGE_SIZE",
  /** Vector path commands or styles are invalid. */
  INVALID_PATH = "INVALID_PATH",
  /** Text content or text layout options are invalid. */
  INVALID_TEXT = "INVALID_TEXT",
  /** A declarative JSON document description is malformed. */
  INVALID_DOCUMENT_JSON = "INVALID_DOCUMENT_JSON",
  /** A graphics transform matrix is invalid. */
  INVALID_TRANSFORM = "INVALID_TRANSFORM",
  /** Text contains a character unsupported by the selected font set. */
  UNSUPPORTED_CHARACTER = "UNSUPPORTED_CHARACTER",
  /** Image bit depth is not supported. */
  UNSUPPORTED_IMAGE_BIT_DEPTH = "UNSUPPORTED_IMAGE_BIT_DEPTH",
  /** Image color space is not supported. */
  UNSUPPORTED_IMAGE_COLOR_SPACE = "UNSUPPORTED_IMAGE_COLOR_SPACE",
  /** Interlaced image data is not supported. */
  UNSUPPORTED_IMAGE_INTERLACE = "UNSUPPORTED_IMAGE_INTERLACE",
  /** Image format is not supported. */
  UNSUPPORTED_IMAGE_FORMAT = "UNSUPPORTED_IMAGE_FORMAT",
  /** Source or output encryption mode is not supported. */
  UNSUPPORTED_ENCRYPTION = "UNSUPPORTED_ENCRYPTION",
  /** Page tree nesting exceeds maximum supported depth. */
  UNSUPPORTED_PAGE_TREE = "UNSUPPORTED_PAGE_TREE",
  /** Cross-reference format is not supported. */
  UNSUPPORTED_XREF_FORMAT = "UNSUPPORTED_XREF_FORMAT",
  /** A number tree is corrupt or has invalid keys. */
  INVALID_NUMBER_TREE = "INVALID_NUMBER_TREE",
  /** An internal serialization invariant was violated. */
  INTERNAL_ERROR = "INTERNAL_ERROR",
  /** A document-level operation was attempted in an unsupported state or combination. */
  INVALID_OPERATION = "INVALID_OPERATION",
  /** Strict layout rendering detected content that cannot fit in its allotted region. */
  LAYOUT_OVERFLOW = "LAYOUT_OVERFLOW",
  /** A ByteSink or stream operation was attempted after the sink was closed. */
  SINK_CLOSED = "SINK_CLOSED",
  /** A ByteSink has reached its maximum configured capacity. */
  SINK_FULL = "SINK_FULL",
  /** A TypeScript type guard failure indicates an unreachable code path. */
  UNREACHABLE = "UNREACHABLE",
  /** A script (e.g. Devanagari, Thai) cannot be shaped by the current shaper. */
  UNSUPPORTED_SCRIPT = "UNSUPPORTED_SCRIPT",
}

/**
 *
 * A structured error type thrown when PDF generation, parsing, validation, or editing fails. It carries a stable error code and optional diagnostic details.
 */
export class PdfEngineError extends Error {
  /** Stable machine-readable issue or error code. */
  readonly code: PdfErrorCode;
  /** Optional diagnostic details supplied with the error. */
  readonly details?: Record<string, unknown> | undefined;

  /**
   * Creates a structured PDF engine error with a stable code and optional details.
   *
   * @param code The stable error code for the failure.
   * @param message The human-readable error message.
   * @param details Optional diagnostic details for the error.
   */
  constructor(
    code: PdfErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PdfEngineError";
    this.code = code;
    this.details = details;
  }
}
