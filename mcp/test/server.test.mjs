// Integration tests for the zeropdf MCP server.
// Spawns the built server over stdio and drives it with the MCP client SDK,
// exercising every tool, the template-schema resource, and error paths.
//
// Run: npm test   (builds first, then `node --test`)
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, "..", "dist", "index.js");

const isPdf = (path) => readFileSync(path).subarray(0, 5).toString() === "%PDF-";

describe("zeropdf MCP server", () => {
  let client;
  let dir;

  // Shared fixtures produced by the generate/transfer tests below.
  let a; // 2-page document
  let b; // 1-page document
  let merged; // a + b = 3 pages

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "zeropdf-mcp-test-"));
    a = join(dir, "a.pdf");
    b = join(dir, "b.pdf");
    merged = join(dir, "merged.pdf");

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverEntry],
      env: { ...process.env, WORKSPACE_DIR: dir },
    });
    client = new Client(
      { name: "test", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(transport);
  });

  after(async () => {
    await client?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const call = (name, args) => client.callTool({ name, arguments: args });

  it("lists 9 tools, each with required annotations", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 9);
    for (const tool of tools) {
      const ann = tool.annotations ?? {};
      assert.ok(ann.title, `${tool.name} missing annotations.title`);
      assert.equal(typeof ann.readOnlyHint, "boolean", `${tool.name} missing readOnlyHint`);
      assert.equal(typeof ann.destructiveHint, "boolean", `${tool.name} missing destructiveHint`);
    }
  });

  it("uses an SDK that implements the latest MCP protocol and advertises current server metadata", () => {
    assert.equal(client.getProtocolEra(), "modern");
    assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
    assert.deepEqual(client.getServerVersion(), {
      name: "zeropdf",
      version: "0.6.1",
      title: "zeroPDF",
      websiteUrl: "https://zeropdf.criston.dev",
    });
  });

  it("generate_pdf writes a multi-page PDF from a template spec", async () => {
    const spec = {
      title: "Doc A",
      page: { size: "A4" },
      blocks: [
        { type: "heading", text: "Document A", options: { level: 1 } },
        { type: "paragraph", text: "Page one of A." },
        { type: "pageBreak" },
        { type: "paragraph", text: "Page two of A." },
      ],
    };
    const res = await call("generate_pdf", { document: spec, outputPath: a });
    assert.ok(!res.isError, res.content[0].text);
    assert.equal(res.structuredContent.path, a);
    assert.equal(res.content[1].type, "resource_link");
    assert.equal(res.content[1].mimeType, "application/pdf");
    assert.ok(isPdf(a));
  });

  it("generate_pdf writes a single-page PDF", async () => {
    const spec = {
      title: "Doc B",
      page: { size: "A4" },
      blocks: [
        { type: "heading", text: "Document B", options: { level: 1 } },
        { type: "paragraph", text: "Only page of B." },
      ],
    };
    const res = await call("generate_pdf", { document: spec, outputPath: b });
    assert.ok(!res.isError, res.content[0].text);
    assert.ok(isPdf(b));
  });

  it("get_pdf_info reports metadata and page count", async () => {
    const res = await call("get_pdf_info", { path: a });
    assert.equal(res.structuredContent.pageCount, 2);
    assert.equal(res.structuredContent.title, "Doc A");
  });

  it("extract_text returns per-page text", async () => {
    const res = await call("extract_text", { path: a });
    assert.equal(res.structuredContent.pages.length, 2);
    assert.match(res.structuredContent.pages[0].text, /Document A/);
  });

  it("generate_pdf applies documentOptions (tagged + language)", async () => {
    const out = join(dir, "tagged.pdf");
    const document = {
      title: "Tagged",
      page: { size: "A4" },
      tagged: true,
      language: "en-US",
      blocks: [{ type: "paragraph", text: "Hi." }],
    };
    const res = await call("generate_pdf", { document, outputPath: out });
    assert.ok(!res.isError, res.content[0].text);
    const inspected = await call("inspect_pdf", { path: out });
    const info = JSON.parse(inspected.content[0].text);
    assert.equal(info.tagged, true);
    assert.equal(info.language, "en-US");
  });

  it("generate_pdf encrypts output with a user password", async () => {
    const out = join(dir, "encrypted.pdf");
    const document = {
      blocks: [{ type: "paragraph", text: "secret" }],
      encryption: { userPassword: "pw", algorithm: "aes-256" },
    };
    const res = await call("generate_pdf", { document, outputPath: out });
    assert.ok(!res.isError, res.content[0].text);
    assert.match(readFileSync(out).toString("latin1"), /\/Encrypt/);
  });

  it("generate_pdf embeds an image referenced by path", async () => {
    // Hand-built 1x1 24-bit BMP (no CRC/compression, guaranteed valid).
    const bmp = Buffer.alloc(58);
    bmp.write("BM", 0, "ascii");
    bmp.writeUInt32LE(58, 2); // file size
    bmp.writeUInt32LE(54, 10); // pixel data offset
    bmp.writeUInt32LE(40, 14); // DIB header size
    bmp.writeInt32LE(1, 18); // width
    bmp.writeInt32LE(1, 22); // height
    bmp.writeUInt16LE(1, 26); // planes
    bmp.writeUInt16LE(24, 28); // bits per pixel
    bmp.writeUInt32LE(4, 34); // image size
    bmp[54] = 0; bmp[55] = 0; bmp[56] = 255; bmp[57] = 0; // one red pixel + pad
    const bmpPath = join(dir, "dot.bmp");
    writeFileSync(bmpPath, bmp);

    const out = join(dir, "with-image.pdf");
    const spec = {
      blocks: [
        { type: "paragraph", text: "Logo:" },
        { type: "bmp", src: { path: bmpPath }, options: { width: 32 } },
      ],
    };
    const res = await call("generate_pdf", { document: spec, outputPath: out });
    assert.ok(!res.isError, res.content[0].text);
    const info = await call("get_pdf_info", { path: out });
    assert.equal(info.structuredContent.pageCount, 1);
  });

  it("generate_pdf places positioned blocks at absolute coordinates", async () => {
    const out = join(dir, "positioned.pdf");
    const document = {
      page: { size: "A4" },
      blocks: [
        { type: "paragraph", text: "Body." },
        { type: "paragraph", text: "Stamped", position: { x: 72, y: 640 } },
        { type: "textField", name: "sig", position: { x: 72, y: 600, width: 220, height: 14 } },
      ],
    };
    const res = await call("generate_pdf", { document, outputPath: out });
    assert.ok(!res.isError, res.content[0].text);
    const text = await call("extract_text", { path: out });
    assert.match(text.structuredContent.pages[0].text, /Stamped/);
  });

  it("generate_pdf accepts a coordinate-only document", async () => {
    const out = join(dir, "coords-only.pdf");
    const res = await call("generate_pdf", {
      document: { page: { size: "A4" }, blocks: [{ type: "paragraph", text: "Coords", position: { x: 80, y: 700 } }] },
      outputPath: out,
    });
    assert.ok(!res.isError, res.content[0].text);
    const info = await call("get_pdf_info", { path: out });
    assert.equal(info.structuredContent.pageCount, 1);
  });

  it("inspect_pdf returns the structural shape", async () => {
    const res = await call("inspect_pdf", { path: a });
    const info = JSON.parse(res.content[0].text);
    assert.equal(typeof info.pageCount, "number");
    assert.ok(Array.isArray(info.formFields));
    assert.ok(Array.isArray(info.outlines));
    assert.ok(Array.isArray(info.attachments));
  });

  it("merge_pdfs concatenates whole documents", async () => {
    const res = await call("merge_pdfs", { paths: [a, b], outputPath: merged });
    assert.ok(!res.isError, res.content[0].text);
    const info = await call("get_pdf_info", { path: merged });
    assert.equal(info.structuredContent.pageCount, 3);
  });

  it("split_pdf writes one file per page", async () => {
    const outputDir = join(dir, "split");
    const res = await call("split_pdf", { path: merged, outputDir, prefix: "pg" });
    assert.ok(!res.isError, res.content[0].text);
    assert.deepEqual(readdirSync(outputDir).sort(), ["pg-1.pdf", "pg-2.pdf", "pg-3.pdf"]);
  });

  it("extract_pages keeps the chosen subset", async () => {
    const out = join(dir, "ext.pdf");
    const res = await call("extract_pages", { path: merged, pages: [0, 2], outputPath: out });
    assert.ok(!res.isError, res.content[0].text);
    const info = await call("get_pdf_info", { path: out });
    assert.equal(info.structuredContent.pageCount, 2);
  });

  it("append_pages appends all source pages", async () => {
    const out = join(dir, "app.pdf");
    const res = await call("append_pages", { targetPath: a, sourcePath: b, outputPath: out });
    assert.ok(!res.isError, res.content[0].text);
    const info = await call("get_pdf_info", { path: out });
    assert.equal(info.structuredContent.pageCount, 3);
  });

  it("append_pages appends a source-page subset", async () => {
    const out = join(dir, "app2.pdf");
    const res = await call("append_pages", { targetPath: b, sourcePath: a, pages: [0], outputPath: out });
    assert.ok(!res.isError, res.content[0].text);
    const info = await call("get_pdf_info", { path: out });
    assert.equal(info.structuredContent.pageCount, 2);
  });

  it("validate_pdf2 returns a typed conformance result", async () => {
    const res = await call("validate_pdf2", { path: a });
    assert.equal(typeof res.structuredContent.conformant, "boolean");
    assert.ok(Array.isArray(res.structuredContent.issues));
  });

  it("write tools refuse to overwrite by default", async () => {
    const spec = { blocks: [{ type: "paragraph", text: "x" }] };
    const blocked = await call("generate_pdf", { document: spec, outputPath: a });
    assert.ok(blocked.isError);
    assert.match(blocked.content[0].text, /already exists/);
  });

  it("write tools overwrite when overwrite:true", async () => {
    const spec = { blocks: [{ type: "paragraph", text: "x" }] };
    const res = await call("generate_pdf", { document: spec, outputPath: a, overwrite: true });
    assert.ok(!res.isError, res.content[0].text);
  });

  it("returns a tool error (not a crash) for a missing file", async () => {
    const res = await call("extract_text", { path: join(dir, "does-not-exist.pdf") });
    assert.ok(res.isError);
    assert.match(res.content[0].text, /Error/);
  });

  it("returns a tool error for an invalid template block", async () => {
    const res = await call("generate_pdf", {
      document: { blocks: [{ type: "bogus_block_kind" }] },
      outputPath: join(dir, "bad.pdf"),
    });
    assert.ok(res.isError);
  });

  it("rejects url sources in generate_pdf", async () => {
    const res = await call("generate_pdf", {
      document: { blocks: [{ type: "png", src: { url: "https://example.com/x.png" } }] },
      outputPath: join(dir, "url.pdf"),
    });
    assert.ok(res.isError);
    assert.match(res.content[0].text, /url/i);
  });

  it("serves the document-schema resource", async () => {
    const res = await client.readResource({ uri: "zeropdf://document-schema" });
    assert.match(res.contents[0].text, /PdfDocumentJson/);
  });
});
