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

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC";
function tinyPngBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));
}
function envFontCandidates(...keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const value = process.env[key];
    return value === undefined || value.length === 0 ? [] : [value];
  });
}
function findTrueTypeFixturePath(): string | undefined {
  const candidates = [
    ...envFontCandidates("PDF_EDITING_LIB_TEST_FONT", "PDF_EDITING_LIB_FONT_PATH"),
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Geneva.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ];

  return candidates.find((path) => existsSync(path));
}


function isStreamValue(value: PdfValue): value is Extract<PdfValue, { kind: "stream" }> {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "stream";
}

function isDictValue(value: PdfValue | undefined): value is Array<[string, PdfValue]> {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string");
}

function isNameValue(value: PdfValue, expected: string): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "name" && value.value === expected;
}

function isRefValue(value: PdfValue | undefined): value is Extract<PdfValue, { kind: "ref" }> {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "ref";
}

function getDictEntry(dict: PdfValue | undefined, key: string): PdfValue | undefined {
  return isDictValue(dict) ? dict.find(([entryKey]) => entryKey === key)?.[1] : undefined;
}

function resolveTestValue(parsed: ReturnType<typeof parseDocument>, value: PdfValue | undefined): PdfValue | undefined {
  return isRefValue(value) ? parsed.getObject(value.objectId)?.value : value;
}

function collectParentTreeEntries(parsed: ReturnType<typeof parseDocument>): Map<number, PdfValue> {
  const catalog = parsed.getObject(parsed.getRootObjectId())?.value;
  const structTreeRoot = resolveTestValue(parsed, getDictEntry(catalog, "StructTreeRoot"));
  const parentTree = resolveTestValue(parsed, getDictEntry(structTreeRoot, "ParentTree"));
  const entries = new Map<number, PdfValue>();
  collectParentTreeEntriesFromNode(parsed, parentTree, entries);
  return entries;
}

function collectParentTreeEntriesFromNode(
  parsed: ReturnType<typeof parseDocument>,
  node: PdfValue | undefined,
  entries: Map<number, PdfValue>
): void {
  const resolvedNode = resolveTestValue(parsed, node);
  const nums = getDictEntry(resolvedNode, "Nums");
  if (Array.isArray(nums) && !isDictValue(nums)) {
    for (let index = 0; index < nums.length; index += 2) {
      const key = nums[index];
      const value = nums[index + 1];
      if (typeof key === "number" && value !== undefined) {
        entries.set(key, value);
      }
    }
  }

  const kids = getDictEntry(resolvedNode, "Kids");
  if (Array.isArray(kids) && !isDictValue(kids)) {
    for (const kid of kids) {
      collectParentTreeEntriesFromNode(parsed, kid, entries);
    }
  }
}

function forceDirectStructTreeRootKid(bytes: Uint8Array): Uint8Array {
  const parsed = parseDocument(bytes);
  const catalog = parsed.getObject(parsed.getRootObjectId())?.value;
  const structTreeRootRef = getDictEntry(catalog, "StructTreeRoot");
  assert.ok(isRefValue(structTreeRootRef));

  const objectOffset = parsed.xrefOffsets.get(structTreeRootRef.objectId);
  assert.notEqual(objectOffset, undefined);

  const text = Buffer.from(bytes).toString("latin1");
  const objectEnd = text.indexOf("endobj", objectOffset);
  assert.notEqual(objectEnd, -1);

  const objectText = text.slice(objectOffset, objectEnd);
  const updatedObjectText = objectText.replace(/\/K \[(\d+ 0 R)\]/, (_match, kid: string) => `/K ${kid}  `);
  assert.notEqual(updatedObjectText, objectText);
  assert.equal(updatedObjectText.length, objectText.length);

  const output = new Uint8Array(bytes);
  output.set(Buffer.from(updatedObjectText, "latin1"), objectOffset);
  return output;
}

test("serializes tagged structure elements and document language", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const page = doc.addPage({ size: "Letter" });
  page.text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  page.png(tinyPngBytes(), {
    x: 36,
    y: 640,
    width: 24,
    height: 24,
    altText: "Example logo"
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/MarkInfo <</);
  assert.match(text, /\/StructTreeRoot \d+ 0 R/);
  assert.match(text, /\/Lang \(en-US\)/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.isTagged(), true);
  assert.equal(parsed.getLanguage(), "en-US");
  assert.deepEqual(
    parsed.listStructureElements().map((element) => ({
      role: element.role,
      altText: element.altText
    })),
    [
      { role: "H1", altText: undefined },
      { role: "Figure", altText: "Example logo" }
    ]
  );
});

test("serializes extended structure roles, role maps, metadata, and tagged links", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-GB",
    structureRoot: "Document",
    roleMap: {
      CustomHeading: "H5"
    }
  });

  const page = doc.addPage({ size: "Letter" });
  page.structure("CustomHeading", {
    language: "en-US",
    actualText: "Deep heading"
  }, (heading) => {
    heading.text("Deep heading", {
      x: 36,
      y: 720,
      tag: "H5"
    });
  });
  page.container("Table", (table) => {
    table.container("TR", (row) => {
      row.text("Header", { x: 36, y: 680, tag: "Span" });
    });
  });
  page.link("https://example.com", {
    x: 36,
    y: 640,
    width: 100,
    height: 16,
    tag: "Link",
    structure: {
      altText: "Example link"
    }
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/RoleMap <<\s*\/CustomHeading \/H5\s*>>/);
  assert.match(text, /\/Type \/OBJR/);
  assert.match(text, /\/ActualText \(Deep heading\)/);
  assert.match(text, /\/Lang \(en-US\)/);

  const parsed = parseDocument(bytes);
  const [root] = parsed.listStructureElements();
  assert.equal(root?.role, "Document");
  assert.deepEqual(root?.children?.map((element) => element.role), ["CustomHeading", "Table", "P"]);
  assert.equal(root?.children?.[0]?.actualText, "Deep heading");
  assert.equal(root?.children?.[0]?.language, "en-US");
  const linkWrapper = root?.children?.[2];
  assert.equal(linkWrapper?.children?.[0]?.role, "Link");
  assert.equal(linkWrapper?.children?.[0]?.altText, "Example link");
});

