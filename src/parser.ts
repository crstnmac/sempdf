import { PdfEngineError, PdfErrorCode } from "./errors.js";
import { inflateZlib } from "./internal/deflate.js";
import {
  decryptBytesForObject,
  latin1Bytes,
  openPdfEncryptionContext,
  type PdfEncryptionContext,
} from "./internal/pdf-encryption.js";
import type { BinaryData, DocumentConformanceProfile } from "./types.js";
import {
  isPdfStream,
  type PdfDict,
  type PdfRef,
  type PdfStream,
  type PdfValue,
} from "./internal/pdf-primitives.js";
import {
  extractPageText,
  parseToUnicodeCMap,
  type FontState,
  type PageTextExtraction,
  type PositionedTextRun,
} from "./internal/text-extract.js";
import {
  glyphNameToString,
  resolveBaseEncoding,
} from "./internal/pdf-encodings.js";

const DEBUG_PDF = typeof process !== "undefined" && process.env.PDF_DEBUG === "1";
function debugLog(...args: unknown[]): void {
  if (DEBUG_PDF) console.warn(...args);
}

/**
 * Low-level parsed indirect object record.
 */
export interface ParsedPdfIndirectObject {
  /** PDF indirect object number. */
  readonly id: number;
  /** PDF indirect object generation number. */
  readonly generation: number;
  /** Byte offset where the indirect object was parsed. */
  readonly offset: number;
  /** Current or default value for the option. */
  readonly value: PdfValue;
}

/**
 * Page metadata discovered while parsing an existing PDF.
 */
/**
 * Options for {@link ParsedPdfDocument.extractText}.
 */
export interface ExtractTextOptions {
  /**
   * Reading order strategy:
   *   - "stream" (default): runs in content-stream order
   *   - "structure": runs reordered to match StructTree traversal via MCID;
   *     runs without MCID are appended in stream order at the end
   */
  readonly readingOrder?: "stream" | "structure" | undefined;
}

export interface ParsedPdfPage {
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
  /** Parsed page media box array. */
  readonly mediaBox?: readonly number[] | undefined;
  /** Object ids of content streams attached to the page. */
  readonly contentObjectIds: readonly number[];
  /** Resolved Resources dictionary (inherited from page tree if absent on page). */
  readonly resources?: PdfDict | undefined;
}

/**
 * Document metadata discovered while parsing an existing PDF.
 */
export interface ParsedPdfMetadata {
  /** Document title or display title. */
  readonly title?: string | undefined;
  /** Document author name. */
  readonly author?: string | undefined;
  /** Document subject or summary. */
  readonly subject?: string | undefined;
  /** Document keywords for search and metadata. */
  readonly keywords?: string | undefined;
  /** Application or person that created the document. */
  readonly creator?: string | undefined;
  /** PDF producer value recorded in metadata. */
  readonly producer?: string | undefined;
  /** Document creation date. */
  readonly creationDate?: string | undefined;
  /** Document modification date. */
  readonly modificationDate?: string | undefined;
}

/**
 * Named destination discovered while parsing an existing PDF.
 */
export interface ParsedPdfNamedDestination {
  /** Name of the item, field, destination, or signer. */
  readonly name: string;
  /** Object id of the page associated with this item. */
  readonly pageObjectId?: number | undefined;
  /** Choice field display mode. */
  readonly mode?: string | undefined;
}

/**
 * Outline item discovered while parsing an existing PDF.
 */
export interface ParsedPdfOutlineItem {
  /** Document title or display title. */
  readonly title: string;
  /** Named destination targeted by the outline item. */
  readonly targetName?: string | undefined;
  /** Page object id targeted by the outline item. */
  readonly targetPageObjectId?: number | undefined;
  /** Nested child list items or structure elements. */
  readonly children: readonly ParsedPdfOutlineItem[];
}

/**
 * Page-label range discovered while parsing an existing PDF.
 */
export interface ParsedPdfPageLabelRange {
  /** Zero-based page index where the label range starts. */
  readonly startPageIndex: number;
  /** Page-label numbering style. */
  readonly style?:
    | "decimal"
    | "romanUpper"
    | "romanLower"
    | "lettersUpper"
    | "lettersLower"
    | undefined;
  /** Text prefix prepended to page labels. */
  readonly prefix?: string | undefined;
  /** Starting number for ordered output. */
  readonly startAt: number;
}

/**
 * Attachment metadata discovered while parsing an existing PDF.
 */
export interface ParsedPdfAttachment {
  /** Name of the item, field, destination, or signer. */
  readonly name: string;
  /** Human-readable attachment description. */
  readonly description?: string | undefined;
  /** MIME type associated with the attachment. */
  readonly mimeType?: string | undefined;
  /** Attachment byte length when it can be determined. */
  readonly byteLength?: number | undefined;
  /** PDF indirect object number for the parsed item. */
  readonly objectId?: number | undefined;
}

/**
 * Tagged structure element discovered while parsing an existing PDF.
 */
export interface ParsedPdfStructureElement {
  /** Structure role used to tag this content. */
  readonly role: string;
  /** Object id of the page associated with this item. */
  readonly pageObjectId?: number | undefined;
  /** First marked-content id associated with the structure element. */
  readonly mcid?: number | undefined;
  /** Marked-content ids associated with the structure element. */
  readonly mcids?: readonly number[] | undefined;
  /** Unique identifier assigned to the structure element. */
  readonly id?: string | undefined;
  /** Alternate text for tagged non-text content. */
  readonly altText?: string | undefined;
  /** Replacement text exposed to assistive technology. */
  readonly actualText?: string | undefined;
  /** BCP 47 language tag for document or structure content. */
  readonly language?: string | undefined;
  /** Nested child list items or structure elements. */
  readonly children?: readonly ParsedPdfStructureElement[] | undefined;
}

export interface ParsedPdfTaggedAnnotation {
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
  /** Subtype. */
  readonly subtype?: string | undefined;
  /** Object id of the page associated with this item. */
  readonly pageObjectId?: number | undefined;
  /** Annotation or widget rectangle in PDF coordinates. */
  readonly rect?: readonly number[] | undefined;
  /** URI target for the link. */
  readonly url?: string | undefined;
  /** Destination page object id. */
  readonly destinationPageObjectId?: number | undefined;
  /** Annotation contents text. */
  readonly contents?: string | undefined;
  /** Signature form field name. */
  readonly fieldName?: string | undefined;
  /** Raw AcroForm field type name. */
  readonly fieldType?: string | undefined;
  /** Current or default value for the option. */
  readonly value?: string | undefined;
}

export interface ParsedPdfInspectedStructureElement extends ParsedPdfStructureElement {
  /** PDF indirect object number for the parsed item. */
  readonly objectId?: number | undefined;
  /** Text content to render or inspect. */
  readonly text?: string | undefined;
  /** Annotations. */
  readonly annotations?: readonly ParsedPdfTaggedAnnotation[] | undefined;
  /** Nested child list items or structure elements. */
  readonly children?: readonly ParsedPdfInspectedStructureElement[] | undefined;
}

/**
 * Editable structure element handle returned by editable-document queries.
 */
export interface ParsedPdfEditableStructureElement {
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
  /** Structure role used to tag this content. */
  readonly role: string;
  /** Object id of the parent structure element. */
  readonly parentObjectId?: number | undefined;
  /** Object id of the page associated with this item. */
  readonly pageObjectId?: number | undefined;
  /** First marked-content id associated with the structure element. */
  readonly mcid?: number | undefined;
  /** Marked-content ids associated with the structure element. */
  readonly mcids?: readonly number[] | undefined;
  /** Alternate text for tagged non-text content. */
  readonly altText?: string | undefined;
  /** Replacement text exposed to assistive technology. */
  readonly actualText?: string | undefined;
  /** BCP 47 language tag for document or structure content. */
  readonly language?: string | undefined;
  /** Nested child list items or structure elements. */
  readonly children?: readonly ParsedPdfEditableStructureElement[] | undefined;
}

/**
 * Form field metadata discovered while parsing an existing PDF.
 */
export interface ParsedPdfFormField {
  /** PDF indirect object number for the parsed item. */
  readonly objectId: number;
  /** Name of the item, field, destination, or signer. */
  readonly name: string;
  /** Raw AcroForm field type name. */
  readonly fieldType?: string | undefined;
  /** Resolved button field subtype. */
  readonly buttonKind?: "checkBox" | "radio" | "pushButton" | undefined;
  /** Current or default value for the option. */
  readonly value?: string | undefined;
  /** Options that control this item. */
  readonly options?: readonly string[] | undefined;
  /** Resolved choice field display mode. */
  readonly choiceMode?: "combo" | "list" | undefined;
  /** Initial checkbox checked state. */
  readonly checked?: boolean | undefined;
  /** Object id of the page associated with this item. */
  readonly pageObjectId?: number | undefined;
  /** Annotation or widget rectangle in PDF coordinates. */
  readonly rect?: readonly number[] | undefined;
  /** Whether the form field is read-only. */
  readonly readOnly?: boolean | undefined;
  /** Whether the form field is required. */
  readonly required?: boolean | undefined;
  /** Whether the text field accepts multiple lines. */
  readonly multiline?: boolean | undefined;
}

interface XrefCompressedEntry {
  /** Object stream id. */
  readonly objectStreamId: number;
  /** Index. */
  readonly index: number;
}

interface ParsedXrefSection {
  /** Offsets. */
  readonly offsets: Map<number, number>;
  /** Compressed. */
  readonly compressed: Map<number, XrefCompressedEntry>;
  /** Free. */
  readonly free: Set<number>;
  /** Trailer. */
  readonly trailer: PdfDict;
}

interface ParsedDocumentEncryption {
  /** Context. */
  readonly context: PdfEncryptionContext;
  /** Encrypt object id. */
  readonly encryptObjectId?: number | undefined;
  /** True when the encryption dict was missing the /P entry. */
  readonly defaultFullPermissions?: boolean | undefined;
}

type StreamLengthResolver = (refValue: PdfRef) => number | undefined;

/**
 * Options that control parsing behavior for existing PDFs.
 */
export interface ParseDocumentOptions {
  /** Password used to open an encrypted source PDF. */
  readonly password?: string | undefined;
}

/**
 *
 * A read-only parsed representation of a PDF document. It provides helpers for inspecting document-level metadata, object references, pages, forms, outlines, structure trees, and source bytes.
 */
export class ParsedPdfDocument {
  /**
   * Creates a parsed PDF document wrapper around the trailer, cross-reference data, object table, source bytes, and optional encryption context.
   *
   * @param version The parsed PDF header version.
   * @param xrefOffsets The parsed cross-reference offsets by object id.
   * @param trailer The parsed trailer dictionary.
   * @param objects The parsed indirect objects by object id.
   * @param sourceBytes The original source PDF bytes.
   * @param startXrefOffset The byte offset of the startxref pointer.
   * @param encryption The optional parsed encryption context.
   * @param recoveryMode Whether the document was parsed in recovery mode.
   * @param repairWarnings Detailed repair warnings collected during recovery parsing.
   */
  constructor(
    readonly version: string,
    readonly xrefOffsets: ReadonlyMap<number, number>,
    readonly trailer: PdfDict,
    private readonly objects: ReadonlyMap<number, ParsedPdfIndirectObject>,
    private readonly sourceBytes: Uint8Array,
    readonly startXrefOffset: number,
    private readonly encryption?: ParsedDocumentEncryption | undefined,
    readonly recoveryMode?: boolean | undefined,
    readonly repairWarnings?: readonly string[] | undefined,
  ) {}

  /**
   * Returns the repair warnings collected during recovery parsing.
   *
   * @returns The repair warnings, or an empty array.
   */
  getRepairWarnings(): readonly string[] {
    return this.repairWarnings ?? [];
  }

  /**
   * Set of object ids whose stream data has not yet been decoded.
   */
  readonly lazyObjects: Set<number> = new Set<number>();

  /**
   * Returns a parsed indirect object by object id.
   *
   * @param id The object id to look up.
   *
   * @returns The parsed object, if present.
   */
  getObject(id: number): ParsedPdfIndirectObject | undefined {
    const object = this.objects.get(id);
    if (!object) return undefined;

    if (
      this.lazyObjects.has(id) &&
      isPdfStream(object.value)
    ) {
      this.lazyObjects.delete(id);
      return this.decodeStreamObject(id, object);
    }

    return object;
  }

  private decodeStreamObject(
    id: number,
    object: ParsedPdfIndirectObject,
  ): ParsedPdfIndirectObject {
    const streamValue = object.value as PdfStream;
    try {
      const decoded = decodePdfStreamBytes(streamValue, `object ${id} stream`);
      const decodedValue: PdfStream = {
        kind: "stream",
        dict: streamValue.dict,
        bytes: decoded,
      };
      (this.objects as Map<number, ParsedPdfIndirectObject>).set(id, {
        ...object,
        value: decodedValue,
      });
      return this.objects.get(id)!;
    } catch {
      (this.objects as Map<number, ParsedPdfIndirectObject>).set(id, {
        ...object,
        value: {
          kind: "stream",
          dict: streamValue.dict,
          bytes: streamValue.bytes,
        },
      });
      return this.objects.get(id)!;
    }
  }

  /**
   * Eagerly loads and decodes the specified object ids so they are
   * available without further lazy-parsing.
   *
   * @param ids The object ids to preload.
   */
  preloadObjects(ids: readonly number[]): void {
    for (const id of ids) {
      if (this.lazyObjects.has(id)) {
        this.getObject(id);
      }
    }
  }

  /**
   * Returns all parsed object ids sorted in ascending order.
   *
   * @returns The sorted object ids.
   */
  getObjectIds(): readonly number[] {
    return [...this.objects.keys()].sort((left, right) => left - right);
  }

  /**
   * Returns the highest parsed object id, or zero for an empty object table.
   *
   * @returns The highest object id.
   */
  getMaxObjectId(): number {
    return Math.max(0, ...this.objects.keys());
  }

  /**
   * Returns the document information dictionary object id when one is present.
   *
   * @returns The information dictionary object id, if present.
   */
  getInfoObjectId(): number | undefined {
    const infoRef = getDictValue(this.trailer, "Info");
    return isPdfRef(infoRef) ? infoRef.objectId : undefined;
  }

  /**
   * Returns the catalog object id from the trailer root entry.
   *
   * @returns The catalog object id.
   */
  getRootObjectId(): number {
    const rootRef = getDictValue(this.trailer, "Root");
    if (!isPdfRef(rootRef)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "PDF trailer Root entry must be a reference.",
      );
    }

