import { PdfEngineError, PdfErrorCode } from "./errors.js";
import {
  parseDocument,
  type ParsedPdfDocument,
  type ParsedPdfPage,
} from "./parser.js";
import type { BinaryData } from "./types.js";
import { inflateZlib } from "./internal/deflate.js";
import { ByteWriter } from "./internal/byte-writer.js";
import {
  formatHeader,
  maxVersion,
  parseVersion,
  type PdfVersion,
} from "./internal/pdf-version.js";
import {
  array,
  dict,
  isPdfLazyStream,
  isPdfStream,
  name,
  ref,
  serializePdfValue,
  stream,
  type PdfDict,
  type PdfIndirectObject,
  type PdfRef,
  type PdfStream,
  type PdfValue,
} from "./internal/pdf-primitives.js";

interface ImportedPageSpec {
  readonly document: ParsedPdfDocument;
  readonly page: ParsedPdfPage;
}

interface CloneBuilder {
  nextObjectId: number;
  objects: PdfIndirectObject[];
}

interface CloneContext {
  readonly document: ParsedPdfDocument;
  readonly builder: CloneBuilder;
  readonly objectMap: Map<number, number>;
}

const encoder = new TextEncoder();

/**
 * Creates a new PDF containing only the selected pages from an existing document.
 *
 * @param data The source PDF bytes.
 * @param pageIndexes Zero-based page indexes to copy into the new document.
 *
 * @returns The transferred PDF bytes.
 */
export function extractPages(
  data: BinaryData,
  pageIndexes: readonly number[],
): Uint8Array {
  const document = parseDocument(data);
  return buildTransferredPdf(collectImportedPages(document, pageIndexes));
}

/**
 * Splits a PDF into one single-page PDF byte array per source page.
 *
 * @param data The source PDF bytes.
 *
 * @returns One PDF byte array per source page.
 */
export function splitDocument(data: BinaryData): Uint8Array[] {
  const document = parseDocument(data);
  return document
    .listPages()
    .map((_, index) =>
      buildTransferredPdf(collectImportedPages(document, [index])),
    );
}

/**
 * Combines multiple PDF documents into a single PDF in the order provided.
 *
 * @param documents Source PDF byte arrays to merge.
 *
 * @returns The merged PDF bytes.
 */
export function mergeDocuments(documents: readonly BinaryData[]): Uint8Array {
  if (documents.length === 0) {
    throw new PdfEngineError(
      PdfErrorCode.EMPTY_PAGE,
      "mergeDocuments() requires at least one source PDF.",
    );
  }

  const importedPages = documents.flatMap((documentData) => {
    const document = parseDocument(documentData);
    return collectImportedPages(document);
  });

  return buildTransferredPdf(importedPages);
}

/**
 * Appends selected pages from one PDF to the end of another PDF and returns the updated document bytes.
 *
 * @param target The PDF bytes that receive appended pages.
 * @param source The PDF bytes to copy pages from.
 * @param pageIndexes Optional zero-based source page indexes to append.
 *
 * @returns The PDF bytes containing the target pages followed by appended source pages.
 */
export function appendPages(
  target: BinaryData,
  source: BinaryData,
  pageIndexes?: readonly number[],
): Uint8Array {
  const targetDocument = parseDocument(target);
  const sourceDocument = parseDocument(source);
  return buildTransferredPdf([
    ...collectImportedPages(targetDocument),
    ...collectImportedPages(sourceDocument, pageIndexes),
  ]);
}

function collectImportedPages(
  document: ParsedPdfDocument,
  pageIndexes?: readonly number[],
): ImportedPageSpec[] {
  const pages = document.listPages();
  const selectedIndexes = pageIndexes ?? pages.map((_, index) => index);
  if (selectedIndexes.length === 0) {
    throw new PdfEngineError(
      PdfErrorCode.EMPTY_PAGE,
      "At least one page must be selected for transfer.",
    );
  }

  return selectedIndexes.map((pageIndex) => {
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= pages.length
    ) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_PAGE,
        "Page index is out of range for transfer.",
        {
          pageIndex,
          pageCount: pages.length,
        },
      );
    }

    return {
      document,
      page: pages[pageIndex]!,
    };
  });
}

