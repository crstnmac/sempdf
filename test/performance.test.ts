import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { BufferSink, createDocument, parseDocument } from "../src/index.js";
import type { PdfDocument } from "../src/document.js";
import type { DocumentEncryptionAlgorithm } from "../src/types.js";

const PAGE_COUNT = 120;
const LINES_PER_PAGE = 18;
const ITERATIONS = 5;
const ENCRYPTION_PAGE_COUNT = 20;
const ENCRYPTION_ITERATIONS = 3;

function createPerformanceDocument(): PdfDocument {
  const doc = createDocument({
    info: {
      title: "Performance fixture",
      author: "pdf-editing-lib",
      creationDate: "D:20260507120000Z",
      modificationDate: "D:20260507120000Z"
    }
  });

  for (let pageIndex = 0; pageIndex < PAGE_COUNT; pageIndex += 1) {
    const page = doc.addPage({ size: "A4" });
    page.text(`Performance page ${pageIndex + 1}`, {
      x: 48,
      y: 790,
      fontSize: 16
    });

    for (let lineIndex = 0; lineIndex < LINES_PER_PAGE; lineIndex += 1) {
      page.text(
        `Line ${lineIndex + 1}: repeated serialization workload for Uint8Array and BufferSink output paths.`,
        {
          x: 48,
          y: 748 - (lineIndex * 28),
          fontSize: 10,
          color: lineIndex % 2 === 0
            ? { kind: "rgb", r: 0.08, g: 0.16, b: 0.28 }
            : { kind: "rgb", r: 0.38, g: 0.1, b: 0.08 }
        }
      );
    }
  }

  return doc;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

test("compares Uint8Array serialization and BufferSink streaming performance", async (t) => {
  const doc = createPerformanceDocument();

  const uint8Timings: number[] = [];
  const bufferSinkTimings: number[] = [];
  let uint8Bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let bufferSinkBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const uint8Start = performance.now();
    uint8Bytes = doc.toUint8Array();
    uint8Timings.push(performance.now() - uint8Start);

    const sink = new BufferSink();
    const sinkStart = performance.now();
    await doc.writeTo(sink);
    bufferSinkBytes = sink.collect();
    bufferSinkTimings.push(performance.now() - sinkStart);
  }

  const uint8Parsed = parseDocument(uint8Bytes);
  const bufferSinkParsed = parseDocument(bufferSinkBytes);

  assert.equal(uint8Parsed.getPageCount(), PAGE_COUNT);
  assert.equal(bufferSinkParsed.getPageCount(), PAGE_COUNT);
  assert.equal(uint8Parsed.getMetadata().title, "Performance fixture");
  assert.equal(bufferSinkParsed.getMetadata().title, "Performance fixture");
  assert.equal(uint8Bytes.length > 0, true);
  assert.equal(bufferSinkBytes.length > 0, true);

  t.diagnostic(`Uint8Array median: ${formatMs(median(uint8Timings))}; samples: ${uint8Timings.map(formatMs).join(", ")}`);
  t.diagnostic(`BufferSink median: ${formatMs(median(bufferSinkTimings))}; samples: ${bufferSinkTimings.map(formatMs).join(", ")}`);
  t.diagnostic(`Uint8Array bytes: ${uint8Bytes.length}; BufferSink bytes: ${bufferSinkBytes.length}`);
});

function buildEncryptedDocument(algorithm: DocumentEncryptionAlgorithm | undefined): PdfDocument {
  const doc = createDocument({
    info: { title: "Encryption perf fixture", author: "pdf-editing-lib" },
    ...(algorithm
      ? { encryption: { algorithm, userPassword: "user", ownerPassword: "owner" } }
      : {})
  });
  for (let pageIndex = 0; pageIndex < ENCRYPTION_PAGE_COUNT; pageIndex += 1) {
    const page = doc.addPage({ size: "A4" });
    page.text(`Encrypted page ${pageIndex + 1}`, { x: 48, y: 790, fontSize: 14 });
    for (let lineIndex = 0; lineIndex < 8; lineIndex += 1) {
      page.text(`Line ${lineIndex + 1}: per-object cipher application overhead.`, {
        x: 48,
        y: 760 - (lineIndex * 24),
        fontSize: 10
      });
    }
  }
  return doc;
}

test("benchmarks encryption algorithm overhead (none, RC4-128, AES-128, AES-256 R=5, AES-256 R=6)", async (t) => {
  const variants: ReadonlyArray<{ label: string; algorithm: DocumentEncryptionAlgorithm | undefined }> = [
    { label: "none           ", algorithm: undefined },
    { label: "rc4-128        ", algorithm: "rc4-128" },
    { label: "aes-128        ", algorithm: "aes-128" },
    { label: "aes-256 (R=5)  ", algorithm: "aes-256" },
    { label: "aes-256-r6     ", algorithm: "aes-256-r6" }
  ];

  for (const variant of variants) {
    const timings: number[] = [];
    let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    for (let iteration = 0; iteration < ENCRYPTION_ITERATIONS; iteration += 1) {
      const doc = buildEncryptedDocument(variant.algorithm);
      const start = performance.now();
      bytes = doc.toUint8Array();
      timings.push(performance.now() - start);
    }
    const parsed = variant.algorithm
      ? parseDocument(bytes, { password: "user" })
      : parseDocument(bytes);
    assert.equal(parsed.getPageCount(), ENCRYPTION_PAGE_COUNT);
    const headerLine = new TextDecoder().decode(bytes.slice(0, 16)).split("\n")[0] ?? "";
    t.diagnostic(`${variant.label} ${headerLine}  median: ${formatMs(median(timings))}; bytes: ${bytes.length}; samples: ${timings.map(formatMs).join(", ")}`);
  }
});

test("benchmarks tagged PDF 2.0 namespace + ToUnicode overhead", async (t) => {
  const variants: ReadonlyArray<{ label: string; build: () => PdfDocument }> = [
    {
      label: "untagged       ",
      build: () => buildEncryptedDocument(undefined)
    },
    {
      label: "tagged 1.4     ",
      build: () => {
        const doc = createDocument({ tagged: true, structureRoot: "Document" });
        for (let i = 0; i < ENCRYPTION_PAGE_COUNT; i += 1) {
          doc.addPage({ size: "A4" }).text(`Heading ${i + 1}`, { x: 48, y: 790, fontSize: 14, tag: "H1" });
        }
        return doc;
      }
    },
    {
      label: "tagged 2.0     ",
      build: () => {
        const doc = createDocument({
          tagged: true,
          structureRoot: "Document",
          encryption: { algorithm: "aes-256-r6", userPassword: "u", ownerPassword: "o" }
        });
        for (let i = 0; i < ENCRYPTION_PAGE_COUNT; i += 1) {
          doc.addPage({ size: "A4" }).text(`Heading ${i + 1}`, { x: 48, y: 790, fontSize: 14, tag: "H1" });
        }
        return doc;
      }
    }
  ];

  for (const variant of variants) {
    const timings: number[] = [];
    let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    for (let iteration = 0; iteration < ENCRYPTION_ITERATIONS; iteration += 1) {
      const doc = variant.build();
      const start = performance.now();
      bytes = doc.toUint8Array();
      timings.push(performance.now() - start);
    }
    const headerLine = new TextDecoder().decode(bytes.slice(0, 16)).split("\n")[0] ?? "";
    t.diagnostic(`${variant.label} ${headerLine}  median: ${formatMs(median(timings))}; bytes: ${bytes.length}`);
  }
});