    return rootRef.objectId;
  }

  /**
   * Returns the effective PDF version, taking into account a Catalog `/Version` override that may raise the version above the file header.
   */
  getEffectiveVersion(): string {
    const catalog = getCatalogDict(this);
    const override = getDictValue(catalog, "Version");
    if (
      override &&
      typeof override === "object" &&
      "kind" in override &&
      override.kind === "name"
    ) {
      const overrideValue = (
        override as {
          value: string;
        }
      ).value;
      if (
        /^\d+\.\d+$/.test(overrideValue) &&
        compareVersionStrings(overrideValue, this.version) > 0
      ) {
        return overrideValue;
      }
    }
    return this.version;
  }

  /**
   * Returns the root Pages tree object id.
   *
   * @returns The Pages tree object id.
   */
  getPagesObjectId(): number {
    return getPagesRef(this).objectId;
  }

  /**
   * Returns a defensive copy of the original source bytes.
   *
   * @returns A copy of the source bytes.
   */
  getSourceBytes(): Uint8Array {
    return this.sourceBytes.slice();
  }

  /**
   * Returns the parsed encryption context when the source PDF is encrypted.
   *
   * @returns The encryption context, if present.
   */
  getEncryptionContext(): PdfEncryptionContext | undefined {
    return this.encryption?.context;
  }

  /**
   * Returns the Encrypt dictionary object id when one was parsed.
   *
   * @returns The encryption dictionary object id, if present.
   */
  getEncryptionObjectId(): number | undefined {
    return this.encryption?.encryptObjectId;
  }

  /**
   * Returns document information dictionary metadata.
   *
   * @returns The parsed document metadata.
   */
  getMetadata(): ParsedPdfMetadata {
    const infoRef = getDictValue(this.trailer, "Info");
    const infoDict = resolveDict(this, infoRef);
    if (!infoDict) {
      return {};
    }

    return {
      title: readString(infoDict, "Title"),
      author: readString(infoDict, "Author"),
      subject: readString(infoDict, "Subject"),
      keywords: readString(infoDict, "Keywords"),
      creator: readString(infoDict, "Creator"),
      producer: readString(infoDict, "Producer"),
      creationDate: readString(infoDict, "CreationDate"),
      modificationDate: readString(infoDict, "ModDate"),
    };
  }

  /**
   * Returns decoded XMP metadata from the catalog metadata stream when present.
   *
   * @returns The decoded XMP metadata, if present.
   */
  getXmpMetadata(): string | undefined {
    const catalog = getCatalogDict(this);
    const metadataValue = resolveValue(this, getDictValue(catalog, "Metadata"));
    if (!metadataValue || !isPdfStream(metadataValue)) {
      return undefined;
    }

    return new TextDecoder().decode(
      decodePdfStreamBytes(metadataValue, "metadata stream"),
    );
  }

  /**
   * Returns the catalog language value when present.
   *
   * @returns The document language, if present.
   */
  getLanguage(): string | undefined {
    return readString(getCatalogDict(this), "Lang");
  }

  /**
   * Reports whether the document declares tagged PDF structure.
   *
   * @returns True when the document is tagged.
   */
  isTagged(): boolean {
    const catalog = getCatalogDict(this);
    const markInfo = resolveDict(this, getDictValue(catalog, "MarkInfo"));
    if (markInfo && getDictValue(markInfo, "Marked") === true) {
      return true;
    }

    return (
      resolveDict(this, getDictValue(catalog, "StructTreeRoot")) !== undefined
    );
  }

  /**
   * Detects the supported PDF/A or PDF/UA conformance profile from catalog and XMP metadata.
   *
   * @returns The detected supported conformance profile, if any.
   */
  getConformanceProfile(): DocumentConformanceProfile | undefined {
    const xmpMetadata = this.getXmpMetadata();
    if (xmpMetadata) {
      const pdfaPart = /pdfaid:part>\s*(\d+)\s*</.exec(xmpMetadata)?.[1];
      const pdfaConf = /pdfaid:conformance>\s*([AB])\s*</.exec(xmpMetadata)?.[1];
      if (pdfaPart === "1" && pdfaConf === "B") return "pdfa-1b";
      if (pdfaPart === "2" && pdfaConf === "B") return "pdfa-2b";
      if (pdfaPart === "3" && pdfaConf === "B") return "pdfa-3b";
      if (pdfaPart === "4") return "pdfa-4";
      if (/pdfuaid:part>\s*2\s*</.test(xmpMetadata)) return "pdfua-2";
      if (/pdfuaid:part>\s*1\s*</.test(xmpMetadata)) return "pdfua-1";
      if (/wtpdf/i.test(xmpMetadata)) return "wtpdf";
    }

    const catalog = getCatalogDict(this);
    const outputIntents = resolveValue(
      this,
      getDictValue(catalog, "OutputIntents"),
    );
    if (Array.isArray(outputIntents) && !isPdfDict(outputIntents)) {
      for (const entry of outputIntents) {
        const intent = resolveDict(this, entry);
        if (intent && getNameValue(intent, "S") === "GTS_PDFA1") {
          return "pdfa-1b";
        }
      }
    }

    return undefined;
  }

  /**
   * Returns the number of pages in the document.
   *
   * @returns The page count.
   */
  getPageCount(): number {
    const pagesRef = getPagesRef(this);
    const pagesDict = resolveDict(this, pagesRef);
    const count = pagesDict ? getDictValue(pagesDict, "Count") : undefined;
    return typeof count === "number" ? count : this.listPages().length;
  }

  /**
   * Returns parsed page records discovered from the page tree.
   *
   * @returns The parsed page records.
   */
  listPages(): readonly ParsedPdfPage[] {
    const pagesRef = getPagesRef(this);
    const output: ParsedPdfPage[] = [];
    walkPages(this, pagesRef, output);
    return output;
  }

  /**
   * Extracts positioned Unicode text from every page of the document.
   * Best-effort: decodes each font via its /ToUnicode CMap when present and
   * falls back to Latin-1 otherwise. Positions are user-space coordinates
   * (origin lower-left) computed from the active text and graphics matrices.
   *
   * @returns Per-page text and positioned runs.
   */
  extractText(options: ExtractTextOptions = {}): readonly PageTextExtraction[] {
    const pages = this.listPages();
    const readingOrder = options.readingOrder ?? "stream";
    return pages.map((page, pageIndex) => {
      const fonts = collectPageFonts(this, page.resources);
      const content = readPageContentStreams(this, page);
      let runs = extractPageText(content, fonts);
      if (readingOrder === "structure") {
        runs = reorderRunsByStructureTree(this, runs);
      }
      const text = runs.map((run) => run.text).join("");
      return { pageIndex, text, runs };
    });
  }

  /**
   * Returns named destinations discovered from the document name tree.
   *
   * @returns The named destinations.
   */
  listNamedDestinations(): readonly ParsedPdfNamedDestination[] {
    const catalog = getCatalogDict(this);
    const names = resolveDict(this, getDictValue(catalog, "Names"));
    const dests = resolveDict(
      this,
      names ? getDictValue(names, "Dests") : undefined,
    );
    if (!dests) {
      return [];
    }

    const destinations = new Map<string, ParsedPdfNamedDestination>();
    collectNamedDestinations(this, dests, destinations);
    return [...destinations.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  /**
   * Returns the document outline tree.
   *
   * @returns The outline items.
   */
  listOutlines(): readonly ParsedPdfOutlineItem[] {
    const catalog = getCatalogDict(this);
    const outlinesRef = getDictValue(catalog, "Outlines");
    const outlinesDict = resolveDict(this, outlinesRef);
    if (!outlinesDict) {
      return [];
    }

    const namedDestinations = new Map(
      this.listNamedDestinations().map((destination) => [
        destination.name,
        destination,
      ]),
    );
    return readOutlineChain(
      this,
      getDictValue(outlinesDict, "First"),
      namedDestinations,
      new Set<number>(),
    );
  }

  /**
   * Returns page-label ranges discovered from the page labels number tree.
   *
   * @returns The page-label ranges.
   */
  listPageLabels(): readonly ParsedPdfPageLabelRange[] {
    const catalog = getCatalogDict(this);
    const pageLabels = resolveDict(this, getDictValue(catalog, "PageLabels"));
    if (!pageLabels) {
      return [];
    }

    const entries = new Map<number, PdfDict>();
    collectNumberTreeEntries(this, pageLabels, entries, new Set<number>());
    return [...entries.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([startPageIndex, labelDict]) =>
        compactPageLabelRange(startPageIndex, labelDict),
      );
  }

  /**
   * Returns embedded file attachment metadata.
   *
   * @returns The attachment metadata records.
   */
  listAttachments(): readonly ParsedPdfAttachment[] {
    const catalog = getCatalogDict(this);
    const names = resolveDict(this, getDictValue(catalog, "Names"));
    const embeddedFiles = resolveDict(
      this,
      names ? getDictValue(names, "EmbeddedFiles") : undefined,
    );
    if (!embeddedFiles) {
      return [];
    }

    const attachments = new Map<string, ParsedPdfAttachment>();
    collectEmbeddedFiles(this, embeddedFiles, attachments, new Set<number>());
    return [...attachments.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  /**
   * Returns AcroForm field metadata.
   *
   * @returns The parsed form fields.
   */
  listFormFields(): readonly ParsedPdfFormField[] {
    const catalog = getCatalogDict(this);
    const acroForm = resolveDict(this, getDictValue(catalog, "AcroForm"));
    if (!acroForm) {
      return [];
    }

    const fields = getDictValue(acroForm, "Fields");
    if (!Array.isArray(fields) || isPdfDict(fields)) {
      return [];
    }

    const output: ParsedPdfFormField[] = [];
    const seen = new Set<number>();
    for (const field of fields) {
      collectFormFields(this, field, output, { nameParts: [] }, seen);
    }

    return output;
  }

  /**
   * Returns a flat list of tagged structure elements.
   *
   * @returns The parsed structure elements.
   */
  listStructureElements(): readonly ParsedPdfStructureElement[] {
    const catalog = getCatalogDict(this);
    const structTreeRoot = resolveDict(
      this,
      getDictValue(catalog, "StructTreeRoot"),
    );
    if (!structTreeRoot) {
      return [];
    }

    return collectStructureElements(
      this,
      getDictValue(structTreeRoot, "K"),
      new Set<number>(),
    );
  }

  /**
   * Returns a nested inspection view of tagged structure elements.
   *
   * @returns The nested structure inspection records.
   */
  inspectStructureElements(): readonly ParsedPdfInspectedStructureElement[] {
    const catalog = getCatalogDict(this);
    const structTreeRoot = resolveDict(
      this,
      getDictValue(catalog, "StructTreeRoot"),
    );
    if (!structTreeRoot) {
      return [];
    }

    return collectInspectedStructureElements(
      this,
      getDictValue(structTreeRoot, "K"),
      new Set<number>(),
      new Map<string, string>(),
    );
  }

  /**
   * Returns editable handles for tagged structure elements.
   *
   * @returns The editable structure element handles.
   */
  listEditableStructureElements(): readonly ParsedPdfEditableStructureElement[] {
    const catalog = getCatalogDict(this);
    const structTreeRoot = resolveDict(
      this,
      getDictValue(catalog, "StructTreeRoot"),
    );
    if (!structTreeRoot) {
      return [];
    }

    return collectEditableStructureElements(
      this,
      getDictValue(structTreeRoot, "K"),
      new Set<number>(),
    );
  }
}

/**
 * Parses PDF bytes into an inspection object for metadata, pages, forms, outlines, attachments, and structure information.
 *
 * @param data The PDF bytes to parse.
 * @param options Parsing options, including a password for encrypted sources.
 *
 * @returns The parsed PDF inspection object.
 */
export function parseDocument(
  data: BinaryData,
  options: ParseDocumentOptions = {},
): ParsedPdfDocument {
  const bytes = toBytes(data);
  const version = parseHeaderVersion(bytes);
  const startXref = findStartXref(bytes);

  let offsets: Map<number, number>;
  let compressed: Map<number, XrefCompressedEntry>;
  let trailer: PdfDict;
  let recoveryMode = false;
  let repairWarnings: string[] = [];

  try {
    const result = parseXrefChain(bytes, startXref);
    offsets = result.offsets;
    compressed = result.compressed;
    trailer = result.trailer;
  } catch (error) {
    if (error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PDF) {
      debugLog(
        "Xref parsing failed, attempting recovery via object scanning...",
      );
      recoveryMode = true;
      const recovered = recoverXrefFromObjectMarkers(bytes);
      offsets = recovered.offsets;
      compressed = recovered.compressed;
      trailer = recovered.trailer;
      repairWarnings = recovered.warnings;
    } else {
      throw error;
    }
  }
  const resolveStreamLength = createStreamLengthResolver(bytes, offsets);

  let objects = new Map<number, ParsedPdfIndirectObject>();
  for (const [objectId, offset] of [...offsets.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    const parsed = parseIndirectObject(bytes, offset, resolveStreamLength);
    if (parsed.id !== objectId) {
      debugLog(
        `Object number mismatch at offset ${offset}: ` +
          `xref expects ${objectId}, object declares ${parsed.id}. ` +
          `Using xref value.`,
      );
    }
    objects.set(
      objectId,
      parsed,
    );
  }

  const encryption = resolveDocumentEncryption(trailer, objects, options);
  if (encryption) {
    objects = decryptParsedObjects(objects, encryption);
  }

  if (compressed.size > 0) {
    const objectStreamCache = new Map<
      number,
      Map<
        number,
        {
          /** Current or default value for the option. */
          value: PdfValue; /** Index. */
          index: number;
        }
      >
    >();
    for (const [objectId, entry] of [...compressed.entries()].sort(
      (left, right) => left[0] - right[0],
    )) {
      const objectStream = objects.get(entry.objectStreamId);
      if (!objectStream) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_PDF,
          "Object stream referenced by xref stream could not be resolved.",
          {
            objectId,
            objectStreamId: entry.objectStreamId,
          },
        );
      }

      const values = parseObjectStream(bytes, objectStream, objectStreamCache);
      const objectEntry = values.get(objectId);
      if (!objectEntry) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_PDF,
          "Compressed object was not found inside its object stream.",
          {
            objectId,
            objectStreamId: entry.objectStreamId,
          },
        );
      }

      if (objectEntry.index !== entry.index) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_PDF,
          "Compressed object index does not match xref stream entry.",
          {
            objectId,
            expectedIndex: entry.index,
            actualIndex: objectEntry.index,
          },
        );
      }

      objects.set(objectId, {
        id: objectId,
        generation: 0,
        offset: objectStream.offset,
        value: objectEntry.value,
      });
    }
  }

  const document = new ParsedPdfDocument(
    version,
    offsets,
    trailer,
    objects,
    bytes.slice(),
    startXref,
    encryption,
    recoveryMode,
    repairWarnings.length > 0 ? repairWarnings : undefined,
  );

  markLazyObjects(document, objects);

  return document;
}

function markLazyObjects(
  doc: ParsedPdfDocument,
  objects: ReadonlyMap<number, ParsedPdfIndirectObject>,
): void {
  const pages = new Set<number>();
  try {
    for (const page of doc.listPages()) {
      pages.add(page.objectId);
      for (const contentId of page.contentObjectIds) {
        doc.lazyObjects.add(contentId);
      }
    }
  } catch {
    // Can't walk pages yet, skip lazy marking.
  }

  for (const [id, obj] of objects) {
    if (doc.lazyObjects.has(id)) continue;
    if (!isPdfStream(obj.value)) continue;
    const type = getNameValue(obj.value.dict, "Type");
    const subtype = getNameValue(obj.value.dict, "Subtype");
    const filter = getDictValue(obj.value.dict, "Filter");
    if (
      type === "XObject" &&
      (subtype === "Image" || filter !== undefined)
    ) {
      doc.lazyObjects.add(id);
    }
  }
}

function resolveDocumentEncryption(
  trailer: PdfDict,
  objects: ReadonlyMap<number, ParsedPdfIndirectObject>,
  options: ParseDocumentOptions,
): ParsedDocumentEncryption | undefined {
  const encryptValue = getDictValue(trailer, "Encrypt");
  if (encryptValue === undefined) {
    return undefined;
  }

  if (options.password === undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_ENCRYPTION,
      "A password is required to parse this encrypted PDF.",
    );
  }

  const encryptRef = isPdfRef(encryptValue) ? encryptValue : undefined;
  const encryptDict = resolveEncryptionDictionary(encryptValue, objects);
  const filter = getNameValue(encryptDict, "Filter");
  const rawVersion = getDictValue(encryptDict, "V");
  const rawRevision = getDictValue(encryptDict, "R");
  const version =
    rawVersion === 1 || rawVersion === 2 || rawVersion === 4 || rawVersion === 5
      ? rawVersion
      : undefined;
  const revision =
    rawRevision === 2 ||
    rawRevision === 3 ||
    rawRevision === 4 ||
    rawRevision === 5 ||
    rawRevision === 6
      ? rawRevision
      : undefined;
  const keyLengthBytes = resolveEncryptionKeyLength(
    version,
    revision,
    getDictValue(encryptDict, "Length"),
  );
  const algorithm =
    revision === 2
      ? "rc4-40"
      : revision === 3
        ? "rc4-128"
        : revision === 5
          ? "aes-256"
          : revision === 6
            ? "aes-256-r6"
            : "aes-128";
  if (
    filter !== "Standard" ||
    version === undefined ||
    revision === undefined ||
    keyLengthBytes === undefined
  ) {
    throw new PdfEngineError(
      PdfErrorCode.UNSUPPORTED_ENCRYPTION,
      "Only Standard Security Handler RC4 and AES password encryption are supported.",
      {
        filter,
        version: rawVersion,
        revision: rawRevision,
        length: getDictValue(encryptDict, "Length"),
      },
    );
  }

  const ownerKey = readEncryptionBytes(getDictValue(encryptDict, "O"), "O");
  const userKey = readEncryptionBytes(getDictValue(encryptDict, "U"), "U");
  const permissionsValue = getDictValue(encryptDict, "P");
  const defaultFullPermissions = typeof permissionsValue !== "number";
  const effectivePermissions = defaultFullPermissions ? 0xfffff0c0 : permissionsValue;

  const ownerEncryptionKey =
    revision === 6
      ? readEncryptionBytes(getDictValue(encryptDict, "OE"), "OE")
      : undefined;
  const userEncryptionKey =
    revision === 6
      ? readEncryptionBytes(getDictValue(encryptDict, "UE"), "UE")
      : undefined;
  const permsEncryptedRaw =
    revision === 6 ? getDictValue(encryptDict, "Perms") : undefined;
  const permsEncrypted =
    permsEncryptedRaw !== undefined
      ? readEncryptionBytes(permsEncryptedRaw, "Perms")
      : undefined;

  const fileId = readEncryptionFileId(trailer);
  const encryptMetadata =
    version !== undefined && version >= 4
      ? (getDictValue(encryptDict, "EncryptMetadata") as boolean | undefined) ?? true
      : true;
  const context = openPdfEncryptionContext({
    password: options.password,
    fileId,
    algorithm,
    version,
    revision,
    keyLengthBytes,
    permissionsValue: effectivePermissions,
    ownerKey,
    userKey,
    encryptMetadata,
    ...(ownerEncryptionKey !== undefined ? { ownerEncryptionKey } : {}),
    ...(userEncryptionKey !== undefined ? { userEncryptionKey } : {}),
    ...(permsEncrypted !== undefined ? { permsEncrypted } : {}),
  });
  if (!context) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_ENCRYPTION,
      "Incorrect password for encrypted PDF.",
    );
  }

  return {
    context,
    ...(encryptRef !== undefined
      ? { encryptObjectId: encryptRef.objectId }
      : {}),
    ...(defaultFullPermissions ? { defaultFullPermissions: true } : {}),
  };
}

