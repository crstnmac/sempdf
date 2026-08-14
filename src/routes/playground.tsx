import { createFileRoute, Link } from "@tanstack/react-router";
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
import { renderDocumentJson, type PdfDocumentJson } from "../document-json";
import liberationSansDataUrl from "@crstnmac/sempdf-fonts/liberation/LiberationSans-Regular.ttf?inline";

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

type PlaygroundResult =
  | { ok: true; pdf: string; bytes: number; durationMs: number }
  | { ok: false; error: string };

type PlaygroundMode = "html" | "typescript" | "json";

function assertSafeDocument(value: unknown): asserts value is PdfDocumentJson {
  const stack: unknown[] = [value];
  let visited = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    visited += 1;
    if (visited > 4_000) throw new Error("The document is too complex for the playground.");
    if (!current || typeof current !== "object") continue;

    for (const [key, child] of Object.entries(current)) {
      if (key === "path" || key === "url" || key === "google") {
        throw new Error("Remote, filesystem, and Google Font assets are disabled in the playground.");
      }
      if (key === "base64" && typeof child === "string" && child.length > 512_000) {
        throw new Error("Inline assets are limited to 512 KB.");
      }
      if (typeof child === "object" && child !== null) stack.push(child);
    }
  }
}

const renderPlayground = createServerFn({ method: "POST" })
  .validator((input: { mode: PlaygroundMode; source: string }) => {
    if (!input || !["html", "typescript", "json"].includes(input.mode) || typeof input.source !== "string") {
      throw new Error("Playground input is invalid.");
    }
    if (Buffer.byteLength(input.source, "utf8") > MAX_SOURCE_BYTES) {
      throw new Error("Playground source is limited to 64 KB.");
    }
    return input;
  })
  .handler(async ({ data: { mode, source } }): Promise<PlaygroundResult> => {
    try {
      const startedAt = performance.now();
      let input: unknown;
      if (mode === "html") {
        input = {
          title: "HTML playground",
          tagged: true,
          language: "en",
          conformance: "pdfua-1",
          blocks: [{ type: "html", html: source }],
        };
      } else if (mode === "json") {
        input = JSON.parse(source);
      } else {
        const ts = await import("typescript");
        const file = ts.createSourceFile("document.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const declaration = file.statements.filter(ts.isVariableStatement)
          .flatMap((statement) => statement.declarationList.declarations)
          .find((item) => ts.isIdentifier(item.name) && item.name.text === "document");
        if (!declaration?.initializer) throw new Error("TypeScript mode requires `const document: PdfDocumentJson = { ... }`.");
        const readLiteral = (node: import("typescript").Expression): unknown => {
          if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return readLiteral(node.expression);
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
          if (ts.isNumericLiteral(node)) return Number(node.text);
          if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
          if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
          if (node.kind === ts.SyntaxKind.NullKeyword) return null;
          if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
          if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => {
            if (ts.isSpreadElement(element)) throw new Error("Spreads are not supported in TypeScript mode.");
            return readLiteral(element);
          });
          if (ts.isObjectLiteralExpression(node)) {
            const value: Record<string, unknown> = {};
            for (const property of node.properties) {
              if (!ts.isPropertyAssignment(property)) throw new Error("TypeScript mode accepts object properties only.");
              const name = property.name;
              if (!(ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) throw new Error("Computed property names are not supported.");
              value[name.text] = readLiteral(property.initializer);
            }
            return value;
          }
          throw new Error("TypeScript mode accepts data literals only; functions and expressions are disabled.");
        };
        input = readLiteral(declaration.initializer);
      }
      assertSafeDocument(input);
      const encodedFont = liberationSansDataUrl.slice(liberationSansDataUrl.indexOf(",") + 1);
      const fontBytes = new Uint8Array(Buffer.from(encodedFont, "base64"));
      const bytes = await renderDocumentJson(input, {
        fonts: {
          families: { "Liberation Sans": { regular: fontBytes } },
          default: "Liberation Sans",
          code: "Liberation Sans",
          fallbacks: ["Liberation Sans"],
        },
      });
      if (bytes.byteLength > MAX_OUTPUT_BYTES) {
        throw new Error("Rendered PDFs are limited to 5 MB.");
      }
      return {
        ok: true,
        pdf: Buffer.from(bytes).toString("base64"),
        bytes: bytes.byteLength,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The document could not be rendered." };
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

function formatSample(sample: SampleName, mode: PlaygroundMode): string {
  const json = JSON.stringify(samples[sample], null, 2);
  if (mode === "json") return json;
  if (mode === "html") return sampleHtml(sample);
  return `import type { PdfDocumentJson } from "@crstnmac/sempdf";\n\nconst document: PdfDocumentJson = ${json};`;
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
    setMessage("Rendering document on the server…");
    try {
      const result = await renderPlayground({ data: { mode, source } });
      if (!result.ok) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      const binary = atob(result.pdf);
      const bytes = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
      const nextUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setPdfUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setStatus("ready");
      setMessage(`Rendered ${(result.bytes / 1024).toFixed(1)} KB in ${result.durationMs} ms`);
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
    const handoff = `import { renderDocumentJson, type PdfDocumentJson } from "@crstnmac/sempdf";\nimport { liberation } from "@crstnmac/sempdf-fonts";\n\nconst document: PdfDocumentJson = ${source};\n\nconst bytes = await renderDocumentJson(document, { fonts: liberation });`;
    await navigator.clipboard.writeText(handoff);
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
              <p>Document JSON in, rendered PDF out.</p>
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
            <button type="button" className="playground-button playground-button-subtle" aria-label="Copy as TypeScript" title="Copy as TypeScript" onClick={copyTypeScript}>
              {copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
              <span>{copied ? "Copied" : "Copy TypeScript"}</span>
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
              <span><Code2 aria-hidden="true" size={14} /> document.{mode === "typescript" ? "ts" : mode}</span>
              <span>{lineCount} lines</span>
            </div>
            <div className="playground-editor">
              <Suspense fallback={<div className="playground-editor-loading">Loading editor…</div>}>
                <PlaygroundEditor mode={mode} value={source} onChange={(value) => setSources((current) => ({ ...current, [mode]: value }))} />
              </Suspense>
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
          <span className="playground-safety">Validated input · 64 KB source limit · no remote assets</span>
        </footer>
      </main>
    </HomeLayout>
  );
}
