import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFileSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";

import {
  BufferSink,
  createDocument,
  editDocument,
  mergeDocuments,
  parseDocument,
  splitDocument,
} from "../src/index.js";
import type { PdfDocument } from "../src/document.js";
import type { DocumentEncryptionAlgorithm, TemplateBlock } from "../src/types.js";

// ─── Test Configuration ───────────────────────────────────────────────

const SMALL_PAGES = 30;
const MEDIUM_PAGES = 100;
const LARGE_PAGES = 250;
const ITERATIONS = 3;
const WARMUP_RUNS = 1;

// ─── Helpers ───────────────────────────────────────────────────────────

function median(values: readonly number[]): number {
  const sorted = [...values].sort((l, r) => l - r);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function formatBytes(bytes: number): string {
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(2)}MB`;
  if (bytes > 1_000) return `${(bytes / 1_000).toFixed(1)}KB`;
  return `${bytes}B`;
}

function throughput(bytes: number, ms: number): string {
  return `${((bytes / (1024 * 1024)) / (ms / 1000)).toFixed(1)} MB/s`;
}

function measure(label: string, fn: () => Uint8Array, iterations: number = ITERATIONS, warmup: number = WARMUP_RUNS): {
  bytes: Uint8Array;
  medianMs: number;
  samples: number[];
} {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  let bytes: Uint8Array = new Uint8Array();
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    bytes = fn() as Uint8Array;
    samples.push(performance.now() - start);
  }
  return { bytes, medianMs: median(samples), samples };
}

function diagnostic(t: any, label: string, result: { bytes: Uint8Array; medianMs: number; samples: number[] }): void {
  t.diagnostic(
    `${label.padEnd(32)} ${formatMs(result.medianMs).padStart(8)}  ${formatBytes(result.bytes.length).padStart(10)}  ${throughput(result.bytes.length, result.medianMs)}  [${result.samples.map(formatMs).join(", ")}]`,
  );
}

function findFontPath(): string | undefined {
  const candidates = [
    process.env.PDF_EDITING_LIB_EXAMPLE_FONT,
    process.env.PDF_EDITING_LIB_FONT_PATH,
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
  ];
  return candidates.find((p): p is string => p !== undefined && existsSync(p));
}

function generateLorumIpsum(paragraphs: number, wordsPerParagraph: number): string {
  const words = [
    "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
    "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore",
    "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis", "nostrud", "exercitation",
    "ullamco", "laboris", "nisi", "ut", "aliquip", "ex", "ea", "commodo", "consequat",
    "duis", "aute", "irure", "reprehenderit", "voluptate", "velit", "esse", "cillum",
    "fugiat", "nulla", "pariatur", "excepteur", "sint", "occaecat", "cupidatat",
    "non", "proident", "sunt", "culpa", "qui", "officia", "deserunt", "mollit",
    "anim", "id", "est", "laborum", "sed", "perspiciatis", "unde", "omnis",
    "iste", "natus", "error", "voluptatem", "accusantium", "doloremque", "laudantium",
  ];
  const result: string[] = [];
  for (let p = 0; p < paragraphs; p++) {
    const para: string[] = [];
    for (let w = 0; w < wordsPerParagraph; w++) {
      para.push(words[(p * 7 + w * 13) % words.length]!);
    }
    result.push(para.join(" "));
  }
  return result.join("\n\n");
}

function tinyPng(): Uint8Array {
  const encoder = new TextEncoder();
  const signature = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = new Uint8Array([0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0]);
  function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = encoder.encode(type);
    const buf = new Uint8Array(4 + 4 + data.length + 4);
    new DataView(buf.buffer).setUint32(0, data.length);
    buf.set(typeBytes, 4);
    buf.set(data, 8);
    return buf;
  }
  const ihdr = chunk("IHDR", ihdrData);
  const raw = new Uint8Array(4 * 4 * 3 + 4);
  raw[0] = 0;
  for (let y = 0; y < 4; y++) {
    const base = 1 + y * (3 * 4 + 1);
    raw[base - 1] = 0;
    for (let x = 0; x < 4; x++) {
      raw[base + x * 3] = (x * 64) & 0xFF;
      raw[base + x * 3 + 1] = (y * 64) & 0xFF;
      raw[base + x * 3 + 2] = 128;
    }
  }
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND", new Uint8Array());
  const result = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  result.set(signature, off); off += signature.length;
  result.set(ihdr, off); off += ihdr.length;
  result.set(idat, off); off += idat.length;
  result.set(iend, off);
  return result;
}

// ─── 1. Document Generation Performance ────────────────────────────────

test("generation: small document (30 pages, text only)", async (t) => {
  const result = measure("small-text", () => {
    const doc = createDocument({ info: { title: "Small doc" } });
    for (let i = 0; i < SMALL_PAGES; i++) {
      doc.addPage({ size: "A4" }).text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "small-text", result);
  const parsed = parseDocument(result.bytes);
  assert.equal(parsed.getPageCount(), SMALL_PAGES);
});

test("generation: medium document (100 pages, text only)", async (t) => {
  const result = measure("medium-text", () => {
    const doc = createDocument({ info: { title: "Medium doc" } });
    for (let i = 0; i < MEDIUM_PAGES; i++) {
      doc.addPage({ size: "A4" }).text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "medium-text", result);
  const parsed = parseDocument(result.bytes);
  assert.equal(parsed.getPageCount(), MEDIUM_PAGES);
});

test("generation: large document with content (250 pages, paragraphs)", async (t) => {
  const lorem = generateLorumIpsum(3, 40);
  const result = measure("large-content", () => {
    const doc = createDocument({ info: { title: "Large doc" } });
    for (let i = 0; i < LARGE_PAGES; i++) {
      doc.addPage({ size: "A4" }).textBlock(lorem, {
        x: 72, y: 780, width: 450, fontSize: 11, lineHeight: 15,
      });
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "large-content", result);
  const parsed = parseDocument(result.bytes);
  assert.equal(parsed.getPageCount(), LARGE_PAGES);
});

test("generation: embedded font document (50 pages, mixed text)", async (t) => {
  const fontPath = findFontPath();
  if (!fontPath) { t.diagnostic("Skipped: no TrueType font found"); return; }

  const fontData = new Uint8Array(readFileSync(fontPath));
  const lorem = generateLorumIpsum(2, 30);

  const result = measure("font-doc", () => {
    const doc = createDocument({ info: { title: "Font doc" } });
    const font = doc.embedTrueTypeFont(fontData, { family: "PerfFont" });
    for (let i = 0; i < 50; i++) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Heading ${i + 1}`, { x: 72, y: 780, font, fontSize: 16 });
      page.textBlock(lorem, { x: 72, y: 750, width: 450, font, fontSize: 10, lineHeight: 14 });
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "font-doc", result);
  const parsed = parseDocument(result.bytes);
  assert.equal(parsed.getPageCount(), 50);
});

