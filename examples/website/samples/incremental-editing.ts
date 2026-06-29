import { createDocument, editDocument } from "@barrierbreak/sempdf-pdf";

// Step 1: Create a base document with form fields.
const baseDoc = createDocument({
  info: { title: "Base Document", author: "sempdf" }
});

baseDoc.renderTemplate({
  page: { size: "A4", margin: 72 },
  blocks: [
    {
      type: "heading",
      text: "Original document",
      options: { level: 1, fontSize: 20 }
    },
    {
      type: "paragraph",
      text: "Original content - this document will be edited incrementally.",
      options: { fontSize: 14 }
    },
    {
      type: "textField",
      name: "name",
      options: { width: 300, height: 22, value: "Original", fontSize: 11 }
    },
    {
      type: "checkBox",
      name: "agree",
      options: { width: 16, height: 16 }
    }
  ]
});

const baseBytes = baseDoc.toUint8Array();

// Step 2: Re-open the saved bytes and edit them as an incremental update.
const editable = editDocument(baseBytes);

// Add a new page.
const newPage = editable.addPage({ size: "A4" });
newPage.text("Added via incremental editing", { x: 72, y: 780, fontSize: 16 });
newPage.text("This page did not exist in the original document.", { x: 72, y: 750, fontSize: 12 });

// Update a form field value.
editable.setFieldValue("name", "Updated via incremental edit");

// Update document info.
editable.updateInfo({ title: "Edited Document", subject: "Demonstrates incremental editing" });

// The edited document is what we render.
export default editable;
