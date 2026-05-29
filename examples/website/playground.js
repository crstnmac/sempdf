const previewEl = document.querySelector("#preview");
const statusEl = document.querySelector("#status");
const downloadEl = document.querySelector("#download");
const splitEl = document.querySelector("#split");
const resizerEl = document.querySelector("#resizer");
const editorEl = document.querySelector("#editor");
const sampleEl = document.querySelector("#sample");

// Selectable starting points. Each is valid TypeScript that builds a document
// and `export default`s it. Keep all text ASCII so the built-in font renders it.
const SAMPLES = [
  {
    label: "Stylesheets & tables",
    code: `import { createDocument, rgb } from "@criston/zeropdf";

// Build a PDF and \`export default\` the document.
const doc = createDocument({
  title: "Stylesheets and Tables Demo",
  language: "en-US",
  xmpMetadata: {
    creator: "zeropdf playground"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  styles: {
    heading1: { fontSize: 28, color: rgb(0.11, 0.22, 0.45) },
    heading2: { fontSize: 16, color: rgb(0.11, 0.22, 0.45) },
    paragraph: { fontSize: 12, lineHeight: 18 },
    muted: { color: rgb(0.45, 0.45, 0.45) }
  },
  blocks: [
    { type: "heading", text: "Hello from zeropdf", options: { level: 1 } },
    { type: "paragraph", text: "Generated in the browser - no server, no dependencies.", class: "muted" },

    { type: "heading", text: "Stylesheets", options: { level: 2 } },
    { type: "paragraph", text: "Define reusable styles once and apply them by block type or via a class." },
    { type: "paragraph", text: "Edit this code on the left and hit Run.", class: "muted" },

    { type: "heading", text: "Tables", options: { level: 2 } },
    {
      type: "table",
      rows: [
        [{ text: "Item", header: true }, { text: "Qty", header: true }, { text: "Price", header: true }],
        ["Notebook", "2", "$11.00"],
        ["Pen", "5", "$7.50"]
      ],
      options: { headerRows: 1 }
    }
  ]
});

export default doc;
`
  },
  {
    label: "Single page (low level)",
    code: `import { createDocument, rgb } from "@criston/zeropdf";

const doc = createDocument({
  title: "Single Page Demo",
  language: "en-US",
  xmpMetadata: {
    creator: "zeropdf playground"
  }
});
const page = doc.addPage({ size: "A4" });

page.text("Hello from zeropdf", { x: 56, y: 760, fontSize: 28, color: rgb(0.11, 0.22, 0.45) });
page.text("Drawn at absolute coordinates on a single page.", { x: 56, y: 730, fontSize: 12 });

export default doc;
`
  },
  {
    label: "Invoice",
    code: `import { createDocument, rgb } from "@criston/zeropdf";

const doc = createDocument({
  title: "Invoice 1042",
  language: "en-US",
  xmpMetadata: {
    creator: "zeropdf playground"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  styles: {
    heading1: { fontSize: 26, color: rgb(0.1, 0.1, 0.12) },
    muted: { color: rgb(0.5, 0.5, 0.5), fontSize: 10 },
    paragraph: { fontSize: 11, lineHeight: 16 }
  },
  blocks: [
    { type: "heading", text: "Invoice #1042", options: { level: 1 } },
    { type: "paragraph", text: "Acme Corp  -  Issued 2026-05-29", class: "muted" },
    {
      type: "table",
      rows: [
        [{ text: "Description", header: true }, { text: "Qty", header: true }, { text: "Amount", header: true }],
        ["Design work", "10", "$1,000.00"],
        ["Development", "20", "$3,000.00"],
        [{ text: "Total", header: true }, "-", "$4,000.00"]
      ],
      options: { headerRows: 1 }
    }
  ]
});

export default doc;
`
  },
  {
    label: "Multi-column",
    code: `import { createDocument } from "@criston/zeropdf";

const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(8);

const doc = createDocument({
  title: "Newspaper Layout Demo",
  language: "en-US",
  xmpMetadata: {
    creator: "zeropdf playground"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 48, columns: { count: 2, gap: 24 } },
  styles: {
    heading1: { fontSize: 22 },
    paragraph: { fontSize: 11, lineHeight: 16 }
  },
  blocks: [
    { type: "heading", text: "Newspaper layout", options: { level: 1 } },
    { type: "paragraph", text: lorem },
    { type: "paragraph", text: lorem }
  ]
});

export default doc;
`
  }
];

let currentUrl = null;
let editor = null;
let monaco = null;

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.classList.remove("text-zinc-400", "text-emerald-400", "text-rose-400");
  statusEl.classList.add(
    kind === "ok" ? "text-emerald-400" : kind === "error" ? "text-rose-400" : "text-zinc-400"
  );
}