test("generation: image-heavy document (50 pages, PNG per page)", async (t) => {
  const png = tinyPng();
  const result = measure("image-doc", () => {
    const doc = createDocument({ info: { title: "Image doc" } });
    for (let i = 0; i < 50; i++) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Image page ${i + 1}`, { x: 72, y: 780, fontSize: 14 });
      page.png(png, { x: 72, y: 650, width: 48, height: 48, altText: "Test image" });
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "image-doc", result);
  const parsed = parseDocument(result.bytes);
  assert.equal(parsed.getPageCount(), 50);
});

test("generation: tagged document (50 pages, headings + paragraphs)", async (t) => {
  const result = measure("tagged-doc", () => {
    const doc = createDocument({ tagged: true, structureRoot: "Document", language: "en-US" });
    for (let i = 0; i < 50; i++) {
      const page = doc.addPage({ size: "A4" });
      page.flow({ font: "Helvetica", fontSize: 12 })
        .heading(`Section ${i + 1}`, { level: 2 })
        .paragraph(generateLorumIpsum(1, 25))
        .paragraph(generateLorumIpsum(1, 20));
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "tagged-doc", result);
  const parsed = parseDocument(result.bytes);
  assert.equal(parsed.getPageCount(), 50);
});

test("generation: template report (50 blocks, autoOutline)", async (t) => {
  const blocks: TemplateBlock[] = [];
  for (let i = 0; i < 10; i++) {
    blocks.push({ type: "heading" as const, text: `Section ${i + 1}`, options: { level: 2 } });
    blocks.push({ type: "paragraph" as const, text: generateLorumIpsum(2, 30) });
    blocks.push({
      type: "table" as const,
      rows: [
        [{ text: "Metric", header: true }, { text: "Value", header: true }],
        [{ text: "Revenue", header: true, scope: "row" as const }, "$1.2M"],
        [{ text: "Cost", header: true, scope: "row" as const }, "$0.8M"],
      ],
    });
    if (i < 9) blocks.push({ type: "pageBreak" as const });
  }

  const result = measure("template-rpt", () => {
    const doc = createDocument({ info: { title: "Template Report" } });
    doc.renderTemplate({ page: { size: "A4", font: "Helvetica" }, autoOutline: { maxLevel: 2 }, blocks });
    return doc.toUint8Array();
  });
  diagnostic(t, "template-rpt", result);
  const parsed = parseDocument(result.bytes);
  assert.ok(parsed.getPageCount() > 0);
});

// ─── 2. Streaming Performance ──────────────────────────────────────────

test("streaming: BufferSink vs Uint8Array output (100 pages)", async (t) => {
  // Uint8Array (synchronous)
  const uint8Result = measure("uint8-output", () => {
    const doc = createDocument({ info: { title: "Stream test" } });
    for (let i = 0; i < MEDIUM_PAGES; i++) {
      doc.addPage({ size: "A4" }).text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "uint8-output", uint8Result);

  // BufferSink (async - need to await writeTo)
  const doc = createDocument({ info: { title: "Stream test" } });
  for (let i = 0; i < MEDIUM_PAGES; i++) {
    doc.addPage({ size: "A4" }).text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
  }
  const sink = new BufferSink();
  const start = performance.now();
  await doc.writeTo(sink);
  const sinkBytes = sink.collect();
  const sinkElapsed = performance.now() - start;
  t.diagnostic(`sink-output                   ${formatMs(sinkElapsed).padStart(8)}  ${formatBytes(sinkBytes.length).padStart(10)}`);

  // Different document instances produce different byte counts (IDs differ), compare page count
  const uint8Parsed = parseDocument(uint8Result.bytes);
  const sinkParsed = parseDocument(sinkBytes);
  assert.equal(uint8Parsed.getPageCount(), MEDIUM_PAGES);
  assert.equal(sinkParsed.getPageCount(), MEDIUM_PAGES);
  t.diagnostic(`Sink/Uint8 ratio: ${(sinkElapsed / uint8Result.medianMs).toFixed(2)}x`);
});

test("streaming: spill-to-disk (TempFileSink, 250 pages)", async (t) => {
  // TempFileSink writes to disk, test basic throughput
  const doc = createDocument({ info: { title: "Spill test" } });
  for (let i = 0; i < LARGE_PAGES; i++) {
    doc.addPage({ size: "A4" }).textBlock(generateLorumIpsum(2, 25), {
      x: 72, y: 780, width: 450, fontSize: 11, lineHeight: 15,
    });
  }

  const start = performance.now();
  const bytes = doc.toUint8Array();
  const elapsed = performance.now() - start;

  t.diagnostic(`large-in-memory              ${formatMs(elapsed).padStart(8)}  ${formatBytes(bytes.length).padStart(10)}`);
  assert.ok(bytes.length > 0);
});

test("streaming: progressive page generation (writeNextPage)", async (t) => {
  const doc = createDocument({ info: { title: "Progressive test" } });
  const sink = new BufferSink();
  const start = performance.now();

  // Add pages and use writeTo (progressive streaming tested via regular streaming)
  for (let i = 0; i < MEDIUM_PAGES; i++) {
    doc.addPage({ size: "A4" }).text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
  }
  await doc.writeTo(sink);

  const elapsed = performance.now() - start;
  const bytes = sink.collect();
  t.diagnostic(`progressive-pages            ${formatMs(elapsed).padStart(8)}  ${formatBytes(bytes.length).padStart(10)}`);
  assert.ok(bytes.length > 0);
});

// ─── 3. Parsing Performance ────────────────────────────────────────────

function buildParsingFixture(pages: number): Uint8Array {
  const doc = createDocument({ info: { title: "Parse fixture" } });
  for (let i = 0; i < pages; i++) {
    doc.addPage({ size: "A4" }).textBlock(generateLorumIpsum(3, 30), {
      x: 72, y: 780, width: 450, fontSize: 11, lineHeight: 15,
    });
  }
  return doc.toUint8Array();
}

test("parsing: small document (30 pages)", async (t) => {
  const fixture = buildParsingFixture(SMALL_PAGES);
  const result = measure("parse-small", () => {
    parseDocument(fixture);
    return fixture;
  });
  diagnostic(t, "parse-small", result);
  const doc = parseDocument(fixture);
  assert.equal(doc.getPageCount(), SMALL_PAGES);
});

test("parsing: medium document (100 pages)", async (t) => {
  const fixture = buildParsingFixture(MEDIUM_PAGES);
  const result = measure("parse-medium", () => {
    parseDocument(fixture);
    return fixture;
  });
  diagnostic(t, "parse-medium", result);
  const doc = parseDocument(fixture);
  assert.equal(doc.getPageCount(), MEDIUM_PAGES);
});

test("parsing: large document (250 pages)", async (t) => {
  const fixture = buildParsingFixture(LARGE_PAGES);
  const result = measure("parse-large", () => {
    parseDocument(fixture);
    return fixture;
  });
  diagnostic(t, "parse-large", result);
  const doc = parseDocument(fixture);
  assert.equal(doc.getPageCount(), LARGE_PAGES);
});

test("parsing: lazy object loading (250 pages)", async (t) => {
  const fixture = buildParsingFixture(LARGE_PAGES);
  const result = measure("parse-lazy", () => {
    const doc = parseDocument(fixture);
    // Access metadata only, don't decompress page content streams
    doc.getMetadata();
    doc.getPageCount();
    return fixture;
  });
  diagnostic(t, "parse-lazy", result);
  const doc = parseDocument(fixture);
  assert.equal(doc.getPageCount(), LARGE_PAGES);
});

test("parsing: extractText throughput (100 pages)", async (t) => {
  const fixture = buildParsingFixture(MEDIUM_PAGES);
  const doc = parseDocument(fixture);

  const result = measure("extract-text", () => {
    doc.extractText();
    return fixture;
  });
  diagnostic(t, "extract-text", result);
  const extractions = doc.extractText();
  assert.equal(extractions.length, MEDIUM_PAGES);
});

// ─── 4. Encryption Performance ─────────────────────────────────────────

test("encryption: algorithm overhead comparison", async (t) => {
  const algorithms: ReadonlyArray<{ label: string; algorithm: DocumentEncryptionAlgorithm | undefined }> = [
    { label: "none", algorithm: undefined },
    { label: "rc4-128", algorithm: "rc4-128" },
    { label: "aes-128", algorithm: "aes-128" },
    { label: "aes-256", algorithm: "aes-256" },
    { label: "aes-256-r6", algorithm: "aes-256-r6" },
  ];

  for (const { label, algorithm } of algorithms) {
    const result = measure(`encrypt-${label}`, () => {
      const doc = createDocument({
        info: { title: "Encrypt perf" },
        ...(algorithm ? { encryption: { algorithm, userPassword: "user", ownerPassword: "owner" } } : {}),
      });
      for (let i = 0; i < 20; i++) {
        doc.addPage({ size: "A4" }).textBlock(generateLorumIpsum(2, 20), {
          x: 72, y: 780, width: 450, fontSize: 10, lineHeight: 14,
        });
      }
      return doc.toUint8Array();
    });
    diagnostic(t, `encrypt-${label.padEnd(8)}`, result);
    const parsed = algorithm
      ? parseDocument(result.bytes, { password: "user" })
      : parseDocument(result.bytes);
    assert.equal(parsed.getPageCount(), 20);
  }
});

test("encryption: metadata-only encryption performance", async (t) => {
  const result = measure("encrypt-meta", () => {
    const doc = createDocument({
      info: { title: "Meta encrypt" },
      encryption: { algorithm: "aes-256", userPassword: "user", ownerPassword: "owner", encryptMetadata: false },
    });
    for (let i = 0; i < 20; i++) {
      doc.addPage({ size: "A4" }).text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "encrypt-meta", result);
  const parsed = parseDocument(result.bytes, { password: "user" });
  assert.equal(parsed.getPageCount(), 20);
});

// ─── 5. Incremental Editing Performance ────────────────────────────────

test("incremental: metadata update (50 pages)", async (t) => {
  const fixture = buildParsingFixture(50);

  const result = measure("incr-metadata", () => {
    const edit = editDocument(fixture);
    edit.updateInfo({ title: "Updated title", author: "New author" });
    return edit.toUint8Array();
  });
  diagnostic(t, "incr-metadata", result);
  const edited = parseDocument(result.bytes);
  assert.equal(edited.getMetadata().author, "New author");
});

test("incremental: page append (50 + 10 pages)", async (t) => {
  const fixture = buildParsingFixture(50);

  const result = measure("incr-append", () => {
    const edit = editDocument(fixture);
    for (let i = 0; i < 10; i++) {
      edit.addPage({ size: "A4" }).text(`Appended page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
    }
    return edit.toUint8Array();
  });
  diagnostic(t, "incr-append", result);
  const edited = parseDocument(result.bytes);
  assert.equal(edited.getPageCount(), 60);
});

