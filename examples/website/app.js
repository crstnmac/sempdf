import { parseDocument } from "sempdf";
import { createBrowserPdf, editBrowserPdf } from "./pdf-studio.js";

const createForm = document.querySelector("#create-form");
const editForm = document.querySelector("#edit-form");
const previewFrame = document.querySelector("#pdf-preview");
const statusView = document.querySelector("#status");
const metadataView = document.querySelector("#metadata-view");
const fieldEditor = document.querySelector("#field-editor");
const pdfUpload = document.querySelector("#pdf-upload");
const downloadCurrent = document.querySelector("#download-current");
const resetToDemo = document.querySelector("#reset-to-demo");
const loadDemo = document.querySelector("#load-demo");

const state = {
  bytes: null,
  blob: null,
  name: "browser-demo.pdf",
  objectUrl: null,
  parsed: null,
  generatedBytes: null
};

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const result = createPdfFromForm(new FormData(createForm));
    state.generatedBytes = result.bytes.slice();
    setDocument(result, "browser-crafted.pdf", "Created a fresh PDF with copy, annotations, and form fields.");
  } catch (error) {
    showError(error);
  }
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const sourceBytes = state.bytes ?? state.generatedBytes;
    if (!sourceBytes) {
      throw new Error("Upload a PDF or generate one first.");
    }

    const result = editBrowserPdf(sourceBytes, readEditFormData());
    setDocument(result, "browser-edited.pdf", "Applied an incremental update to the active PDF.");
  } catch (error) {
    showError(error);
  }
});

pdfUpload.addEventListener("change", async (event) => {
  try {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setDocument({
      bytes,
      blob: file,
      parsed: parseDocument(bytes)
    }, file.name, `Loaded ${file.name} for inspection and incremental editing.`);
  } catch (error) {
    showError(error);
  }
});

downloadCurrent.addEventListener("click", () => {
  if (!state.bytes) {
    updateStatus("There is no active PDF yet. Generate one first.");
    return;
  }
  downloadBlob(state.blob, state.name);
});

resetToDemo.addEventListener("click", () => {
  if (!state.generatedBytes) {
    updateStatus("Generate a PDF first, then you can reuse it in the editor.");
    return;
  }
  setDocument({
    bytes: state.generatedBytes.slice(),
    blob: new Blob([state.generatedBytes], { type: "application/pdf" }),
    parsed: parseDocument(state.generatedBytes)
  }, "generated-demo.pdf", "Moved the generated demo PDF into the editor flow.");
});

loadDemo.addEventListener("click", () => {
  try {
    const result = createPdfFromForm(new FormData(createForm));
    state.generatedBytes = result.bytes.slice();
    setDocument(result, "browser-demo.pdf", "Loaded the built-in demo PDF so you can immediately test incremental edits.");
  } catch (error) {
    showError(error);
  }
});

boot();

function boot() {
  const result = createPdfFromForm(new FormData(createForm));
  state.generatedBytes = result.bytes.slice();
  setDocument(result, "browser-demo.pdf", "Ready. The preview is showing a generated starter PDF.");
}

function createPdfFromForm(formData) {
  return createBrowserPdf({
    title: valueOf(formData, "docTitle", "Field Guide / Project Atlas"),
    subtitle: valueOf(formData, "docSubtitle", "A browser-built example powered by sempdf"),
    body: valueOf(formData, "docBody", ""),
    pageSize: valueOf(formData, "pageSize", "Letter"),
    accentColor: valueOf(formData, "accentColor", "#dd5f45")
  });
}

function readEditFormData() {
  const formData = new FormData(editForm);

  const fieldValues = {};
  const fieldInputs = fieldEditor.querySelectorAll("[data-field-name]");
  for (const input of fieldInputs) {
    const name = input.getAttribute("data-field-name");
    const type = input.getAttribute("data-field-type");
    if (!name || !type) {
      continue;
    }

    if (type === "boolean") {
      fieldValues[name] = input.checked;
      continue;
    }

    fieldValues[name] = input.value;
  }

  return {
    title: valueOf(formData, "editTitle", "Revised Browser Draft"),
    overlayText: valueOf(formData, "overlayText", "REVIEWED IN BROWSER"),
    appendNote: valueOf(formData, "appendNote", ""),
    flattenForms: formData.get("flattenForms") === "on",
    fieldValues
  };
}