function resolveEncryptionKeyLength(
  version: PdfValue | undefined,
  revision: PdfValue | undefined,
  lengthValue: PdfValue | undefined,
): number | undefined {
  if (version === 1 && revision === 2) {
    return 5;
  }

  if (
    (version === 4 && revision === 4) ||
    (version === 5 && (revision === 5 || revision === 6))
  ) {
    if (
      typeof lengthValue !== "number" ||
      !Number.isInteger(lengthValue) ||
      lengthValue % 8 !== 0
    ) {
      return undefined;
    }
    const bytes = lengthValue / 8;
    return bytes === 16 || bytes === 32 ? bytes : undefined;
  }

  if (version !== 2 || revision !== 3) {
    return undefined;
  }

  if (lengthValue === undefined) {
    return 5;
  }

  if (
    typeof lengthValue !== "number" ||
    !Number.isInteger(lengthValue) ||
    lengthValue % 8 !== 0
  ) {
    return undefined;
  }

  const keyLengthBytes = lengthValue / 8;
  return keyLengthBytes >= 5 && keyLengthBytes <= 16
    ? keyLengthBytes
    : undefined;
}

function resolveEncryptionDictionary(
  encryptValue: PdfValue,
  objects: ReadonlyMap<number, ParsedPdfIndirectObject>,
): PdfDict {
  const resolvedValue = isPdfRef(encryptValue)
    ? objects.get(encryptValue.objectId)?.value
    : encryptValue;
  if (
    !resolvedValue ||
    !Array.isArray(resolvedValue) ||
    !isPdfDict(resolvedValue)
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_ENCRYPTION,
      "Encrypted PDF is missing a valid encryption dictionary.",
    );
  }

  return resolvedValue;
}

function readEncryptionBytes(
  value: PdfValue | undefined,
  key: string,
): Uint8Array {
  if (!isPdfString(value)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_ENCRYPTION,
      `Encrypted PDF is missing a valid ${key} entry.`,
    );
  }

  return latin1Bytes(value.value);
}

function readEncryptionFileId(trailer: PdfDict): Uint8Array {
  const ids = getDictValue(trailer, "ID");
  if (
    !Array.isArray(ids) ||
    isPdfDict(ids) ||
    ids.length === 0 ||
    !isPdfString(ids[0])
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_ENCRYPTION,
      "Encrypted PDF is missing a valid file identifier.",
    );
  }

  return latin1Bytes(ids[0].value);
}

function decryptParsedObjects(
  objects: ReadonlyMap<number, ParsedPdfIndirectObject>,
  encryption: ParsedDocumentEncryption,
): Map<number, ParsedPdfIndirectObject> {
  const decrypted = new Map<number, ParsedPdfIndirectObject>();
  for (const [objectId, object] of objects) {
    if (
      objectId === encryption.encryptObjectId ||
      (isPdfStream(object.value) &&
        getNameValue(object.value.dict, "Type") === "XRef")
    ) {
      decrypted.set(objectId, object);
      continue;
    }

    decrypted.set(objectId, {
      ...object,
      value: decryptPdfValueForObject(
        object.value,
        encryption.context,
        object.id,
        object.generation,
      ),
    });
  }

  return decrypted;
}

function decryptPdfValueForObject(
  value: PdfValue,
  encryption: PdfEncryptionContext,
  objectId: number,
  generation: number,
): PdfValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    if (isPdfDict(value)) {
      return value.map(
        ([key, entryValue]) =>
          [
            key,
            decryptPdfValueForObject(
              entryValue,
              encryption,
              objectId,
              generation,
            ),
          ] as [string, PdfValue],
      );
    }

    return value.map((entry) =>
      decryptPdfValueForObject(entry, encryption, objectId, generation),
    );
  }

  if (isPdfStream(value)) {
    return {
      kind: "stream",
      dict: value.dict.map(
        ([key, entryValue]) =>
          [
            key,
            decryptPdfValueForObject(
              entryValue,
              encryption,
              objectId,
              generation,
            ),
          ] as [string, PdfValue],
      ),
      bytes: decryptBytesForObject(
        encryption,
        objectId,
        generation,
        value.bytes,
      ),
    };
  }

  if (isPdfString(value)) {
    return {
      kind: "string",
      value: decodeLatin1(
        decryptBytesForObject(
          encryption,
          objectId,
          generation,
          latin1Bytes(value.value),
        ),
      ),
    };
  }

  return value;
}

function compareVersionStrings(a: string, b: string): number {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  if (am !== bm) return (am ?? 0) - (bm ?? 0);
  return (an ?? 0) - (bn ?? 0);
}

function parseHeaderVersion(bytes: Uint8Array): string {
  let start = 0;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    start = 3;
  }
  const header = decodeLatin1(bytes.slice(start, Math.min(bytes.length, start + 32)));
  const match = /%PDF-(\d+\.\d+)/.exec(header);
  if (!match?.[1]) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "PDF header not found.");
  }

  return match[1];
}

function findStartXref(bytes: Uint8Array): number {
  const text = decodeLatin1(bytes);
  const hasEof = /\s*%%EOF\s*$/.test(text);
  const marker = "startxref";
  const index = text.lastIndexOf(marker);
  if (index === -1) {
    if (!hasEof) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "PDF appears truncated: missing %%EOF marker and startxref section.",
      );
    }
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "startxref section not found.",
    );
  }

  const match = /startxref\s+(\d+)/.exec(text.slice(index));
  if (!match?.[1]) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "startxref offset is missing.",
    );
  }

  const offset = Number(match[1]);
  if (offset < 0 || offset >= bytes.length) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "startxref offset is out of file bounds.",
    );
  }

  return offset;
}

function parseClassicXrefSection(
  bytes: Uint8Array,
  offset: number,
): ParsedXrefSection {
  const parser = new ValueParser(bytes, offset);
  parser.skipWhitespaceAndComments();
  if (!parser.consumeKeyword("xref")) {
    throw new PdfEngineError(
      PdfErrorCode.UNSUPPORTED_XREF_FORMAT,
      "Only classic xref tables are supported.",
    );
  }

  const offsets = new Map<number, number>();
  const compressed = new Map<number, XrefCompressedEntry>();
  const free = new Set<number>();
  while (true) {
    parser.skipWhitespaceAndComments();
    if (parser.consumeKeyword("trailer")) {
      break;
    }

    const startObject = parser.parseInteger();
    parser.skipWhitespaceAndComments();
    const count = parser.parseInteger();
    parser.skipWhitespaceAndComments();

    for (let index = 0; index < count; index += 1) {
      const line = parser.readLine().trim();
      const parts = line.split(/\s+/);
      if (parts.length < 3) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_PDF,
          "Malformed xref entry.",
          { line },
        );
      }

      if (parts[2] === "n") {
        offsets.set(startObject + index, Number(parts[0]));
      } else if (parts[2] === "f") {
        free.add(startObject + index);
      }
    }
  }

  const trailerValue = parser.parseValue();
  if (!Array.isArray(trailerValue) || !isPdfDict(trailerValue)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "PDF trailer must be a dictionary.",
    );
  }

  return {
    offsets,
    compressed,
    free,
    trailer: trailerValue,
  };
}

function parseXrefStreamSection(
  bytes: Uint8Array,
  offset: number,
): ParsedXrefSection {
  const object = parseIndirectObject(bytes, offset);
  if (
    !isPdfStream(object.value) ||
    getNameValue(object.value.dict, "Type") !== "XRef"
  ) {
    throw new PdfEngineError(
      PdfErrorCode.UNSUPPORTED_XREF_FORMAT,
      "Unsupported xref section at startxref offset.",
      {
        offset,
      },
    );
  }

  const size = getDictValue(object.value.dict, "Size");
  if (typeof size !== "number") {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "XRef stream is missing Size.",
    );
  }

  const widths = getArrayNumbers(getDictValue(object.value.dict, "W"));
  if (!widths || widths.length < 3) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "XRef stream is missing a valid W array.",
    );
  }

  const index = getArrayNumbers(getDictValue(object.value.dict, "Index")) ?? [
    0,
    size,
  ];
  if (index.length % 2 !== 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "XRef stream Index array must contain pairs.",
    );
  }

  const decoded = decodePdfStreamBytes(object.value, "xref stream");
  const entryLength = widths[0]! + widths[1]! + widths[2]!;
  if (entryLength <= 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "XRef stream entry width must be greater than zero.",
    );
  }

  const offsets = new Map<number, number>();
  const compressed = new Map<number, XrefCompressedEntry>();
  const free = new Set<number>();
  let cursor = 0;

  for (let pairIndex = 0; pairIndex < index.length; pairIndex += 2) {
    const startObject = index[pairIndex]!;
    const count = index[pairIndex + 1]!;

    for (let objectIndex = 0; objectIndex < count; objectIndex += 1) {
      if (cursor + entryLength > decoded.length) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_PDF,
          "XRef stream ended before all entries were read.",
          {
            cursor,
            entryLength,
            decodedLength: decoded.length,
          },
        );
      }

      const type =
        widths[0] === 0 ? 1 : readBigEndian(decoded, cursor, widths[0]!);
      const field2 = readBigEndian(decoded, cursor + widths[0]!, widths[1]!);
      const field3 = readBigEndian(
        decoded,
        cursor + widths[0]! + widths[1]!,
        widths[2]!,
      );
      const objectId = startObject + objectIndex;

      if (type === 0) {
        free.add(objectId);
      } else if (type === 1) {
        offsets.set(objectId, field2);
      } else if (type === 2) {
        compressed.set(objectId, {
          objectStreamId: field2,
          index: field3,
        });
      } else {
        throw new PdfEngineError(
          PdfErrorCode.UNSUPPORTED_XREF_FORMAT,
          "Unsupported xref stream entry type.",
          {
            type,
            objectId,
          },
        );
      }

      cursor += entryLength;
    }
  }

  return {
    offsets,
    compressed,
    free,
    trailer: object.value.dict,
  };
}

function parseXrefSection(
  bytes: Uint8Array,
  offset: number,
): ParsedXrefSection {
  const parser = new ValueParser(bytes, offset);
  parser.skipWhitespaceAndComments();
  if (parser.consumeKeyword("xref")) {
    return parseClassicXrefSection(bytes, offset);
  }

  try {
    return parseXrefStreamSection(bytes, offset);
  } catch (error) {
    if (
      error instanceof PdfEngineError &&
      error.code === PdfErrorCode.UNSUPPORTED_XREF_FORMAT
    ) {
      const recovered = findXrefBefore(bytes, offset);
      if (recovered !== undefined) {
        return parseXrefSection(bytes, recovered);
      }
    }
    throw error;
  }
}

function findXrefBefore(bytes: Uint8Array, offset: number): number | undefined {
  const keyword = encodeAscii("xref");
  for (let i = offset - 1; i >= 0; i -= 1) {
    if (i + keyword.length > offset) {
      continue;
    }
    let matches = true;
    for (let j = 0; j < keyword.length; j += 1) {
      if (bytes[i + j] !== keyword[j]) {
        matches = false;
        break;
      }
    }
    if (matches && (i === 0 || isWhitespace(bytes[i - 1]!))) {
      return i;
    }
  }
  return undefined;
}

function parseXrefChain(
  bytes: Uint8Array,
  offset: number,
): {
  /** Offsets. */
  offsets: Map<number, number>; /** Compressed. */
  compressed: Map<number, XrefCompressedEntry>; /** Trailer. */
  trailer: PdfDict;
} {
  const sections: ParsedXrefSection[] = [];
  const visited = new Set<number>();
  let currentOffset: number | undefined = offset;

  while (currentOffset !== undefined) {
    if (visited.has(currentOffset)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Circular Prev chain found in xref sections.",
        {
          offset: currentOffset,
        },
      );
    }

    visited.add(currentOffset);
    const section = parseXrefSection(bytes, currentOffset);
    sections.push(section);

    const prev = getDictValue(section.trailer, "Prev");
    if (prev === undefined) {
      currentOffset = undefined;
    } else if (typeof prev === "number") {
      currentOffset = prev;
    } else {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Trailer Prev entry must be a number.",
        { prev },
      );
    }
  }

  const offsets = new Map<number, number>();
  const compressed = new Map<number, XrefCompressedEntry>();
  let trailer: PdfDict = [];
  for (const section of [...sections].reverse()) {
    trailer = mergePdfDicts(trailer, section.trailer);
    for (const objectId of section.free) {
      offsets.delete(objectId);
      compressed.delete(objectId);
    }
    for (const [objectId, objectOffset] of section.offsets) {
      offsets.set(objectId, objectOffset);
      compressed.delete(objectId);
    }
    for (const [objectId, entry] of section.compressed) {
      compressed.set(objectId, entry);
      offsets.delete(objectId);
    }
  }

  return {
    offsets,
    compressed,
    trailer,
  };
}

function createStreamLengthResolver(
  bytes: Uint8Array,
  offsets: ReadonlyMap<number, number>,
): StreamLengthResolver {
  const cache = new Map<number, number | undefined>();
  const resolving = new Set<number>();

  return (refValue: PdfRef): number | undefined => {
    if (refValue.generation !== 0) {
      return undefined;
    }

    if (cache.has(refValue.objectId)) {
      return cache.get(refValue.objectId);
    }

    const offset = offsets.get(refValue.objectId);
    if (offset === undefined || resolving.has(refValue.objectId)) {
      cache.set(refValue.objectId, undefined);
      return undefined;
    }

    resolving.add(refValue.objectId);
    try {
      const object = parseIndirectObject(bytes, offset);
      const length =
        typeof object.value === "number" &&
        Number.isInteger(object.value) &&
        object.value >= 0
          ? object.value
          : undefined;
      cache.set(refValue.objectId, length);
      return length;
    } finally {
      resolving.delete(refValue.objectId);
    }
  };
}

function parseIndirectObject(
  bytes: Uint8Array,
  offset: number,
  resolveStreamLength?: StreamLengthResolver,
): ParsedPdfIndirectObject {
  const parser = new ValueParser(bytes, offset);
  const id = parser.parseInteger();
  parser.skipWhitespaceAndComments();
  const generation = parser.parseInteger();
  parser.skipWhitespaceAndComments();
  parser.expectKeyword("obj");

  const value = parser.parseValue();
  parser.skipWhitespaceAndComments();

  let finalValue = value;
  if (
    Array.isArray(value) &&
    isPdfDict(value) &&
    parser.consumeKeyword("stream")
  ) {
    parser.consumeSingleEol();

    const lengthValue = getDictValue(value, "Length");
    let streamBytes: Uint8Array;
    const resolvedLength = resolveStreamLengthValue(
      lengthValue,
      resolveStreamLength,
    );
    if (resolvedLength !== undefined) {
      const maxAvailable = bytes.length - parser.position;
      if (resolvedLength > maxAvailable) {
        debugLog(
          `Stream length (${resolvedLength}) exceeds remaining bytes (${maxAvailable}) at offset ${parser.position}; clamping to available bytes.`,
        );
        streamBytes = bytes.slice(parser.position, parser.position + maxAvailable);
        parser.position += maxAvailable;
      } else {
        streamBytes = bytes.slice(
          parser.position,
          parser.position + resolvedLength,
        );
        parser.position += resolvedLength;
      }
      const endstreamSearch = findKeyword(
        bytes,
        parser.position,
        "endstream",
      );
      if (endstreamSearch === -1) {
        debugLog(
          `Stream endstream marker not found after declared stream length at offset ${parser.position}.`,
        );
      } else if (endstreamSearch < parser.position + 100) {
        const extraBytes = endstreamSearch - parser.position;
        if (extraBytes > 0) {
          debugLog(
            `Stream length mismatch: declared ${resolvedLength} bytes, but endstream found ${extraBytes} bytes later; using declared length.`,
          );
        }
        parser.position = endstreamSearch;
      }
    } else {
      const endstream = findKeyword(bytes, parser.position, "endstream");
      if (endstream === -1) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_PDF,
          "Stream terminator not found.",
          { objectId: id },
        );
      }
      streamBytes = bytes.slice(
        parser.position,
        trimTrailingLineBreak(bytes, parser.position, endstream),
      );
      parser.position = endstream;
    }

    parser.skipWhitespaceAndComments();
    parser.expectKeyword("endstream");
    finalValue = {
      kind: "stream",
      dict: value,
      bytes: streamBytes,
    } satisfies PdfStream;
    parser.skipWhitespaceAndComments();
  }

  if (!parser.consumeKeyword("endobj")) {
    parser.skipWhitespaceAndComments();
    if (parser.position < bytes.length) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        `Expected keyword "endobj".`,
        {
          position: parser.position,
        },
      );
    }
  }

  return {
    id,
    generation,
    offset,
    value: finalValue,
  };
}

