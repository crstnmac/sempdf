const previewEl = document.querySelector("#preview");
const statusEl = document.querySelector("#status");
const downloadEl = document.querySelector("#download");
const splitEl = document.querySelector("#split");
const resizerEl = document.querySelector("#resizer");
const editorEl = document.querySelector("#editor");
const sampleEl = document.querySelector("#sample");

// Selectable starting points are authored as standalone files under
// ./samples/, listed in ./samples/samples.json. Each is valid TypeScript that
// builds a document and `export default`s it (ASCII-only so the built-in font
// renders it). The same files are embedded in the docs "Examples" page, so the
// snippets stay in a single source of truth. Loaded at boot into SAMPLES.
const SAMPLES_DIR = "/examples/website/samples/";
let SAMPLES = [];

async function loadSamples() {
  const manifest = await (await fetch(`${SAMPLES_DIR}samples.json`)).json();
  return Promise.all(
    manifest.map(async ({ label, file }) => ({
      label,
      code: await (await fetch(SAMPLES_DIR + file)).text()
    }))
  );
}

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

// Recursively load a11ydocs's .d.ts files so the editor offers real IntelliSense.
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
    JSON.stringify({ name: "@barrierbreak/a11ydocs-pdf", types: "index.d.ts" }),
    "file:///node_modules/@barrierbreak/a11ydocs-pdf/package.json"
  );

  async function add(relPath) {
    if (seen.has(relPath)) return;
    seen.add(relPath);
    const response = await fetch(base + relPath);
    if (!response.ok) return;
    const text = await response.text();
    defaults.addExtraLib(text, `file:///node_modules/@barrierbreak/a11ydocs-pdf/${relPath}`);

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
      // The page importmap resolves the `a11ydocs` import inside this module.
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
  // The library is secure-by-default: with no license guard installed it
  // refuses to serialize. The playground is a public demo, so install a
  // permissive guard that allows unlimited local generation. Guards installed
  // through the public API are unverified, so every playground PDF carries the
  // fixed "UNLICENSED — evaluation only" watermark; clean output requires the
  // server-backed auto-guard (A11YDOCS_LICENSE_KEY).
  const { setLicenseGuard } = await import("@barrierbreak/a11ydocs-pdf/license-guard");
  setLicenseGuard({ consume() {} });

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
    paths: { "@barrierbreak/a11ydocs-pdf": ["node_modules/@barrierbreak/a11ydocs-pdf/index.d.ts"] },
    lib: ["esnext", "dom"]
  });

  await loadTypes();

  try {
    SAMPLES = await loadSamples();
  } catch (error) {
    setStatus(`Could not load samples: ${error.message}`, "error");
    return;
  }

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
    wordWrap: "on",
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
