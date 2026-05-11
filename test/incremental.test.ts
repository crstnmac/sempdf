import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { appendPages, BufferSink, cmyk, createDocument, deviceN, editDocument, extractPages, mergeDocuments, PAGE_SIZES, parseDocument, PdfEngineError, PdfErrorCode, rgb, separation, splitDocument } from "../src/index.js";
import { StreamingByteWriter } from "../src/internal/streaming-byte-writer.js";
import { inspectPdf } from "../src/internal/inspect.js";
import { makeKerningPairKey, measureTextWidth } from "../src/internal/text-layout.js";
import type { PdfValue } from "../src/internal/pdf-primitives.js";
import { parseTrueTypeFont } from "../src/internal/truetype.js";

function isDictValue(value: PdfValue | undefined): value is Array<[string, PdfValue]> {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string");
}

function isNameValue(value: PdfValue, expected: string): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "name" && value.value === expected;
}

function xrefEntry(type: number, field2: number, field3: number): Uint8Array {
  return Uint8Array.from([
    type & 0xff,
    (field2 >>> 24) & 0xff,
    (field2 >>> 16) & 0xff,
    (field2 >>> 8) & 0xff,
    field2 & 0xff,
    (field3 >>> 8) & 0xff,
    field3 & 0xff
  ]);
}

function joinBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function xrefStreamFixtureBytes(): Uint8Array {
  const encoder = new TextEncoder();
  const header = encoder.encode("%PDF-1.5\n");
  const object1 = encoder.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const compressedObjects = [
    { id: 2, body: "<< /Type /Pages /Count 1 /Kids [4 0 R] >>\n" },
    { id: 3, body: "<< /Title (ObjStm PDF) /Producer (Fixture) >>\n" },
    { id: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\n" }
  ];

  let objectBody = "";
  let objectHeader = "";
  for (const object of compressedObjects) {
    objectHeader += `${object.id} ${objectBody.length} `;
    objectBody += object.body;
  }

  const objectStreamDecoded = encoder.encode(objectHeader + objectBody);
  const objectStreamCompressed = deflateSync(objectStreamDecoded);
  const object5Prefix = encoder.encode(
    `5 0 obj\n<< /Type /ObjStm /N ${compressedObjects.length} /First ${objectHeader.length} /Length ${objectStreamCompressed.length} /Filter /FlateDecode >>\nstream\n`
  );
  const object5Suffix = encoder.encode("\nendstream\nendobj\n");
  const object5 = joinBytes([object5Prefix, objectStreamCompressed, object5Suffix]);

  const offset1 = header.length;
  const offset5 = offset1 + object1.length;
  const offset6 = offset5 + object5.length;

  const xrefEntries = joinBytes([
    xrefEntry(0, 0, 65535),
    xrefEntry(1, offset1, 0),
    xrefEntry(2, 5, 0),
    xrefEntry(2, 5, 1),
    xrefEntry(2, 5, 2),
    xrefEntry(1, offset5, 0),
    xrefEntry(1, offset6, 0)
  ]);
  const xrefCompressed = deflateSync(xrefEntries);
  const object6Prefix = encoder.encode(
    `6 0 obj\n<< /Type /XRef /Size 7 /Root 1 0 R /Info 3 0 R /W [1 4 2] /Index [0 7] /Length ${xrefCompressed.length} /Filter /FlateDecode >>\nstream\n`
  );
  const object6Suffix = encoder.encode("\nendstream\nendobj\n");
  const object6 = joinBytes([object6Prefix, xrefCompressed, object6Suffix]);

  const footer = encoder.encode(`startxref\n${offset6}\n%%EOF`);
  return joinBytes([header, object1, object5, object6, footer]);
}

test("incrementally updates metadata and appends pages", () => {
  const baseDoc = createDocument({
    info: {
      title: "Base Title",
      author: "Codex",
      creationDate: "D:20260413213000Z",
      modificationDate: "D:20260413213000Z"
    }
  });

  const basePage = baseDoc.addPage({ size: "Letter" });
  basePage.text("Original page", { x: 36, y: 700 });

  const baseBytes = baseDoc.toUint8Array();
  const baseStartXref = inspectPdf(baseBytes).startXref;

  const editable = editDocument(baseBytes);
  editable.updateInfo({
    title: "Updated Title",
    modificationDate: "D:20260414091500Z"
  });

  const appendedPage = editable.addPage({ size: "Letter" });
  appendedPage.text("Appended page", { x: 36, y: 700, font: "Courier" });

  const bytes = editable.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.deepEqual(bytes.slice(0, baseBytes.length), baseBytes);
  assert.match(text, new RegExp(`/Prev ${baseStartXref}`));
  assert.match(text, /\/Title \(Updated Title\)/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(parsed.getMetadata().title, "Updated Title");
  assert.equal(parsed.getMetadata().modificationDate, "D:20260414091500Z");
  assert.deepEqual(parsed.listPages().map((page) => page.objectId).length, 2);
});

test("incrementally updates and clears XMP metadata", () => {
  const baseXmpMetadata =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Base</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';
  const updatedXmpMetadata =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Updated</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';

  const baseDoc = createDocument({
    xmpMetadata: baseXmpMetadata
  });
  baseDoc.addPage({ size: "Letter" }).text("Original page", { x: 36, y: 700 });

  const baseBytes = baseDoc.toUint8Array();
  const editable = editDocument(baseBytes);
  editable.setXmpMetadata(updatedXmpMetadata);

  const updatedBytes = editable.toUint8Array();
  assert.deepEqual(updatedBytes.slice(0, baseBytes.length), baseBytes);

  const updatedParsed = parseDocument(updatedBytes);
  assert.equal(updatedParsed.getXmpMetadata(), updatedXmpMetadata);

  const clearedEditable = editDocument(updatedBytes);
  clearedEditable.setXmpMetadata(undefined);

  const clearedParsed = parseDocument(clearedEditable.toUint8Array());
  assert.equal(clearedParsed.getXmpMetadata(), undefined);
  const catalogValue = clearedParsed.getObject(clearedParsed.getRootObjectId())?.value;
  assert.equal(isDictValue(catalogValue) && catalogValue.some(([key]) => key === "Metadata"), false);
});

test("returns the original bytes when no incremental changes are made", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage();
  page.text("No changes", { x: 24, y: 700 });

  const baseBytes = baseDoc.toUint8Array();
  const editable = editDocument(baseBytes);

  assert.deepEqual(editable.toUint8Array(), baseBytes);
});

test("incrementally reorders and removes existing pages", () => {
  const baseDoc = createDocument();
  const page1 = baseDoc.addPage({ size: "Letter" });
  page1.text("Page 1", { x: 36, y: 700 });
  const page2 = baseDoc.addPage({ size: "Letter" });
  page2.text("Page 2", { x: 36, y: 700 });
  const page3 = baseDoc.addPage({ size: "Letter" });
  page3.text("Page 3", { x: 36, y: 700 });

  const baseParsed = parseDocument(baseDoc.toUint8Array());
  const baseIds = baseParsed.listPages().map((page) => page.objectId);

  const editable = editDocument(baseDoc.toUint8Array());
  editable.movePage(2, 0);
  editable.removePage(1);

  const updated = parseDocument(editable.toUint8Array());
  assert.equal(updated.getPageCount(), 2);
  assert.deepEqual(updated.listPages().map((page) => page.objectId), [baseIds[2], baseIds[1]]);
});

test("incrementally inserts appended pages at a specific index", () => {
  const baseDoc = createDocument();
  const page1 = baseDoc.addPage({ size: "Letter" });
  page1.text("First", { x: 36, y: 700 });
  const page2 = baseDoc.addPage({ size: "Letter" });
  page2.text("Second", { x: 36, y: 700 });

  const baseBytes = baseDoc.toUint8Array();
  const baseIds = parseDocument(baseBytes).listPages().map((page) => page.objectId);

  const editable = editDocument(baseBytes);
  const inserted = editable.insertPage(1, { size: "Letter" });
  inserted.text("Inserted", { x: 36, y: 700 });

  const updated = parseDocument(editable.toUint8Array());
  const updatedIds = updated.listPages().map((page) => page.objectId);

  assert.equal(updated.getPageCount(), 3);
  assert.equal(updatedIds[0], baseIds[0]);
  assert.equal(updatedIds[2], baseIds[1]);
  assert.equal(updatedIds[1] !== baseIds[0] && updatedIds[1] !== baseIds[1], true);
});

test("incrementally appends AcroForm fields on new pages", () => {
  const baseDoc = createDocument();
  const basePage = baseDoc.addPage({ size: "Letter" });
  basePage.text("Base page", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  const formPage = editable.addPage({ size: "Letter" });
  formPage.textField("email", {
    x: 48,
    y: 620,
    width: 220,
    height: 24,
    value: "ada@example.com",
    readOnly: true
  });

  const parsed = parseDocument(editable.toUint8Array());
  const field = parsed.listFormFields()[0];
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(field?.name, "email");
  assert.equal(field?.pageObjectId, parsed.listPages()[1]?.objectId);
  assert.equal(field?.readOnly, true);
});

test("incrementally removes form fields when their page is removed", () => {
  const baseDoc = createDocument();
  const formPage = baseDoc.addPage({ size: "Letter" });
  formPage.textField("customerId", {
    x: 48,
    y: 620,
    width: 140,
    height: 24,
    value: "42"
  });
  const contentPage = baseDoc.addPage({ size: "Letter" });
  contentPage.text("Keep me", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.removePage(0);

  const parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.getPageCount(), 1);
  assert.equal(parsed.listFormFields().length, 0);
});

test("incrementally appends check box fields on new pages", () => {
  const baseDoc = createDocument();
  const basePage = baseDoc.addPage({ size: "Letter" });
  basePage.text("Base page", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  const formPage = editable.addPage({ size: "Letter" });
  formPage.checkBox("tosAccepted", {
    x: 48,
    y: 620,
    width: 14,
    height: 14,
    checked: true,
    readOnly: true
  });

  const parsed = parseDocument(editable.toUint8Array());
  const field = parsed.listFormFields()[0];
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(field?.name, "tosAccepted");
  assert.equal(field?.checked, true);
  assert.equal(field?.readOnly, true);
  assert.equal(field?.pageObjectId, parsed.listPages()[1]?.objectId);
});

test("incrementally appends choice fields on new pages", () => {
  const baseDoc = createDocument();
  const basePage = baseDoc.addPage({ size: "Letter" });
  basePage.text("Base page", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  const formPage = editable.addPage({ size: "Letter" });
  formPage.choiceField("department", {
    x: 48,
    y: 620,
    width: 180,
    height: 24,
    options: ["Engineering", "Design", "Sales"],
    value: "Design",
    mode: "list",
    readOnly: true
  });

  const parsed = parseDocument(editable.toUint8Array());
  const field = parsed.listFormFields()[0];
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(field?.name, "department");
  assert.equal(field?.fieldType, "Ch");
  assert.equal(field?.value, "Design");
  assert.equal(field?.choiceMode, "list");
  assert.equal(field?.readOnly, true);
  assert.equal(field?.pageObjectId, parsed.listPages()[1]?.objectId);
});

test("rejects invalid editable page indices", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage();
  page.text("Editable page", { x: 24, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());

  assert.throws(
    () => editable.removePage(1),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PAGE
  );

  assert.throws(
    () => editable.movePage(0, 1),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PAGE
  );

  assert.throws(
    () => editable.insertPage(-1),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PAGE
  );
});

test("parses xref streams and compressed object streams", () => {
  const bytes = xrefStreamFixtureBytes();
  const parsed = parseDocument(bytes);

  assert.equal(parsed.version, "1.5");
  assert.equal(parsed.getPageCount(), 1);
  assert.equal(parsed.getMetadata().title, "ObjStm PDF");
  assert.equal(parsed.getMetadata().producer, "Fixture");
  assert.deepEqual(parsed.listPages()[0]?.mediaBox, [0, 0, 612, 792]);

  const pagesObject = parsed.getObject(2)?.value;
  assert.equal(isDictValue(pagesObject) && pagesObject.some(([key, value]) => key === "Type" && isNameValue(value, "Pages")), true);
});

test("incrementally edits xref-stream PDFs by appending a new revision xref stream", () => {
  const editable = editDocument(xrefStreamFixtureBytes());
  const page = editable.addPage();
  page.text("Appended from xref stream", { x: 36, y: 700 });

  const bytes = editable.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.equal(parsed.getPageCount(), 2);
  assert.match(text, /\/Type \/XRef/);
  assert.match(text, /\/Prev \d+/);
});

test("serializes generated PDFs with compressed object streams when requested", () => {
  const doc = createDocument({ objectStreams: true, compress: true });
  const page = doc.addPage();
  page.text("Object stream body", { x: 36, y: 700 });
  page.note({ x: 36, y: 660, contents: "Packed objects" });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.match(text, /%PDF-1\.5/);
  assert.match(text, /\/Type \/ObjStm/);
  assert.match(text, /\/Type \/XRef/);
  assert.equal(parsed.getPageCount(), 1);
});

test("serializes encrypted generated PDFs with object streams", () => {
  const doc = createDocument({
    objectStreams: true,
    compress: true,
    encryption: {
      algorithm: "aes-128",
      userPassword: "reader"
    }
  });
  doc.addPage().text("Encrypted object stream body", { x: 36, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes, { password: "reader" });

  assert.match(text, /\/Type \/ObjStm/);
  assert.match(text, /\/CFM \/AESV2/);
  assert.equal(parsed.getPageCount(), 1);
});

test("incrementally adds XMP metadata to xref-stream PDFs", () => {
  const xmpMetadata =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>XRef Stream</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';

  const editable = editDocument(xrefStreamFixtureBytes());
  editable.setXmpMetadata(xmpMetadata);

  const bytes = editable.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.match(text, /\/Type \/XRef/);
  assert.equal(parsed.getXmpMetadata(), xmpMetadata);
});

test("edits existing pages by appending overlay content streams", () => {
  const baseDoc = createDocument();
  baseDoc.addPage().text("Base layer", { x: 36, y: 700 });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.editPage(0).text("Overlay layer", { x: 36, y: 680, font: "Courier" });

  const updated = parseDocument(editable.toUint8Array());
  assert.equal(updated.listPages()[0]?.contentObjectIds.length, 2);
});

test("writePageContent appends content to existing page", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "A4" });
  page.text("Original text", { x: 72, y: 720, fontSize: 12 });
  const pdfBytes = doc.toUint8Array();

  const edit = editDocument(pdfBytes);
  edit.writePageContent(0, "BT /F1 12 Tf 72 700 Td (Overlay text) Tj ET", "append");
  const editedBytes = edit.toUint8Array();
  assert.ok(editedBytes.length > pdfBytes.length);

  const parsed = parseDocument(editedBytes);
  const text = new TextDecoder().decode(editedBytes);
  assert.ok(text.includes("Original text"));
  assert.ok(text.includes("Overlay text"));
});

test("writePageContent prepends content to existing page", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Body text", { x: 72, y: 720 });
  const pdfBytes = doc.toUint8Array();

  const edit = editDocument(pdfBytes);
  edit.writePageContent(0, "BT /F1 12 Tf 72 740 Td (Header text) Tj ET", "prepend");
  const editedBytes = edit.toUint8Array();

  const text = new TextDecoder().decode(editedBytes);
  assert.ok(text.includes("Header text"));
  assert.ok(text.includes("Body text"));
});

test("writePageContent replaces page content", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Old text", { x: 72, y: 720 });
  const pdfBytes = doc.toUint8Array();

  const edit = editDocument(pdfBytes);
  edit.writePageContent(0, "BT /F1 12 Tf 72 720 Td (New text) Tj ET", "replace");
  const editedBytes = edit.toUint8Array();

  const text = new TextDecoder().decode(editedBytes);
  assert.ok(text.includes("New text"));
});