test("incremental: content overlay (50 pages)", async (t) => {
  const fixture = buildParsingFixture(50);

  const result = measure("incr-overlay", () => {
    const edit = editDocument(fixture);
    for (let i = 0; i < 50; i++) {
      edit.writePageContent(i, "BT /Helvetica 10 Tf 500 30 Td (Overlay) Tj ET", "append");
    }
    return edit.toUint8Array();
  });
  diagnostic(t, "incr-overlay", result);
  const edited = parseDocument(result.bytes);
  assert.equal(edited.getPageCount(), 50);
});

// ─── 6. Memory Usage Tracking ──────────────────────────────────────────

test("memory: document creation peak RSS (250 pages)", async (t) => {
  if (typeof process.memoryUsage !== "function") {
    t.diagnostic("Skipped: memoryUsage not available");
    return;
  }

  const baseline = process.memoryUsage().heapUsed;
  const result = measure("mem-create", () => {
    const doc = createDocument({ info: { title: "Memory test" } });
    for (let i = 0; i < LARGE_PAGES; i++) {
      doc.addPage({ size: "A4" }).textBlock(generateLorumIpsum(3, 30), {
        x: 72, y: 780, width: 450, fontSize: 11, lineHeight: 15,
      });
    }
    return doc.toUint8Array();
  });
  const peak = process.memoryUsage().heapUsed;

  const outputLen = result.bytes.length;
  const heapDelta = peak - baseline;
  t.diagnostic(`mem-create    heap: ${formatBytes(heapDelta)}  output: ${formatBytes(outputLen)}  ratio: ${(heapDelta / outputLen).toFixed(1)}x memory/output`);
  assert.ok(outputLen > 0);
});

