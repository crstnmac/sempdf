import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { existsSync, readFileSync } from "node:fs";

import {
  createDocument,
  parseDocument,
  editDocument,
  mergeDocuments,
  extractPages,
  splitDocument,
  hex,
  PdfEngineError,
  BufferSink,
  TempFileSink
} from "../src/index.js";
import type { TemplateBlock } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC";

function tinyPngBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));
}

function findTrueTypeFixturePath(): string | undefined {
  const candidates = [
    process.env.PDF_EDITING_LIB_EXAMPLE_FONT,
    process.env.PDF_EDITING_LIB_FONT_PATH,
    "/System/Library/Fonts/SFNS.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/Library/Fonts/Arial.ttf",
    String.raw`C:\Windows\Fonts\arial.ttf`
  ];
  return candidates.find((p): p is string => p !== undefined && existsSync(p));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

// ---------------------------------------------------------------------------
// 1. Massive page count
// ---------------------------------------------------------------------------

test("stress: 500 pages with text", () => {
  const doc = createDocument({ info: { title: "500-page stress" } });
  const pageCount = 500;

  const start = performance.now();
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage({ size: "A4" });
    page.text(`Page ${i + 1}`, { x: 72, y: 800, fontSize: 14 });
    for (let line = 0; line < 5; line += 1) {
      page.text(`Line ${line + 1}: stress-testing serialization at scale.`, {
        x: 72,
        y: 770 - line * 24,
        fontSize: 10
      });
    }
  }
  const buildMs = performance.now() - start;

  const serialStart = performance.now();
  const bytes = doc.toUint8Array();
  const serialMs = performance.now() - serialStart;

  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), pageCount);
  assert.ok(bytes.length > 50000);

  console.log(`  500 pages: build=${formatMs(buildMs)}  serial=${formatMs(serialMs)}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 2. Deeply nested structure containers (tagged)
// ---------------------------------------------------------------------------

test("stress: 50-level nested tagged structure containers", () => {
  const doc = createDocument({ tagged: true, language: "en-US", structureRoot: "Document" });
  const page = doc.addPage({ size: "A4" });

  const depth = 50;
  let y = 780;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function nest(level: number, parent: any): void {
    if (level > depth) return;
    parent.container("Sect", undefined, (child: any) => {
      child.text(`Nesting level ${level}`, { x: 72, y, fontSize: 10 - (level * 0.08), tag: "P" });
      y -= 14;
      nest(level + 1, child);
    });
  }

  const start = performance.now();
  nest(1, page);
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.ok(parsed.isTagged());

  const elements = parsed.listStructureElements();
  assert.equal(elements.length, 1);
  assert.equal(elements[0]?.role, "Document");

  console.log(`  50-level nesting: build=${formatMs(buildMs)}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 3. Large table (100 rows, 6 columns, wrapped text)
// ---------------------------------------------------------------------------

test("stress: table with 100 rows and 6 columns", () => {
  const doc = createDocument({ info: { title: "100-row table" } });
  const page = doc.addPage({ size: "A4" });
  const rowCount = 100;
  const colCount = 6;

  const header = Array.from({ length: colCount }, (_, c) =>
    ({ text: `Col ${c + 1}`, header: true } as const)
  );
  const rows: Array<Array<string | { text: string; header: boolean }>> = [header];
  for (let r = 1; r <= rowCount; r += 1) {
    rows.push(
      Array.from({ length: colCount }, (_, c) =>
        `R${r}C${c + 1}` + (r % 3 === 0 ? " extra text for wrapping" : "")
      )
    );
  }

  const start = performance.now();
  page.table(rows, {
    x: 72, y: 780, width: 460,
    headerRows: 1,
    fontSize: 7,
    cellPadding: 1,
    rowGap: 0,
    lineHeight: 8
  });
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 1);

  console.log(`  100x6 table: build=${formatMs(buildMs)}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 4. Large textBlock with a very long paragraph
// ---------------------------------------------------------------------------

test("stress: textBlock with 50K character paragraph", () => {
  const doc = createDocument({ info: { title: "Long paragraph" } });
  const page = doc.addPage({ size: "A4" });

  const lorem =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
    "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
  const text = lorem.repeat(1000); // ~50K chars

  const start = performance.now();
  page.textBlock(text, {
    x: 72, y: 780, width: 460,
    fontSize: 10, lineHeight: 12
  });
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 1);
  assert.ok(bytes.length > 5000);

  console.log(`  50K-char textBlock: build=${formatMs(buildMs)}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 5. Many form fields on one page
// ---------------------------------------------------------------------------

test("stress: 200 text fields on one page", () => {
  const doc = createDocument({ info: { title: "200 text fields" } });
  const page = doc.addPage({ size: "A4" });
  const fieldCount = 200;

  const start = performance.now();
  for (let i = 0; i < fieldCount; i += 1) {
    const row = Math.floor(i / 10);
    const col = i % 10;
    page.textField(`field_${i}`, {
      x: 72 + col * 47,
      y: 780 - row * 28,
      width: 40,
      height: 18,
      fontSize: 7,
      value: `v${i}`
    });
  }
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 1);

  console.log(`  200 text fields: build=${formatMs(buildMs)}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 6. Many images on one page
// ---------------------------------------------------------------------------

test("stress: 60 PNG images on one page", () => {
  const doc = createDocument({ info: { title: "60 images" } });
  const page = doc.addPage({ size: "A4" });
  const png = tinyPngBytes();
  const imageCount = 60;

  const start = performance.now();
  for (let i = 0; i < imageCount; i += 1) {
    const row = Math.floor(i / 10);
    const col = i % 10;
    page.png(png, {
      x: 72 + col * 48,
      y: 780 - row * 48,
      width: 40,
      height: 40
    });
  }
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 1);

  console.log(`  60 PNG images: build=${formatMs(buildMs)}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 7. Many outlines / bookmarks
// ---------------------------------------------------------------------------

test("stress: 150 outline entries with nesting", () => {
  const doc = createDocument({ info: { title: "150 outlines" } });
  const outlineCount = 150;

  const pages: Array<{ page: ReturnType<typeof doc.addPage>; index: number }> = [];
  for (let i = 0; i < outlineCount; i += 1) {
    const page = doc.addPage({ size: "A4" });
    page.text(`Outline ${i + 1}`, { x: 72, y: 780, fontSize: 14 });
    pages.push({ page, index: i });
  }

  const start = performance.now();
  for (let i = 0; i < outlineCount; i += 1) {
    const parent = doc.addOutline(`Item ${i + 1}`, pages[i]!.page);
    if (i % 5 === 0 && i + 1 < outlineCount) {
      parent.addChild(`Sub-item ${i + 1}.1`, pages[i + 1]!.page);
    }
  }
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), outlineCount);

  console.log(`  150 outlines: build=${formatMs(buildMs)}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 8. Page transfer: merge + extract many pages
// ---------------------------------------------------------------------------

test("stress: merge 10 documents of 50 pages each (500 total)", () => {
  const docCount = 10;
  const pagesPerDoc = 50;
  const docs: Uint8Array[] = [];

  for (let d = 0; d < docCount; d += 1) {
    const doc = createDocument({ info: { title: `Doc ${d + 1}` } });
    for (let p = 0; p < pagesPerDoc; p += 1) {
      doc.addPage({ size: "A4" }).text(`D${d + 1}P${p + 1}`, { x: 72, y: 780, fontSize: 12 });
    }
    docs.push(doc.toUint8Array());
  }

  const mergeStart = performance.now();
  const merged = mergeDocuments(docs);
  const mergeMs = performance.now() - mergeStart;

  const parsed = parseDocument(merged);
  assert.equal(parsed.getPageCount(), docCount * pagesPerDoc);

  const extractStart = performance.now();
  const extracted = extractPages(merged, [0, 249, 499]);
  const extractMs = performance.now() - extractStart;

  const parsedExtracted = parseDocument(extracted);
  assert.equal(parsedExtracted.getPageCount(), 3);

  const splitStart = performance.now();
  const split = splitDocument(docs[0]!);
  const splitMs = performance.now() - splitStart;
  assert.equal(split.length, pagesPerDoc);

  console.log(`  500-page merge: merge=${formatMs(mergeMs)}  extract=${formatMs(extractMs)}  split=${formatMs(splitMs)}  bytes=${merged.length}`);
});

// ---------------------------------------------------------------------------
// 9. Incremental editing: add + insert + remove many pages
// ---------------------------------------------------------------------------

test("stress: incremental editing with 30 add/insert/remove operations", () => {
  const baseDoc = createDocument({ info: { title: "Base" } });
  baseDoc.addPage({ size: "A4" }).text("Base page", { x: 72, y: 780, fontSize: 14 });
  const baseBytes = baseDoc.toUint8Array();

  const editable = editDocument(baseBytes);
  const opCount = 30;

  const start = performance.now();
  for (let i = 0; i < opCount; i += 1) {
    if (i % 3 === 0) {
      const np = editable.addPage({ size: "A4" });
      np.text(`Added page ${i}`, { x: 72, y: 780, fontSize: 12 });
    } else if (i % 3 === 1) {
      const ip = editable.insertPage(0, { size: "A4" });
      ip.text(`Inserted ${i}`, { x: 72, y: 780, fontSize: 12 });
    } else {
      const count = editable.getPageCount();
      if (count > 1) {
        editable.removePage(count - 1);
      }
    }
  }
  const buildMs = performance.now() - start;

  const bytes = editable.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.ok(parsed.getPageCount() >= 1);

  console.log(`  30 incremental edits: build=${formatMs(buildMs)}  final pages=${parsed.getPageCount()}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 10. Flow layout: heavy mixed content
// ---------------------------------------------------------------------------

test("stress: flow layout with 50 mixed blocks (paragraphs, headings, tables)", () => {
  const doc = createDocument({ info: { title: "Flow stress" } });

  const start = performance.now();
  for (let pageNum = 0; pageNum < 5; pageNum += 1) {
    const page = doc.addPage({ size: "A4" });
    const flow = page.flow({ fontSize: 11 });

    for (let i = 0; i < 10; i += 1) {
      flow.heading(`Section ${pageNum * 10 + i + 1}`, { level: 2 });
      flow.paragraph(
        "This paragraph contains enough text to wrap across multiple lines " +
        "and demonstrate that the flow layout engine handles line breaking " +
        "and cursor advancement correctly under stress. ".repeat(3)
      );
      if (i % 3 === 0) {
        flow.table(
          [
            ["Key", "Value", "Notes"],
            ["Alpha", "100", "Primary metric"],
            ["Beta", "200", "Adjusted for seasonality"],
          ],
          { headerRows: 1, fontSize: 9 }
        );
      }
    }
  }
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 5);

  console.log(`  5-page flow layout: build=${formatMs(buildMs)}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 11. Tagged PDF with many structure elements
// ---------------------------------------------------------------------------

test("stress: tagged document with 200 structure elements across 20 pages", () => {
  const doc = createDocument({ tagged: true, language: "en-US", structureRoot: "Document" });
  const pageCount = 20;
  const elementsPerPage = 10;

  const start = performance.now();
  for (let p = 0; p < pageCount; p += 1) {
    const page = doc.addPage({ size: "A4" });
    for (let e = 0; e < elementsPerPage; e += 1) {
      const tag = e % 3 === 0 ? "H2" as const : "P" as const;
      page.text(`${tag} page=${p + 1} element=${e + 1}`, {
        x: 72,
        y: 780 - e * 24,
        fontSize: 11,
        tag
      });
    }
  }
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), pageCount);
  assert.ok(parsed.isTagged());

  console.log(`  200 tagged elements: build=${formatMs(buildMs)}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 12. Edge cases
// ---------------------------------------------------------------------------

test("stress: edge cases - empty document throws", () => {
  const doc = createDocument({});
  assert.throws(() => {
    doc.toUint8Array();
  }, PdfEngineError);
  console.log("  Empty document correctly rejected");
});

test("stress: edge cases - empty page throws", () => {
  const doc = createDocument({});
  doc.addPage({ size: "A4" });
  assert.throws(() => {
    doc.toUint8Array();
  }, PdfEngineError);
  console.log("  Empty page correctly rejected");
});

test("stress: edge cases - zero-width text block", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "A4" });

  assert.throws(() => {
    page.textBlock("should fail", {
      x: 72, y: 780, width: 0,
      fontSize: 10
    });
  }, PdfEngineError);
});

test("stress: edge cases - empty string in textBlock", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "A4" });

  assert.throws(() => {
    page.textBlock("", {
      x: 72, y: 780, width: 400,
      fontSize: 10
    });
  }, PdfEngineError);
});

test("stress: edge cases - table with single cell", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "A4" });

  page.table([["single cell"]], {
    x: 72, y: 780, width: 400, fontSize: 12
  });

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 1);
  console.log(`  Single-cell table: bytes=${bytes.length}`);
});