test("serializes tagged page links, annotations, form widgets, attributes, and path artifacts", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const first = doc.addPage({ size: "Letter" });
  const second = doc.addPage({ size: "Letter" });
  second.text("Details", { x: 36, y: 720, tag: "H1" });

  first.path(
    [{ type: "rect", x: 30, y: 700, width: 80, height: 20 }],
    { paint: "stroke", tag: "Artifact" }
  );
  first.linkToPage(second, {
    x: 36,
    y: 660,
    width: 90,
    height: 16,
    tag: "Link",
    structure: { actualText: "Go to details" }
  });
  first.highlight({
    x: 36,
    y: 630,
    width: 90,
    height: 16,
    tag: "Annot",
    structure: { altText: "Important highlight" }
  });
  first.textField("name", {
    x: 36,
    y: 590,
    width: 120,
    height: 24,
    tag: "Annot",
    structure: {
      altText: "Name field",
      attributes: {
        O: { name: "Layout" },
        RowSpan: 1,
        Headers: ["name-header"]
      }
    }
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/Artifact(?: BMC| <<)/);
  assert.match(text, /\/Type \/OBJR/);
  assert.match(text, /\/A <<\s*\/O \/Layout\s*\/RowSpan 1\s*\/Headers \[\(name-header\)\]\s*\/BBox \[36 590 156 614\]\s*>>/);

  const [root] = parseDocument(bytes).listStructureElements();
  assert.equal(root?.role, "Document");
  assert.deepEqual(root?.children?.map((element) => element.role), ["Link", "Annot", "Annot", "H1"]);
  assert.equal(root?.children?.[0]?.actualText, "Go to details");
  assert.equal(root?.children?.[1]?.altText, "Important highlight");
  assert.equal(root?.children?.[2]?.altText, "Name field");
});

test("infers structure bounding boxes and supports flow-authored tagged content", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.flow({ margin: 48, width: 300 })
    .heading("Flow Report")
    .paragraph("This paragraph is tagged and laid out without caller supplied coordinates.")
    .link("Read more", "https://example.com/report")
    .png(tinyPngBytes(), {
      width: 24,
      altText: "Status icon"
    });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/S \/H1/);
  assert.match(text, /\/S \/P/);
  assert.match(text, /\/S \/Link/);
  assert.match(text, /\/S \/Figure/);
  assert.match(text, /\/BBox \[48 [0-9.]+ 72 [0-9.]+\]/);

  const [root] = parseDocument(doc.toUint8Array()).listStructureElements();
  assert.deepEqual(root?.children?.map((element) => element.role), ["H1", "P", "P", "Figure"]);
  assert.equal(root?.children?.[2]?.children?.[0]?.role, "Link");
});

test("richParagraph emits tagged structure content with text and mcids", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.richText(
    [
      { text: "Hello ", bold: true },
      { text: "world", italic: true }
    ],
    { x: 36, y: 720, width: 200, tag: "P" }
  );

  const inspected = parseDocument(doc.toUint8Array()).inspectStructureElements();
  const pElement = inspected[0]?.children?.find((e) => e.role === "P");
  assert.ok(pElement, "richText should produce a P structure element");
  assert.equal(pElement?.text, "Hello world");

  const struct = parseDocument(doc.toUint8Array()).listStructureElements();
  const pStruct = struct[0]?.children?.find((e) => e.role === "P");
  assert.ok(pStruct?.mcids, "richText P element should have mcids");
  assert.ok(pStruct!.mcids!.length > 0, "richText P element mcids should not be empty");
});

test("flow richParagraph emits tagged structure content with text and mcids", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.flow({ margin: 48, width: 300 })
    .richParagraph(
      [
        { text: "Bold ", bold: true },
        { text: "and italic", italic: true }
      ],
      { tag: "P" }
    );

  const inspected = parseDocument(doc.toUint8Array()).inspectStructureElements();
  const pElement = inspected[0]?.children?.find((e) => e.role === "P");
  assert.ok(pElement, "flow richParagraph should produce a P structure element");
  assert.equal(pElement?.text, "Bold and italic");

  const struct = parseDocument(doc.toUint8Array()).listStructureElements();
  const pStruct = struct[0]?.children?.find((e) => e.role === "P");
  assert.ok(pStruct?.mcids, "flow richParagraph P element should have mcids");
  assert.ok(pStruct!.mcids!.length > 0, "flow richParagraph P element mcids should not be empty");
});

test("flow richParagraph tolerates null/undefined run text instead of throwing", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  assert.doesNotThrow(() => {
    page.flow({ margin: 48, width: 300 }).richParagraph([
      { text: "Page URL: ", bold: true },
      // Simulates `localStorage.getItem(...)` returning null on a miss.
      { text: null as unknown as string, link: null as unknown as string, color: rgb(0, 0, 1), underline: true }
    ]);
  });

  // The valid run still renders; the null run degrades to nothing.
  const inspected = parseDocument(doc.toUint8Array()).inspectStructureElements();
  const pElement = inspected[0]?.children?.find((e) => e.role === "P");
  assert.equal(pElement?.text?.trim(), "Page URL:");
});

test("richParagraph uses custom tag on structure element", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.flow({ margin: 48, width: 300 })
    .richParagraph(
      [{ text: "Custom tagged content" }],
      { tag: "H3" }
    );

  const struct = parseDocument(doc.toUint8Array()).listStructureElements();
  const h3Element = struct[0]?.children?.find((e) => e.role === "H3");
  assert.ok(h3Element, "richParagraph should accept custom tag H3");
  assert.ok(h3Element?.mcids?.length, "H3 element should have mcids");
});

test("richParagraph multiple paragraphs each have distinct mcids", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.flow({ margin: 48, width: 300 })
    .richParagraph([{ text: "First paragraph" }])
    .richParagraph([{ text: "Second paragraph" }]);

  const struct = parseDocument(doc.toUint8Array()).listStructureElements();
  const pElements = struct[0]?.children?.filter((e) => e.role === "P") ?? [];
  assert.equal(pElements.length, 2, "should have two P elements");
  for (const [i, p] of pElements.entries()) {
    assert.ok(p.mcids, `P element ${i} should have mcids`);
    assert.ok(p.mcids!.length > 0, `P element ${i} mcids should not be empty`);
  }
});

test("flow block margins control placement without legacy spacing props", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: { width: 200, height: 200 } });

  page.flow({ margin: [10, 20, 30, 40] }).png(tinyPngBytes(), {
    width: 10,
    height: 10,
    altText: "Top-left margin image"
  });

  page.flow({ margin: 10 }).png(tinyPngBytes(), {
    width: 10,
    height: 10,
    marginLeft: 20,
    marginRight: 30,
    align: "right",
    altText: "Right-aligned inset image"
  });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/BBox \[40 180 50 190\]/);
  assert.match(text, /\/BBox \[150 180 160 190\]/);
  assert.doesNotMatch(text, /spaceBefore|spaceAfter|spaceLeft/i);
});

