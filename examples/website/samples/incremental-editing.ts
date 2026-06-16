import { createDocument, editDocument } from "@barrierbreak/sempdf-pdf";

// Step 1: Create a base document with form fields.
const baseDoc = createDocument({
  info: { title: "Base Document", author: "sempdf" }
});

const page = baseDoc.addPage({ size: "A4" });
page.text("Original content - this document will be edited incrementally.", {
  x: 72, y: 780, fontSize: 14
});
page.textField("name", { x: 72, y: 730, width: 300, height: 22, value: "Original", fontSize: 11 });
page.checkBox("agree", { x: 72, y: 690, width: 16, height: 16 });

const baseBytes = baseDoc.toUint8Array();

// Step 2: Re-open the saved bytes and edit them as an incremental update.
const editable = editDocument(baseBytes);

// Add a new page.
const newPage = editable.addPage({ size: "A4" });
newPage.text("Added via incremental editing", { x: 72, y: 780, fontSize: 16 });
newPage.text("This page did not exist in the original document.", { x: 72, y: 750, fontSize: 12 });

// Insert a page at index 1.
const insertedPage = editable.insertPage(1, { size: "A4" });
insertedPage.text("Inserted between pages 1 and 2", { x: 72, y: 780, fontSize: 16 });
insertedPage.text("Incremental editing preserves the original content.", { x: 72, y: 750, fontSize: 12 });

// Update a form field value.
editable.setFieldValue("name", "Updated via incremental edit");

// Update document info.
editable.updateInfo({ title: "Edited Document", subject: "Demonstrates incremental editing" });

// Remove the last page.
editable.removePage(editable.getPageCount() - 1);

// The edited document is what we render.
export default editable;