test("stress: edge cases - table with rowSpan and colSpan", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "A4" });

  page.table(
    [
      [
        { text: "Merged header", header: true, colSpan: 3 },
      ],
      [
        { text: "Name", header: true },
        { text: "Score", header: true },
        { text: "Grade", header: true },
      ],
      [
        { text: "Alice", header: true, rowSpan: 2 },
        "95", "A"
      ],
      [
        "88", "B"
      ]
    ],
    { x: 72, y: 780, width: 400, fontSize: 11, headerRows: 2 }
  );

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 1);
  console.log(`  colSpan/rowSpan table: bytes=${bytes.length}`);
});

test("stress: edge cases - overlapping text positions", () => {
  const doc = createDocument({});
  const page = doc.addPage({ size: "A4" });

  // Overlapping text at same position - should not crash
  page.text("Layer 1", { x: 72, y: 780, fontSize: 20, color: hex("#ff0000") });
  page.text("Layer 2", { x: 72, y: 780, fontSize: 20, color: hex("#0000ff") });

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 1);
  console.log(`  Overlapping text: bytes=${bytes.length}`);
});

test("stress: edge cases - all page sizes", () => {
  const doc = createDocument({});
  const sizes = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "Letter", "Legal", "Tabloid", "Ledger"] as const;

  for (const size of sizes) {
    doc.addPage({ size }).text(size, { x: 72, y: 780, fontSize: 14 });
  }

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), sizes.length);

  console.log(`  All 11 page sizes: bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 13. RenderTemplate stress
// ---------------------------------------------------------------------------

test("stress: renderTemplate with 50 mixed blocks and autoOutline", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) return;

  const doc = createDocument({
    info: { title: "Template stress" }
  });
  const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "StressSans" });

  const blocks: TemplateBlock[] = [];
  for (let i = 0; i < 50; i += 1) {
    if (i % 5 === 0) {
      blocks.push({ type: "heading", text: `Section ${i + 1}`, options: { level: 2 } });
    } else if (i % 5 === 1) {
      blocks.push({
        type: "table",
        rows: [
          ["Item", "Qty", "Price"],
          ["Alpha", "10", "$100"],
          ["Beta", "20", "$200"]
        ],
        options: { headerRows: 1, fontSize: 9 }
      });
    } else if (i % 5 === 4) {
      blocks.push({ type: "pageBreak" });
    } else {
      blocks.push({
        type: "paragraph",
        text: `Block ${i + 1}: Sample paragraph content for stress testing the template rendering pipeline. `.repeat(2),
        options: {}
      });
    }
  }

  const start = performance.now();
  doc.renderTemplate({
    page: { size: "A4", font },
    autoOutline: { maxLevel: 2, expanded: true },
    blocks,
    pageNumber: { region: "footer", align: "center" }
  });
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.ok(parsed.getPageCount() >= 1);

  console.log(`  renderTemplate 50 blocks: build=${formatMs(buildMs)}  pages=${parsed.getPageCount()}  bytes=${bytes.length}`);
});

// ---------------------------------------------------------------------------
// 14. Serialization round-trip integrity
// ---------------------------------------------------------------------------

test("stress: round-trip integrity after heavy operations", () => {
  const doc = createDocument({ info: { title: "Round-trip stress" } });

  const page = doc.addPage({ size: "A4" });
  page.text("Original content", { x: 72, y: 780, fontSize: 14 });
  page.textField("test_field", { x: 72, y: 730, width: 200, height: 22, value: "original", fontSize: 11 });

  const bytes1 = doc.toUint8Array();
  const parsed1 = parseDocument(bytes1);
  assert.equal(parsed1.getPageCount(), 1);

  // Edit incrementally
  const editable = editDocument(bytes1);
  editable.addPage({ size: "A4" }).text("Added page", { x: 72, y: 780, fontSize: 14 });
  editable.setFieldValue("test_field", "updated");

  const bytes2 = editable.toUint8Array();
  const parsed2 = parseDocument(bytes2);
  assert.equal(parsed2.getPageCount(), 2);

  // Merge with self
  const merged = mergeDocuments([bytes1, bytes2]);
  const parsed3 = parseDocument(merged);
  assert.equal(parsed3.getPageCount(), 3);

  console.log(`  Round-trip: original=${bytes1.length}  edited=${bytes2.length}  merged=${merged.length}`);
});

// ---------------------------------------------------------------------------
// 15. Path operations stress
// ---------------------------------------------------------------------------

test("stress: 500 path operations on one page", () => {
  const doc = createDocument({ info: { title: "500 paths" } });
  const page = doc.addPage({ size: "A4" });
  const pathCount = 500;

  const start = performance.now();
  for (let i = 0; i < pathCount; i += 1) {
    const x = 72 + (i % 40) * 12;
    const y = 780 - Math.floor(i / 40) * 12;
    page.path(
      [{ type: "rect", x, y, width: 8, height: 8 }],
      {
        paint: i % 3 === 0 ? "fill" : "stroke",
        fill: i % 3 === 0 ? { color: hex("#1a1a2e") } : undefined,
        stroke: i % 3 !== 0 ? { width: 0.5, color: hex("#1a1a2e") } : undefined
      }
    );
  }
  const buildMs = performance.now() - start;

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  assert.equal(parsed.getPageCount(), 1);

  console.log(`  500 paths: build=${formatMs(buildMs)}  bytes=${bytes.length}`);
});

test("stress: recovers from corrupted stream lengths", () => {
  const doc = createDocument({ info: { title: "Corrupted lengths" } });
  doc.addPage({ size: "A4" }).text("Recovery test", { x: 72, y: 780 });
  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  // Offset length by +1 to test recovery via stream length clamping
  const corrupted = text.replace(/\/Length (\d+)/, (_match, len) => `/Length ${Number(len) + 1}`);
  const parsed = parseDocument(new TextEncoder().encode(corrupted));
  assert.equal(parsed.getPageCount(), 1);
});

test("stress: spills to disk for large documents", async () => {
  const doc = createDocument({ info: { title: "Spill test" } });
  for (let i = 0; i < 10; i += 1) {
    const page = doc.addPage({ size: "A4" });
    page.text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 14 });
  }
  const bytes = doc.toUint8Array();
  const sink = new TempFileSink();
  await sink.write(bytes);
  const readBack = await sink.getBytes();
  assert.deepEqual(readBack, bytes);
  await sink.close();
});