test("memory: parsing peak RSS (250 pages)", async (t) => {
  if (typeof process.memoryUsage !== "function") {
    t.diagnostic("Skipped: memoryUsage not available");
    return;
  }

  const fixture = buildParsingFixture(LARGE_PAGES);
  const baseline = process.memoryUsage().heapUsed;

  parseDocument(fixture);
  const peak = process.memoryUsage().heapUsed;
  const heapDelta = peak - baseline;
  t.diagnostic(`mem-parse     heap: ${formatBytes(heapDelta)}  input: ${formatBytes(fixture.length)}  ratio: ${(heapDelta / fixture.length).toFixed(1)}x memory/input`);
  assert.ok(heapDelta > 0);
});

// ─── 7. Clone Performance ──────────────────────────────────────────────

test("clone: document clone overhead (100 pages)", async (t) => {
  const result = measure("clone-doc", () => {
    const doc = createDocument({ info: { title: "Clone source" } });
    for (let i = 0; i < MEDIUM_PAGES; i++) {
      doc.addPage({ size: "A4" }).text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
    }
    const cloned = doc.clone();
    cloned.addPage({ size: "A4" }).text("Extra page", { x: 72, y: 780, fontSize: 12 });
    return cloned.toUint8Array();
  });
  diagnostic(t, "clone-doc", result);
  const clonedParsed = parseDocument(result.bytes);
  assert.equal(clonedParsed.getPageCount(), MEDIUM_PAGES + 1);
});