// Recursively load zeropdf's .d.ts files so the editor offers real IntelliSense.
// Non-fatal: editing still works if any fetch fails.
async function loadTypes() {
  const base = "/dist/src/";
  const defaults = monaco.languages.typescript.typescriptDefaults;
  const seen = new Set();

  const resolve = (dir, spec) => {
    const parts = (dir + spec).split("/");
    const out = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return out.join("/");
  };

  // Minimal package manifest so module resolution finds the entry types.
  defaults.addExtraLib(
    JSON.stringify({ name: "@criston/zeropdf", types: "index.d.ts" }),
    "file:///node_modules/@criston/zeropdf/package.json"
  );

  async function add(relPath) {
    if (seen.has(relPath)) return;
    seen.add(relPath);
    const response = await fetch(base + relPath);
    if (!response.ok) return;
    const text = await response.text();
    defaults.addExtraLib(text, `file:///node_modules/@criston/zeropdf/${relPath}`);

    const dir = relPath.includes("/") ? `${relPath.slice(0, relPath.lastIndexOf("/"))}/` : "";
    const re = /from\s+["'](\.[^"']+)["']/g;
    let match;
    while ((match = re.exec(text))) {
      const target = resolve(dir, match[1].replace(/\.js$/, ".d.ts"));
      await add(target);
    }
  }

  try {
    await add("index.d.ts");
  } catch {
    /* IntelliSense is best-effort */
  }
}

async function run() {
  if (!editor) return;
  let doc;
  try {
    const model = editor.getModel();
    const worker = await monaco.languages.typescript.getTypeScriptWorker();
    const client = await worker(model.uri);
    const output = await client.getEmitOutput(model.uri.toString());
    if (output.emitSkipped || !output.outputFiles.length) {
      throw new Error("could not compile the TypeScript");
    }

    const js = output.outputFiles[0].text;
    const moduleUrl = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
    try {
      // The page importmap resolves the `zeropdf` import inside this module.
      const module = await import(moduleUrl);
      doc = module.default;
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  } catch (error) {
    setStatus(`Code error: ${error.message}`, "error");
    return;
  }

  if (!doc || typeof doc.toBlob !== "function") {
    setStatus("Your code must `export default` a document — add `export default doc;`.", "error");
    return;
  }

  try {
    const blob = doc.toBlob();
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    previewEl.src = currentUrl;
    downloadEl.href = currentUrl;
    downloadEl.removeAttribute("aria-disabled");
    setStatus(`Rendered ${(blob.size / 1024).toFixed(1)} KB at ${new Date().toLocaleTimeString()}.`, "ok");
  } catch (error) {
    setStatus(`Render error: ${error.message}`, "error");
  }
}

// Debounced live render: re-render shortly after the user stops typing.
let renderTimer = null;
function scheduleRender() {
  setStatus("Rendering…", "muted");
  clearTimeout(renderTimer);
  renderTimer = setTimeout(run, 400);
}

// Resizer: drag with a pointer, or nudge with arrow keys.
function setSplit(percent) {
  splitEl.style.setProperty("--split", `${Math.min(85, Math.max(15, percent))}%`);
}

resizerEl.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  resizerEl.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    const rect = splitEl.getBoundingClientRect();
    setSplit(((moveEvent.clientX - rect.left) / rect.width) * 100);
  };
  const up = () => {
    resizerEl.removeEventListener("pointermove", move);
    resizerEl.removeEventListener("pointerup", up);
  };
  resizerEl.addEventListener("pointermove", move);
  resizerEl.addEventListener("pointerup", up);
});

resizerEl.addEventListener("keydown", (event) => {
  const rect = splitEl.getBoundingClientRect();
  const editorWidth = editorEl.closest("section").getBoundingClientRect().width;
  const current = (editorWidth / rect.width) * 100;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    setSplit(current - 4);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    setSplit(current + 4);
  }
});

// Boot Monaco, wire TypeScript, then render the default document.
(async () => {
  monaco = await window.monacoReady;

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    // 100 = Bundler resolution (Monaco's enum only exposes Classic/NodeJs).
    // Bundler resolves the `.js` import specifiers in the .d.ts files.
    moduleResolution: 100,
    allowNonTsExtensions: true,
    allowJs: true,
    noEmit: false,
    strict: false,
    baseUrl: "file:///",
    paths: { "@criston/zeropdf": ["node_modules/@criston/zeropdf/index.d.ts"] },
    lib: ["esnext", "dom"]
  });

  await loadTypes();

  const model = monaco.editor.createModel(
    SAMPLES[0].code,
    "typescript",
    // A file:// URI lets module resolution walk up to /node_modules.
    monaco.Uri.parse("file:///main.ts")
  );
  editor = monaco.editor.create(editorEl, {
    model,
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 2,
    scrollBeyondLastLine: false,
    padding: { top: 12 }
  });

  // Live render: re-run shortly after edits stop.
  editor.onDidChangeModelContent(scheduleRender);

  // Populate the sample picker; switching loads the snippet and renders it.
  SAMPLES.forEach((sample, index) => {
    sampleEl.add(new Option(sample.label, String(index)));
  });
  sampleEl.addEventListener("change", () => {
    editor.setValue(SAMPLES[Number(sampleEl.value)].code);
  });

  await run();
})();