test("renders template blocks across pages with semantic tags", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });

  doc.renderTemplate({
    page: {
      size: { width: 240, height: 220 },
      margin: 24,
      marginBottom: 24
    },
    blocks: [
      { type: "heading", text: "Template report" },
      ...Array.from({ length: 14 }, (_, index) => ({
        type: "paragraph" as const,
        text: `Paragraph ${index + 1} in an automatically paginated template document.`
      })),
      {
        type: "table",
        rows: [
          [{ text: "Metric", header: true }, { text: "Result", header: true }],
          [{ text: "Tagged", header: true, scope: "row" }, "Yes"]
        ],
        options: { headerRows: 1, headerColumns: 1 }
      }
    ],
    header: ({ pageNumber }) => [
      { type: "paragraph", text: `Page ${pageNumber}`, options: { fontSize: 8 } }
    ]
  });

  assert.ok(doc.toUint8Array().length > 0);
  const parsed = parseDocument(doc.toUint8Array());
  assert.ok(parsed.getPageCount() > 1);

  const [root] = parsed.listStructureElements();
  const roles = root?.children?.map((element) => element.role) ?? [];
  assert.ok(roles.includes("H1"));
  assert.ok(roles.includes("P"));
  assert.ok(roles.includes("Table"));
});

test("template running header reads and draws before the body", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });

  doc.renderTemplate({
    page: { size: "A4", margin: 70 },
    header: () => [
      {
        type: "png",
        data: tinyPngBytes(),
        options: { width: 160, align: "center", altText: "Logo", tag: "Figure" }
      }
    ],
    blocks: [
      { type: "heading", text: "Audit Report", options: { level: 1, bold: true } },
      { type: "paragraph", text: "Body paragraph." }
    ]
  });

  const struct = parseDocument(doc.toUint8Array()).listStructureElements();
  const children = struct[0]?.children ?? [];
  // Reading order: the header Figure is hoisted to the front of the tag tree.
  assert.equal(children[0]?.role, "Figure");
  // Content order: it is also drawn first, so it owns the lowest MCID (0).
  const figure = children[0];
  assert.deepEqual(figure?.mcids, [0]);
  const h1 = children.find((element) => element.role === "H1");
  assert.ok((h1?.mcids?.[0] ?? -1) > (figure?.mcids?.[0] ?? -1), "H1 should draw after the header Figure");
});

test("flow advances past wrapped table cell content", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: { width: 220, height: 260 } });
  const flow = page.flow({ margin: 24, width: 120, fontSize: 10, gap: 8 });
  const startY = flow.cursorY;

  flow.table(
    [
      ["Label", "Value"],
      [
        "Long",
        "This table cell wraps across multiple lines so the flow cursor must advance by the measured row height."
      ]
    ],
    { fontSize: 10 }
  );

  assert.ok(
    flow.cursorY < startY - 50,
    `expected wrapped table to consume more than a fixed two-row height, got ${startY - flow.cursorY}`
  );
});

test("serializes tagged table helpers with header scopes and spans", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.table(
    [
      [
        { text: "Metric", header: true },
        { text: "Q1", header: true },
        { text: "Q2", header: true }
      ],
      [
        { text: "Revenue", header: true, scope: "row" },
        { text: "$10M", colSpan: 2, structure: { attributes: { Headers: ["q1", "q2"] } } }
      ],
      [
        { text: "Notes", header: true, rowSpan: 2 },
        "Audited",
        "Reviewed"
      ],
      [
        "Board",
        "Approved"
      ]
    ],
    {
      x: 36,
      y: 720,
      width: 300,
      columnWidths: [100, 100, 100],
      headerRows: 1,
      headerColumns: 1
    }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/S \/Table/);
  assert.match(text, /\/S \/TR/);
  assert.match(text, /\/S \/TH/);
  assert.match(text, /\/S \/TD/);
  assert.match(text, /\/Scope \/Column/);
  assert.match(text, /\/Scope \/Row/);
  assert.match(text, /\/ColSpan 2/);
  assert.match(text, /\/RowSpan 2/);
  assert.match(text, /\/Headers \[\(q1\) \(q2\)\]/);

  const [root] = parseDocument(doc.toUint8Array()).listStructureElements();
  const table = root?.children?.[0];
  assert.equal(table?.role, "Table");
  assert.deepEqual(table?.children?.map((row) => row.role), ["TR", "TR", "TR", "TR"]);
  assert.deepEqual(table?.children?.[0]?.children?.map((cell) => cell.role), ["TH", "TH", "TH"]);
});

test("inspects tagged structure content text and OBJR annotations", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US",
    structureRoot: "Document"
  });
  const page = doc.addPage({ size: "Letter" });

  page.text("Quarterly Report", { x: 36, y: 720, tag: "H1" });
  page.table(
    [
      [{ text: "Metric", header: true }, { text: "Q1", header: true }],
      [{ text: "Revenue", header: true, scope: "row" }, "$10M"]
    ],
    {
      x: 36,
      y: 680,
      width: 180,
      columnWidths: [90, 90],
      headerRows: 1,
      headerColumns: 1
    }
  );
  page.textField("approval", {
    x: 36,
    y: 560,
    width: 120,
    height: 24,
    value: "Approved",
    tag: "Annot",
    structure: { altText: "Approval field" }
  });
  page.structure("Link", { actualText: "Open report" }, (link) => {
    link.text("Open report", {
      x: 36,
      y: 525,
      tag: "Span"
    });
    link.link("https://example.com/report", {
      x: 36,
      y: 521,
      width: 120,
      height: 16,
      tag: "Link"
    });
  });

  const [root] = parseDocument(doc.toUint8Array()).inspectStructureElements();
  assert.equal(root?.role, "Document");

  const heading = root?.children?.find((element) => element.role === "H1");
  assert.equal(heading?.text, "Quarterly Report");

  const table = root?.children?.find((element) => element.role === "Table");
  const firstHeader = table?.children?.[0]?.children?.[0];
  const valueCell = table?.children?.[1]?.children?.[1];
  assert.equal(firstHeader?.role, "TH");
  assert.equal(firstHeader?.text, "Metric");
  assert.equal(valueCell?.role, "TD");
  assert.equal(valueCell?.text, "$10M");

  const widget = root?.children?.find((element) => element.altText === "Approval field");
  assert.equal(widget?.annotations?.[0]?.subtype, "Widget");
  assert.equal(widget?.annotations?.[0]?.fieldName, "approval");
  assert.equal(widget?.annotations?.[0]?.fieldType, "Tx");
  assert.equal(widget?.annotations?.[0]?.value, "Approved");

  const link = root?.children?.find((element) => element.role === "Link");
  assert.equal(link?.actualText, "Open report");
  assert.deepEqual(link?.children?.map((element) => element.role), ["Span"]);
  assert.equal(link?.children?.[0]?.text, "Open report");
  assert.equal(link?.annotations?.[0]?.subtype, "Link");
  assert.equal(link?.annotations?.[0]?.url, "https://example.com/report");
});

