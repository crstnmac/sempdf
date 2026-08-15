import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { baseOptions } from "@/lib/layout.shared";
import type { PdfDocumentJson } from "../document-json";

type PlaygroundMode = "html" | "typescript" | "json";
type RenderResult = { ok: true; bytesBase64: string; durationMs: number } | { ok: false; error: string };
const renderStarts: number[] = [];
let activeRenders = 0;

const renderOnServer = createServerFn({ method: "POST" })
  .validator((input: { mode: PlaygroundMode; source: string }) => input)
  .handler(async ({ data }): Promise<RenderResult> => {
    const startedAt = performance.now();
    const now = Date.now();
    while (renderStarts[0] !== undefined && renderStarts[0] < now - 60_000) renderStarts.shift();
    if (renderStarts.length >= 30) return { ok: false, error: "The render rate limit has been reached. Try again shortly." };
    if (activeRenders >= 2) return { ok: false, error: "The renderer is busy. Try again shortly." };
    renderStarts.push(now);
    activeRenders += 1;
    try {
      if (Buffer.byteLength(data.source, "utf8") > 64 * 1024) {
        throw new Error("Playground source is limited to 64 KB.");
      }

      // TypeScript's CommonJS-oriented system shim still reads these globals
      // while its ESM server bundle is being initialized.
      const serverGlobals = globalThis as typeof globalThis & { __filename?: string; __dirname?: string };
      serverGlobals.__filename ??= import.meta.filename;
      serverGlobals.__dirname ??= import.meta.dirname;
      const [ts, vm, sempdf, sempdfFonts] = await Promise.all([
        import("typescript"),
        import("node:vm"),
        import("../index.js"),
        import("@crstnmac/sempdf-fonts"),
      ]);
      const sourceFile = ts.default.createSourceFile("playground.ts", data.source, ts.default.ScriptTarget.ES2022, true);
      const allowedModules = new Map([
        ["@crstnmac/sempdf", new Set(["createDocument", "hex", "htmlToBlocks", "renderDocumentJson"])],
        ["@crstnmac/sempdf-fonts", new Set(["liberation"])],
      ]);
      const allowedIdentifiers = new Set(["undefined", "String"]);
      const forbiddenProperties = new Set(["constructor", "prototype", "__proto__", "writeToFile"]);
      const fail = (node: import("typescript").Node, message: string): never => {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        throw new Error(`${message} (line ${position.line + 1}).`);
      };
      const checkExpression = (node: import("typescript").Expression): void => {
        if (
          ts.default.isStringLiteral(node) || ts.default.isNumericLiteral(node) ||
          node.kind === ts.default.SyntaxKind.TrueKeyword || node.kind === ts.default.SyntaxKind.FalseKeyword ||
          node.kind === ts.default.SyntaxKind.NullKeyword || ts.default.isNoSubstitutionTemplateLiteral(node)
        ) return;
        if (ts.default.isIdentifier(node)) {
          if (!allowedIdentifiers.has(node.text)) fail(node, `Identifier ${node.text} is not available`);
          return;
        }
        if (ts.default.isArrayLiteralExpression(node)) {
          for (const element of node.elements) {
            if (ts.default.isSpreadElement(element)) fail(element, "Spread syntax is not available");
            checkExpression(element as import("typescript").Expression);
          }
          return;
        }
        if (ts.default.isObjectLiteralExpression(node)) {
          for (const property of node.properties) {
            if (!ts.default.isPropertyAssignment(property)) {
              fail(property, "Only plain object properties are available");
            }
            const assignment = property as import("typescript").PropertyAssignment;
            if (ts.default.isComputedPropertyName(assignment.name)) fail(assignment.name, "Computed properties are not available");
            checkExpression(assignment.initializer);
          }
          return;
        }
        if (ts.default.isPropertyAccessExpression(node)) {
          if (forbiddenProperties.has(node.name.text)) fail(node.name, `Property ${node.name.text} is not available`);
          checkExpression(node.expression);
          return;
        }
        if (ts.default.isCallExpression(node)) {
          checkExpression(node.expression);
          for (const argument of node.arguments) checkExpression(argument);
          return;
        }
        if (ts.default.isAwaitExpression(node)) {
          checkExpression(node.expression);
          return;
        }
        if (ts.default.isTaggedTemplateExpression(node) && ts.default.isNoSubstitutionTemplateLiteral(node.template)) {
          checkExpression(node.tag);
          return;
        }
        if (ts.default.isParenthesizedExpression(node) || ts.default.isAsExpression(node) || ts.default.isNonNullExpression(node)) {
          checkExpression(node.expression);
          return;
        }
        if (ts.default.isPrefixUnaryExpression(node) && (node.operator === ts.default.SyntaxKind.MinusToken || node.operator === ts.default.SyntaxKind.PlusToken)) {
          checkExpression(node.operand);
          return;
        }
        fail(node, `Syntax ${ts.default.SyntaxKind[node.kind]} is not available`);
      };
      for (const statement of sourceFile.statements) {
        if (ts.default.isImportDeclaration(statement)) {
          if (!ts.default.isStringLiteral(statement.moduleSpecifier)) {
            fail(statement, "Invalid module import");
          }
          const moduleName = (statement.moduleSpecifier as import("typescript").StringLiteral).text;
          const exports = allowedModules.get(moduleName);
          const bindings = statement.importClause?.namedBindings;
          if (exports === undefined || (bindings !== undefined && !ts.default.isNamedImports(bindings))) {
            fail(statement, "Module import is not available");
          }
          const availableExports = exports as Set<string>;
          const elements = bindings !== undefined && ts.default.isNamedImports(bindings) ? bindings.elements : [];
          for (const element of elements) {
            if (statement.importClause?.isTypeOnly === true || element.isTypeOnly) continue;
            const imported = element.propertyName?.text ?? element.name.text;
            if (!availableExports.has(imported)) fail(element, `Import ${imported} is not available`);
            allowedIdentifiers.add(element.name.text);
          }
          continue;
        }
        if (ts.default.isVariableStatement(statement) && (statement.declarationList.flags & ts.default.NodeFlags.Const) !== 0) {
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.default.isIdentifier(declaration.name) || declaration.initializer === undefined) {
              fail(declaration, "Only initialized const declarations are available");
            }
            if (!ts.default.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
            checkExpression(declaration.initializer);
            allowedIdentifiers.add(declaration.name.text);
          }
          continue;
        }
        if (ts.default.isExpressionStatement(statement) && ts.default.isCallExpression(statement.expression)) {
          checkExpression(statement.expression);
          continue;
        }
        fail(statement, "This statement is not available in the server playground");
      }
      const transpiled = ts.default.transpileModule(data.source, {
        compilerOptions: {
          target: ts.default.ScriptTarget.ES2022,
          module: ts.default.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
        reportDiagnostics: true,
      });
      const syntaxError = transpiled.diagnostics?.find(
        (diagnostic) => diagnostic.category === ts.default.DiagnosticCategory.Error,
      );
      if (syntaxError) throw new Error(ts.default.flattenDiagnosticMessageText(syntaxError.messageText, "\n"));

      const safeSempdf = Object.freeze({
        createDocument: sempdf.createDocument,
        hex: sempdf.hex,
        htmlToBlocks: sempdf.htmlToBlocks,
        renderDocumentJson: sempdf.renderDocumentJson,
      });
      const safeFonts = Object.freeze({ liberation: sempdfFonts.liberation });
      const requireModule = (name: unknown) => {
        if (name === "@crstnmac/sempdf") return safeSempdf;
        if (name === "@crstnmac/sempdf-fonts") return safeFonts;
        throw new Error(`Module ${String(name)} is not available in the playground.`);
      };
      const module = { exports: {} as Record<string, unknown> };
      const context = vm.default.createContext(
        { exports: module.exports, require: requireModule, module },
        { codeGeneration: { strings: false, wasm: false } },
      );
      const output = await vm.default.runInContext(
        `(async () => { ${transpiled.outputText}\nreturn typeof bytes === "undefined" ? undefined : bytes; })()`,
        context,
        { timeout: 10_000 },
      );
      if (!ArrayBuffer.isView(output) || (output as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT !== 1) {
        throw new Error("TypeScript mode must assign the generated Uint8Array to `bytes`.");
      }
      const bytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Rendered PDFs are limited to 5 MB.");

      return {
        ok: true,
        bytesBase64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64"),
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "TypeScript execution failed." };
    } finally {
      activeRenders -= 1;
    }
  });

const samples = {
  "Accessible report": {
    title: "Accessibility review",
    info: { author: "sempdf", subject: "Document review" },
    language: "en-US",
    tagged: true,
    conformance: "pdfua-1",
    compress: true,
    autoOutline: true,
    page: { size: "A4", margin: 56, footerHeight: 36 },
    footer: [
      {
        type: "paragraph",
        text: "Page {{pageNumber}} of {{pageCount}}",
        options: { align: "center", fontSize: 8, color: "gray", tag: "Artifact" },
      },
    ],
    blocks: [
      { type: "heading", text: "Accessibility review", options: { level: 1 } },
      {
        type: "paragraph",
        text: "A concise, tagged report generated from a declarative document definition.",
      },
      {
        type: "richParagraph",
        runs: [
          { text: "Overall status: " },
          { text: "PASS", bold: true, color: "green" },
          { text: " - all required checks completed." },
        ],
      },
      { type: "heading", text: "Findings", options: { level: 2 } },
      {
        type: "list",
        items: [
          "Document language is declared.",
          "Headings follow a logical hierarchy.",
          "Decorative content is excluded from the tag tree.",
        ],
      },
      {
        type: "table",
        rows: [
          [
            { text: "Check", header: true },
            { text: "Result", header: true },
          ],
          ["Tagged structure", "Pass"],
          ["Reading order", "Pass"],
          ["Document language", "Pass"],
        ],
        options: { headerRows: 1 },
      },
    ],
  },
  Invoice: {
    title: "Invoice 1007",
    info: { author: "Northwind Studio" },
    language: "en-US",
    tagged: true,
    conformance: "pdfua-1",
    page: { size: "A4", margin: 52 },
    styles: {
      title: { fontSize: 24, color: "teal" },
      muted: { color: "gray", fontSize: 9 },
    },
    blocks: [
      { type: "heading", text: "INVOICE", options: { level: 1 }, class: "title" },
      { type: "paragraph", text: "Invoice #1007 - 14 August 2026", class: "muted" },
      { type: "heading", text: "Bill to", options: { level: 2 } },
      { type: "paragraph", text: "Acme Products\n21 Market Street\nBengaluru, Karnataka" },
      {
        type: "table",
        rows: [
          [
            { text: "Description", header: true },
            { text: "Qty", header: true },
            { text: "Amount", header: true },
          ],
          ["Accessibility audit", "1", "$1,200.00"],
          ["Tagged PDF remediation", "2", "$840.00"],
          ["Total", "", "$2,040.00"],
        ],
        options: { headerRows: 1 },
      },
      { type: "paragraph", text: "Thank you for your business.", options: { color: "green" } },
    ],
  },
  "Layout sampler": {
    title: "Layout sampler",
    language: "en-US",
    tagged: true,
    conformance: "pdfua-1",
    page: { size: "Letter", margin: 48 },
    blocks: [
      { type: "heading", text: "Layout sampler", options: { level: 1 } },
      { type: "paragraph", text: "Mix headings, rich text, lists, tables, and vector graphics." },
      {
        type: "richParagraph",
        runs: [
          { text: "Rich text supports " },
          { text: "bold", bold: true },
          { text: ", " },
          { text: "italic", italic: true },
          { text: ", and color.", color: "teal" },
        ],
      },
      { type: "heading", text: "A compact checklist", options: { level: 2 } },
      { type: "list", items: ["Edit the JSON", "Render on the server", "Download the PDF"] },
      {
        type: "rect",
        width: 220,
        height: 64,
        style: { paint: "fillStroke", fill: { color: "silver" }, stroke: { color: "teal", width: 1 } },
      },
    ],
  },
} satisfies Record<string, PdfDocumentJson>;

type SampleName = keyof typeof samples;
type MobilePane = "source" | "preview";

const PlaygroundEditor = lazy(() => import("@/components/playground-editor"));

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function sampleHtml(sample: SampleName): string {
  const document = samples[sample];
  const body = document.blocks.map((item) => {
    if (item.type === "heading") return `<h${item.options?.level ?? 2}>${escapeHtml(item.text)}</h${item.options?.level ?? 2}>`;
    if (item.type === "paragraph") return `<p>${escapeHtml(item.text).replaceAll("\n", "<br>")}</p>`;
    if (item.type === "richParagraph") return `<p>${item.runs.map((run) => run.bold ? `<strong>${escapeHtml(run.text)}</strong>` : "italic" in run && run.italic ? `<em>${escapeHtml(run.text)}</em>` : escapeHtml(run.text)).join("")}</p>`;
    if (item.type === "list") return `<ul>\n${item.items.map((entry) => `  <li>${escapeHtml(String(entry))}</li>`).join("\n")}\n</ul>`;
    if (item.type === "table") return `<table>\n${item.rows.map((row) => `  <tr>${row.map((cell) => typeof cell === "string" ? `<td>${escapeHtml(cell)}</td>` : `<${cell.header ? "th" : "td"}>${escapeHtml(cell.text)}</${cell.header ? "th" : "td"}>`).join("")}</tr>`).join("\n")}\n</table>`;
    return "";
  }).filter(Boolean).join("\n\n");
  return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>${escapeHtml(document.title ?? sample)}</title>\n</head>\n<body>\n${body.split("\n").map((line) => `  ${line}`).join("\n")}\n</body>\n</html>`;
}

function formatTypeScriptValue(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, "$1$2:");
}

function formatSample(sample: SampleName, mode: PlaygroundMode): string {
  const jsonDocument = mode === "json" ? { ...samples[sample], conformance: undefined } : samples[sample];
  const json = JSON.stringify(jsonDocument, null, 2);
  if (mode === "json") return `import { renderDocumentJson, type PdfDocumentJson } from "@crstnmac/sempdf";

const document: PdfDocumentJson = ${json};

const bytes = await renderDocumentJson(document);`;
  if (mode === "html") {
    const html = sampleHtml(sample).replaceAll("`", "\\`").replaceAll("${", "\\${");
    return `import { createDocument, htmlToBlocks } from "@crstnmac/sempdf";

const html = String.raw\`${html}\`;

const doc = createDocument({ language: "en", tagged: true, compress: true });
doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  blocks: htmlToBlocks(html)
});

const bytes = doc.toUint8Array();`;
  }
  const document: PdfDocumentJson = samples[sample];
  const template = {
    ...(document.page === undefined ? {} : { page: document.page }),
    ...(document.styles === undefined ? {} : { styles: document.styles }),
    ...(document.autoOutline === undefined ? {} : { autoOutline: document.autoOutline }),
    blocks: document.blocks,
  };
  return `import { createDocument } from "@crstnmac/sempdf";

const doc = createDocument({
  language: ${JSON.stringify(document.language ?? "en-US")},
  tagged: ${document.tagged ?? false},
  compress: ${document.compress ?? true},
  defaultPageSize: ${JSON.stringify(document.page?.size ?? "A4")},
  info: ${formatTypeScriptValue({ title: document.title ?? sample, ...document.info })}
});

doc.renderTemplate(${formatTypeScriptValue(template)});

// The server previews whichever Uint8Array is assigned to \`bytes\`.
const bytes = doc.toUint8Array();`;
}