function buildTransferredPdf(
  importedPages: readonly ImportedPageSpec[],
): Uint8Array {
  if (importedPages.length === 0) {
    throw new PdfEngineError(
      PdfErrorCode.EMPTY_PAGE,
      "Transferred PDFs must contain at least one page.",
    );
  }

  const builder: CloneBuilder = {
    nextObjectId: 4,
    objects: [],
  };
  const contexts = new Map<ParsedPdfDocument, CloneContext>();
  let pdfVersion: PdfVersion = "1.4";
  for (const importedPage of importedPages) {
    const sourceVersion = parseVersion(
      importedPage.document.getEffectiveVersion(),
    );
    if (sourceVersion) pdfVersion = maxVersion(pdfVersion, sourceVersion);
  }
  const pageObjects: Array<{
    pageObjectId: number;
    contentObjectId: number;
    mediaBox: readonly number[];
  }> = [];

  for (const importedPage of importedPages) {
    const context = getCloneContext(contexts, importedPage.document, builder);
    const mediaBox = normalizeMediaBox(importedPage.page.mediaBox);
    const resources = resolveInheritedPageValue(
      importedPage.document,
      importedPage.page.objectId,
      "Resources",
    );
    const clonedResources = asOptionalPdfDict(
      clonePdfValue(resources, context),
    );
    const formObjectId = builder.nextObjectId++;
    const contentObjectId = builder.nextObjectId++;
    const pageObjectId = builder.nextObjectId++;
    const formResourceName = "ImportedPage";

    builder.objects.push(
      {
        id: formObjectId,
        value: stream(
          dict([
            ["Type", name("XObject")],
            ["Subtype", name("Form")],
            ["BBox", array([...mediaBox])],
            ["Resources", clonedResources],
          ]),
          collectDecodedPageContent(
            importedPage.document,
            importedPage.page.objectId,
          ),
        ),
      },
      {
        id: contentObjectId,
        value: stream(
          dict([]),
          encoder.encode(`q /${formResourceName} Do Q\n`),
        ),
      },
      {
        id: pageObjectId,
        value: dict([
          ["Type", name("Page")],
          ["Parent", ref(2)],
          ["MediaBox", array([...mediaBox])],
          [
            "Resources",
            dict([["XObject", dict([[formResourceName, ref(formObjectId)]])]]),
          ],
          ["Contents", ref(contentObjectId)],
        ]),
      },
    );

    pageObjects.push({ pageObjectId, contentObjectId, mediaBox });
  }

  const objects: PdfIndirectObject[] = [
    {
      id: 1,
      value: dict([
        ["Type", name("Catalog")],
        ["Pages", ref(2)],
      ]),
    },
    {
      id: 2,
      value: dict([
        ["Type", name("Pages")],
        ["Count", pageObjects.length],
        ["Kids", array(pageObjects.map((page) => ref(page.pageObjectId)))],
      ]),
    },
    {
      id: 3,
      value: dict([["Producer", { kind: "string", value: "pdf-editing-lib" }]]),
    },
    ...builder.objects,
  ];

  return writePdf(objects, pdfVersion);
}

function getCloneContext(
  contexts: Map<ParsedPdfDocument, CloneContext>,
  document: ParsedPdfDocument,
  builder: CloneBuilder,
): CloneContext {
  const existing = contexts.get(document);
  if (existing) {
    return existing;
  }

  const context: CloneContext = {
    document,
    builder,
    objectMap: new Map(),
  };
  contexts.set(document, context);
  return context;
}

function clonePdfValue(
  value: PdfValue | undefined,
  context: CloneContext,
): PdfValue | undefined {
  if (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    if (isPdfDict(value)) {
      return value.map(
        ([key, entry]) =>
          [key, clonePdfValue(entry, context) ?? null] as [string, PdfValue],
      );
    }

    return value.map((entry) => clonePdfValue(entry, context) ?? null);
  }

  if ("kind" in value) {
    if (value.kind === "ref") {
      return clonePdfRef(value, context);
    }

    if (value.kind === "stream") {
      return stream(clonePdfDict(value.dict, context), value.bytes.slice());
    }

    return { ...value };
  }

  return value;
}

