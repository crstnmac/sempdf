import test from "node:test";
import assert from "node:assert/strict";

import {
  parseDocument,
  PdfEngineError,
  PdfErrorCode,
  renderDocumentJson,
  renderDocumentJsonSync,
  type PdfDocumentJson,
} from "../src/index.js";

// A hand-built 1x1 24-bit BMP (no CRC/compression — always valid), base64-encoded.
function bmp1x1Base64(): string {
  const bmp = Buffer.alloc(58);
  bmp.write("BM", 0, "ascii");
  bmp.writeUInt32LE(58, 2); // file size
  bmp.writeUInt32LE(54, 10); // pixel data offset
  bmp.writeUInt32LE(40, 14); // DIB header size
  bmp.writeInt32LE(1, 18); // width
  bmp.writeInt32LE(1, 22); // height
  bmp.writeUInt16LE(1, 26); // planes
  bmp.writeUInt16LE(24, 28); // bpp
  bmp.writeUInt32LE(4, 34); // image size
  bmp[56] = 255; // red pixel
  return bmp.toString("base64");
}

function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-";
}

function pageText(bytes: Uint8Array): string {
  return parseDocument(bytes)
    .extractText()
    .map((p) => p.text)
    .join("\n");
}

test("renders a minimal document from JSON and round-trips its text", async () => {
  const doc: PdfDocumentJson = {
    title: "Hello",
    blocks: [
      { type: "heading", text: "Greeting", options: { level: 1 } },
      { type: "paragraph", text: "Hello from JSON." },
    ],
  };
  const bytes = await renderDocumentJson(doc);
  assert.ok(isPdf(bytes));
  const text = pageText(bytes);
  assert.match(text, /Greeting/);
  assert.match(text, /Hello from JSON\./);
});

test("registers a base64 font and resolves it by name", async () => {
  // Embed a real TrueType font from the test fixtures via base64.
  const fontBytes = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./fixtures/Roboto-Regular.ttf", import.meta.url)).catch(() => null),
  );
  // Fall back to a built-in font name if no fixture font is present.
  if (!fontBytes) {
    const bytes = await renderDocumentJson({
      defaultFont: "Helvetica",
      blocks: [{ type: "paragraph", text: "Built-in font." }],
    });
    assert.ok(isPdf(bytes));
    return;
  }
  const doc: PdfDocumentJson = {
    fonts: [{ name: "Body", source: { base64: Buffer.from(fontBytes).toString("base64") } }],
    defaultFont: "Body",
    blocks: [{ type: "paragraph", text: "Custom font.", options: { font: "Body" } }],
  };
  const bytes = await renderDocumentJson(doc);
  assert.ok(isPdf(bytes));
  assert.match(pageText(bytes), /Custom font\./);
});

test("embeds an image from an inline base64 src", async () => {
  const doc: PdfDocumentJson = {
    blocks: [
      { type: "paragraph", text: "Logo:" },
      { type: "bmp", src: { base64: bmp1x1Base64() }, options: { width: 24 } },
    ],
  };
  const bytes = await renderDocumentJson(doc);
  assert.ok(isPdf(bytes));
  assert.equal(parseDocument(bytes).getPageCount(), 1);
});

test("interpolates page tokens in header and footer", async () => {
  const doc: PdfDocumentJson = {
    page: { size: "A4", footerHeight: 40 },
    footer: [{ type: "paragraph", text: "Page {{pageNumber}} of {{pageCount}}" }],
    blocks: [
      { type: "paragraph", text: "First page." },
      { type: "pageBreak" },
      { type: "paragraph", text: "Second page." },
    ],
  };
  const bytes = await renderDocumentJson(doc);
  const text = pageText(bytes);
  assert.match(text, /Page 1 of 2/);
  assert.match(text, /Page 2 of 2/);
});

test("applies document options (encryption, tagged, language)", async () => {
  const doc: PdfDocumentJson = {
    tagged: true,
    language: "en-US",
    encryption: { userPassword: "pw", algorithm: "aes-256" },
    blocks: [{ type: "paragraph", text: "secret" }],
  };
  const bytes = await renderDocumentJson(doc);
  assert.ok(isPdf(bytes));
  assert.match(Buffer.from(bytes).toString("latin1"), /\/Encrypt/);
});

test("does not mutate the caller's input", async () => {
  const doc: PdfDocumentJson = {
    blocks: [{ type: "bmp", src: { base64: bmp1x1Base64() }, options: { width: 10 } }],
  };
  const before = JSON.stringify(doc);
  await renderDocumentJson(doc);
  assert.equal(JSON.stringify(doc), before);
});