test("rejects writePageContent with invalid page index", () => {
  const doc = createDocument();
  doc.addPage().text("Content", { x: 72, y: 720 });
  const pdfBytes = doc.toUint8Array();
  const edit = editDocument(pdfBytes);

  assert.throws(
    () => edit.writePageContent(99, "BT /F1 12 Tf ET", "append"),
    (error: unknown) =>
      error instanceof PdfEngineError &&
      error.code === PdfErrorCode.INVALID_PAGE,
  );
});

test("extracts, splits, merges, and appends pages across PDFs", () => {
  const source = createDocument();
  source.addPage().text("Page one", { x: 36, y: 700 });
  source.addPage().text("Page two", { x: 36, y: 700 });
  const sourceBytes = source.toUint8Array();

  const extracted = extractPages(sourceBytes, [1]);
  const split = splitDocument(sourceBytes);
  const merged = mergeDocuments([sourceBytes, extracted]);
  const appended = appendPages(extracted, sourceBytes, [0]);

  assert.equal(parseDocument(extracted).getPageCount(), 1);
  assert.equal(split.length, 2);
  assert.equal(parseDocument(split[0]!).getPageCount(), 1);
  assert.equal(parseDocument(split[1]!).getPageCount(), 1);
  assert.equal(parseDocument(merged).getPageCount(), 3);
  assert.equal(parseDocument(appended).getPageCount(), 2);
});