test("serializes PDF/UA-1 identification metadata and validates required tagging inputs", () => {
  const doc = createDocument({
    conformance: "pdfua-1",
    tagged: true,
    language: "en-US",
    structureRoot: "Document",
    info: {
      title: "Accessible Document"
    }
  });
  const page = doc.addPage({ size: "Letter" });
  page.link("https://example.com/accessibility", {
    x: 36,
    y: 680,
    width: 120,
    height: 16,
    tag: "Link",
    structure: { altText: "Accessibility link" }
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/ViewerPreferences <<\s*\/DisplayDocTitle true\s*>>/);
  assert.match(text, /\/Tabs \/S/);
  assert.match(text, /\/Contents \(Accessibility link\)/);
  assert.match(text, /\/StructParent \d+/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getConformanceProfile(), "pdfua-1");
  assert.match(parsed.getXmpMetadata() ?? "", /pdfuaid:part>\s*1\s*</);
  const findLink = (nodes?: readonly any[]): any => {
    for (const node of nodes ?? []) {
      if (node.role === "Link") return node;
      const inner = findLink(node.children);
      if (inner) return inner;
    }
    return undefined;
  };
  assert.equal(findLink(parsed.inspectStructureElements()[0]?.children)?.annotations?.[0]?.contents, "Accessibility link");

  const invalid = createDocument({ conformance: "pdfua-1" });
  invalid.addPage({ size: "Letter" }).text("Plain", { x: 36, y: 720 });
  assert.throws(
    () => invalid.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );
});

test("reports tagged PDF accessibility warnings", () => {
  const doc = createDocument({ tagged: true });
  const page = doc.addPage();
  page.text("Heading", { x: 36, y: 720, tag: "H1" });
  page.png(tinyPngBytes(), {
    x: 36,
    y: 640,
    width: 24,
    height: 24,
    tag: "Figure"
  });

  const issues = [...doc.validateCompliance()].sort((left, right) => left.code.localeCompare(right.code));
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ["FIGURE_ALT_TEXT_RECOMMENDED", "TAGGED_LANGUAGE_RECOMMENDED"]
  );
});

test("groups wrapped tagged text blocks into a single structure element", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const page = doc.addPage({ size: "Letter" });
  page.textBlock(
    "This paragraph wraps onto multiple lines so the tagged PDF structure should keep it as one logical paragraph element.",
    {
      x: 36,
      y: 720,
      width: 140,
      fontSize: 12,
      lineHeight: 14,
      tag: "P"
    }
  );

  const parsed = parseDocument(doc.toUint8Array());
  const structureElements = parsed.listStructureElements();

  assert.equal(structureElements.length, 1);
  assert.equal(structureElements[0]?.role, "P");
  assert.equal((structureElements[0]?.mcids?.length ?? 0), 1);
});

test("groups fallback-split tagged text into a single structure element", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const fallbackFont = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "TaggedFallback" });
  const page = doc.addPage({ size: "Letter" });
  page.text("Hello Ω", {
    x: 36,
    y: 720,
    font: "Helvetica",
    fallbackFonts: [fallbackFont],
    tag: "P",
    fontSize: 18
  });

  const parsed = parseDocument(doc.toUint8Array());
  const structureElements = parsed.listStructureElements();

  assert.equal(structureElements.length, 1);
  assert.equal(structureElements[0]?.role, "P");
  assert.equal((structureElements[0]?.mcids?.length ?? 0), 1);
});

test("serializes nested tagged lists as structured list elements", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const page = doc.addPage({ size: "Letter" });
  page.list(
    [
      "First item",
      {
        body: "Second item",
        children: [
          {
            body: "Nested item"
          }
        ]
      }
    ],
    {
      x: 36,
      y: 720,
      width: 220
    }
  );

  const parsed = parseDocument(doc.toUint8Array());
  const structureElements = parsed.listStructureElements();
  const list = structureElements[0];

  assert.equal(structureElements.length, 1);
  assert.equal(list?.role, "L");
  assert.deepEqual(list?.children?.map((child) => child.role), ["LI", "LI"]);
  assert.deepEqual(list?.children?.[0]?.children?.map((child) => child.role), ["Lbl", "LBody"]);
  assert.equal(list?.children?.[0]?.children?.[0]?.mcids?.length, 1);
  // PDF/UA: text inside LBody must NOT be wrapped in a separate P element.
  assert.equal((list?.children?.[0]?.children?.[1]?.mcids?.length ?? 0) > 0, true);
  assert.equal(list?.children?.[1]?.children?.[1]?.children?.[0]?.role, "L");
});

test("serializes tagged containers with nested semantic children", () => {
  const doc = createDocument({
    tagged: true,
    language: "en-US"
  });

  const page = doc.addPage({ size: "Letter" });
  page.container("Sect", (section) => {
    section.text("Architecture", {
      x: 36,
      y: 720,
      tag: "H2"
    });
    section.container("Div", (content) => {
      content.textBlock("Body copy inside a tagged section should default to a paragraph element.", {
        x: 36,
        y: 690,
        width: 180,
        lineHeight: 14
      });
    });
  });

  const parsed = parseDocument(doc.toUint8Array());
  const structureElements = parsed.listStructureElements();
  const section = structureElements[0];

  assert.equal(structureElements.length, 1);
  assert.equal(section?.role, "Sect");
  assert.deepEqual(section?.children?.map((child) => child.role), ["H2", "Div"]);
  assert.equal(section?.children?.[1]?.children?.[0]?.role, "P");
  assert.ok((section?.children?.[1]?.children?.[0]?.mcids?.length ?? 0) > 0);
});

test("serializes pdfa-1b output intents and autogenerated conformance XMP", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument({
    conformance: "pdfa-1b",
    info: {
      title: "Archive Copy",
      creator: "Codex"
    }
  });

  const embeddedFont = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "PdfaFixture" });
  doc.addPage({ size: "Letter" }).text("Archive Copy", {
    x: 36,
    y: 720,
    font: embeddedFont,
    fontSize: 18
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/OutputIntents \[/);
  assert.match(text, /\/S \/GTS_PDFA1/);

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getConformanceProfile(), "pdfa-1b");
  assert.match(parsed.getXmpMetadata() ?? "", /pdfaid:part>1</);
  assert.match(parsed.getXmpMetadata() ?? "", /pdfaid:conformance>B</);
});

