import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
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
type WorkerResult = { ok: true; bytes: ArrayBuffer; durationMs: number } | { ok: false; error: string };

function renderInWorker(mode: PlaygroundMode, source: string): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("../workers/playground.worker.ts", import.meta.url), { type: "module" });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: "Rendering exceeded the 10 second limit." });
    }, 10_000);
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve({ ok: false, error: event.message || "The playground worker failed." });
    };
    worker.postMessage({ mode, source });
  });
}

const samples = {
  "Accessible report": {
    title: "Accessibility review",
    info: { author: "zeropdf", subject: "Document review" },
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
  if (mode === "json") return `import { renderDocumentJson, type PdfDocumentJson } from "@crstnmac/zeropdf";
import { liberation } from "@crstnmac/zeropdf-fonts";

const document: PdfDocumentJson = ${json};

const bytes = await renderDocumentJson(document, { fonts: liberation });`;
  if (mode === "html") {
    const html = sampleHtml(sample).replaceAll("`", "\\`").replaceAll("${", "\\${");
    return `import { createDocument, htmlToBlocks } from "@crstnmac/zeropdf";

const html = String.raw\`${html}\`;

const doc = createDocument({ language: "en", tagged: true, compress: true });
doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  blocks: htmlToBlocks(html)
});

const bytes = doc.toUint8Array();`;
  }
  const document: PdfDocumentJson = samples[sample];
  let y = 790;
  const commands: string[] = [];
  for (const item of document.blocks) {
    if (item.type === "heading") {
      commands.push(`page.text(${JSON.stringify(item.text)}, { x: 56, y: ${y}, fontSize: ${item.options?.level === 1 ? 24 : 16}, color: hex("#315200") });`);
      y -= item.options?.level === 1 ? 42 : 30;
    } else if (item.type === "paragraph") {
      commands.push(`page.textBlock(${JSON.stringify(item.text)}, { x: 56, y: ${y}, width: 480, fontSize: 11, lineHeight: 16 });`);
      y -= 42;
    } else if (item.type === "richParagraph") {
      commands.push(`page.textBlock(${JSON.stringify(item.runs.map((run) => run.text).join(""))}, { x: 56, y: ${y}, width: 480, fontSize: 11, lineHeight: 16 });`);
      y -= 34;
    } else if (item.type === "list") {
      for (const entry of item.items) {
        commands.push(`page.text(${JSON.stringify(`- ${String(entry)}`)}, { x: 68, y: ${y}, fontSize: 11 });`);
        y -= 20;
      }
    } else if (item.type === "table") {
      for (const row of item.rows) {
        const text = row.map((cell) => typeof cell === "string" ? cell : cell.text).join("    ");
        commands.push(`page.text(${JSON.stringify(text)}, { x: 56, y: ${y}, fontSize: 10 });`);
        y -= 20;
      }
    } else if (item.type === "rect") {
      commands.push(`page.rect(56, ${Math.max(80, y - item.height)}, ${item.width}, ${item.height}, { paint: "fillStroke", fill: { color: hex("#e8efec") }, stroke: { color: hex("#315200"), width: 1 } });`);
      y -= item.height + 20;
    }
  }
  return `import { createDocument, hex } from "@crstnmac/zeropdf";

const doc = createDocument({
  language: ${JSON.stringify(document.language ?? "en-US")},
  tagged: ${document.tagged ?? false},
  compress: ${document.compress ?? true},
  defaultPageSize: ${JSON.stringify(document.page?.size ?? "A4")},
  info: ${JSON.stringify(document.info ?? { title: document.title ?? sample }, null, 2)}
});

const page = doc.addPage();
${commands.join("\n")}

// The worker previews whichever Uint8Array is assigned to \`bytes\`.
const bytes = doc.toUint8Array();`;
}

export const Route = createFileRoute("/playground")({
  component: Playground,
  head: () => ({
    meta: [
      { title: "Playground — zeropdf" },
      { name: "description", content: "Build and render ZeroPDF documents inside the documentation." },
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
    setMessage("Running zeropdf in the browser…");
    try {
      const result = await renderInWorker(mode, source);
      if (!result.ok) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      const bytes = new Uint8Array(result.bytes);
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
              <p>Real zeropdf APIs, rendered locally.</p>
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
              <a className="playground-button playground-button-subtle" aria-label="Download PDF" title="Download PDF" href={pdfUrl} download="zeropdf-playground.pdf">
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
                    <a href={pdfUrl} download="zeropdf-playground.pdf">Download</a>
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
          <span className="playground-safety">Real library runtime · isolated browser worker · 10 s limit</span>
        </footer>
      </main>
    </HomeLayout>
  );
}
