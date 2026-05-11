import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, parseDocument, PdfEngineError, PdfErrorCode, rgb } from "../src/index.js";
import type { PdfValue } from "../src/internal/pdf-primitives.js";

function isDictValue(value: PdfValue | undefined): value is Array<[string, PdfValue]> {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string");
}

function isNameValue(value: PdfValue, expected: string): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "name" && value.value === expected;
}

test("serializes URI link annotations and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.text("Open OpenAI", { x: 36, y: 700 });
  page.link("https://openai.com", {
    x: 36,
    y: 694,
    width: 120,
    height: 18,
    borderWidth: 0
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Subtype \/Link/);
  assert.match(text, /\/S \/URI/);
  assert.match(text, /\/URI \(https:\/\/openai\.com\)/);

  const parsed = parseDocument(bytes);
  const parsedPage = parsed.listPages()[0];
  const pageObject = parsedPage ? parsed.getObject(parsedPage.objectId)?.value : undefined;
  assert.equal(isDictValue(pageObject) && pageObject.some(([key]) => key === "Annots"), true);

  const annotationObject = parsed
    .getObjectIds()
    .map((id) => parsed.getObject(id)?.value)
    .find((value) =>
      isDictValue(value) && value.some(([key, entry]) => key === "Subtype" && isNameValue(entry, "Link"))
    );
  assert.equal(
    isDictValue(annotationObject) &&
      annotationObject.some(([key, entry]) => key === "Subtype" && isNameValue(entry, "Link")),
    true
  );
});