test("rejects pdfa-1b output that relies on built-in fonts", () => {
  const doc = createDocument({ conformance: "pdfa-1b" });
  doc.addPage({ size: "Letter" }).text("Archive Copy", { x: 36, y: 720 });

  assert.throws(
    () => doc.toUint8Array(),
    (error: unknown) =>
      error instanceof PdfEngineError
      && error.code === PdfErrorCode.INVALID_COMPLIANCE
      && /embedded fonts/i.test(error.message)
  );
});

test("incrementally edits tagged PDFs while preserving the structure tree", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const editable = editDocument(doc.toUint8Array());

  editable.editPage(0).text("Accessible note", { x: 36, y: 680, tag: "P" });
  editable.addPage({ size: "Letter" }).container("Sect", (section) => {
    section.text("Appended section", { x: 36, y: 720, tag: "H2" });
    section.textBlock("Body copy for the appended tagged page.", {
      x: 36,
      y: 690,
      width: 180
    });
  });

  const parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.isTagged(), true);
  assert.equal(parsed.getLanguage(), "en-US");
  assert.equal(parsed.getPageCount(), 2);
  assert.deepEqual(parsed.listStructureElements().map((element) => element.role), ["H1", "P", "Sect"]);
});

test("incrementally preserves existing annotation parent tree references", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });
  page.link("https://example.com", {
    x: 36,
    y: 680,
    width: 120,
    height: 16,
    tag: "Link"
  });

  const baseBytes = doc.toUint8Array();
  const baseParentTreeEntries = collectParentTreeEntries(parseDocument(baseBytes));
  const annotationEntries = [...baseParentTreeEntries.entries()].filter((entry): entry is [number, Extract<PdfValue, { kind: "ref" }>] =>
    isRefValue(entry[1])
  );
  assert.ok(annotationEntries.length > 0);

  const editable = editDocument(baseBytes);
  editable.addPage({ size: "Letter" }).text("Appended tagged paragraph", { x: 36, y: 720, tag: "P" });

  const updatedParentTreeEntries = collectParentTreeEntries(parseDocument(editable.toUint8Array()));
  for (const [key, value] of annotationEntries) {
    assert.deepEqual(updatedParentTreeEntries.get(key), value);
  }
});

test("incrementally preserves existing direct StructTreeRoot K child", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Single root heading", { x: 36, y: 720, tag: "H1" });

  const baseBytes = forceDirectStructTreeRootKid(doc.toUint8Array());
  assert.deepEqual(parseDocument(baseBytes).listStructureElements().map((element) => element.role), ["H1"]);

  const editable = editDocument(baseBytes);
  editable.addPage({ size: "Letter" }).text("Appended paragraph", { x: 36, y: 720, tag: "P" });

  const parsed = parseDocument(editable.toUint8Array());
  assert.deepEqual(parsed.listStructureElements().map((element) => element.role), ["H1", "P"]);
});

test("retags existing tagged headings through editable structure handles", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const editable = editDocument(doc.toUint8Array());

  const structure = editable.listEditableStructureElements();
  assert.equal(structure.length, 1);
  assert.equal(structure[0]?.role, "H1");

  editable.setStructureRole(structure[0]!, "H2");
  editable.editPage(0).text("Accessible note", { x: 36, y: 680, tag: "P" });
  editable.addPage({ size: "Letter" }).container("Sect", (section) => {
    section.text("Appended section", { x: 36, y: 720, tag: "H2" });
  });

  const parsed = parseDocument(editable.toUint8Array());
  assert.deepEqual(parsed.listStructureElements().map((element) => element.role), ["H2", "P", "Sect"]);
});

test("retags multiple tagged elements in one call", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });
  page.text("Heading one", { x: 36, y: 720, tag: "H1" });
  page.text("Heading two", { x: 36, y: 684, tag: "H1" });

  const editable = editDocument(doc.toUint8Array());
  editable.setStructureRoles(editable.findEditableStructureElements({ role: "H1" }), "H2");

  const parsed = parseDocument(editable.toUint8Array());
  assert.deepEqual(parsed.listStructureElements().map((element) => element.role), ["H2", "H2"]);
});

test("finds similar tagged elements by role and scope", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page1 = doc.addPage({ size: "Letter" });
  page1.text("Page one heading", { x: 36, y: 720, tag: "H1" });
  page1.text("Page one body", { x: 36, y: 684, tag: "P" });
  const page2 = doc.addPage({ size: "Letter" });
  page2.text("Page two heading", { x: 36, y: 720, tag: "H1" });

  const editable = editDocument(doc.toUint8Array());
  const firstHeading = editable.findEditableStructureElements({ role: "H1", pageObjectId: editable.listEditableStructureElements()[0]!.pageObjectId })[0]!;

  assert.equal(editable.findSimilarStructureElements(firstHeading).length, 2);
  assert.equal(editable.findSimilarStructureElements(firstHeading, { scope: "page" }).length, 1);
});

test("retags nested tagged structure elements while preserving tree shape", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).container("Sect", (section) => {
    section.text("Section heading", { x: 36, y: 720, tag: "H1" });
    section.list(
      [
        {
          body: "Item body",
          children: ["Nested child"]
        }
      ],
      {
        x: 36,
        y: 680,
        width: 180
      }
    );
  });

  const editable = editDocument(doc.toUint8Array());
  const [section] = editable.listEditableStructureElements();
  const heading = section?.children?.find((element) => element.role === "H1");
  const list = section?.children?.find((element) => element.role === "L");
  assert.ok(section);
  assert.ok(heading);
  assert.ok(list);

  editable.setStructureRole(heading!, "H2");
  editable.setStructureRole(list!, "Div");

  const parsed = parseDocument(editable.toUint8Array());
  const [parsedSection] = parsed.listStructureElements();
  assert.equal(parsedSection?.role, "Sect");
  assert.equal(parsedSection?.children?.[0]?.role, "H2");
  assert.equal(parsedSection?.children?.[1]?.role, "Div");
  assert.equal(parsedSection?.children?.[1]?.children?.[0]?.role, "LI");
});

test("updates structure alt text through editable structure handles", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).png(tinyPngBytes(), {
    x: 36,
    y: 680,
    width: 24,
    height: 24,
    altText: "Original logo"
  });

  const editable = editDocument(doc.toUint8Array());
  const figure = editable.listEditableStructureElements()[0]!;
  assert.equal(figure.role, "Figure");
  assert.equal(figure.altText, "Original logo");

  editable.setStructureAltText(figure, "Updated logo");

  const parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.listStructureElements()[0]?.altText, "Updated logo");
});

