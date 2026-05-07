/**
 * Stable error-code enum used by PdfEngineError to classify failures.
 */
export enum PdfErrorCode {
  INVALID_ATTACHMENT = "INVALID_ATTACHMENT",
  INVALID_ANNOTATION = "INVALID_ANNOTATION",
  INVALID_COMPLIANCE = "INVALID_COMPLIANCE",
  INVALID_DESTINATION = "INVALID_DESTINATION",
  INVALID_ENCRYPTION = "INVALID_ENCRYPTION",
  EMPTY_PAGE = "EMPTY_PAGE",
  INVALID_COLOR = "INVALID_COLOR",
  INVALID_DASH_PATTERN = "INVALID_DASH_PATTERN",
  INVALID_FONT = "INVALID_FONT",
  INVALID_FORM_FIELD = "INVALID_FORM_FIELD",
  INVALID_GRAPHICS_STATE = "INVALID_GRAPHICS_STATE",
  INVALID_IMAGE = "INVALID_IMAGE",
  INVALID_LINK = "INVALID_LINK",
  INVALID_METADATA = "INVALID_METADATA",
  INVALID_NUMBER = "INVALID_NUMBER",
  INVALID_OUTLINE = "INVALID_OUTLINE",
  INVALID_PAGE = "INVALID_PAGE",
  INVALID_PAGE_LABEL = "INVALID_PAGE_LABEL",
  INVALID_PDF = "INVALID_PDF",
  INVALID_PAGE_SIZE = "INVALID_PAGE_SIZE",
  INVALID_PATH = "INVALID_PATH",
  INVALID_TEXT = "INVALID_TEXT",
  INVALID_TRANSFORM = "INVALID_TRANSFORM",
  UNSUPPORTED_CHARACTER = "UNSUPPORTED_CHARACTER",
  UNSUPPORTED_IMAGE_BIT_DEPTH = "UNSUPPORTED_IMAGE_BIT_DEPTH",
  UNSUPPORTED_IMAGE_COLOR_SPACE = "UNSUPPORTED_IMAGE_COLOR_SPACE",
  UNSUPPORTED_IMAGE_INTERLACE = "UNSUPPORTED_IMAGE_INTERLACE",
  UNSUPPORTED_IMAGE_FORMAT = "UNSUPPORTED_IMAGE_FORMAT",
  UNSUPPORTED_ENCRYPTION = "UNSUPPORTED_ENCRYPTION",
  UNSUPPORTED_XREF_FORMAT = "UNSUPPORTED_XREF_FORMAT"
}

/**
 *
 * A structured error type thrown when PDF generation, parsing, validation, or editing fails. It carries a stable error code and optional diagnostic details.
 *
 * @export
 * @class PdfEngineError
 */
export class PdfEngineError extends Error {
  readonly code: PdfErrorCode;
  readonly details?: Record<string, unknown> | undefined;

  /**
   * Creates a structured PDF engine error with a stable code and optional details.
   *
   * @param code The stable error code for the failure.
   * @param message The human-readable error message.
   * @param details Optional diagnostic details for the error.
   */
  constructor(code: PdfErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PdfEngineError";
    this.code = code;
    this.details = details;
  }
}