test("rejects invalid link annotations", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Has content", { x: 24, y: 700 });

  assert.throws(
    () => page.link("not-a-url", { x: 24, y: 24, width: 50, height: 20 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_LINK
  );

  assert.throws(
    () => page.link("https://openai.com", { x: 24, y: 24, width: 0, height: 20 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_LINK
  );
});

test("serializes internal page links as destinations", () => {
  const doc = createDocument();
  const firstPage = doc.addPage({ size: "Letter" });
  firstPage.text("Jump to page 2", { x: 36, y: 700 });

  const secondPage = doc.addPage({ size: "Letter" });
  secondPage.text("Destination page", { x: 36, y: 700 });

  firstPage.linkToPage(secondPage, {
    x: 36,
    y: 694,
    width: 120,
    height: 18
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Dest \[\d+ 0 R \/Fit\]/);

  const parsed = parseDocument(bytes);
  const linkAnnotation = parsed
    .getObjectIds()
    .map((id) => parsed.getObject(id)?.value)
    .find((value) =>
      isDictValue(value) && value.some(([key, entry]) => key === "Dest" && Array.isArray(entry))
    );

  assert.equal(isDictValue(linkAnnotation), true);
});

test("serializes named destinations and outline bookmarks", () => {
  const doc = createDocument();
  const firstPage = doc.addPage({ size: "Letter" });
  firstPage.text("Section one", { x: 36, y: 700 });

  const secondPage = doc.addPage({ size: "Letter" });
  secondPage.text("Section two", { x: 36, y: 700 });

  doc.addNamedDestination("section-two", secondPage);
  const topLevel = doc.addOutline("Section One", firstPage);
  topLevel.addChild("Jump to section two", "section-two", { expanded: false });
  doc.addOutline("Section Two", secondPage);

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Outlines \d+ 0 R/);
  assert.match(text, /\/PageMode \/UseOutlines/);
  assert.match(text, /\/Dests << \/Names \[\(section-two\) \[\d+ 0 R \/Fit\]\] >>/);
  assert.match(text, /\/Title \(Section One\)/);
  assert.match(text, /\/Title \(Jump to section two\)/);
  assert.match(text, /\/Dest \(section-two\)/);

  const parsed = parseDocument(bytes);
  assert.deepEqual(parsed.listNamedDestinations(), [
    {
      name: "section-two",
      pageObjectId: parsed.listPages()[1]?.objectId,
      mode: "Fit"
    }
  ]);

  assert.deepEqual(parsed.listOutlines(), [
    {
      title: "Section One",
      targetPageObjectId: parsed.listPages()[0]?.objectId,
      children: [
        {
          title: "Jump to section two",
          targetName: "section-two",
          targetPageObjectId: parsed.listPages()[1]?.objectId,
          children: []
        }
      ]
    },
    {
      title: "Section Two",
      targetPageObjectId: parsed.listPages()[1]?.objectId,
      children: []
    }
  ]);
});

test("serializes page labels and embedded file attachments", () => {
  const doc = createDocument();
  const cover = doc.addPage({ size: "Letter" });
  cover.text("Cover", { x: 36, y: 700 });

  const body = doc.addPage({ size: "Letter" });
  body.text("Body", { x: 36, y: 700 });

  const appendix = doc.addPage({ size: "Letter" });
  appendix.text("Appendix", { x: 36, y: 700 });

  doc.setPageLabel(cover, { style: "decimal", prefix: "Sec-" });
  doc.setPageLabel(appendix, { style: "romanLower", prefix: "App-", startAt: 7 });
  doc.attachFile("notes.txt", new TextEncoder().encode("hi"), {
    description: "Release notes",
    mimeType: "text/plain"
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /\/PageLabels << \/Nums \[/);
  assert.match(text, /\/EmbeddedFiles << \/Names \[/);
  assert.match(text, /\/Type \/EmbeddedFile/);
  assert.match(text, /\/Subtype \/text#2Fplain/);

  const parsed = parseDocument(bytes);
  assert.deepEqual(parsed.listPageLabels(), [
    {
      startPageIndex: 0,
      style: "decimal",
      prefix: "Sec-",
      startAt: 1
    },
    {
      startPageIndex: 2,
      style: "romanLower",
      prefix: "App-",
      startAt: 7
    }
  ]);

  const attachments = parsed.listAttachments();
  assert.equal(attachments.length, 1);
  assert.deepEqual(
    attachments.map(({ objectId: _objectId, ...attachment }) => attachment),
    [
      {
        name: "notes.txt",
        description: "Release notes",
        mimeType: "text/plain",
        byteLength: 2
      }
    ]
  );
  assert.equal(typeof attachments[0]?.objectId, "number");
});

test("rejects invalid page labels and attachment definitions", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.text("Validation", { x: 36, y: 700 });

  assert.throws(
    () => doc.setPageLabel(page, {}),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PAGE_LABEL
  );

  assert.throws(
    () => doc.attachFile("", new Uint8Array([1])),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ATTACHMENT
  );

  doc.attachFile("notes.txt", new Uint8Array([1]));
  doc.attachFile("notes.txt", new Uint8Array([2]));

  assert.throws(
    () => doc.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ATTACHMENT
  );
});

test("rejects invalid named destinations and outline targets", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Outline content", { x: 24, y: 700 });

  assert.throws(
    () => doc.addNamedDestination("", page),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_DESTINATION
  );

  assert.throws(
    () => doc.addOutline(" ", page),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_OUTLINE
  );

  const foreignDoc = createDocument();
  const foreignPage = foreignDoc.addPage();
  foreignPage.text("Foreign page", { x: 24, y: 700 });

  doc.addNamedDestination("foreign", foreignPage);
  assert.throws(
    () => doc.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_DESTINATION
  );

  const secondDoc = createDocument();
  const secondPage = secondDoc.addPage();
  secondPage.text("Same document", { x: 24, y: 700 });
  secondDoc.addOutline("Broken", "missing-destination");

  assert.throws(
    () => secondDoc.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_OUTLINE
  );
});

test("serializes highlight, note, and free text annotations", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Annotated", { x: 36, y: 700 });
  page.highlight({ x: 34, y: 694, width: 80, height: 14, color: rgb(1, 1, 0) });
  page.note({ x: 120, y: 694, contents: "Review this" });
  page.freeText({ x: 36, y: 640, width: 140, height: 32, text: "Inline note" });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Subtype \/Highlight/);
  assert.match(text, /\/Subtype \/Text/);
  assert.match(text, /\/Subtype \/FreeText/);
});
