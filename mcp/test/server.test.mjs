// Integration tests for the sempdf MCP server.
// Spawns the built server over stdio and drives it with the MCP client SDK,
// exercising every tool, the template-schema resource, and error paths.
//
// Run: npm test   (builds first, then `node --test`)
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, "..", "dist", "index.js");

const isPdf = (path) => readFileSync(path).subarray(0, 5).toString() === "%PDF-";

describe("sempdf MCP server", () => {
  let client;
  let dir;

  // Shared fixtures produced by the generate/transfer tests below.
  let a; // 2-page document
  let b; // 1-page document
  let merged; // a + b = 3 pages

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "sempdf-mcp-test-"));
    a = join(dir, "a.pdf");
    b = join(dir, "b.pdf");
    merged = join(dir, "merged.pdf");

    const transport = new StdioClientTransport({ command: "node", args: [serverEntry] });
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
  });

  after(async () => {
    await client?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const call = (name, args) => client.callTool({ name, arguments: args });

  it("lists 8 tools, each with required annotations", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    for (const tool of tools) {
      const ann = tool.annotations ?? {};
      assert.ok(ann.title, `${tool.name} missing annotations.title`);
      assert.equal(typeof ann.readOnlyHint, "boolean", `${tool.name} missing readOnlyHint`);
      assert.equal(typeof ann.destructiveHint, "boolean", `${tool.name} missing destructiveHint`);
    }
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
    const res = await call("generate_pdf", { spec, outputPath: a });
    assert.ok(!res.isError, res.content[0].text);
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
    const res = await call("generate_pdf", { spec, outputPath: b });
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
    const blocked = await call("generate_pdf", { spec, outputPath: a });
    assert.ok(blocked.isError);
    assert.match(blocked.content[0].text, /already exists/);
  });

  it("write tools overwrite when overwrite:true", async () => {
    const spec = { blocks: [{ type: "paragraph", text: "x" }] };
    const res = await call("generate_pdf", { spec, outputPath: a, overwrite: true });
    assert.ok(!res.isError, res.content[0].text);
  });

  it("returns a tool error (not a crash) for a missing file", async () => {
    const res = await call("extract_text", { path: join(dir, "does-not-exist.pdf") });
    assert.ok(res.isError);
    assert.match(res.content[0].text, /Error/);
  });

  it("returns a tool error for an invalid template block", async () => {
    const res = await call("generate_pdf", {
      spec: { blocks: [{ type: "bogus_block_kind" }] },
      outputPath: join(dir, "bad.pdf"),
    });
    assert.ok(res.isError);
  });

  it("serves the template-schema resource", async () => {
    const res = await client.readResource({ uri: "sempdf://template-schema" });
    assert.match(res.contents[0].text, /TemplateDocumentOptions/);
  });
});
