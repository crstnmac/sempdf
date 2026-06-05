#!/usr/bin/env node
/**
 * MCP server for @criston/zeropdf.
 *
 * Exposes the library's PDF generation (declarative template passthrough) and
 * manipulation (parse / merge / split / page transfer / validate) over stdio.
 * Read tools are annotated `readOnlyHint`; write tools refuse to overwrite an
 * existing file unless `overwrite: true` is passed.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  appendPages,
  createDocument,
  extractPages,
  mergeDocuments,
  parseDocument,
  splitDocument,
  validatePdf2Conformance,
  type DocumentOptions,
  type TemplateDocumentOptions,
} from "@criston/zeropdf";

/** Filesystem scoping ----------------------------------------------------- */

// Largest PDF this server will read into memory.
const MAX_PDF_BYTES = 100 * 1024 * 1024;

// When a workspace root is configured (WORKSPACE_DIR env, set by the MCPB
// manifest, or the host's first roots/list entry) every path is resolved
// against it and may not escape it. Unset = unscoped (local stdio / dev).
let workspaceRoot: string | null = process.env.WORKSPACE_DIR
  ? resolve(process.env.WORKSPACE_DIR)
  : null;

/** Resolves a user-supplied path, enforcing containment when a root is set. */
function resolvePath(userPath: string): string {
  if (!workspaceRoot) return resolve(userPath);
  const full = resolve(workspaceRoot, userPath);
  const rel = relative(workspaceRoot, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes the workspace root (${workspaceRoot}): ${userPath}`);
  }
  return full;
}

/** Helpers ---------------------------------------------------------------- */

function ok(text: string, structuredContent?: Record<string, unknown>) {
  return structuredContent === undefined
    ? { content: [{ type: "text" as const, text }] }
    : { content: [{ type: "text" as const, text }], structuredContent };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

/** Reads any file (PDF or image), scoped to the workspace root and size-capped. */
async function readBytes(path: string): Promise<Uint8Array> {
  const full = resolvePath(path);
  const buf = await readFile(full);
  if (buf.length > MAX_PDF_BYTES) {
    throw new Error(`${full} is ${buf.length} bytes — exceeds the ${MAX_PDF_BYTES}-byte limit.`);
  }
  return new Uint8Array(buf);
}

// Template image block discriminators (see TemplateImageBlock).
const IMAGE_TYPES = new Set(["png", "jpeg", "bmp", "jbig2", "tiff", "jp2", "webp", "gif", "svg"]);

/**
 * Walks a template spec and replaces image blocks written as
 * `{ type: "png", path: "logo.png", ... }` with the file's bytes in `data`,
 * so images can be embedded over JSON (which can't carry binary). Paths are
 * scoped to the workspace root by readBytes. Mutates the spec in place.
 */
async function materializeImages(node: unknown): Promise<void> {
  if (Array.isArray(node)) {
    for (const child of node) await materializeImages(child);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.path === "string" && IMAGE_TYPES.has(obj.type as string) && obj.data === undefined) {
    obj.data = await readBytes(obj.path);
    delete obj.path;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === "data" || ArrayBuffer.isView(value)) continue;
    await materializeImages(value);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Writes `bytes` to `path`, refusing to clobber an existing file unless told. */
async function writePdf(path: string, bytes: Uint8Array, overwrite: boolean): Promise<string> {
  const full = resolvePath(path);
  if (!overwrite && (await exists(full))) {
    throw new Error(`${full} already exists. Pass overwrite: true to replace it.`);
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return full;
}

/** Annotation presets ----------------------------------------------------- */

/** Read-only tool annotations. `title` is required by the Anthropic Directory. */
const readOnly = (title: string) => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** Write tool annotations. Not destructive because writes refuse to clobber by default. */
const write = (title: string) => ({
  title,
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const overwriteParam = z
  .boolean()
  .default(false)
  .describe("Replace the output file if it already exists. Defaults to false (refuse to clobber).");

// Document-level options applied at creation time (encryption, conformance, etc).
// Signing is intentionally omitted — it needs a signing callback that can't cross JSON.
const documentOptionsParam = z
  .object({
    encryption: z
      .object({
        userPassword: z.string().optional().describe("Password required to open the document."),
        ownerPassword: z.string().optional().describe("Password granting owner-level permissions."),
        algorithm: z
          .enum(["rc4-40", "rc4-128", "aes-128", "aes-256", "aes-256-r6"])
          .optional()
          .describe("Encryption algorithm. Defaults to the library's strongest."),
        encryptMetadata: z.boolean().optional().describe("Encrypt the metadata stream. Defaults to true."),
        permissions: z
          .object({
            printing: z.boolean().optional(),
            modifying: z.boolean().optional(),
            copying: z.boolean().optional(),
            annotating: z.boolean().optional(),
            accessibility: z.boolean().optional(),
            assemble: z.boolean().optional(),
            highQualityPrint: z.boolean().optional(),
            fillForms: z.boolean().optional(),
          })
          .optional()
          .describe("Permission flags for encrypted output."),
      })
      .optional()
      .describe("Password-encrypt the output."),
    conformance: z
      .enum(["pdfa-1b", "pdfa-2b", "pdfa-3b", "pdfa-4", "pdfua-1", "pdfua-2", "wtpdf"])
      .optional()
      .describe("Validate and emit a PDF/A or PDF/UA conformance profile. PDF/UA implies tagged."),
    language: z.string().optional().describe("BCP 47 language tag for the document."),
    tagged: z.boolean().optional().describe("Emit a tagged (accessible) PDF structure tree."),
    compress: z.boolean().optional().describe("Compress content streams. Defaults to true."),
  })
  .optional()
  .describe("Document-level options (encryption, conformance, language, tagged, compress).");

/** Server ----------------------------------------------------------------- */

const server = new McpServer(
  { name: "zeropdf", version: "0.1.0" },
  {
    instructions:
      "Generates and manipulates PDFs via @criston/zeropdf. To author a `generate_pdf` spec, " +
      "first read the `zeropdf://template-schema` resource for the TemplateDocumentOptions / TemplateBlock " +
      "types. PDFs are passed as filesystem paths. Write tools refuse to overwrite existing files unless " +
      "`overwrite: true` is set.",
  },
);

