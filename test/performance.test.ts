import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { BufferSink, createDocument, parseDocument } from "../src/index.js";
import type { PdfDocument } from "../src/document.js";

const PAGE_COUNT = 120;
const LINES_PER_PAGE = 18;
const ITERATIONS = 5;

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