function resolveStreamLengthValue(
  lengthValue: PdfValue | undefined,
  resolveStreamLength: StreamLengthResolver | undefined,
): number | undefined {
  if (
    typeof lengthValue === "number" &&
    Number.isInteger(lengthValue) &&
    lengthValue >= 0
  ) {
    return lengthValue;
  }

  if (isPdfRef(lengthValue) && resolveStreamLength) {
    return resolveStreamLength(lengthValue);
  }

  return undefined;
}

function parseObjectStream(
  bytes: Uint8Array,
  objectStream: ParsedPdfIndirectObject,
  cache: Map<
    number,
    Map<
      number,
      {
        /** Current or default value for the option. */
        value: PdfValue; /** Index. */
        index: number;
      }
    >
  >,
): Map<
  number,
  {
    /** Current or default value for the option. */
    value: PdfValue; /** Index. */
    index: number;
  }
> {
  const cached = cache.get(objectStream.id);
  if (cached) {
    return cached;
  }

  if (
    !isPdfStream(objectStream.value) ||
    getNameValue(objectStream.value.dict, "Type") !== "ObjStm"
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "Referenced compressed object stream is invalid.",
      {
        objectStreamId: objectStream.id,
      },
    );
  }

  const count = getDictValue(objectStream.value.dict, "N");
  const first = getDictValue(objectStream.value.dict, "First");
  if (typeof count !== "number" || typeof first !== "number") {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "Object stream is missing N or First metadata.",
      {
        objectStreamId: objectStream.id,
      },
    );
  }

  const decoded = decodePdfStreamBytes(objectStream.value, "object stream");
  const headerParser = new ValueParser(decoded, 0);
  const entries: Array<{
    /** PDF indirect object number for the parsed item. */
    objectId: number; /** Byte offset where the indirect object was parsed. */
    offset: number;
  }> = [];

  for (let index = 0; index < count; index += 1) {
    headerParser.skipWhitespaceAndComments();
    const objectId = headerParser.parseInteger();
    headerParser.skipWhitespaceAndComments();
    const objectOffset = headerParser.parseInteger();
    entries.push({ objectId, offset: objectOffset });
  }

  const values = new Map<
    number,
    {
      /** Current or default value for the option. */
      value: PdfValue; /** Index. */
      index: number;
    }
  >();
  for (const [index, entry] of entries.entries()) {
    const parser = new ValueParser(decoded, first + entry.offset);
    const parsedValue = parser.parseValue();
    if (
      isPdfStream(parsedValue) &&
      getNameValue(parsedValue.dict, "Type") === "ObjStm"
    ) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Nested object streams are not allowed.",
        {
          objectStreamId: objectStream.id,
          nestedObjectId: entry.objectId,
        },
      );
    }
    values.set(entry.objectId, {
      value: parsedValue,
      index,
    });
  }

  cache.set(objectStream.id, values);
  return values;
}

/**
 * Decodes a stream's bytes, tolerating a stream object whose bytes were already
 * inflated by {@link ParsedPdfDocument.getObject} while its dict still advertises
 * a Filter. A second decode of already-decoded bytes throws, in which case the
 * bytes are already plain and returned as-is. Best-effort: also returns the raw
 * bytes for genuinely undecodable streams.
 */
function decodeStreamBytesLenient(streamValue: PdfStream, context: string): Uint8Array {
  try {
    return decodePdfStreamBytes(streamValue, context);
  } catch {
    return streamValue.bytes;
  }
}

function decodePdfStreamBytes(
  streamValue: PdfStream,
  context: string,
): Uint8Array {
  const filter = getDictValue(streamValue.dict, "Filter");
  if (filter === undefined) {
    return streamValue.bytes;
  }

  const filterNames = readFilterNames(filter);
  if (filterNames.length !== 1 || filterNames[0] !== "FlateDecode") {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      `Unsupported filter configuration for ${context}.`,
      {
        filters: filterNames,
      },
    );
  }

  try {
    const inflated = inflateZlib(streamValue.bytes);
    return applyDecodePredictor(inflated, streamValue.dict);
  } catch (error) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      `Unable to decode ${context}.`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

function applyDecodePredictor(bytes: Uint8Array, dict: PdfDict): Uint8Array {
  const decodeParms = resolveDecodeParams(dict);
  const predictor = getNumericDictValue(decodeParms, "Predictor") ?? 1;
  if (predictor === 1) {
    return bytes;
  }

  const columns = getNumericDictValue(decodeParms, "Columns") ?? 1;
  if (columns <= 0 || !Number.isInteger(columns)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "Decode predictor Columns must be a positive integer.",
      {
        columns,
      },
    );
  }

  if (predictor === 2) {
    return applyTiffPredictor(bytes, columns);
  }

  if (predictor >= 10 && predictor <= 15) {
    return applyPngPredictor(bytes, columns, predictor);
  }

  throw new PdfEngineError(
    PdfErrorCode.INVALID_PDF,
    "Unsupported stream decode predictor.",
    {
      predictor,
    },
  );
}

function resolveDecodeParams(dict: PdfDict): PdfDict | undefined {
  const decodeParms =
    getDictValue(dict, "DecodeParms") ?? getDictValue(dict, "DP");
  if (Array.isArray(decodeParms) && isPdfDict(decodeParms)) {
    return decodeParms;
  }
  if (Array.isArray(decodeParms) && !isPdfDict(decodeParms)) {
    const first = decodeParms[0];
    return Array.isArray(first) && isPdfDict(first) ? first : undefined;
  }
  return undefined;
}

function getNumericDictValue(
  dict: PdfDict | undefined,
  key: string,
): number | undefined {
  const value = dict ? getDictValue(dict, key) : undefined;
  return typeof value === "number" ? value : undefined;
}

function applyTiffPredictor(bytes: Uint8Array, columns: number): Uint8Array {
  const output = bytes.slice();
  for (let rowStart = 0; rowStart < output.length; rowStart += columns) {
    const rowEnd = Math.min(rowStart + columns, output.length);
    for (let index = rowStart + 1; index < rowEnd; index += 1) {
      output[index] = (output[index]! + output[index - 1]!) & 0xff;
    }
  }
  return output;
}

function applyPngPredictor(
  bytes: Uint8Array,
  columns: number,
  predictor: number,
): Uint8Array {
  const hasRowFilters = predictor >= 10;
  const rowLength = hasRowFilters ? columns + 1 : columns;
  const rows = Math.ceil(bytes.length / rowLength);
  const output = new Uint8Array(rows * columns);
  let inputCursor = 0;
  let outputCursor = 0;
  const previous = new Uint8Array(columns);

  while (inputCursor < bytes.length) {
    const encodedFilter = hasRowFilters
      ? bytes[inputCursor++]!
      : predictor - 10;
    const filter = predictor === 15 ? encodedFilter : predictor - 10;
    if (predictor !== 15 && encodedFilter !== filter) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "PNG predictor row filter does not match the stream predictor.",
        {
          predictor,
          filter: encodedFilter,
        },
      );
    }
    const current = new Uint8Array(columns);
    for (
      let column = 0;
      column < columns && inputCursor < bytes.length;
      column += 1
    ) {
      const raw = bytes[inputCursor++]!;
      const left = column > 0 ? current[column - 1]! : 0;
      const up = previous[column]!;
      const upLeft = column > 0 ? previous[column - 1]! : 0;
      switch (filter) {
        case 0:
          current[column] = raw;
          break;
        case 1:
          current[column] = (raw + left) & 0xff;
          break;
        case 2:
          current[column] = (raw + up) & 0xff;
          break;
        case 3:
          current[column] = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          current[column] = (raw + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new PdfEngineError(
            PdfErrorCode.INVALID_PDF,
            "Unsupported PNG predictor row filter.",
            { filter },
          );
      }
    }
    output.set(current, outputCursor);
    previous.set(current);
    outputCursor += columns;
  }

  return output.slice(0, outputCursor);
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function readFilterNames(value: PdfValue): string[] {
  if (isPdfName(value)) {
    return [value.value];
  }

  if (Array.isArray(value) && !isPdfDict(value)) {
    return value
      .filter(
        (
          entry,
        ): entry is {
          /** Discriminator identifying this value shape. */
          kind: "name"; /** Current or default value for the option. */
          value: string;
        } => isPdfName(entry),
      )
      .map((entry) => entry.value);
  }

  return [];
}

function readBigEndian(
  bytes: Uint8Array,
  offset: number,
  width: number,
): number {
  let value = 0;
  for (let index = 0; index < width; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Unexpected end of binary xref entry.",
        {
          offset,
          width,
        },
      );
    }
    value = value * 256 + byte;
  }
  return value;
}

/**
 *
 * An internal parser for reading individual PDF primitive values from a byte buffer. It handles whitespace, comments, dictionaries, arrays, names, strings, numbers, booleans, nulls, and references.
 *
 * @class ValueParser
 */
class ValueParser {
  /**
   * Creates a primitive value parser starting at the supplied byte position.
   *
   * @param bytes The source bytes to read.
   * @param position The starting byte position.
   */
  constructor(
    private readonly bytes: Uint8Array,
    public position: number,
  ) {}

  /**
   * Moves the cursor past PDF whitespace and comment lines.
   */
  skipWhitespaceAndComments(): void {
    while (this.position < this.bytes.length) {
      const byte = this.bytes[this.position];
      if (byte === undefined) {
        return;
      }

      if (isWhitespace(byte)) {
        this.position += 1;
        continue;
      }

      if (byte === 0x25) {
        this.readLine();
        continue;
      }

      return;
    }
  }

  /**
   * Parses the next PDF primitive value at the current cursor.
   *
   * @returns The parsed PDF value.
   */
  parseValue(): PdfValue {
    this.skipWhitespaceAndComments();
    const byte = this.bytes[this.position];
    if (byte === undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Unexpected end of PDF value.",
      );
    }

    if (byte === 0x3c && this.bytes[this.position + 1] === 0x3c) {
      return this.parseDict();
    }

    if (byte === 0x5b) {
      return this.parseArray();
    }

    if (byte === 0x2f) {
      return { kind: "name", value: this.parseName() };
    }

    if (byte === 0x28) {
      return { kind: "string", value: this.parseLiteralString() };
    }

    if (byte === 0x3c) {
      return { kind: "string", value: this.parseHexString() };
    }

    if (isDigit(byte) || byte === 0x2d || byte === 0x2b || byte === 0x2e) {
      return this.parseNumberOrRef();
    }

    if (this.consumeKeyword("true")) {
      return true;
    }

    if (this.consumeKeyword("false")) {
      return false;
    }

    if (this.consumeKeyword("null")) {
      return null;
    }

    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "Unsupported PDF token.",
      {
        position: this.position,
        byte,
      },
    );
  }

  /**
   * Parses the next token as an integer.
   *
   * @returns The parsed integer.
   */
  parseInteger(): number {
    const token = this.parseNumberToken();
    if (!/^[+-]?\d+$/.test(token)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Expected an integer token.",
        { token },
      );
    }

    return Number(token);
  }

  /**
   * Consumes a keyword at the current cursor when it matches.
   *
   * @param keyword The keyword to consume.
   *
   * @returns True when the keyword was consumed.
   */
  consumeKeyword(keyword: string): boolean {
    this.skipWhitespaceAndComments();
    const bytes = encodeAscii(keyword);
    for (let index = 0; index < bytes.length; index += 1) {
      if (this.bytes[this.position + index] !== bytes[index]) {
        return false;
      }
    }

    this.position += bytes.length;
    return true;
  }

  /**
   * Consumes a required keyword or throws when it is absent.
   *
   * @param keyword The keyword to consume.
   */
  expectKeyword(keyword: string): void {
    if (!this.consumeKeyword(keyword)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        `Expected keyword "${keyword}".`,
        {
          position: this.position,
        },
      );
    }
  }

  /**
   * Reads a line of Latin-1 text and consumes one trailing end-of-line marker.
   *
   * @returns The decoded line.
   */
  readLine(): string {
    const start = this.position;
    while (this.position < this.bytes.length) {
      const byte = this.bytes[this.position];
      if (byte === 0x0a || byte === 0x0d) {
        break;
      }
      this.position += 1;
    }

    const line = decodeLatin1(this.bytes.slice(start, this.position));
    this.consumeSingleEol();
    return line;
  }

  /**
   * Consumes a single CR, LF, or CRLF sequence at the current cursor.
   */
  consumeSingleEol(): void {
    const first = this.bytes[this.position];
    const second = this.bytes[this.position + 1];
    if (first === 0x0d && second === 0x0a) {
      this.position += 2;
    } else if (first === 0x0a || first === 0x0d) {
      this.position += 1;
    }
  }

  /**
   * Parses a PDF dictionary.
   *
   * @returns The parsed dictionary.
   */
  private parseDict(): PdfDict {
    this.position += 2;
    const entries: PdfDict = [];

    while (true) {
      this.skipWhitespaceAndComments();
      if (
        this.bytes[this.position] === 0x3e &&
        this.bytes[this.position + 1] === 0x3e
      ) {
        this.position += 2;
        return entries;
      }

      if (this.bytes[this.position] !== 0x2f) {
        throw new PdfEngineError(
          PdfErrorCode.INVALID_PDF,
          "Dictionary keys must be names.",
          {
            position: this.position,
          },
        );
      }

      const key = this.parseName();
      const value = this.parseValue();
      entries.push([key, value]);
    }
  }

  /**
   * Parses a PDF array.
   *
   * @returns The parsed array.
   */
  private parseArray(): PdfValue[] {
    this.position += 1;
    const items: PdfValue[] = [];

    while (true) {
      this.skipWhitespaceAndComments();
      if (this.bytes[this.position] === 0x5d) {
        this.position += 1;
        return items;
      }

      items.push(this.parseValue());
    }
  }

  /**
   * Parses a PDF name object and decodes hexadecimal name escapes.
   *
   * @returns The parsed name.
   */
  private parseName(): string {
    this.position += 1;
    const start = this.position;
    while (this.position < this.bytes.length) {
      const byte = this.bytes[this.position];
      if (
        byte === undefined ||
        isWhitespace(byte) ||
        byte === 0x2f ||
        byte === 0x3c ||
        byte === 0x3e ||
        byte === 0x5b ||
        byte === 0x5d ||
        byte === 0x28 ||
        byte === 0x29
      ) {
        break;
      }
      this.position += 1;
    }

    const raw = decodeLatin1(this.bytes.slice(start, this.position));
    return raw.replaceAll(/#([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }

  /**
   * Parses a parenthesized PDF literal string.
   *
   * @returns The parsed string.
   */
  private parseLiteralString(): string {
    this.position += 1;
    let depth = 1;
    let output = "";

    while (this.position < this.bytes.length) {
      const byte = this.bytes[this.position];
      this.position += 1;

      if (byte === 0x5c) {
        const escaped = this.bytes[this.position];
        if (escaped === undefined) {
          break;
        }
        this.position += 1;
        output += decodeEscape(escaped);
        continue;
      }

      if (byte === 0x28) {
        depth += 1;
      } else if (byte === 0x29) {
        depth -= 1;
        if (depth === 0) {
          return output;
        }
      }

      output += String.fromCharCode(byte ?? 0);
    }

    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "Unterminated literal string.",
    );
  }

  /**
   * Parses a hexadecimal PDF string.
   *
   * @returns The parsed string.
   */
  private parseHexString(): string {
    this.position += 1;
    const start = this.position;
    while (
      this.position < this.bytes.length &&
      this.bytes[this.position] !== 0x3e
    ) {
      this.position += 1;
    }

    if (this.bytes[this.position] !== 0x3e) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Unterminated hex string.",
      );
    }

    const raw = decodeLatin1(this.bytes.slice(start, this.position)).replace(
      /\s+/g,
      "",
    );
    this.position += 1;

    const normalized = raw.length % 2 === 0 ? raw : `${raw}0`;
    let output = "";
    for (let index = 0; index < normalized.length; index += 2) {
      output += String.fromCharCode(
        Number.parseInt(normalized.slice(index, index + 2), 16),
      );
    }
    return output;
  }

  /**
   * Parses a number token and upgrades it to an indirect reference when followed by generation and R tokens.
   *
   * @returns The parsed number or reference.
   */
  private parseNumberOrRef(): PdfValue {
    const start = this.position;
    const firstToken = this.parseNumberToken();
    const first = Number(firstToken);
    const checkpoint = this.position;

    this.skipWhitespaceAndComments();
    const maybeSecond = this.peekNumberToken();
    if (
      /^[+-]?\d+$/.test(firstToken) &&
      maybeSecond &&
      /^[+-]?\d+$/.test(maybeSecond)
    ) {
      const secondToken = this.parseNumberToken();
      this.skipWhitespaceAndComments();
      if (this.consumeKeyword("R")) {
        return {
          kind: "ref",
          objectId: Number(firstToken),
          generation: Number(secondToken),
        } satisfies PdfRef;
      }
    }

    this.position = checkpoint;
    if (!Number.isFinite(first)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Invalid number token.",
        { token: firstToken, start },
      );
    }
    return first;
  }

  /**
   * Parses a PDF numeric token.
   *
   * @returns The parsed number token.
   */
  private parseNumberToken(): string {
    const start = this.position;
    while (this.position < this.bytes.length) {
      const byte = this.bytes[this.position];
      if (
        byte === undefined ||
        isWhitespace(byte) ||
        byte === 0x2f ||
        byte === 0x3c ||
        byte === 0x3e ||
        byte === 0x5b ||
        byte === 0x5d ||
        byte === 0x28 ||
        byte === 0x29
      ) {
        break;
      }
      this.position += 1;
    }

    return decodeLatin1(this.bytes.slice(start, this.position));
  }

  /**
   * Reads a numeric token from the current cursor without advancing the parser.
   *
   * @returns The peeked number token, if present.
   */
  private peekNumberToken(): string | undefined {
    const saved = this.position;
    try {
      const token = this.parseNumberToken();
      return token.length > 0 ? token : undefined;
    } finally {
      this.position = saved;
    }
  }
}

