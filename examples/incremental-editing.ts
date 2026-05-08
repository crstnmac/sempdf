import { writeFile } from "node:fs/promises";

import { createDocument, editDocument } from "../src/index.js";

// Step 1: Create a base document with form fields
const baseDoc = createDocument({
  info: { title: "Base Document", author: "pdf-editing-lib" }
});

const page = baseDoc.addPage({ size: "A4" });
page.text("Original content - this document will be edited incrementally.", {
  x: 56, y: 780, fontSize: 14
});
page.textField("name", { x: 56, y: 730, width: 300, height: 22, value: "Original", fontSize: 11 });
page.checkBox("agree", { x: 56, y: 690, width: 16, height: 16 });

const baseBytes = baseDoc.toUint8Array();
await writeFile("examples/incremental-editing-base.pdf", baseBytes);
console.log("Wrote examples/incremental-editing-base.pdf (1 page)");

// Step 2: Edit the document incrementally
const editable = editDocument(baseBytes);

// Add a new page
const newPage = editable.addPage({ size: "A4" });
newPage.text("Added via incremental editing", {
  x: 56, y: 780, fontSize: 16
});
newPage.text("This page did not exist in the original document.", {
  x: 56, y: 750, fontSize: 12
});

// Insert a page at index 1
const insertedPage = editable.insertPage(1, { size: "A4" });
insertedPage.text("Inserted between pages 1 and 2", {
  x: 56, y: 780, fontSize: 16
});
insertedPage.text("Incremental editing preserves the original content.", {
  x: 56, y: 750, fontSize: 12
});

// Update a form field value
editable.setFieldValue("name", "Updated via incremental edit");

// Update document info
editable.updateInfo({ title: "Edited Document", subject: "Demonstrates incremental editing" });

// Remove the last page
const totalPages = editable.getPageCount();
editable.removePage(totalPages - 1);

// Write the incrementally edited document
const editedBytes = editable.toUint8Array();
await writeFile("examples/incremental-editing.pdf", editedBytes);
console.log("Wrote examples/incremental-editing.pdf");
console.log(`  Pages: ${editable.getPageCount()} (added, inserted, removed)`);
console.log("  Field 'name' value updated via setFieldValue");