test("changes tagged structure reading order among siblings", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).container("Sect", (section) => {
    section.text("First heading", { x: 36, y: 720, tag: "H1" });
    section.text("Second heading", { x: 36, y: 684, tag: "H2" });
    section.textBlock("Body copy", { x: 36, y: 648, width: 160, tag: "P" });
  });

  const editable = editDocument(doc.toUint8Array());
  const section = editable.listEditableStructureElements()[0]!;
  const children = section.children ?? [];
  editable.setStructureReadingOrder([children[1]!, children[0]!, children[2]!]);

  const parsed = parseDocument(editable.toUint8Array());
  assert.deepEqual(parsed.listStructureElements()[0]?.children?.map((element) => element.role), ["H2", "H1", "P"]);
});

test("adds and removes structure alt text through editable structure handles", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Heading", { x: 36, y: 720, tag: "H1" });

  const editable = editDocument(doc.toUint8Array());
  const heading = editable.listEditableStructureElements()[0]!;
  assert.equal(heading.altText, undefined);

  editable.setStructureAltText(heading, "Heading for assistive tech");
  let parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.listStructureElements()[0]?.altText, "Heading for assistive tech");

  const editableAgain = editDocument(parsed.getSourceBytes());
  const updatedHeading = editableAgain.listEditableStructureElements()[0]!;
  editableAgain.setStructureAltText(updatedHeading, undefined);
  parsed = parseDocument(editableAgain.toUint8Array());
  assert.equal(parsed.listStructureElements()[0]?.altText, undefined);
});

test("treats setting the existing structure alt text as a no-op", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).png(tinyPngBytes(), {
    x: 36,
    y: 680,
    width: 24,
    height: 24,
    altText: "Original logo"
  });
  const bytes = doc.toUint8Array();
  const editable = editDocument(bytes);

  editable.setStructureAltText(editable.listEditableStructureElements()[0]!, "Original logo");

  assert.deepEqual(editable.toUint8Array(), bytes);
});

test("treats setting the existing structure role as a no-op", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const bytes = doc.toUint8Array();
  const editable = editDocument(bytes);

  editable.setStructureRole(editable.listEditableStructureElements()[0]!, "H1");

  assert.deepEqual(editable.toUint8Array(), bytes);
});

test("rejects invalid tagged structure role updates", () => {
  const taggedDoc = createDocument({ tagged: true, language: "en-US" });
  taggedDoc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const taggedEditable = editDocument(taggedDoc.toUint8Array());
  const handle = taggedEditable.listEditableStructureElements()[0]!;

  const untaggedDoc = createDocument();
  untaggedDoc.addPage({ size: "Letter" }).text("Plain heading", { x: 36, y: 720 });
  const untaggedEditable = editDocument(untaggedDoc.toUint8Array());
  assert.deepEqual(untaggedEditable.listEditableStructureElements(), []);
  assert.throws(
    () => untaggedEditable.setStructureRole(handle, "H2"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );

  const otherDoc = createDocument({ tagged: true, language: "en-US" });
  otherDoc.addPage({ size: "Letter" }).text("Other heading", { x: 36, y: 720, tag: "H1" });
  const foreignHandle = editDocument(otherDoc.toUint8Array()).listEditableStructureElements()[0]!;
  assert.throws(
    () => taggedEditable.setStructureRole(foreignHandle, "H2"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PDF
  );

  assert.throws(
    () => taggedEditable.setStructureRole({ ...handle, objectId: 99999 }, "H2"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_PDF
  );

  assert.throws(
    () => taggedEditable.setStructureRole(handle, "Artifact" as unknown as "H1"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );
});

test("rejects unsafe page-order edits for tagged PDFs", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).text("Accessible heading", { x: 36, y: 720, tag: "H1" });
  const editable = editDocument(doc.toUint8Array());

  assert.throws(
    () => editable.removePage(0),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );
});

test("incrementally edits pdfa-1b documents with compliant appended pages", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument({
    conformance: "pdfa-1b",
    info: {
      title: "Archive Copy",
      creator: "Codex"
    }
  });
  const embeddedFont = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "PdfaIncremental" });
  doc.addPage({ size: "Letter" }).text("Archive Copy", {
    x: 36,
    y: 720,
    font: embeddedFont,
    fontSize: 18
  });

  const editable = editDocument(doc.toUint8Array());
  const appendedFont = editable.embedTrueTypeFont(readFileSync(fontPath), { family: "PdfaIncrementalAppend" });
  editable.addPage({ size: "Letter" }).text("Appended Archive Copy", {
    x: 36,
    y: 720,
    font: appendedFont,
    fontSize: 18
  });

  const parsed = parseDocument(editable.toUint8Array());
  assert.equal(parsed.getConformanceProfile(), "pdfa-1b");
  assert.equal(parsed.getPageCount(), 2);
});

test("rejects non-compliant incremental pdfa-1b edits", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }

  const doc = createDocument({
    conformance: "pdfa-1b"
  });
  const embeddedFont = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "PdfaReject" });
  doc.addPage({ size: "Letter" }).text("Archive Copy", {
    x: 36,
    y: 720,
    font: embeddedFont
  });

  const editable = editDocument(doc.toUint8Array());
  editable.addPage({ size: "Letter" }).text("Built-in font should fail", {
    x: 36,
    y: 720
  });

  assert.throws(
    () => editable.toUint8Array(),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_COMPLIANCE
  );
});

test("PDF/UA Math: emits MathML embedded file and AF reference for Formula", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const mathML =
    '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>=</mo><mn>1</mn></mrow></math>';
  const doc = createDocument({
    conformance: "pdfua-2",
    tagged: true,
    language: "en-US",
    structureRoot: "Document",
    info: { title: "Math" }
  });
  doc.embedTrueTypeFont(readFileSync(fontPath), { family: "MathFixture" });
  const page = doc.addPage({ size: "Letter" });
  page.png(tinyPngBytes(), {
    x: 36,
    y: 720,
    width: 24,
    height: 24,
    tag: "Formula",
    structure: { altText: "x equals one", mathML }
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  // Catalog AF references the Formula filespec.
  assert.match(text, /\/AF \[/);
  // Filespec entry.
  assert.match(text, /\/AFRelationship \/Supplement/);
  // Embedded file Subtype names the MathML mime type.
  assert.match(text, /\/Subtype \/application#2Fmathml\+xml|\/Subtype \/application\/mathml\+xml/);
});

test("emits /Phoneme and /E attributes", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });
  page.text("PhD", {
    x: 36, y: 720, tag: "Span",
    structure: { phoneme: "P H D", expansion: "Doctor of Philosophy" }
  });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Phoneme \(P H D\)/);
  assert.match(text, /\/E \(Doctor of Philosophy\)/);
});

test("emits /Summary on table structure elements", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.addPage({ size: "Letter" }).table(
    [["Name"], ["Ada"]],
    { x: 36, y: 680, width: 100, columnWidths: [100], summary: "A list of contributors" }
  );
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Summary \(A list of contributors\)/);
});