function clonePdfRef(sourceRef: PdfRef, context: CloneContext): PdfRef {
  const existingObjectId = context.objectMap.get(sourceRef.objectId);
  if (existingObjectId !== undefined) {
    return ref(existingObjectId);
  }

  const sourceObject = context.document.getObject(sourceRef.objectId);
  if (!sourceObject) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "Transferred object reference could not be resolved.",
      {
        objectId: sourceRef.objectId,
      },
    );
  }

  const clonedObjectId = context.builder.nextObjectId++;
  context.objectMap.set(sourceRef.objectId, clonedObjectId);
  const clonedValue = clonePdfValue(sourceObject.value, context);
  if (
    clonedValue === undefined ||
    (typeof clonedValue === "object" &&
      clonedValue !== null &&
      "kind" in clonedValue &&
      clonedValue.kind === "ref")
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "Indirect PDF objects must resolve to a direct value.",
    );
  }

  context.builder.objects.push({
    id: clonedObjectId,
    value: clonedValue,
  });
  return ref(clonedObjectId);
}

function clonePdfDict(source: PdfDict, context: CloneContext): PdfDict {
  return source.map(
    ([key, entry]) =>
      [key, clonePdfValue(entry, context) ?? null] as [string, PdfValue],
  );
}

function resolveInheritedPageValue(
  document: ParsedPdfDocument,
  pageObjectId: number,
  key: string,
): PdfValue | undefined {
  let currentObjectId: number | undefined = pageObjectId;
  const seen = new Set<number>();

  while (currentObjectId !== undefined) {
    if (seen.has(currentObjectId)) {
      break;
    }
    seen.add(currentObjectId);

    const dictValue = asPdfDict(
      document.getObject(currentObjectId)?.value,
      "Page",
    );
    const directValue = getPdfDictValue(dictValue, key);
    if (directValue !== undefined) {
      return resolvePdfValue(document, directValue);
    }

    const parentRef = getPdfDictValue(dictValue, "Parent");
    currentObjectId = isPdfRefValue(parentRef) ? parentRef.objectId : undefined;
  }

  return undefined;
}

function collectDecodedPageContent(
  document: ParsedPdfDocument,
  pageObjectId: number,
): Uint8Array {
  const pageDict = asPdfDict(document.getObject(pageObjectId)?.value, "Page");
  const contents = resolvePdfValue(
    document,
    getPdfDictValue(pageDict, "Contents"),
  );
  const streams: Uint8Array[] = [];

  if (Array.isArray(contents) && !isPdfDict(contents)) {
    for (const entry of contents) {
      const streamValue = resolvePdfValue(document, entry);
      if (streamValue && isPdfStream(streamValue)) {
        streams.push(decodePdfStreamBytes(streamValue));
      }
    }
  } else if (contents && isPdfStream(contents)) {
    streams.push(decodePdfStreamBytes(contents));
  }

  if (streams.length === 0) {
    return new Uint8Array();
  }

  const totalLength = streams.reduce((sum, chunk) => sum + chunk.length + 1, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of streams) {
    bytes.set(chunk, offset);
    offset += chunk.length;
    bytes[offset] = 0x0a;
    offset += 1;
  }
  return bytes.subarray(0, offset);
}

function decodePdfStreamBytes(streamValue: PdfStream): Uint8Array {
  const filter = resolveFilterValue(streamValue.dict);
  if (!filter) {
    return streamValue.bytes.slice();
  }

  if (filter !== "FlateDecode") {
    throw new PdfEngineError(
      PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT,
      "Unsupported page content stream filter during page transfer.",
      {
        filter,
      },
    );
  }

  return inflateZlib(streamValue.bytes);
}