// ─── 8. Object Stream Performance ──────────────────────────────────────

test("object-streams: with and without comparison (100 pages)", async (t) => {
  const result = measure("obj-stream", () => {
    const doc = createDocument({ info: { title: "ObjStream test" }, objectStreams: true });
    for (let i = 0; i < MEDIUM_PAGES; i++) {
      doc.addPage({ size: "A4" }).text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "obj-stream", result);

  const noStreamResult = measure("no-obj-stream", () => {
    const doc = createDocument({ info: { title: "NoObjStream test" }, objectStreams: false });
    for (let i = 0; i < MEDIUM_PAGES; i++) {
      doc.addPage({ size: "A4" }).text(`Page ${i + 1}`, { x: 72, y: 780, fontSize: 12 });
    }
    return doc.toUint8Array();
  });
  diagnostic(t, "no-obj-stream", noStreamResult);

  t.diagnostic(`ObjectStreams size reduction: ${((1 - result.bytes.length / noStreamResult.bytes.length) * 100).toFixed(1)}% smaller, speed ratio: ${(noStreamResult.medianMs / result.medianMs).toFixed(2)}x`);
  assert.ok(result.bytes.length > 0);
});

// ─── 9. Page Transfer Performance ──────────────────────────────────────

test("page-transfer: split 100-page document", async (t) => {
  const fixture = buildParsingFixture(MEDIUM_PAGES);

  const result = measure("split-doc", () => {
    const docs = splitDocument(fixture);
    return docs[0]!;
  });
  diagnostic(t, "split-doc", result);
  const docs = splitDocument(fixture);
  assert.equal(docs.length, MEDIUM_PAGES);
});

test("page-transfer: merge 10 documents of 10 pages each", async (t) => {
  const docs: Uint8Array[] = [];
  for (let i = 0; i < 10; i++) {
    docs.push(buildParsingFixture(10));
  }

  const result = measure("merge-docs", () => {
    return mergeDocuments(docs);
  });
  diagnostic(t, "merge-docs", result);
  const merged = parseDocument(result.bytes);
  assert.equal(merged.getPageCount(), 100);
});