test("table borders option controls which grid lines are stroked", () => {
  const rows = [["A", "B"], ["1", "2"], ["3", "4"]];
  const base = { x: 50, y: 700, width: 200, headerRows: 1, borderColor: "black" } satisfies Partial<import("../src/index.js").TableOptions>;
  const strokeCount = (opts: Partial<import("../src/index.js").TableOptions>): number => {
    const doc = createDocument();
    doc.addPage().table(rows, { ...base, ...opts });
    const text = new TextDecoder("latin1").decode(doc.toUint8Array());
    return (text.match(/(^|\n)S(\n|$)/g) ?? []).length;
  };

  // 3 rows x 2 cells = 6 cell rects.
  assert.equal(strokeCount({}), 6, "default is full grid");
  assert.equal(strokeCount({ borders: "all" }), 6, "all = full grid");
  // 3 row-top rules + 1 bottom edge.
  assert.equal(strokeCount({ borders: "horizontal" }), 4, "horizontal = row rules");
  assert.equal(strokeCount({ borders: "outer" }), 1, "outer = single frame");
  assert.equal(strokeCount({ borders: "none" }), 0, "none suppresses borders");
});

test("table borders:none suppresses borders without a color set", () => {
  const doc = createDocument();
  doc.addPage().table([["A"], ["1"]], { x: 50, y: 700, width: 100, columnWidths: [100], borders: "none" });
  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  assert.equal((text.match(/(^|\n)S(\n|$)/g) ?? []).length, 0);
});

test("table borders rejects an invalid style", () => {
  const doc = createDocument();
  assert.throws(
    () => doc.addPage().table([["A"]], { x: 50, y: 700, width: 100, columnWidths: [100], borders: "dashed" as never }),
    /borders must be/
  );
});

test("per-cell border draws one stroked segment per requested side", () => {
  const strokeCount = (cell: object): number => {
    const doc = createDocument();
    doc.addPage().table([[cell]], { x: 50, y: 700, width: 100, columnWidths: [100] });
    const text = new TextDecoder("latin1").decode(doc.toUint8Array());
    return (text.match(/(^|\n)S(\n|$)/g) ?? []).length;
  };

  // No table-level border: only the requested cell sides are stroked.
  assert.equal(strokeCount({ text: "A" }), 0, "no borders by default");
  assert.equal(strokeCount({ text: "A", border: { bottom: true } }), 1, "one side");
  assert.equal(
    strokeCount({ text: "A", border: { top: true, right: true, bottom: true, left: true } }),
    4,
    "boxed cell = four sides"
  );
});

test("per-cell border draws on top of the table preset", () => {
  const doc = createDocument();
  // Preset "all" = 1 cell rect; plus a bottom side on the single cell = 1 more stroke.
  doc.addPage().table([[{ text: "A", border: { bottom: { width: 2 } } }]], {
    x: 50, y: 700, width: 100, columnWidths: [100], borders: "all", borderColor: "black"
  });
  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  assert.equal((text.match(/(^|\n)S(\n|$)/g) ?? []).length, 2);
});

test("per-cell border rejects a negative width", () => {
  const doc = createDocument();
  assert.throws(
    () => doc.addPage().table([[{ text: "A", border: { top: { width: -1 } } }]], { x: 50, y: 700, width: 100, columnWidths: [100] }),
    /border width must be zero or greater/
  );
});

test("emits artifact type in marked content", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });
  page.text("Page 1 of 10", {
    x: 36, y: 720, tag: "Artifact"
  });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Artifact BMC/);
});

test("emits /AF associated file references", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;
  const doc = createDocument({ conformance: "pdfua-2", tagged: true, language: "en-US", info: { title: "AF Test" } });
  doc.embedTrueTypeFont(readFileSync(fontPath), { family: "AFTest" });
  const page = doc.addPage({ size: "Letter" });
  page.structure("Formula", {
    altText: "formula with file", mathML: "<math xmlns='http://www.w3.org/1998/Math/MathML'><mrow><mi>x</mi></mrow></math>"
  }, (wrapper) => {
    wrapper.png(tinyPngBytes(), { x: 36, y: 720, width: 24, height: 24 });
  });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/AF \[/);
  assert.match(text, /\/Type \/EmbeddedFile/);
});

test("flow richParagraph wraps an inline link run in a Link element with its annotation", () => {
  const doc = createDocument({ tagged: true, language: "en-US", structureRoot: "Document" });
  const page = doc.addPage({ size: "Letter" });

  page.flow({ margin: 48, width: 300 }).richParagraph([
    { text: "See ", bold: true },
    { text: "the site", link: "https://example.com" },
    { text: " for more." }
  ]);

  const text = new TextDecoder().decode(doc.toUint8Array());
  // The visible link text lives inside a Link structure element that also
  // references the annotation via an OBJR, not stranded under the parent P.
  assert.match(text, /\/S \/Link/);
  assert.match(text, /\/Type \/OBJR/);

  const findLink = (nodes?: readonly any[]): any => {
    for (const node of nodes ?? []) {
      if (node.role === "Link") return node;
      const inner = findLink(node.children);
      if (inner) return inner;
    }
    return undefined;
  };
  const link = findLink(parseDocument(doc.toUint8Array()).inspectStructureElements());
  assert.ok(link, "richParagraph link run should produce a Link structure element");
  assert.equal(link.text, "the site");
  assert.equal(link.annotations?.length, 1);
});

test("table cell marked header outside any header band gets Row scope", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });

  // headerRows:1 but no headerColumns; the first cell of each body row is a
  // per-cell header (a row label). It must still carry /Scope /Row.
  page.table(
    [
      [{ text: "Results", header: true }, { text: "A", header: true }],
      [{ text: "Fail", header: true }, "3"]
    ],
    { x: 36, y: 720, width: 200, columnWidths: [100, 100], headerRows: 1 }
  );

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Scope \/Column/); // header-row cells
  assert.match(text, /\/Scope \/Row/);    // the body-row "Fail" row label
});

test("template running header reads first in the page tag tree", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });

  doc.renderTemplate({
    page: { size: "A4", margin: 48 },
    header: () => [
      { type: "png", data: tinyPngBytes(), options: { width: 24, altText: "Logo", tag: "Figure" } }
    ],
    blocks: [
      { type: "heading", text: "Report", options: { level: 1 } },
      { type: "paragraph", text: "Body." }
    ]
  });

  const roots = parseDocument(doc.toUint8Array()).inspectStructureElements();
  // renderTemplate wraps all content under a single Document root by default.
  assert.equal(roots[0]?.role, "Document");
  // Header is rendered after the body, but its Figure must be hoisted to the
  // front of the reading order.
  assert.equal(roots[0]?.children?.[0]?.role, "Figure");
});