function setDocument(result, name, statusMessage) {
  state.bytes = result.bytes.slice();
  state.blob = result.blob;
  state.name = name;
  state.parsed = result.parsed;
  syncPreview(result.blob);
  renderMetadata(result.parsed, name);
  renderFieldEditor(result.parsed);
  updateStatus(statusMessage);
}

function syncPreview(blob) {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
  }
  state.objectUrl = URL.createObjectURL(blob);
  previewFrame.src = state.objectUrl;
}

function renderMetadata(parsed, name) {
  const metadata = parsed.getMetadata();
  const rows = [
    ["File", name],
    ["Version", parsed.version],
    ["Pages", String(parsed.getPageCount())],
    ["Tagged", parsed.isTagged() ? "Yes" : "No"],
    ["Conformance", parsed.getConformanceProfile() ?? "None"],
    ["Title", metadata.title ?? "Untitled"],
    ["Author", metadata.author ?? "Unknown"],
    ["Form fields", String(parsed.listFormFields().length)],
    ["Attachments", String(parsed.listAttachments().length)],
    ["Outlines", String(parsed.listOutlines().length)]
  ];

  metadataView.replaceChildren();
  for (const [term, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    metadataView.append(dt, dd);
  }
}

function renderFieldEditor(parsed) {
  const fields = parsed.listFormFields().filter(
    (field) => field.fieldType === "Tx" || field.fieldType === "Ch" || field.buttonKind === "checkBox"
  );
  fieldEditor.replaceChildren();

  const legend = document.createElement("legend");
  legend.textContent = "Detected form fields";
  fieldEditor.append(legend);

  if (fields.length === 0) {
    const empty = document.createElement("p");
    empty.className = "field-editor-empty";
    empty.textContent = "No editable text, choice, or check-box fields were detected in this PDF.";
    fieldEditor.append(empty);
    return;
  }

  for (const field of fields) {
    const row = document.createElement("div");
    row.className = "field-row";

    const heading = document.createElement("strong");
    heading.textContent = field.name;

    const meta = document.createElement("p");
    meta.className = "field-meta";
    meta.textContent = describeField(field);
    row.append(heading, meta);

    if (field.buttonKind === "checkBox") {
      const wrap = document.createElement("label");
      wrap.className = "field-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = field.checked ?? false;
      input.setAttribute("data-field-name", field.name);
      input.setAttribute("data-field-type", "boolean");
      const labelText = document.createElement("span");
      labelText.textContent = "Checked";
      wrap.append(input, labelText);
      row.append(wrap);
    } else if (field.fieldType === "Ch" && field.options?.length) {
      const select = document.createElement("select");
      select.className = "field-input";
      select.setAttribute("data-field-name", field.name);
      select.setAttribute("data-field-type", "string");
      for (const option of field.options) {
        const optionNode = document.createElement("option");
        optionNode.value = option;
        optionNode.textContent = option;
        optionNode.selected = option === field.value;
        select.append(optionNode);
      }
      row.append(select);
    } else {
      const input = document.createElement("input");
      input.className = "field-input";
      input.type = "text";
      input.value = field.value ?? "";
      input.placeholder = "Enter a replacement value";
      input.setAttribute("data-field-name", field.name);
      input.setAttribute("data-field-type", "string");
      row.append(input);
    }

    fieldEditor.append(row);
  }
}

function describeField(field) {
  if (field.buttonKind === "checkBox") {
    return `Check box on page ${pageNumber(field.pageObjectId, state.parsed)}.`;
  }
  if (field.fieldType === "Ch") {
    return `Choice field with ${field.options?.length ?? 0} options on page ${pageNumber(field.pageObjectId, state.parsed)}.`;
  }
  return `Text field on page ${pageNumber(field.pageObjectId, state.parsed)}.`;
}

function pageNumber(pageObjectId, parsed) {
  if (!pageObjectId || !parsed) {
    return "?";
  }
  const index = parsed.listPages().findIndex((page) => page.objectId === pageObjectId);
  return index >= 0 ? String(index + 1) : "?";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

function valueOf(formData, key, fallback) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function updateStatus(message) {
  statusView.textContent = message;
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  updateStatus(`Error: ${message}`);
  console.error(error);
}