/* generate_pdf — declarative template passthrough --------------------------- */

server.registerTool(
  "generate_pdf",
  {
    title: "Generate PDF from a template spec",
    description:
      "Render a PDF from a declarative zeropdf TemplateDocumentOptions JSON spec and write it to disk. " +
      "The `spec` shape (blocks[], page, styles, pageNumber, autoOutline, info, title) is documented in the " +
      "`zeropdf://template-schema` resource — read it first. Each block is discriminated by `type` " +
      "(e.g. {\"type\":\"heading\",\"text\":\"...\",\"options\":{\"level\":1}}). Image blocks may reference a " +
      "file with `path` (e.g. {\"type\":\"png\",\"path\":\"logo.png\"}) — its bytes are embedded. `header`/`footer` " +
      "callbacks cannot be expressed in JSON; use `pageNumber` for page numbering. To combine or edit existing " +
      "PDFs use merge_pdfs / append_pages / extract_pages instead.",
    inputSchema: {
      spec: z
        .object({ blocks: z.array(z.record(z.unknown())) })
        .passthrough()
        .describe("TemplateDocumentOptions JSON. Must include a `blocks` array of template blocks."),
      documentOptions: documentOptionsParam,
      outputPath: z.string().describe("Filesystem path to write the resulting PDF to."),
      overwrite: overwriteParam,
    },
    annotations: write("Generate PDF from a template spec"),
  },
  async ({ spec, documentOptions, outputPath, overwrite }) => {
    try {
      await materializeImages(spec);
      const doc = createDocument((documentOptions ?? {}) as DocumentOptions);
      doc.renderTemplate(spec as unknown as TemplateDocumentOptions);
      const bytes = doc.toUint8Array();
      const full = await writePdf(outputPath, bytes, overwrite);
      return ok(`Wrote ${bytes.length} bytes to ${full}`);
    } catch (error) {
      return fail(error);
    }
  },
);

/* extract_text -------------------------------------------------------------- */

server.registerTool(
  "extract_text",
  {
    title: "Extract text from a PDF",
    description:
      "Parse a PDF and return its text content, one entry per page in stream order. For document metadata " +
      "(title, author, page count) use get_pdf_info instead.",
    inputSchema: {
      path: z.string().describe("Path to the source PDF."),
    },
    outputSchema: {
      pages: z
        .array(z.object({ pageIndex: z.number().int(), text: z.string() }))
        .describe("Extracted text per page, zero-based pageIndex."),
    },
    annotations: readOnly("Extract text from a PDF"),
  },
  async ({ path }) => {
    try {
      const extracted = parseDocument(await readBytes(path)).extractText();
      const pages = extracted.map((p) => ({ pageIndex: p.pageIndex, text: p.text }));
      return ok(JSON.stringify(pages, null, 2), { pages });
    } catch (error) {
      return fail(error);
    }
  },
);

/* get_pdf_info -------------------------------------------------------------- */