export const Route = createFileRoute("/playground")({
  component: Playground,
  head: () => ({
    meta: [
      { title: "Playground — sempdf" },
      { name: "description", content: "Build and render SemPDF documents inside the documentation." },
    ],
  }),
});

function Playground() {
  const [sample, setSample] = useState<SampleName>("Accessible report");
  const [mode, setMode] = useState<PlaygroundMode>("typescript");
  const [sources, setSources] = useState<Record<PlaygroundMode, string>>(() => ({
    html: formatSample("Accessible report", "html"),
    typescript: formatSample("Accessible report", "typescript"),
    json: formatSample("Accessible report", "json"),
  }));
  const [status, setStatus] = useState<"idle" | "rendering" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Ready to render");
  const [pdfUrl, setPdfUrl] = useState<string>();
  const [mobilePane, setMobilePane] = useState<MobilePane>("source");
  const [copied, setCopied] = useState(false);
  const [split, setSplit] = useState(48);
  const splitRef = useRef<HTMLDivElement>(null);
  const source = sources[mode];

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  const lineCount = useMemo(() => source.split("\n").length, [source]);

  async function render() {
    setStatus("rendering");
    setMessage("Running sempdf on the Node.js server…");
    try {
      const result = await renderOnServer({ data: { mode, source } });
      if (!result.ok) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      const bytes = Uint8Array.from(atob(result.bytesBase64), (character) => character.charCodeAt(0));
      const pdfBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const nextUrl = URL.createObjectURL(new Blob([pdfBuffer], { type: "application/pdf" }));
      setPdfUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setStatus("ready");
      setMessage(`Rendered ${(bytes.byteLength / 1024).toFixed(1)} KB in ${result.durationMs} ms`);
      setMobilePane("preview");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The render request failed.");
    }
  }

  function chooseSample(nextSample: SampleName) {
    setSample(nextSample);
    setSources((current) => ({ ...current, [mode]: formatSample(nextSample, mode) }));
    setStatus("idle");
    setMessage("Example loaded — render when ready");
  }

  function chooseMode(nextMode: PlaygroundMode) {
    setMode(nextMode);
    setStatus("idle");
    setMessage(`${nextMode === "typescript" ? "TypeScript" : nextMode.toUpperCase()} mode ready`);
  }

  async function copyTypeScript() {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function beginResize(event: React.PointerEvent<HTMLDivElement>) {
    const root = splitRef.current;
    if (!root) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const resize = (moveEvent: PointerEvent) => {
      const bounds = root.getBoundingClientRect();
      setSplit(Math.min(72, Math.max(30, ((moveEvent.clientX - bounds.left) / bounds.width) * 100)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
  }

  function nudgeSplit(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setSplit((current) => Math.min(72, Math.max(30, current + (event.key === "ArrowLeft" ? -4 : 4))));
  }

  return (
    <HomeLayout {...baseOptions()}>
      <main className="playground-shell">
        <header className="playground-toolbar">
          <div className="playground-heading">
            <Link to="/" className="playground-back" aria-label="Back to documentation home">
              <img src="/logo.svg" alt="" width={22} height={22} />
            </Link>
            <div>
              <h1>PDF playground</h1>
              <p>Real sempdf APIs, rendered locally.</p>
            </div>
          </div>

          <div className="playground-actions">
            <div className="playground-mode-switch" role="radiogroup" aria-label="Source language">
              {(["html", "typescript", "json"] as const).map((item) => (
                <button key={item} type="button" role="radio" aria-checked={mode === item} onClick={() => chooseMode(item)}>
                  {item === "typescript" ? "TypeScript" : item.toUpperCase()}
                </button>
              ))}
            </div>
            <label className="playground-select">
              <span className="sr-only">Starting example</span>
              <select value={sample} onChange={(event) => chooseSample(event.target.value as SampleName)}>
                {Object.keys(samples).map((name) => <option key={name}>{name}</option>)}
              </select>
              <ChevronDown aria-hidden="true" size={15} />
            </label>
            <button type="button" className="playground-button playground-button-subtle" aria-label="Reset example" title="Reset example" onClick={() => chooseSample(sample)}>
              <RotateCcw aria-hidden="true" size={15} />
              <span>Reset</span>
            </button>
            <button type="button" className="playground-button playground-button-subtle" aria-label="Copy source" title="Copy source" onClick={copyTypeScript}>
              {copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
              <span>{copied ? "Copied" : "Copy source"}</span>
            </button>
            {pdfUrl ? (
              <a className="playground-button playground-button-subtle" aria-label="Download PDF" title="Download PDF" href={pdfUrl} download="sempdf-playground.pdf">
                <Download aria-hidden="true" size={15} />
                <span>Download</span>
              </a>
            ) : null}
            <button type="button" className="playground-button playground-button-primary" aria-label={status === "rendering" ? "Rendering PDF" : "Render PDF"} title="Render PDF" onClick={render} disabled={status === "rendering"}>
              {status === "rendering" ? <LoaderCircle className="playground-spin" aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
              <span>{status === "rendering" ? "Rendering" : "Render PDF"}</span>
            </button>
          </div>
        </header>

        <div className="playground-mobile-tabs" role="tablist" aria-label="Workspace pane">
          <button type="button" role="tab" aria-selected={mobilePane === "source"} onClick={() => setMobilePane("source")}>
            <Code2 aria-hidden="true" size={15} /> Source
          </button>
          <button type="button" role="tab" aria-selected={mobilePane === "preview"} onClick={() => setMobilePane("preview")}>
            <FileText aria-hidden="true" size={15} /> Preview
          </button>
        </div>

        <div
          ref={splitRef}
          className="playground-workspace"
          data-mobile-pane={mobilePane}
          style={{ "--playground-split": `${split}%` } as React.CSSProperties}
        >
          <section className="playground-pane playground-source" aria-label="Document source">
            <div className="playground-pane-label">
              <span><Code2 aria-hidden="true" size={14} /> {mode === "html" ? "html-to-pdf.ts" : mode === "json" ? "json-to-pdf.ts" : "document.ts"}</span>
              <span>{lineCount} lines</span>
            </div>
            <div className="playground-editor">
              <ClientOnly fallback={<div className="playground-editor-loading">Loading editor…</div>}>
                <Suspense fallback={<div className="playground-editor-loading">Loading editor…</div>}>
                  <PlaygroundEditor mode={mode} value={source} onChange={(value) => setSources((current) => ({ ...current, [mode]: value }))} />
                </Suspense>
              </ClientOnly>
            </div>
          </section>

          <div
            className="playground-resizer"
            role="separator"
            aria-label="Resize source and preview"
            aria-orientation="vertical"
            aria-valuemin={30}
            aria-valuemax={72}
            aria-valuenow={Math.round(split)}
            tabIndex={0}
            onPointerDown={beginResize}
            onKeyDown={nudgeSplit}
          ><span /></div>

          <section className="playground-pane playground-preview" aria-label="PDF preview">
            <div className="playground-pane-label">
              <span><FileText aria-hidden="true" size={14} /> Preview</span>
              <span>{pdfUrl ? "PDF" : "Waiting"}</span>
            </div>
            {pdfUrl ? (
              <>
                <iframe src={pdfUrl} title="Rendered PDF preview" />
                <div className="playground-mobile-pdf">
                  <div className="playground-mobile-pdf-icon" aria-hidden="true">
                    <FileText size={28} />
                  </div>
                  <h2>PDF ready</h2>
                  <p>Mobile browsers open generated PDFs in their native document viewer.</p>
                  <div>
                    <a href={pdfUrl} target="_blank" rel="noreferrer">Open PDF</a>
                    <a href={pdfUrl} download="sempdf-playground.pdf">Download</a>
                  </div>
                </div>
              </>
            ) : (
              <div className="playground-empty">
                <div className="playground-paper" aria-hidden="true"><span /><span /><span /><span /></div>
                <h2>Your document appears here</h2>
                <p>Edit the JSON, then render it through the docs server.</p>
                <button type="button" onClick={render}>Render the example</button>
              </div>
            )}
          </section>
        </div>

        <footer className="playground-status" data-status={status}>
          <div className="playground-status-icon">
            {status === "error" ? <TriangleAlert aria-hidden="true" size={15} /> : status === "ready" ? <Check aria-hidden="true" size={15} /> : <span />}
          </div>
          <output aria-live="polite">{message}</output>
          <span className="playground-safety">Real library runtime · Node.js server rendering · 5 MB limit</span>
        </footer>
      </main>
    </HomeLayout>
  );
}