test("renderTemplate wraps all content under a single Document root by default", () => {
  // No `structureRoot` passed to createDocument.
  const doc = createDocument({ tagged: true, language: "en-US" });
  doc.renderTemplate({
    page: { size: "A4", margin: 48 },
    blocks: [
      { type: "heading", text: "Report", options: { level: 1 } },
      { type: "paragraph", text: "One." },
      { type: "paragraph", text: "Two." }
    ]
  });

  const roots = parseDocument(doc.toUint8Array()).inspectStructureElements();
  assert.deepEqual(roots.map((element) => element.role), ["Document"]);
  assert.deepEqual(roots[0]?.children?.map((element) => element.role), ["H1", "P", "P"]);
});

test("renderTemplate keeps bare roots when structureRoot is false", () => {
  const doc = createDocument({ tagged: true, language: "en-US", structureRoot: false });
  doc.renderTemplate({
    page: { size: "A4", margin: 48 },
    blocks: [
      { type: "heading", text: "Report", options: { level: 1 } },
      { type: "paragraph", text: "One." }
    ]
  });

  const roots = parseDocument(doc.toUint8Array()).inspectStructureElements();
  assert.deepEqual(roots.map((element) => element.role), ["H1", "P"]);
});

test("page.link without an explicit tag defaults to a Link structure element", () => {
  const doc = createDocument({ tagged: true, language: "en-US", structureRoot: "Document" });
  const page = doc.addPage({ size: "Letter" });

  // No `tag` passed: a tagged document must still reference the annotation from
  // the structure tree (OBJR), otherwise it is an untagged-annotation failure.
  page.link("https://example.com", { x: 36, y: 700, width: 120, height: 16 });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/S \/Link/);
  assert.match(text, /\/Type \/OBJR/);
});

test("page.link with tag Artifact stays an untagged decorative annotation", () => {
  const doc = createDocument({ tagged: true, language: "en-US", structureRoot: "Document" });
  const page = doc.addPage({ size: "Letter" });

  page.link("https://example.com", { x: 36, y: 700, width: 120, height: 16, tag: "Artifact" });

  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.doesNotMatch(text, /\/S \/Link/);
});

test("richParagraph keeps leading text before an inline link in reading order", () => {
  const doc = createDocument({ tagged: true, language: "en-US", structureRoot: "Document" });
  doc.renderTemplate({
    page: { size: "A4", margin: 70 },
    blocks: [
      {
        type: "richParagraph",
        runs: [
          { text: "Page URL: ", bold: true },
          { text: "https://example.com", link: "https://example.com" }
        ]
      }
    ]
  });

  // The paragraph's own marked content ("Page URL: ", mcid 0) must precede the
  // child Link element in /K — otherwise screen readers announce the link first.
  const text = new TextDecoder("latin1").decode(doc.toUint8Array());
  const pKid = /\/S\s*\/P\b[^>]*?\/K\s*\[\s*(\S+)/.exec(text);
  assert.ok(pKid, "expected a /S /P struct element with a /K array");
  assert.match(pKid[1]!, /^\d+$/, "first /K entry of P should be a marked-content id, not the Link ref");

  // And the link's own text precedes its OBJR annotation.
  assert.match(text, /\/S\s*\/Link[^>]*?\/K\s*\[\s*\d+\s*<<\s*\/Type\s*\/OBJR/);
});

test("list items accept rich InlineTextRun bodies tagged inside LBody", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });

  page.list(
    [
      {
        body: [
          { text: "Read the " },
          { text: "terms", bold: true, link: "https://example.com/terms" },
          { text: " carefully." }
        ]
      },
      "Plain second item"
    ],
    { x: 36, y: 720, width: 300, fontSize: 12 }
  );

  const parsed = parseDocument(doc.toUint8Array());
  const list = parsed.listStructureElements()[0];
  assert.equal(list?.role, "L");
  assert.deepEqual(list?.children?.map((child) => child.role), ["LI", "LI"]);
  const firstBody = list?.children?.[0]?.children?.[1];
  assert.equal(firstBody?.role, "LBody");
  // Rich runs paint as marked content owned directly by LBody (no extra P).
  assert.equal((firstBody?.mcids?.length ?? 0) > 0, true);
  // The link run becomes a Link child of the same LBody.
  assert.equal(firstBody?.children?.some((child) => child.role === "Link"), true);

  const raw = new TextDecoder("latin1").decode(doc.toUint8Array());
  assert.match(raw, /Helvetica-Bold/, "bold run should resolve the bold font variant");
});

test("nested list children under a rich body keep the L-in-LBody structure", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });

  page.list(
    [
      {
        body: [{ text: "Parent ", italic: true }, { text: "item" }],
        children: ["Nested child"]
      }
    ],
    { x: 36, y: 720, width: 260, fontSize: 11 }
  );

  const parsed = parseDocument(doc.toUint8Array());
  const list = parsed.listStructureElements()[0];
  const body = list?.children?.[0]?.children?.[1];
  assert.equal(body?.role, "LBody");
  assert.equal(body?.children?.some((child) => child.role === "L"), true);
});

test("rich list bodies reject substring annotations", () => {
  const doc = createDocument({ tagged: true, language: "en-US" });
  const page = doc.addPage({ size: "Letter" });

  assert.throws(
    () =>
      page.list(
        [
          {
            body: [{ text: "styled" }],
            annotations: [{ type: "highlight", match: "styled" }]
          }
        ],
        { x: 36, y: 720, width: 200 }
      ),
    (error: unknown) =>
      error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_TEXT
  );
});

test("rich list bodies auto-expand line height when lineHeight is omitted", () => {
  const secondItemY = (bigFirstRun: boolean): number => {
    const doc = createDocument({ tagged: true, language: "en-US" });
    const page = doc.addPage({ size: "Letter" });
    page.list(
      [
        { body: [{ text: "Lead ", fontSize: bigFirstRun ? 24 : 12 }, { text: "rest of the item" }] },
        "Second"
      ],
      { x: 36, y: 720, width: 220, fontSize: 12 }
    );
    const internal = Object.values(page as unknown as Record<string, unknown>).find(
      (value): value is { ops: { type: string; text?: string; options: { y: number } }[] } =>
        typeof value === "object" && value !== null && Array.isArray((value as { ops?: unknown }).ops)
    );
    const second = internal?.ops.find((op) => op.type === "text" && op.text === "Second");
    assert.ok(second, "expected the second item's text op");
    return second.options.y;
  };

  assert.ok(
    secondItemY(true) < secondItemY(false),
    "a 24pt run in the first item should push the second item further down"
  );
});