function reorderRunsByStructureTree(
  document: ParsedPdfDocument,
  runs: readonly PositionedTextRun[],
): PositionedTextRun[] {
  // Walk the structure tree and collect MCIDs in document order.
  const catalog = getCatalogDict(document);
  const structRoot = resolveDict(document, getDictValue(catalog, "StructTreeRoot"));
  if (!structRoot) return [...runs];

  const orderedMcids: number[] = [];
  const visit = (value: PdfValue | undefined): void => {
    if (value === undefined) return;
    if (typeof value === "number") {
      orderedMcids.push(value);
      return;
    }
    if (Array.isArray(value)) {
      if (isPdfDict(value)) {
        // dict — could be MCR or OBJR
        const type = getNameValue(value, "Type");
        if (type === "MCR") {
          const mcid = getNumberValue(value, "MCID");
          if (mcid !== undefined) orderedMcids.push(mcid);
          return;
        }
        // StructElem-like; recurse into K
        const k = getDictValue(value, "K");
        visit(resolveValue(document, k));
        return;
      }
      for (const item of value) visit(resolveValue(document, item));
      return;
    }
    if (value !== null && typeof value === "object" && "kind" in value && (value as { kind: string }).kind === "ref") {
      visit(resolveValue(document, value));
    }
  };
  visit(resolveValue(document, getDictValue(structRoot, "K")));

  if (orderedMcids.length === 0) return [...runs];

  // Index runs by MCID; preserve stream order within an MCID bucket.
  const byMcid = new Map<number, PositionedTextRun[]>();
  const noMcid: PositionedTextRun[] = [];
  for (const run of runs) {
    if (run.mcid === undefined) {
      noMcid.push(run);
    } else {
      const bucket = byMcid.get(run.mcid) ?? [];
      bucket.push(run);
      byMcid.set(run.mcid, bucket);
    }
  }
  const ordered: PositionedTextRun[] = [];
  for (const mcid of orderedMcids) {
    const bucket = byMcid.get(mcid);
    if (bucket) ordered.push(...bucket);
  }
  // Append untagged content at the end so it isn't lost.
  ordered.push(...noMcid);
  return ordered;
}

function readPageContentStreams(document: ParsedPdfDocument, page: ParsedPdfPage): string {
  const parts: string[] = [];
  for (const contentObjectId of page.contentObjectIds) {
    const object = document.getObject(contentObjectId);
    if (!object || !isPdfStream(object.value)) continue;
    // getObject() may have already inflated a lazy stream while leaving its
    // Filter in the dict; decodeStreamBytesLenient handles that double-decode.
    parts.push(decodeLatin1(decodeStreamBytesLenient(object.value, "page content stream")));
  }
  return parts.join("\n");
}

function collectPageFonts(document: ParsedPdfDocument, resources: PdfDict | undefined): Map<string, FontState> {
  const out = new Map<string, FontState>();
  if (!resources) return out;
  const fontDict = resolveDict(document, getDictValue(resources, "Font"));
  if (!fontDict) return out;
  for (const [resourceName, fontRef] of fontDict) {
    const font = resolveDict(document, fontRef);
    if (!font) continue;
    const subtype = getNameValue(font, "Subtype");
    const twoByteCodes = subtype === "Type0";

    // ToUnicode CMap.
    const toUnicodeRef = getDictValue(font, "ToUnicode");
    let toUnicode: Map<number, string> | undefined;
    let codeRanges: readonly { byteLen: number; lo: number; hi: number }[] | undefined;
    if (isPdfRef(toUnicodeRef)) {
      const cmapObject = document.getObject(toUnicodeRef.objectId);
      if (cmapObject && isPdfStream(cmapObject.value)) {
        try {
          const source = decodeLatin1(decodeStreamBytesLenient(cmapObject.value, "ToUnicode CMap"));
          const parsed = parseToUnicodeCMap(source);
          toUnicode = parsed;
          if (parsed.codeRanges.length > 0) codeRanges = parsed.codeRanges;
        } catch {
          // Best-effort.
        }
      }
    }

    // Widths + encoding depend on font kind.
    const widths = new Map<number, number>();
    let defaultWidth: number | undefined;
    let encoding: ReadonlyArray<number | undefined> | undefined;

    let identityHFallback = false;
    let verticalMode = false;
    const verticalWidths = new Map<number, number>();
    const verticalOrigins = new Map<number, { vx: number; vy: number }>();
    let defaultVerticalWidth: number | undefined;
    let defaultVerticalOrigin: { vx: number; vy: number } | undefined;

    if (twoByteCodes) {
      // Identity-H/V detection from /Encoding (PDF spec § 9.7.5).
      const encodingValue = resolveValue(document, getDictValue(font, "Encoding"));
      const encodingName =
        encodingValue && typeof encodingValue === "object" && "kind" in encodingValue
        && (encodingValue as { kind: string }).kind === "name"
          ? (encodingValue as { value: string }).value
          : undefined;
      if (encodingName === "Identity-H" || encodingName === "Identity-V") {
        identityHFallback = true;
      }
      if (encodingName === "Identity-V") {
        verticalMode = true;
      }

      // DescendantFonts[0]: read /DW, /W, /DW2, /W2.
      const descendants = resolveValue(document, getDictValue(font, "DescendantFonts"));
      if (Array.isArray(descendants) && !isPdfDict(descendants)) {
        const cidFont = resolveDict(document, descendants[0]);
        if (cidFont) {
          const dw = getNumberValue(cidFont, "DW");
          if (dw !== undefined) defaultWidth = dw;
          const wArray = resolveValue(document, getDictValue(cidFont, "W"));
          if (Array.isArray(wArray) && !isPdfDict(wArray)) {
            parseCidWidthArray(wArray, widths);
          }
          const dw2 = resolveValue(document, getDictValue(cidFont, "DW2"));
          if (Array.isArray(dw2) && !isPdfDict(dw2)) {
            // [v_y_origin v_advance] per spec
            const yOrigin = dw2[0];
            const adv = dw2[1];
            if (typeof adv === "number") defaultVerticalWidth = adv;
            if (typeof yOrigin === "number") {
              defaultVerticalOrigin = { vx: 500, vy: yOrigin };
            }
          }
          const w2Array = resolveValue(document, getDictValue(cidFont, "W2"));
          if (Array.isArray(w2Array) && !isPdfDict(w2Array)) {
            parseCidVerticalWidthArray(w2Array, verticalWidths, verticalOrigins);
          }
        }
      }

      // CMap-derived WMode override: if ToUnicode CMap declares /WMode 1
      // it doesn't actually mean the *font* is vertical, so we trust only
      // the Identity-V signal above for fallback decoding.
    } else {
      // Simple font: /FirstChar, /LastChar, /Widths
      const firstChar = getNumberValue(font, "FirstChar");
      const widthsArr = resolveValue(document, getDictValue(font, "Widths"));
      if (firstChar !== undefined && Array.isArray(widthsArr) && !isPdfDict(widthsArr)) {
        for (let i = 0; i < widthsArr.length; i += 1) {
          const w = widthsArr[i];
          if (typeof w === "number") widths.set(firstChar + i, w);
        }
      }
      // /Encoding: name or dict {BaseEncoding, Differences}.
      encoding = resolveSimpleFontEncoding(document, getDictValue(font, "Encoding"));
    }

    out.set(resourceName, {
      ...(toUnicode === undefined ? {} : { toUnicode }),
      ...(codeRanges === undefined ? {} : { codeRanges }),
      twoByteCodes,
      ...(encoding === undefined ? {} : { encoding }),
      ...(identityHFallback ? { identityHFallback: true } : {}),
      ...(widths.size > 0 ? { widths } : {}),
      ...(defaultWidth === undefined ? {} : { defaultWidth }),
      ...(verticalMode ? { verticalMode: true } : {}),
      ...(verticalWidths.size > 0 ? { verticalWidths } : {}),
      ...(defaultVerticalWidth === undefined ? {} : { defaultVerticalWidth }),
      ...(verticalOrigins.size > 0 ? { verticalOrigins } : {}),
      ...(defaultVerticalOrigin === undefined ? {} : { defaultVerticalOrigin }),
    });
  }
  return out;
}

function parseCidVerticalWidthArray(
  w2Array: readonly PdfValue[],
  widths: Map<number, number>,
  origins: Map<number, { vx: number; vy: number }>,
): void {
  // /W2 form 1: c [w_y0 v_x0 v_y0 w_y1 v_x1 v_y1 ...]
  // /W2 form 2: c_first c_last w_y v_x v_y
  let i = 0;
  while (i < w2Array.length) {
    const first = w2Array[i];
    if (typeof first !== "number") { i += 1; continue; }
    const second = w2Array[i + 1];
    if (Array.isArray(second) && !isPdfDict(second)) {
      let j = 0;
      let cid = first;
      while (j + 2 < second.length) {
        const wy = second[j];
        const vx = second[j + 1];
        const vy = second[j + 2];
        if (typeof wy === "number") widths.set(cid, wy);
        if (typeof vx === "number" && typeof vy === "number") origins.set(cid, { vx, vy });
        j += 3;
        cid += 1;
      }
      i += 2;
    } else if (typeof second === "number") {
      const last = second;
      const wy = w2Array[i + 2];
      const vx = w2Array[i + 3];
      const vy = w2Array[i + 4];
      if (typeof wy === "number") {
        for (let cid = first; cid <= last; cid += 1) widths.set(cid, wy);
      }
      if (typeof vx === "number" && typeof vy === "number") {
        for (let cid = first; cid <= last; cid += 1) origins.set(cid, { vx, vy });
      }
      i += 5;
    } else {
      i += 1;
    }
  }
}

function parseCidWidthArray(wArray: readonly PdfValue[], widths: Map<number, number>): void {
  let i = 0;
  while (i < wArray.length) {
    const first = wArray[i];
    if (typeof first !== "number") { i += 1; continue; }
    const second = wArray[i + 1];
    if (Array.isArray(second) && !isPdfDict(second)) {
      // first [widths...]
      for (let j = 0; j < second.length; j += 1) {
        const w = second[j];
        if (typeof w === "number") widths.set(first + j, w);
      }
      i += 2;
    } else if (typeof second === "number") {
      // first last width
      const width = wArray[i + 2];
      if (typeof width === "number") {
        for (let cid = first; cid <= second; cid += 1) widths.set(cid, width);
      }
      i += 3;
    } else {
      i += 1;
    }
  }
}

function resolveSimpleFontEncoding(
  document: ParsedPdfDocument,
  encodingValue: PdfValue | undefined,
): ReadonlyArray<number | undefined> | undefined {
  if (encodingValue === undefined) return undefined;
  const resolved = resolveValue(document, encodingValue);
  if (!resolved) return undefined;

  // Encoding can be a name or a dict.
  if (typeof resolved === "object" && "kind" in resolved && (resolved as { kind: string }).kind === "name") {
    return resolveBaseEncoding((resolved as { value: string }).value).slice();
  }
  if (Array.isArray(resolved) && isPdfDict(resolved)) {
    const base = getNameValue(resolved, "BaseEncoding");
    const baseTable = resolveBaseEncoding(base ?? "WinAnsiEncoding");
    const out: Array<number | undefined> = baseTable.slice();
    const differences = resolveValue(document, getDictValue(resolved, "Differences"));
    if (Array.isArray(differences) && !isPdfDict(differences)) {
      let code = 0;
      for (const entry of differences) {
        if (typeof entry === "number") {
          code = entry;
        } else if (entry && typeof entry === "object" && "kind" in entry && (entry as { kind: string }).kind === "name") {
          const glyphName = (entry as { value: string }).value;
          const text = glyphNameToString(glyphName);
          if (text.length > 0) {
            out[code] = text.codePointAt(0);
          } else {
            out[code] = undefined;
          }
          code += 1;
        }
      }
    }
    return out;
  }
  return undefined;
}

function getNumberValue(dict: PdfDict, key: string): number | undefined {
  const v = getDictValue(dict, key);
  return typeof v === "number" ? v : undefined;
}

function getPagesRef(document: ParsedPdfDocument): PdfRef {
  const catalog = getCatalogDict(document);
  const pagesRef = getDictValue(catalog, "Pages");
  if (!isPdfRef(pagesRef)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "PDF catalog Pages entry must be a reference.",
    );
  }

  return pagesRef;
}

function getCatalogDict(document: ParsedPdfDocument): PdfDict {
  const rootRef = getDictValue(document.trailer, "Root");
  if (!isPdfRef(rootRef)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "PDF trailer Root entry must be a reference.",
    );
  }

  const catalog = resolveDict(document, rootRef);
  if (!catalog) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "PDF catalog could not be resolved.",
    );
  }

  return catalog;
}

const MAX_PAGE_TREE_DEPTH = 50;

interface WalkPagesEntry {
  readonly ref: PdfRef;
  readonly inheritedResources?: PdfDict | undefined;
  readonly depth: number;
}

function walkPages(
  document: ParsedPdfDocument,
  refValue: PdfRef,
  output: ParsedPdfPage[],
  inheritedResources?: PdfDict,
): void {
  const stack: WalkPagesEntry[] = [
    { ref: refValue, inheritedResources, depth: 0 },
  ];

  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (entry.depth > MAX_PAGE_TREE_DEPTH) {
      throw new PdfEngineError(
        PdfErrorCode.UNSUPPORTED_PAGE_TREE,
        "Page tree nesting exceeds maximum supported depth.",
        { maxDepth: MAX_PAGE_TREE_DEPTH },
      );
    }

    const dict = resolveDict(document, entry.ref);
    if (!dict) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Page tree reference could not be resolved.",
        {
          objectId: entry.ref.objectId,
        },
      );
    }

    const ownResources = resolveDict(document, getDictValue(dict, "Resources"));
    const resources = ownResources ?? entry.inheritedResources;

    const type = getNameValue(dict, "Type");
    if (type === "Page") {
      const contents = getDictValue(dict, "Contents");
      let contentObjectIds: number[] = [];
      if (Array.isArray(contents) && !isPdfDict(contents)) {
        contentObjectIds = contents
          .filter((entry): entry is PdfRef => isPdfRef(entry))
          .map((entry) => entry.objectId);
      } else if (isPdfRef(contents)) {
        contentObjectIds = [contents.objectId];
      }
      const mediaBox = getArrayNumbers(getDictValue(dict, "MediaBox"));
      output.push({
        objectId: entry.ref.objectId,
        mediaBox,
        contentObjectIds,
        ...(resources === undefined ? {} : { resources }),
      });
      continue;
    }

    const kids = getDictValue(dict, "Kids");
    if (!Array.isArray(kids) || isPdfDict(kids)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Page tree node is missing Kids.",
        {
          objectId: entry.ref.objectId,
        },
      );
    }

    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i];
      if (isPdfRef(kid)) {
        stack.push({
          ref: kid,
          inheritedResources: resources,
          depth: entry.depth + 1,
        });
      }
    }
  }
}