function resolveFilterValue(dictValue: PdfDict): string | undefined {
  const filter = getPdfDictValue(dictValue, "Filter");
  if (
    filter &&
    typeof filter === "object" &&
    "kind" in filter &&
    filter.kind === "name"
  ) {
    return filter.value;
  }
  if (Array.isArray(filter) && !isPdfDict(filter)) {
    const first = filter[0];
    if (
      first &&
      typeof first === "object" &&
      "kind" in first &&
      first.kind === "name"
    ) {
      return first.value;
    }
  }
  return undefined;
}

function normalizeMediaBox(
  mediaBox: readonly number[] | undefined,
): readonly number[] {
  if (mediaBox?.length !== 4) {
    return [0, 0, 612, 792];
  }
  return mediaBox;
}

function resolvePdfValue(
  document: ParsedPdfDocument,
  value: PdfValue | undefined,
): PdfValue | undefined {
  let current = value;
  const seen = new Set<number>();
  while (isPdfRefValue(current)) {
    if (seen.has(current.objectId)) {
      break;
    }
    seen.add(current.objectId);
    current = document.getObject(current.objectId)?.value;
  }
  return current;
}

function getPdfDictValue(
  source: PdfDict | undefined,
  key: string,
): PdfValue | undefined {
  return source?.find(([entryKey]) => entryKey === key)?.[1];
}

function asPdfDict(value: PdfValue | undefined, label: string): PdfDict {
  if (value && Array.isArray(value) && isPdfDict(value)) {
    return value;
  }

  throw new PdfEngineError(
    PdfErrorCode.INVALID_PDF,
    `${label} object must be a dictionary.`,
  );
}

function asOptionalPdfDict(value: PdfValue | undefined): PdfDict | undefined {
  return value && Array.isArray(value) && isPdfDict(value) ? value : undefined;
}

function isPdfDict(value: PdfValue[] | PdfDict): value is PdfDict {
  return value.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string",
  );
}

function isPdfRefValue(value: PdfValue | undefined): value is PdfRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "ref"
  );
}

function writePdf(
  objects: PdfIndirectObject[],
  pdfVersion: PdfVersion = "1.4",
): Uint8Array {
  const writer = new ByteWriter();
  writer.writeLine(formatHeader(pdfVersion));
  writer.writeBytes(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));

  const offsets = new Map<number, number>();
  for (const object of objects) {
    offsets.set(object.id, writer.size);
    writer.writeLine(`${object.id} 0 obj`);
    writeObjectValue(writer, object.value);
    writer.writeLine();
    writer.writeLine("endobj");
  }

  const startXref = writer.size;
  const maxObjectId = Math.max(...objects.map((object) => object.id));
  writer.writeLine("xref");
  writer.writeLine(`0 ${maxObjectId + 1}`);
  writer.writeLine("0000000000 65535 f ");
  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    const offset = offsets.get(objectId);
    writer.writeLine(
      offset === undefined
        ? "0000000000 65535 f "
        : `${String(offset).padStart(10, "0")} 00000 n `,
    );
  }

  writer.writeLine("trailer");
  writer.writeLine(
    serializePdfValue(
      dict([
        ["Size", maxObjectId + 1],
        ["Root", ref(1)],
        ["Info", ref(3)],
      ]),
    ),
  );
  writer.writeLine("startxref");
  writer.writeLine(String(startXref));
  writer.writeLine("%%EOF");
  return writer.toUint8Array();
}

function writeObjectValue(writer: ByteWriter, value: PdfValue): void {
  if (isPdfLazyStream(value)) {
    throw new PdfEngineError(PdfErrorCode.INTERNAL_ERROR, "Lazy PDF streams require sink serialization.");
  }

  if (isPdfStream(value)) {
    const streamDict = dict([...value.dict, ["Length", value.bytes.length]]);
    writer.writeLine(serializePdfValue(streamDict));
    writer.writeLine("stream");
    writer.writeBytes(value.bytes);
    writer.writeLine();
    writer.write("endstream");
    return;
  }

  writer.write(serializePdfValue(value));
}