test("renderDocumentJsonSync works with inline base64 assets", () => {
  const bytes = renderDocumentJsonSync({
    blocks: [
      { type: "paragraph", text: "Sync render." },
      { type: "bmp", src: { base64: bmp1x1Base64() }, options: { width: 10 } },
    ],
  });
  assert.ok(isPdf(bytes));
  assert.match(pageText(bytes), /Sync render\./);
});

test("renderDocumentJsonSync rejects non-inline sources", () => {
  assert.throws(
    () =>
      renderDocumentJsonSync({
        blocks: [{ type: "png", src: { path: "/tmp/whatever.png" } }],
      }),
    (error: unknown) =>
      error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_DOCUMENT_JSON,
  );
});

test("places positioned blocks at absolute coordinates alongside flow", async () => {
  const bytes = await renderDocumentJson({
    page: { size: "A4" },
    blocks: [
      { type: "paragraph", text: "Flowed body." },
      { type: "paragraph", text: "Stamped at (72,640)", position: { x: 72, y: 640 } },
      {
        type: "rect",
        width: 220,
        height: 40,
        style: { paint: "stroke", stroke: { color: "black", width: 1 } },
        position: { x: 60, y: 620 },
      },
    ],
  });
  assert.ok(isPdf(bytes));
  const text = pageText(bytes);
  assert.match(text, /Flowed body\./);
  assert.match(text, /Stamped at \(72,640\)/);
});

test("supports a coordinate-only document (all blocks positioned)", async () => {
  const bytes = await renderDocumentJson({
    page: { size: "A4" },
    blocks: [{ type: "paragraph", text: "Coordinate-only page", position: { x: 100, y: 700 } }],
  });
  assert.ok(isPdf(bytes));
  assert.equal(parseDocument(bytes).getPageCount(), 1);
  assert.match(pageText(bytes), /Coordinate-only page/);
});

test("places a form field block at absolute x/y/width/height", async () => {
  const bytes = await renderDocumentJson({
    blocks: [
      { type: "paragraph", text: "Form:" },
      { type: "textField", name: "email", position: { x: 72, y: 640, width: 220, height: 14 } },
    ],
  });
  const fields = parseDocument(bytes).listFormFields();
  assert.ok(
    fields.some((f) => f.name === "email"),
    `expected an "email" field, got ${JSON.stringify(fields.map((f) => f.name))}`,
  );
});

test("honors a per-block top-left origin", async () => {
  const bytes = await renderDocumentJson({
    page: { size: "A4" },
    blocks: [{ type: "paragraph", text: "Top-left placed", position: { x: 72, y: 72, origin: "top-left" } }],
  });
  assert.ok(isPdf(bytes));
  assert.match(pageText(bytes), /Top-left placed/);
});

test("targets a later page, creating it when the flow is shorter", async () => {
  const bytes = await renderDocumentJson({
    page: { size: "A4" },
    blocks: [
      { type: "paragraph", text: "Page one flow." },
      { type: "paragraph", text: "On page 2", position: { x: 72, y: 700, page: 2 } },
    ],
  });
  assert.equal(parseDocument(bytes).getPageCount(), 2);
  assert.match(pageText(bytes), /On page 2/);
});

test("rejects a position on a non-positionable block type", async () => {
  await assert.rejects(
    renderDocumentJson({
      blocks: [{ type: "table", rows: [["a"]], position: { x: 10, y: 10 } }],
    } as unknown as Parameters<typeof renderDocumentJson>[0]),
    (error: unknown) =>
      error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_DOCUMENT_JSON,
  );
});

test("extracts text from a compressed document (no double-decode)", async () => {
  // Larger content compresses, so the page content stream gets a FlateDecode
  // filter; the extractor must not decode the already-inflated bytes twice.
  const bytes = await renderDocumentJson({
    compress: true,
    blocks: [
      { type: "heading", text: "Compressed report", options: { level: 1 } },
      {
        type: "table",
        rows: [
          [
            { text: "Key", header: true },
            { text: "Value", header: true },
          ],
          ["alpha", "one"],
          ["bravo", "two"],
        ],
        options: { headerRows: 1 },
      },
    ],
  });
  const text = pageText(bytes);
  assert.match(text, /Compressed report/);
  assert.match(text, /alpha/);
  assert.match(text, /bravo/);
});

test("rejects malformed documents with INVALID_DOCUMENT_JSON", async () => {
  const cases: unknown[] = [
    {},
    { blocks: [] },
    { blocks: [{ type: "paragraph", text: "x" }], header: "nope" },
    { blocks: [{ type: "paragraph", text: "x" }], fonts: [{ name: "", source: { base64: "AA" } }] },
  ];
  for (const bad of cases) {
    await assert.rejects(
      renderDocumentJson(bad as PdfDocumentJson),
      (error: unknown) =>
        error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_DOCUMENT_JSON,
    );
  }
});