server.registerTool(
  "get_pdf_info",
  {
    title: "Get PDF metadata",
    description:
      "Return document metadata (title, author, subject, keywords, creator, producer, dates) plus page " +
      "count. For the actual page text use extract_text instead.",
    inputSchema: {
      path: z.string().describe("Path to the source PDF."),
    },
    outputSchema: {
      title: z.string().optional(),
      author: z.string().optional(),
      subject: z.string().optional(),
      keywords: z.string().optional(),
      creator: z.string().optional(),
      producer: z.string().optional(),
      creationDate: z.string().optional(),
      modificationDate: z.string().optional(),
      pageCount: z.number().int(),
    },
    annotations: readOnly("Get PDF metadata"),
  },
  async ({ path }) => {
    try {
      const doc = parseDocument(await readBytes(path));
      const info = { ...doc.getMetadata(), pageCount: doc.listPages().length };
      return ok(JSON.stringify(info, null, 2), info);
    } catch (error) {
      return fail(error);
    }
  },
);

/* inspect_pdf --------------------------------------------------------------- */

server.registerTool(
  "inspect_pdf",
  {
    title: "Inspect PDF structure",
    description:
      "Read structural details from a PDF: form fields, outline/bookmarks, attachments (names and sizes, " +
      "not contents), named destinations, page labels, and accessibility/conformance flags (tagged, " +
      "language, PDF/A or PDF/UA profile). For plain metadata use get_pdf_info; for page text use extract_text.",
    inputSchema: {
      path: z.string().describe("Path to the source PDF."),
    },
    annotations: readOnly("Inspect PDF structure"),
  },
  async ({ path }) => {
    try {
      const doc = parseDocument(await readBytes(path));
      const result = {
        pageCount: doc.getPageCount(),
        tagged: doc.isTagged(),
        language: doc.getLanguage() ?? null,
        conformanceProfile: doc.getConformanceProfile() ?? null,
        hasXmpMetadata: doc.getXmpMetadata() !== undefined,
        formFields: doc.listFormFields().map((f) => ({
          name: f.name,
          fieldType: f.fieldType ?? null,
          buttonKind: f.buttonKind ?? null,
          value: f.value ?? null,
          options: f.options ?? null,
        })),
        outlines: doc.listOutlines(),
        attachments: doc.listAttachments().map((a) => ({
          name: a.name,
          description: a.description ?? null,
          mimeType: a.mimeType ?? null,
          byteLength: a.byteLength ?? null,
        })),
        namedDestinations: doc.listNamedDestinations().map((d) => d.name),
        pageLabels: doc.listPageLabels(),
      };
      return ok(JSON.stringify(result, null, 2));
    } catch (error) {
      return fail(error);
    }
  },
);

/* merge_pdfs ---------------------------------------------------------------- */

server.registerTool(
  "merge_pdfs",
  {
    title: "Merge PDFs",
    description:
      "Concatenate multiple whole PDFs (in the order given) into a single output PDF. To append only some " +
      "pages of one PDF onto another use append_pages.",
    inputSchema: {
      paths: z.array(z.string()).min(1).describe("Source PDF paths, in merge order."),
      outputPath: z.string().describe("Path to write the merged PDF."),
      overwrite: overwriteParam,
    },
    annotations: write("Merge PDFs"),
  },
  async ({ paths, outputPath, overwrite }) => {
    try {
      const sources = await Promise.all(paths.map(readBytes));
      const bytes = mergeDocuments(sources);
      const full = await writePdf(outputPath, bytes, overwrite);
      return ok(`Merged ${paths.length} PDFs → ${full} (${bytes.length} bytes)`);
    } catch (error) {
      return fail(error);
    }
  },
);

/* split_pdf ----------------------------------------------------------------- */

server.registerTool(
  "split_pdf",
  {
    title: "Split a PDF into single pages",
    description:
      "Split a PDF into one single-page PDF per source page, written into a directory as " +
      "<prefix>-<n>.pdf (1-based). To keep only a chosen subset in one file use extract_pages instead.",
    inputSchema: {
      path: z.string().describe("Path to the source PDF."),
      outputDir: z.string().describe("Directory to write the page PDFs into (created if absent)."),
      prefix: z.string().default("page").describe("Filename prefix. Files are <prefix>-<n>.pdf, 1-based."),
      overwrite: overwriteParam,
    },
    annotations: write("Split a PDF into single pages"),
  },
  async ({ path, outputDir, prefix, overwrite }) => {
    try {
      const parts = splitDocument(await readBytes(path));
      const written: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        const full = await writePdf(join(outputDir, `${prefix}-${i + 1}.pdf`), parts[i]!, overwrite);
        written.push(full);
      }
      return ok(`Split into ${parts.length} files:\n${written.join("\n")}`);
    } catch (error) {
      return fail(error);
    }
  },
);

/* extract_pages ------------------------------------------------------------- */