function resolveDict(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
): PdfDict | undefined {
  const resolved = resolveValue(document, value);
  return Array.isArray(resolved) && isPdfDict(resolved) ? resolved : undefined;
}

function resolveValue(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
): PdfValue | undefined {
  if (!isPdfRef(value)) {
    return value;
  }

  return document.getObject(value.objectId)?.value;
}

function collectNamedDestinations(
  document: ParsedPdfDocument,
  node: PdfDict,
  output: Map<string, ParsedPdfNamedDestination>,
): void {
  const names = getDictValue(node, "Names");
  if (Array.isArray(names) && !isPdfDict(names)) {
    for (let index = 0; index < names.length; index += 2) {
      const key = names[index];
      const value = names[index + 1];
      const destinationName = isPdfString(key)
        ? key.value
        : isPdfName(key)
          ? key.value
          : undefined;
      if (!destinationName) {
        continue;
      }

      output.set(
        destinationName,
        parseNamedDestinationValue(document, destinationName, value),
      );
    }
  }

  const kids = getDictValue(node, "Kids");
  if (Array.isArray(kids) && !isPdfDict(kids)) {
    for (const kid of kids) {
      const dictValue = resolveDict(document, kid);
      if (dictValue) {
        collectNamedDestinations(document, dictValue, output);
      }
    }
  }
}

function collectEmbeddedFiles(
  document: ParsedPdfDocument,
  node: PdfDict,
  output: Map<string, ParsedPdfAttachment>,
  seen: Set<number>,
): void {
  const names = getDictValue(node, "Names");
  if (Array.isArray(names) && !isPdfDict(names)) {
    for (let index = 0; index < names.length; index += 2) {
      const key = names[index];
      const value = names[index + 1];
      const attachmentName = isPdfString(key)
        ? key.value
        : isPdfName(key)
          ? key.value
          : undefined;
      if (!attachmentName) {
        continue;
      }

      output.set(
        attachmentName,
        parseAttachmentValue(document, attachmentName, value),
      );
    }
  }

  const kids = getDictValue(node, "Kids");
  if (Array.isArray(kids) && !isPdfDict(kids)) {
    for (const kid of kids) {
      if (isPdfRef(kid)) {
        if (seen.has(kid.objectId)) {
          continue;
        }
        seen.add(kid.objectId);
      }
      const dictValue = resolveDict(document, kid);
      if (dictValue) {
        collectEmbeddedFiles(document, dictValue, output, seen);
      }
    }
  }
}

function collectNumberTreeEntries(
  document: ParsedPdfDocument,
  node: PdfDict,
  output: Map<number, PdfDict>,
  seen: Set<number>,
  corruptedNodes: Set<number> = new Set(),
): void {
  const nums = getDictValue(node, "Nums");
  if (Array.isArray(nums) && !isPdfDict(nums)) {
    const keysSeen: number[] = [];
    for (let index = 0; index < nums.length; index += 2) {
      const key = nums[index];
      const value = nums[index + 1];
      if (typeof key !== "number") {
        continue;
      }

      keysSeen.push(key);

      const dictValue = resolveDict(document, value);
      if (dictValue) {
        output.set(key, dictValue);
      }
    }

    let sorted = true;
    if (keysSeen.length > 1) {
      for (let i = 1; i < keysSeen.length; i++) {
        if (keysSeen[i]! < keysSeen[i - 1]!) {
          sorted = false;
          break;
        }
      }
    }
    if (!sorted) {
      if (corruptedNodes.size === 0) {
        debugLog("Number tree contains unsorted keys; attempting recovery by scanning leaf nodes...");
      }
      corruptedNodes.add(nodeNodeId(node, document));
      try {
        const recoveredKeys = keysSeen.length;
        for (const key of keysSeen) {
          if (!output.has(key)) {
            const existing = resolveDict(document, nums[keysSeen.indexOf(key)! * 2 + 1]);
            if (existing) {
              output.set(key, existing);
            }
          }
        }
        (output as Map<number, PdfDict> & { recoveredKeys?: number }).recoveredKeys = recoveredKeys;
      } catch {
        // Continue despite recovery failure
      }
      return;
    }
  }

  const kids = getDictValue(node, "Kids");
  if (Array.isArray(kids) && !isPdfDict(kids)) {
    for (const kid of kids) {
      if (isPdfRef(kid)) {
        if (seen.has(kid.objectId)) {
          continue;
        }
        seen.add(kid.objectId);
      }
      try {
        const dictValue = resolveDict(document, kid);
        if (dictValue) {
          collectNumberTreeEntries(document, dictValue, output, seen, corruptedNodes);
        }
      } catch (error) {
        if (error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_NUMBER_TREE) {
          if (corruptedNodes.size === 0) {
            debugLog("Number tree node corruption detected; skipping corrupted intermediate node and continuing to children...");
          }
          corruptedNodes.add(
            isPdfRef(kid) ? kid.objectId : (nodeNodeId(node, document))
          );
          if (isPdfRef(kid)) {
            const object = document.getObject(kid.objectId);
            if (object && Array.isArray(object.value) && typeof object.value !== "string") {
              const kidDict = object.value as unknown as PdfDict;
              const kidKids = getDictValue(kidDict, "Kids");
              if (Array.isArray(kidKids) && !isPdfDict(kidKids)) {
                for (const grandKid of kidKids) {
                  try {
                    const grandDict = resolveDict(document, grandKid);
                    if (grandDict) {
                      collectNumberTreeEntries(document, grandDict, output, seen, corruptedNodes);
                    }
                  } catch {
                    // Skip corrupted grandchild, continue
                  }
                }
              }
            }
          }
        } else {
          // Other errors — try recovery by continuing
        }
      }
    }
  }
}

function nodeNodeId(node: PdfDict, _document: ParsedPdfDocument): number {
  if (Array.isArray(node) && !Array.isArray(node) === false) {
    return -1;
  }
  return -1;
}

export interface NumberTreeScannedResult {
  readonly entries: ReadonlyMap<number, PdfDict>;
  readonly warnings: readonly string[];
  readonly recoveredKeys: number;
}

function collectNumberTreeEntriesWithRecovery(
  document: ParsedPdfDocument,
  node: PdfDict,
): NumberTreeScannedResult {
  const entries = new Map<number, PdfDict>();
  const warnings: string[] = [];
  const corruptedNodes = new Set<number>();
  try {
    collectNumberTreeEntries(document, node, entries, new Set<number>(), corruptedNodes);
  } catch (error) {
    warnings.push(
      `Number tree parsing failed: ${error instanceof Error ? error.message : String(error)}`
    );
    if (error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_NUMBER_TREE) {
      warnings.push("Attempting recovery by scanning all leaf nodes regardless of corruption.");
      try {
        scanNumberTreeLeaves(document, node, entries, new Set<number>());
      } catch (scanError) {
        warnings.push(
          `Leaf scan recovery also failed: ${scanError instanceof Error ? scanError.message : String(scanError)}`
        );
      }
    }
  }
  if (corruptedNodes.size > 0) {
    warnings.push(
      `Number tree contained ${corruptedNodes.size} corrupted intermediate node(s); results are partial.`
    );
  }
  const recoveredKeys =
    "recoveredKeys" in entries ? (entries as unknown as { recoveredKeys: number }).recoveredKeys : entries.size;
  return { entries, warnings, recoveredKeys };
}

function scanNumberTreeLeaves(
  document: ParsedPdfDocument,
  node: PdfDict,
  output: Map<number, PdfDict>,
  seen: Set<number>,
): void {
  const nums = getDictValue(node, "Nums");
  if (Array.isArray(nums) && !isPdfDict(nums)) {
    for (let index = 0; index < nums.length; index += 2) {
      const key = nums[index];
      const value = nums[index + 1];
      if (typeof key !== "number") {
        continue;
      }
      const dictValue = resolveDict(document, value);
      if (dictValue) {
        output.set(key, dictValue);
      }
    }
  }

  const kids = getDictValue(node, "Kids");
  if (Array.isArray(kids) && !isPdfDict(kids)) {
    for (const kid of kids) {
      if (isPdfRef(kid)) {
        if (seen.has(kid.objectId)) {
          continue;
        }
        seen.add(kid.objectId);
      }
      try {
        const dictValue = resolveDict(document, kid);
        if (dictValue) {
          scanNumberTreeLeaves(document, dictValue, output, seen);
        }
      } catch {
        // Skip corrupted node, continue scanning
      }
    }
  }
}

function collectStructureElements(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  seen: Set<number>,
): ParsedPdfStructureElement[] {
  const resolvedValue = resolveValue(document, value);
  if (Array.isArray(resolvedValue) && !isPdfDict(resolvedValue)) {
    const output: ParsedPdfStructureElement[] = [];
    for (const entry of resolvedValue) {
      const parsed = parseStructureElement(document, entry, seen);
      if (parsed) {
        output.push(parsed);
      }
    }
    return output;
  }

  const parsed = parseStructureElement(document, resolvedValue, seen);
  return parsed ? [parsed] : [];
}

function collectEditableStructureElements(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  seen: Set<number>,
): ParsedPdfEditableStructureElement[] {
  const resolvedValue = resolveValue(document, value);
  if (Array.isArray(resolvedValue) && !isPdfDict(resolvedValue)) {
    const output: ParsedPdfEditableStructureElement[] = [];
    for (const entry of resolvedValue) {
      const parsed = parseEditableStructureElement(document, entry, seen);
      if (parsed) {
        output.push(parsed);
      }
    }
    return output;
  }

  const parsed = parseEditableStructureElement(document, value, seen);
  return parsed ? [parsed] : [];
}

function collectInspectedStructureElements(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  seen: Set<number>,
  textCache: Map<string, string>,
): ParsedPdfInspectedStructureElement[] {
  const resolvedValue = resolveValue(document, value);
  if (Array.isArray(resolvedValue) && !isPdfDict(resolvedValue)) {
    const output: ParsedPdfInspectedStructureElement[] = [];
    for (const entry of resolvedValue) {
      const parsed = parseInspectedStructureElement(
        document,
        entry,
        seen,
        textCache,
      );
      if (parsed) {
        output.push(parsed);
      }
    }
    return output;
  }

  const parsed = parseInspectedStructureElement(
    document,
    resolvedValue,
    seen,
    textCache,
  );
  return parsed ? [parsed] : [];
}

function parseStructureElement(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  seen: Set<number>,
): ParsedPdfStructureElement | undefined {
  const valueRef = isPdfRef(value) ? value : undefined;
  if (valueRef) {
    if (seen.has(valueRef.objectId)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Circular reference detected in structure tree.",
      );
    }
    seen.add(valueRef.objectId);
  }

  const structElement = resolveDict(document, value);
  if (!structElement || !isStructureElementDictionary(structElement)) {
    return undefined;
  }

  return compactStructureElement(document, structElement, seen);
}

function parseEditableStructureElement(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  seen: Set<number>,
): ParsedPdfEditableStructureElement | undefined {
  const valueRef = isPdfRef(value) ? value : undefined;
  if (!valueRef) {
    return undefined;
  }

  if (seen.has(valueRef.objectId)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "Circular reference detected in structure tree.",
    );
  }
  seen.add(valueRef.objectId);

  const structElement = resolveDict(document, value);
  if (!structElement || !isStructureElementDictionary(structElement)) {
    return undefined;
  }

  return compactEditableStructureElement(
    document,
    valueRef.objectId,
    structElement,
    seen,
  );
}

function parseInspectedStructureElement(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  seen: Set<number>,
  textCache: Map<string, string>,
): ParsedPdfInspectedStructureElement | undefined {
  const valueRef = isPdfRef(value) ? value : undefined;
  if (valueRef) {
    if (seen.has(valueRef.objectId)) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PDF,
        "Circular reference detected in structure tree.",
      );
    }
    seen.add(valueRef.objectId);
  }

  const structElement = resolveDict(document, value);
  if (!structElement || !isStructureElementDictionary(structElement)) {
    return undefined;
  }

  return compactInspectedStructureElement(
    document,
    valueRef?.objectId,
    structElement,
    seen,
    textCache,
  );
}

function isStructureElementDictionary(dict: PdfDict): boolean {
  return (
    getNameValue(dict, "Type") === "StructElem" ||
    getNameValue(dict, "S") !== undefined
  );
}

function parseNamedDestinationValue(
  document: ParsedPdfDocument,
  destinationName: string,
  value: PdfValue | undefined,
): ParsedPdfNamedDestination {
  const destinationValue = resolveValue(document, value);
  if (Array.isArray(destinationValue) && !isPdfDict(destinationValue)) {
    const [pageRef, mode] = destinationValue;
    return compactNamedDestination(
      destinationName,
      isPdfRef(pageRef) ? pageRef.objectId : undefined,
      isPdfName(mode) ? mode.value : undefined,
    );
  }

  const destinationDict = resolveDict(document, destinationValue);
  const arrayValue = destinationDict
    ? getDictValue(destinationDict, "D")
    : undefined;
  if (Array.isArray(arrayValue) && !isPdfDict(arrayValue)) {
    const [pageRef, mode] = arrayValue;
    return compactNamedDestination(
      destinationName,
      isPdfRef(pageRef) ? pageRef.objectId : undefined,
      isPdfName(mode) ? mode.value : undefined,
    );
  }

  return { name: destinationName };
}