server.registerTool(
  "extract_pages",
  {
    title: "Extract specific pages",
    description:
      "Extract a subset of pages (by zero-based index, in the order given) into a new PDF. To split every " +
      "page into its own file use split_pdf.",
    inputSchema: {
      path: z.string().describe("Path to the source PDF."),
      pages: z.array(z.number().int().min(0)).min(1).describe("Zero-based page indexes to keep, in order."),
      outputPath: z.string().describe("Path to write the extracted PDF."),
      overwrite: overwriteParam,
    },
    annotations: write("Extract specific pages"),
  },
  async ({ path, pages, outputPath, overwrite }) => {
    try {
      const bytes = extractPages(await readBytes(path), pages);
      const full = await writePdf(outputPath, bytes, overwrite);
      return ok(`Extracted ${pages.length} pages → ${full} (${bytes.length} bytes)`);
    } catch (error) {
      return fail(error);
    }
  },
);

/* append_pages -------------------------------------------------------------- */

server.registerTool(
  "append_pages",
  {
    title: "Append pages from one PDF to another",
    description:
      "Append pages from a source PDF onto the end of a target PDF. Omit `pages` to append all source " +
      "pages. To concatenate whole PDFs use merge_pdfs.",
    inputSchema: {
      targetPath: z.string().describe("PDF that receives appended pages."),
      sourcePath: z.string().describe("PDF to copy pages from."),
      pages: z
        .array(z.number().int().min(0))
        .optional()
        .describe("Zero-based source page indexes to append; omit for all source pages."),
      outputPath: z.string().describe("Path to write the combined PDF."),
      overwrite: overwriteParam,
    },
    annotations: write("Append pages from one PDF to another"),
  },
  async ({ targetPath, sourcePath, pages, outputPath, overwrite }) => {
    try {
      const bytes = appendPages(await readBytes(targetPath), await readBytes(sourcePath), pages);
      const full = await writePdf(outputPath, bytes, overwrite);
      return ok(`Appended → ${full} (${bytes.length} bytes)`);
    } catch (error) {
      return fail(error);
    }
  },
);

/* validate_pdf2 ------------------------------------------------------------- */

server.registerTool(
  "validate_pdf2",
  {
    title: "Validate PDF 2.0 conformance",
    description:
      "Check a PDF for PDF 2.0 conformance issues. Returns `conformant` plus an `issues` list of " +
      "{ code, message } (empty when clean).",
    inputSchema: {
      path: z.string().describe("Path to the source PDF."),
    },
    outputSchema: {
      conformant: z.boolean(),
      issues: z.array(z.object({ code: z.string(), message: z.string() })),
    },
    annotations: readOnly("Validate PDF 2.0 conformance"),
  },
  async ({ path }) => {
    try {
      const found = validatePdf2Conformance(parseDocument(await readBytes(path)));
      const issues = found.map((i) => ({ code: i.code, message: i.message }));
      const result = { conformant: issues.length === 0, issues };
      const text =
        issues.length === 0 ? "No PDF 2.0 conformance issues found." : JSON.stringify(result, null, 2);
      return ok(text, result);
    } catch (error) {
      return fail(error);
    }
  },
);

/* Resource: template schema ------------------------------------------------- */

server.registerResource(
  "template-schema",
  "zeropdf://template-schema",
  {
    title: "zeropdf template type declarations",
    description:
      "TypeScript .d.ts declarations covering TemplateDocumentOptions and every TemplateBlock variant. " +
      "Read this to author `generate_pdf` specs.",
    mimeType: "text/plain",
  },
  async (uri) => {
    const text = await loadTypeDeclarations();
    return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
  },
);

/** Loads the library's type declarations, whether running from node_modules or a bundle. */
async function loadTypeDeclarations(): Promise<string> {
  // Bundled (MCPB): shipped beside the entry as template-types.txt
  // (mcpb pack strips *.d.ts, so it can't be named types.d.ts).
  const beside = join(dirname(fileURLToPath(import.meta.url)), "template-types.txt");
  if (await exists(beside)) return readFile(beside, "utf8");
  // Dev: resolve from the installed package. import.meta.resolve honors `exports`.
  const entry = fileURLToPath(import.meta.resolve("@criston/zeropdf"));
  return readFile(join(dirname(entry), "types.d.ts"), "utf8");
}

/* Boot ---------------------------------------------------------------------- */

// If no WORKSPACE_DIR was configured, adopt the host's first approved root
// (roots/list) as the workspace boundary once the session initializes.
server.server.oninitialized = async () => {
  if (workspaceRoot) return;
  const caps = server.server.getClientCapabilities();
  if (!caps?.roots) return;
  try {
    const { roots } = await server.server.listRoots();
    if (roots[0]?.uri) workspaceRoot = fileURLToPath(roots[0].uri);
  } catch {
    // Host advertised roots but the call failed — stay unscoped.
  }
};

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe; stdout is reserved for the MCP protocol.
  console.error("zeropdf MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