function parseAttachmentValue(
  document: ParsedPdfDocument,
  attachmentName: string,
  value: PdfValue | undefined,
): ParsedPdfAttachment {
  const fileSpecRef = isPdfRef(value) ? value : undefined;
  const fileSpec = resolveDict(document, value);
  if (!fileSpec) {
    return {
      name: attachmentName,
      ...(fileSpecRef !== undefined ? { objectId: fileSpecRef.objectId } : {}),
    };
  }

  const embeddedFile = readEmbeddedFile(document, fileSpec);
  const embeddedFileStream = embeddedFile?.stream;
  const paramsDict = embeddedFileStream
    ? resolveDict(document, getDictValue(embeddedFileStream.dict, "Params"))
    : undefined;
  const sizeValue = paramsDict ? getDictValue(paramsDict, "Size") : undefined;
  const byteLength =
    typeof sizeValue === "number" && sizeValue >= 0
      ? sizeValue
      : embeddedFileStream
        ? embeddedFileStream.bytes.length
        : undefined;
  const mimeType = embeddedFileStream
    ? getNameValue(embeddedFileStream.dict, "Subtype")
    : undefined;
  const description = readString(fileSpec, "Desc");

  return {
    name: attachmentName,
    ...(description !== undefined ? { description } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(byteLength !== undefined ? { byteLength } : {}),
    ...(fileSpecRef !== undefined ? { objectId: fileSpecRef.objectId } : {}),
  };
}

function readEmbeddedFile(
  document: ParsedPdfDocument,
  fileSpec: PdfDict,
):
  | {
      /** Ref. */
      ref?: PdfRef; /** Stream. */
      stream?: PdfStream;
    }
  | undefined {
  const efDict = resolveDict(document, getDictValue(fileSpec, "EF"));
  if (!efDict) {
    return undefined;
  }

  const fileValue = getDictValue(efDict, "UF") ?? getDictValue(efDict, "F");
  const refValue = isPdfRef(fileValue) ? fileValue : undefined;
  const resolvedValue = resolveValue(document, fileValue);
  const streamValue =
    resolvedValue && isPdfStream(resolvedValue) ? resolvedValue : undefined;
  if (!refValue && !streamValue) {
    return undefined;
  }

  return {
    ...(refValue !== undefined ? { ref: refValue } : {}),
    ...(streamValue !== undefined ? { stream: streamValue } : {}),
  };
}

function readOutlineChain(
  document: ParsedPdfDocument,
  firstValue: PdfValue | undefined,
  namedDestinations: ReadonlyMap<string, ParsedPdfNamedDestination>,
  seen: Set<number>,
): ParsedPdfOutlineItem[] {
  const items: ParsedPdfOutlineItem[] = [];
  let current = firstValue;

  while (isPdfRef(current)) {
    if (seen.has(current.objectId)) {
      break;
    }

    seen.add(current.objectId);
    const dictValue = resolveDict(document, current);
    if (!dictValue) {
      break;
    }

    const title = readString(dictValue, "Title") ?? "";
    const destination = readOutlineDestination(
      document,
      getDictValue(dictValue, "Dest"),
      namedDestinations,
    );
    const children = readOutlineChain(
      document,
      getDictValue(dictValue, "First"),
      namedDestinations,
      seen,
    );
    items.push(
      compactOutlineItem(
        title,
        destination.targetName,
        destination.targetPageObjectId,
        children,
      ),
    );

    current = getDictValue(dictValue, "Next");
  }

  return items;
}

function readOutlineDestination(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  namedDestinations: ReadonlyMap<string, ParsedPdfNamedDestination>,
): {
  /** Named destination targeted by the outline item. */
  targetName?: string; /** Page object id targeted by the outline item. */
  targetPageObjectId?: number;
} {
  const resolved = resolveValue(document, value);
  if (Array.isArray(resolved) && !isPdfDict(resolved)) {
    const pageObjectId = isPdfRef(resolved[0])
      ? resolved[0].objectId
      : undefined;
    return pageObjectId !== undefined
      ? { targetPageObjectId: pageObjectId }
      : {};
  }

  const destinationName = isPdfString(resolved)
    ? resolved.value
    : isPdfName(resolved)
      ? resolved.value
      : undefined;
  if (!destinationName) {
    return {};
  }

  const pageObjectId = namedDestinations.get(destinationName)?.pageObjectId;
  return {
    targetName: destinationName,
    ...(pageObjectId !== undefined ? { targetPageObjectId: pageObjectId } : {}),
  };
}

function collectFormFields(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  output: ParsedPdfFormField[],
  inherited: {
    /** Name parts. */
    nameParts: readonly string[];
    /** Raw AcroForm field type name. */
    fieldType?: string | undefined;
    /** Current or default value for the option. */
    value?: string | undefined;
    /** Options that control this item. */
    options?: readonly string[] | undefined;
    /** Flags. */
    flags?: number | undefined;
    /** Object id of the page associated with this item. */
    pageObjectId?: number | undefined;
  },
  seen: Set<number>,
): void {
  const fieldRef = isPdfRef(value) ? value : undefined;
  if (fieldRef && seen.has(fieldRef.objectId)) {
    return;
  }
  if (fieldRef) {
    seen.add(fieldRef.objectId);
  }

  const fieldDict = resolveDict(document, value);
  if (!fieldDict) {
    return;
  }

  const partialName = readString(fieldDict, "T");
  const nameParts =
    partialName !== undefined
      ? [...inherited.nameParts, partialName]
      : [...inherited.nameParts];
  const fieldType = getNameValue(fieldDict, "FT") ?? inherited.fieldType;
  const fieldValue =
    readFieldValue(document, getDictValue(fieldDict, "V")) ??
    readFieldValue(document, getDictValue(fieldDict, "AS")) ??
    inherited.value;
  const fieldOptions =
    readChoiceOptions(document, getDictValue(fieldDict, "Opt")) ??
    inherited.options;
  const fieldFlags =
    typeof getDictValue(fieldDict, "Ff") === "number"
      ? (getDictValue(fieldDict, "Ff") as number)
      : inherited.flags;
  const pageRef = getDictValue(fieldDict, "P");
  const pageObjectId = isPdfRef(pageRef)
    ? pageRef.objectId
    : inherited.pageObjectId;
  const rect = getArrayNumbers(getDictValue(fieldDict, "Rect"));
  const kids = getDictValue(fieldDict, "Kids");
  const subtype = getNameValue(fieldDict, "Subtype");

  if (
    Array.isArray(kids) &&
    !isPdfDict(kids) &&
    subtype !== "Widget" &&
    fieldType === "Btn" &&
    hasFieldFlag(fieldFlags, 1 << 15)
  ) {
    output.push(
      compactRadioGroupField(
        document,
        fieldRef?.objectId ?? 0,
        nameParts.join("."),
        fieldValue,
        fieldOptions,
        kids,
        fieldFlags,
      ),
    );
    return;
  }

  if (Array.isArray(kids) && !isPdfDict(kids) && subtype !== "Widget") {
    for (const kid of kids) {
      collectFormFields(
        document,
        kid,
        output,
        {
          nameParts,
          fieldType,
          ...(fieldValue !== undefined ? { value: fieldValue } : {}),
          ...(fieldOptions !== undefined ? { options: fieldOptions } : {}),
          ...(fieldFlags !== undefined ? { flags: fieldFlags } : {}),
          ...(pageObjectId !== undefined ? { pageObjectId } : {}),
        },
        seen,
      );
    }
    return;
  }

  output.push(
    compactFormField(
      fieldRef?.objectId ?? 0,
      nameParts.join("."),
      fieldType,
      fieldValue,
      fieldOptions,
      pageObjectId,
      rect,
      fieldFlags,
    ),
  );
}

function readFieldValue(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
): string | undefined {
  const resolved = resolveValue(document, value);
  return isPdfString(resolved)
    ? resolved.value
    : isPdfName(resolved)
      ? resolved.value
      : undefined;
}

function readChoiceOptions(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
): readonly string[] | undefined {
  const resolved = resolveValue(document, value);
  if (!Array.isArray(resolved) || isPdfDict(resolved)) {
    return undefined;
  }

  const options: string[] = [];
  for (const entry of resolved) {
    const option = readChoiceOptionValue(document, entry);
    if (option !== undefined) {
      options.push(option);
    }
  }

  return options.length > 0 ? options : undefined;
}

function readChoiceOptionValue(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
): string | undefined {
  const resolved = resolveValue(document, value);
  if (isPdfString(resolved) || isPdfName(resolved)) {
    return resolved.value;
  }

  if (!Array.isArray(resolved) || isPdfDict(resolved)) {
    return undefined;
  }

  const exportValue = resolveValue(document, resolved[0]);
  if (isPdfString(exportValue) || isPdfName(exportValue)) {
    return exportValue.value;
  }

  const displayValue = resolveValue(document, resolved[1]);
  return isPdfString(displayValue) || isPdfName(displayValue)
    ? displayValue.value
    : undefined;
}

function compactFormField(
  objectId: number,
  name: string,
  fieldType: string | undefined,
  value: string | undefined,
  options: readonly string[] | undefined,
  pageObjectId: number | undefined,
  rect: readonly number[] | undefined,
  flags: number | undefined,
): ParsedPdfFormField {
  return {
    objectId,
    name,
    ...(fieldType !== undefined ? { fieldType } : {}),
    ...(fieldType === "Btn"
      ? {
          buttonKind: hasFieldFlag(flags, 1 << 15)
            ? "radio"
            : hasFieldFlag(flags, 1 << 16)
              ? "pushButton"
              : "checkBox",
        }
      : {}),
    ...(value !== undefined ? { value } : {}),
    ...(options !== undefined ? { options } : {}),
    ...(fieldType === "Ch"
      ? { choiceMode: hasFieldFlag(flags, 1 << 17) ? "combo" : "list" }
      : {}),
    ...(fieldType === "Btn" && !hasFieldFlag(flags, 1 << 15)
      ? { checked: value !== undefined && value !== "Off" }
      : {}),
    ...(pageObjectId !== undefined ? { pageObjectId } : {}),
    ...(rect !== undefined ? { rect } : {}),
    ...(hasFieldFlag(flags, 1) ? { readOnly: true } : {}),
    ...(hasFieldFlag(flags, 1 << 1) ? { required: true } : {}),
    ...(hasFieldFlag(flags, 1 << 12) ? { multiline: true } : {}),
  };
}

function compactRadioGroupField(
  document: ParsedPdfDocument,
  objectId: number,
  name: string,
  value: string | undefined,
  inheritedOptions: readonly string[] | undefined,
  kids: readonly PdfValue[],
  flags: number | undefined,
): ParsedPdfFormField {
  const widgetOptions: string[] = [];
  let pageObjectId: number | undefined;
  let hasConflictingPages = false;

  for (const kid of kids) {
    const widgetDict = resolveDict(document, kid);
    if (!widgetDict) {
      continue;
    }

    const widgetOption = readRadioWidgetValue(document, widgetDict);
    if (widgetOption !== undefined && !widgetOptions.includes(widgetOption)) {
      widgetOptions.push(widgetOption);
    }

    const widgetPageRef = getDictValue(widgetDict, "P");
    const widgetPageObjectId = isPdfRef(widgetPageRef)
      ? widgetPageRef.objectId
      : undefined;
    if (widgetPageObjectId === undefined) {
      continue;
    }

    if (pageObjectId === undefined) {
      pageObjectId = widgetPageObjectId;
      continue;
    }

    if (pageObjectId !== widgetPageObjectId) {
      hasConflictingPages = true;
    }
  }

  const options =
    inheritedOptions ?? (widgetOptions.length > 0 ? widgetOptions : undefined);

  return {
    objectId,
    name,
    fieldType: "Btn",
    buttonKind: "radio",
    ...(value !== undefined ? { value } : {}),
    ...(options !== undefined ? { options } : {}),
    ...(!hasConflictingPages && pageObjectId !== undefined
      ? { pageObjectId }
      : {}),
    ...(hasFieldFlag(flags, 1) ? { readOnly: true } : {}),
    ...(hasFieldFlag(flags, 1 << 1) ? { required: true } : {}),
  };
}

function readRadioWidgetValue(
  document: ParsedPdfDocument,
  widgetDict: PdfDict,
): string | undefined {
  const apDict = resolveDict(document, getDictValue(widgetDict, "AP"));
  const normalAppearance = apDict
    ? resolveDict(document, getDictValue(apDict, "N"))
    : undefined;
  if (!normalAppearance) {
    return undefined;
  }

  return normalAppearance.find(([key]) => key !== "Off")?.[0];
}

function hasFieldFlag(flags: number | undefined, mask: number): boolean {
  return typeof flags === "number" && (flags & mask) !== 0;
}

function compactNamedDestination(
  name: string,
  pageObjectId: number | undefined,
  mode: string | undefined,
): ParsedPdfNamedDestination {
  return {
    name,
    ...(pageObjectId !== undefined ? { pageObjectId } : {}),
    ...(mode !== undefined ? { mode } : {}),
  };
}

function compactOutlineItem(
  title: string,
  targetName: string | undefined,
  targetPageObjectId: number | undefined,
  children: readonly ParsedPdfOutlineItem[],
): ParsedPdfOutlineItem {
  return {
    title,
    ...(targetName !== undefined ? { targetName } : {}),
    ...(targetPageObjectId !== undefined ? { targetPageObjectId } : {}),
    children,
  };
}

function compactPageLabelRange(
  startPageIndex: number,
  labelDict: PdfDict,
): ParsedPdfPageLabelRange {
  const style = parsePageLabelStyle(getNameValue(labelDict, "S"));
  const prefix = readString(labelDict, "P");
  const startValue = getDictValue(labelDict, "St");
  const startAt =
    typeof startValue === "number" &&
    Number.isInteger(startValue) &&
    startValue > 0
      ? startValue
      : 1;

  return {
    startPageIndex,
    ...(style !== undefined ? { style } : {}),
    ...(prefix !== undefined ? { prefix } : {}),
    startAt,
  };
}

function compactStructureElement(
  document: ParsedPdfDocument,
  structElement: PdfDict,
  seen: Set<number>,
): ParsedPdfStructureElement {
  const pageRef = getDictValue(structElement, "Pg");
  const contentRef = getDictValue(structElement, "K");
  const mcids = collectStructureMcids(contentRef);
  const mcid = mcids[0];
  const children = collectStructureElements(document, contentRef, seen);
  const id = readString(structElement, "ID");
  const altText = readString(structElement, "Alt");
  const actualText = readString(structElement, "ActualText");
  const language = readString(structElement, "Lang");

  return {
    role: getNameValue(structElement, "S") ?? "Unknown",
    ...(isPdfRef(pageRef) ? { pageObjectId: pageRef.objectId } : {}),
    ...(mcid !== undefined ? { mcid } : {}),
    ...(mcids.length > 0 ? { mcids } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(altText !== undefined ? { altText } : {}),
    ...(actualText !== undefined ? { actualText } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function compactEditableStructureElement(
  document: ParsedPdfDocument,
  objectId: number,
  structElement: PdfDict,
  seen: Set<number>,
): ParsedPdfEditableStructureElement {
  const pageRef = getDictValue(structElement, "Pg");
  const contentRef = getDictValue(structElement, "K");
  const mcids = collectStructureMcids(contentRef);
  const mcid = mcids[0];
  const children = collectEditableStructureElements(document, contentRef, seen);
  const id = readString(structElement, "ID");
  const altText = readString(structElement, "Alt");
  const actualText = readString(structElement, "ActualText");
  const language = readString(structElement, "Lang");

  return {
    objectId,
    role: getNameValue(structElement, "S") ?? "Unknown",
    ...(isPdfRef(getDictValue(structElement, "P"))
      ? {
          parentObjectId: (getDictValue(structElement, "P") as PdfRef).objectId,
        }
      : {}),
    ...(isPdfRef(pageRef) ? { pageObjectId: pageRef.objectId } : {}),
    ...(mcid !== undefined ? { mcid } : {}),
    ...(mcids.length > 0 ? { mcids } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(altText !== undefined ? { altText } : {}),
    ...(actualText !== undefined ? { actualText } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function compactInspectedStructureElement(
  document: ParsedPdfDocument,
  objectId: number | undefined,
  structElement: PdfDict,
  seen: Set<number>,
  textCache: Map<string, string>,
): ParsedPdfInspectedStructureElement {
  const pageRef = getDictValue(structElement, "Pg");
  const pageObjectId = isPdfRef(pageRef) ? pageRef.objectId : undefined;
  const contentRef = getDictValue(structElement, "K");
  const mcids = collectStructureMcids(contentRef);
  const mcid = mcids[0];
  const annotations = collectStructureAnnotations(
    document,
    contentRef,
    pageObjectId,
  );
  const children = collectInspectedStructureElements(
    document,
    contentRef,
    seen,
    textCache,
  );
  const directText = collectStructureText(
    document,
    contentRef,
    pageObjectId,
    textCache,
  );
  const childText = children
    .map((child) => child.text)
    .filter((text): text is string => text !== undefined && text.length > 0)
    .join(" ");
  const text = [directText, childText]
    .filter((entry) => entry.length > 0)
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const id = readString(structElement, "ID");
  const altText = readString(structElement, "Alt");
  const actualText = readString(structElement, "ActualText");
  const language = readString(structElement, "Lang");

  return {
    ...(objectId !== undefined ? { objectId } : {}),
    role: getNameValue(structElement, "S") ?? "Unknown",
    ...(pageObjectId !== undefined ? { pageObjectId } : {}),
    ...(mcid !== undefined ? { mcid } : {}),
    ...(mcids.length > 0 ? { mcids } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(altText !== undefined ? { altText } : {}),
    ...(actualText !== undefined ? { actualText } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(text.length > 0 ? { text } : {}),
    ...(annotations.length > 0 ? { annotations } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function collectStructureMcids(value: PdfValue | undefined): number[] {
  if (typeof value === "number") {
    return [value];
  }

  if (isPdfRef(value)) {
    return [];
  }

  if (Array.isArray(value) && isPdfDict(value)) {
    const mcidValue = getDictValue(value, "MCID");
    return typeof mcidValue === "number" ? [mcidValue] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const mcids: number[] = [];
  for (const entry of value) {
    if (typeof entry === "number") {
      mcids.push(entry);
      continue;
    }
    if (Array.isArray(entry) && isPdfDict(entry)) {
      const mcidValue = getDictValue(entry, "MCID");
      if (typeof mcidValue === "number") {
        mcids.push(mcidValue);
      }
    }
  }

  return mcids;
}

function collectStructureText(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  defaultPageObjectId: number | undefined,
  textCache: Map<string, string>,
): string {
  const items = collectStructureMarkedContentItems(
    document,
    value,
    defaultPageObjectId,
  );
  const parts: string[] = [];
  for (const item of items) {
    if (item.pageObjectId === undefined) {
      continue;
    }
    const cacheKey = `${item.pageObjectId}:${item.mcid}`;
    let text = textCache.get(cacheKey);
    if (text === undefined) {
      text = extractMarkedContentText(document, item.pageObjectId, item.mcid);
      textCache.set(cacheKey, text);
    }
    if (text.length > 0) {
      parts.push(text);
    }
  }

  return parts.join(" ").replaceAll(/\s+/g, " ").trim();
}

function collectStructureMarkedContentItems(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  defaultPageObjectId: number | undefined,
): Array<{
  /** Object id of the page associated with this item. */
  pageObjectId?: number; /** First marked-content id associated with the structure element. */
  mcid: number;
}> {
  if (typeof value === "number") {
    return [
      {
        ...(defaultPageObjectId !== undefined
          ? { pageObjectId: defaultPageObjectId }
          : {}),
        mcid: value,
      },
    ];
  }

  const resolved = resolveValue(document, value);
  if (Array.isArray(resolved) && isPdfDict(resolved)) {
    if (getNameValue(resolved, "Type") === "OBJR") {
      return [];
    }

    const mcidValue = getDictValue(resolved, "MCID");
    const pageValue = getDictValue(resolved, "Pg");
    const pageObjectId = isPdfRef(pageValue)
      ? pageValue.objectId
      : defaultPageObjectId;
    return typeof mcidValue === "number"
      ? [
          {
            ...(pageObjectId !== undefined ? { pageObjectId } : {}),
            mcid: mcidValue,
          },
        ]
      : [];
  }

  if (!Array.isArray(resolved) || isPdfDict(resolved)) {
    return [];
  }

  const items: Array<{
    /** Object id of the page associated with this item. */
    pageObjectId?: number; /** First marked-content id associated with the structure element. */
    mcid: number;
  }> = [];
  for (const entry of resolved) {
    items.push(
      ...collectStructureMarkedContentItems(
        document,
        entry,
        defaultPageObjectId,
      ),
    );
  }
  return items;
}

function collectStructureAnnotations(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
  defaultPageObjectId: number | undefined,
): ParsedPdfTaggedAnnotation[] {
  const refs = collectStructureObjectRefs(document, value);
  const annotations: ParsedPdfTaggedAnnotation[] = [];
  for (const refValue of refs) {
    const parsed = parseTaggedAnnotation(
      document,
      refValue,
      defaultPageObjectId,
    );
    if (parsed) {
      annotations.push(parsed);
    }
  }
  return annotations;
}

function collectStructureObjectRefs(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
): PdfRef[] {
  const resolved = resolveValue(document, value);
  if (Array.isArray(resolved) && isPdfDict(resolved)) {
    if (getNameValue(resolved, "Type") === "OBJR") {
      const objectValue = getDictValue(resolved, "Obj");
      return isPdfRef(objectValue) ? [objectValue] : [];
    }
    return [];
  }

  if (!Array.isArray(resolved) || isPdfDict(resolved)) {
    return [];
  }

  const refs: PdfRef[] = [];
  for (const entry of resolved) {
    refs.push(...collectStructureObjectRefs(document, entry));
  }
  return refs;
}

function parseTaggedAnnotation(
  document: ParsedPdfDocument,
  refValue: PdfRef,
  defaultPageObjectId: number | undefined,
): ParsedPdfTaggedAnnotation | undefined {
  const annotation = resolveDict(document, refValue);
  if (!annotation) {
    return undefined;
  }

  const pageValue = getDictValue(annotation, "P");
  const action = resolveDict(document, getDictValue(annotation, "A"));
  const destination = readAnnotationDestination(
    document,
    getDictValue(annotation, "Dest") ?? getDictValue(action ?? [], "D"),
  );
  const fieldName = readString(annotation, "T");
  const fieldType = getNameValue(annotation, "FT");
  const value =
    readFieldValue(document, getDictValue(annotation, "V")) ??
    readFieldValue(document, getDictValue(annotation, "AS"));
  const uri = action ? readString(action, "URI") : undefined;
  const rect = getArrayNumbers(getDictValue(annotation, "Rect"));
  const contents = readString(annotation, "Contents");
  const pageObjectId = isPdfRef(pageValue)
    ? pageValue.objectId
    : defaultPageObjectId;

  return {
    objectId: refValue.objectId,
    ...(getNameValue(annotation, "Subtype") !== undefined
      ? { subtype: getNameValue(annotation, "Subtype") }
      : {}),
    ...(pageObjectId !== undefined ? { pageObjectId } : {}),
    ...(rect !== undefined ? { rect } : {}),
    ...(uri !== undefined ? { url: uri } : {}),
    ...(destination !== undefined
      ? { destinationPageObjectId: destination }
      : {}),
    ...(contents !== undefined ? { contents } : {}),
    ...(fieldName !== undefined ? { fieldName } : {}),
    ...(fieldType !== undefined ? { fieldType } : {}),
    ...(value !== undefined ? { value } : {}),
  };
}

function readAnnotationDestination(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
): number | undefined {
  const resolved = resolveValue(document, value);
  if (Array.isArray(resolved) && !isPdfDict(resolved)) {
    return isPdfRef(resolved[0]) ? resolved[0].objectId : undefined;
  }

  return undefined;
}

function extractMarkedContentText(
  document: ParsedPdfDocument,
  pageObjectId: number,
  mcid: number,
): string {
  const page = document
    .listPages()
    .find((entry) => entry.objectId === pageObjectId);
  if (!page) {
    return "";
  }

  const streams: string[] = [];
  for (const contentObjectId of page.contentObjectIds) {
    const object = document.getObject(contentObjectId);
    if (!object || !isPdfStream(object.value)) {
      continue;
    }

    try {
      streams.push(
        decodeLatin1(decodePdfStreamBytes(object.value, "page content stream")),
      );
    } catch {
      // Content inspection is best-effort; malformed or unsupported streams should not break structure parsing.
    }
  }

  if (streams.length === 0) {
    return "";
  }

  const content = streams.join("\n");
  const parts: string[] = [];
  const markerPattern = new RegExp(
    String.raw`\/[A-Za-z0-9_.:-]+\s*<<[^>]*\/MCID\s+${escapeRegExp(String(mcid))}\b[^>]*>>\s*BDC`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(content)) !== null) {
    const start = match.index + match[0].length;
    const end = findMatchingEndMarkedContent(content, start);
    if (end === -1) {
      continue;
    }

    const text = extractPdfTextOperations(content.slice(start, end));
    if (text.length > 0) {
      parts.push(text);
    }
  }

  return parts.join(" ").replaceAll(/\s+/g, " ").trim();
}

function findMatchingEndMarkedContent(content: string, start: number): number {
  let depth = 1;
  const tokenPattern =
    /\/[A-Za-z0-9_.:-]+\s*(?:<<[^>]*>>\s*)?B(?:D|M)?C\b|EMC\b/g;
  tokenPattern.lastIndex = start;
  let token: RegExpExecArray | null;
  while ((token = tokenPattern.exec(content)) !== null) {
    if (token[0].endsWith("EMC")) {
      depth -= 1;
      if (depth === 0) {
        return token.index;
      }
      continue;
    }
    depth += 1;
  }
  return -1;
}

function extractPdfTextOperations(content: string): string {
  const parts: string[] = [];
  const textOperationPattern =
    /((?:\((?:\\.|[^\\()])*\)|<[\dA-Fa-f\s]+>|\[(?:[^\[\]]|\((?:\\.|[^\\()])*\)|<[\dA-Fa-f\s]+>)*\])\s*T[Jj])/g;
  let match: RegExpExecArray | null;
  while ((match = textOperationPattern.exec(content)) !== null) {
    parts.push(...decodePdfTextOperands(match[1]!));
  }

  return parts.join("");
}

function decodePdfTextOperands(operation: string): string[] {
  const operand = operation.replace(/\s*T[Jj]\s*$/, "");
  const parts: string[] = [];
  const stringPattern = /\((?:\\.|[^\\()])*\)|<[\dA-Fa-f\s]+>/g;
  let match: RegExpExecArray | null;
  while ((match = stringPattern.exec(operand)) !== null) {
    const token = match[0];
    if (token.startsWith("(")) {
      parts.push(decodePdfLiteralOperand(token));
    } else {
      parts.push(decodePdfHexOperand(token));
    }
  }
  return parts;
}

function decodePdfLiteralOperand(token: string): string {
  let output = "";
  const body = token.slice(1, -1);
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (character !== "\\") {
      output += character;
      continue;
    }

    const next = body[index + 1];
    if (next === undefined) {
      continue;
    }

    if (/[0-7]/.test(next)) {
      let octal = next;
      let consumed = 1;
      while (consumed < 3 && /[0-7]/.test(body[index + 1 + consumed] ?? "")) {
        octal += body[index + 1 + consumed]!;
        consumed += 1;
      }
      output += String.fromCharCode(Number.parseInt(octal, 8));
      index += consumed;
      continue;
    }

    output += decodePdfTextEscape(next);
    index += 1;
  }

  return output;
}

function decodePdfTextEscape(value: string): string {
  switch (value) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "(":
    case ")":
    case "\\":
      return value;
    case "\n":
    case "\r":
      return "";
    default:
      return value;
  }
}

function decodePdfHexOperand(token: string): string {
  let hex = token.slice(1, -1).replaceAll(/\s+/g, "");
  if (hex.length === 0) {
    return "";
  }
  if (hex.length % 2 === 1) {
    hex += "0";
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let output = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      output += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!);
    }
    return output;
  }

  return decodeLatin1(bytes);
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePageLabelStyle(
  style: string | undefined,
): ParsedPdfPageLabelRange["style"] {
  switch (style) {
    case undefined:
      return undefined;
    case "D":
      return "decimal";
    case "R":
      return "romanUpper";
    case "r":
      return "romanLower";
    case "A":
      return "lettersUpper";
    case "a":
      return "lettersLower";
    default:
      return undefined;
  }
}

function getDictValue(dict: PdfDict, key: string): PdfValue | undefined {
  return dict.find(([entryKey]) => entryKey === key)?.[1];
}

function getNameValue(dict: PdfDict, key: string): string | undefined {
  const value = getDictValue(dict, key);
  return isPdfName(value) ? value.value : undefined;
}

function readString(dict: PdfDict, key: string): string | undefined {
  const value = getDictValue(dict, key);
  return isPdfString(value) ? value.value : undefined;
}

function getArrayNumbers(
  value: PdfValue | undefined,
): readonly number[] | undefined {
  if (!Array.isArray(value) || isPdfDict(value)) {
    return undefined;
  }

  return value.every((entry) => typeof entry === "number")
    ? [...value]
    : undefined;
}

function mergePdfDicts(base: PdfDict, overrides: PdfDict): PdfDict {
  const overrideMap = new Map(overrides);
  const result: PdfDict = [];
  const seen = new Set<string>();

  for (const [key, value] of base) {
    if (overrideMap.has(key)) {
      result.push([key, overrideMap.get(key)!]);
      seen.add(key);
    } else {
      result.push([key, value]);
    }
  }

  for (const [key, value] of overrides) {
    if (!seen.has(key) && !base.some(([baseKey]) => baseKey === key)) {
      result.push([key, value]);
    }
  }

  return result;
}

function trimTrailingLineBreak(
  bytes: Uint8Array,
  start: number,
  end: number,
): number {
  let result = end;
  while (
    result > start &&
    (bytes[result - 1] === 0x0a || bytes[result - 1] === 0x0d)
  ) {
    result -= 1;
  }
  return result;
}

function findKeyword(
  bytes: Uint8Array,
  start: number,
  keyword: string,
): number {
  const pattern = encodeAscii(keyword);
  for (
    let offset = start;
    offset <= bytes.length - pattern.length;
    offset += 1
  ) {
    let matches = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (bytes[offset + index] !== pattern[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return offset;
    }
  }

  return -1;
}

function toBytes(data: BinaryData): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function recoverXrefFromObjectMarkers(bytes: Uint8Array): {
  offsets: Map<number, number>;
  compressed: Map<number, XrefCompressedEntry>;
  trailer: PdfDict;
  warnings: string[];
} {
  const offsets = new Map<number, number>();
  const compressed = new Map<number, XrefCompressedEntry>();
  const objPattern = encodeAscii("obj");
  const endobjPattern = encodeAscii("endobj");
  const streamPattern = encodeAscii("stream");
  const endstreamPattern = encodeAscii("endstream");
  const trailerPattern = encodeAscii("trailer");

  const warnings: string[] = [];
  let trailer: PdfDict = [];
  const seenIds = new Set<number>();

  // Scan for "<id> <gen> obj" patterns
  let totalObjMarkers = 0;
  let totalEndobjMarkers = 0;
  let totalStreamMarkers = 0;
  let totalEndstreamMarkers = 0;

  for (let i = 0; i < bytes.length; i += 1) {
    if (matchesPattern(bytes, i, endobjPattern)) {
      totalEndobjMarkers += 1;
      i += endobjPattern.length - 1;
      continue;
    }

    if (matchesPattern(bytes, i, streamPattern)) {
      totalStreamMarkers += 1;
      i += streamPattern.length - 1;
      continue;
    }

    if (matchesPattern(bytes, i, endstreamPattern)) {
      totalEndstreamMarkers += 1;
      i += endstreamPattern.length - 1;
      continue;
    }

    // Check for "obj" marker with preceding numbers
    if (!matchesPattern(bytes, i, objPattern)) {
      continue;
    }

    // Try to find integer-id and generation before "obj"
    const before = decodeLatin1(
      bytes.slice(Math.max(0, i - 30), i),
    );
    const match = /(\d+)\s+(\d+)\s*$/.exec(before);
    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    const objectId = Number(match[1]);
    const generation = Number(match[2]);
    if (generation !== 0 || seenIds.has(objectId)) {
      if (generation !== 0) {
        warnings.push(`Skipping object ${objectId} with non-zero generation ${generation} during recovery.`);
      }
      i += objPattern.length - 1;
      continue;
    }

    totalObjMarkers += 1;
    const objStart = i - match[0].length;
    seenIds.add(objectId);
    offsets.set(objectId, objStart);
    i += objPattern.length - 1;
  }

  // Find last trailer dictionary
  for (
    let i = bytes.length - trailerPattern.length;
    i >= 0;
    i -= 1
  ) {
    if (matchesPattern(bytes, i, trailerPattern)) {
      try {
        const parser = new ValueParser(bytes, i);
        parser.skipWhitespaceAndComments();
        if (parser.consumeKeyword("trailer")) {
          const trailerValue = parser.parseValue();
          if (Array.isArray(trailerValue) && isPdfDict(trailerValue)) {
            trailer = trailerValue;
            break;
          }
        }
      } catch {
        // Keep scanning
      }
    }
  }

  warnings.push(
    `Deep repair: recovered ${offsets.size} objects from scanning file contents ` +
    `(${totalObjMarkers} obj markers, ${totalEndobjMarkers} endobj markers, ` +
    `${totalStreamMarkers} stream markers, ${totalEndstreamMarkers} endstream markers).`,
  );

  if (totalObjMarkers !== totalEndobjMarkers) {
    warnings.push(
      `Mismatch between obj (${totalObjMarkers}) and endobj (${totalEndobjMarkers}) markers; the file may be truncated.`,
    );
  }

  if (totalStreamMarkers !== totalEndstreamMarkers) {
    warnings.push(
      `Mismatch between stream (${totalStreamMarkers}) and endstream (${totalEndstreamMarkers}) markers; some streams may be unclosed.`,
    );
  }

  return { offsets, compressed, trailer, warnings };
}

function matchesPattern(
  bytes: Uint8Array,
  offset: number,
  pattern: Uint8Array,
): boolean {
  if (offset + pattern.length > bytes.length) {
    return false;
  }
  for (let j = 0; j < pattern.length; j += 1) {
    if (bytes[offset + j] !== pattern[j]) {
      return false;
    }
  }
  return true;
}

function encodeAscii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function isWhitespace(byte: number): boolean {
  return (
    byte === 0x00 ||
    byte === 0x09 ||
    byte === 0x0a ||
    byte === 0x0c ||
    byte === 0x0d ||
    byte === 0x20
  );
}

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function decodeEscape(byte: number): string {
  switch (byte) {
    case 0x6e:
      return "\n";
    case 0x72:
      return "\r";
    case 0x74:
      return "\t";
    case 0x62:
      return "\b";
    case 0x66:
      return "\f";
    case 0x28:
      return "(";
    case 0x29:
      return ")";
    case 0x5c:
      return "\\";
    case 0x0a:
    case 0x0d:
      return "";
    default:
      return String.fromCharCode(byte);
  }
}

function isPdfRef(value: PdfValue | undefined): value is PdfRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "ref"
  );
}

function isPdfName(value: PdfValue | undefined): value is {
  /** Discriminator identifying this value shape. */
  kind: "name"; /** Current or default value for the option. */
  value: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "name"
  );
}

function isPdfString(value: PdfValue | undefined): value is {
  /** Discriminator identifying this value shape. */
  kind: "string"; /** Current or default value for the option. */
  value: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "string"
  );
}

function isPdfDict(value: PdfValue[] | PdfDict): value is PdfDict {
  return value.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string",
  );
}
