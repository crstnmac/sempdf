import { writeFile } from "node:fs/promises";

import {
  createDocument,
  appendPages,
  extractPages,
  splitDocument,
  mergeDocuments
} from "../src/index.js";

// Create source documents
const doc1 = createDocument({ info: { title: "Source A" } });
doc1.addPage({ size: "A4" }).text("Page A1 - Source A", {   x: 72, y: 780, fontSize: 16 });
doc1.addPage({ size: "A4" }).text("Page A2 - Source A", {   x: 72, y: 780, fontSize: 16 });
const bytes1 = doc1.toUint8Array();

const doc2 = createDocument({ info: { title: "Source B" } });
doc2.addPage({ size: "A4" }).text("Page B1 - Source B", {   x: 72, y: 780, fontSize: 16 });
doc2.addPage({ size: "A4" }).text("Page B2 - Source B", {   x: 72, y: 780, fontSize: 16 });
const bytes2 = doc2.toUint8Array();

// appendPages: append all pages from doc2 into doc1 starting at index 1
const appended = appendPages(bytes1, bytes2, [0, 1]);
await writeFile("examples/page-transfer-append.pdf", appended);
console.log("Wrote examples/page-transfer-append.pdf (pages: A1, B1, B2, A2)");

// extractPages: extract specific pages
const extracted = extractPages(bytes1, [0]);
await writeFile("examples/page-transfer-extract.pdf", extracted);
console.log("Wrote examples/page-transfer-extract.pdf (page A1 only)");

// splitDocument: split into single-page PDFs
const split = splitDocument(bytes1);
for (const [i, bytes] of split.entries()) {
  await writeFile(`examples/page-transfer-split-${i + 1}.pdf`, bytes);
}
console.log(`Wrote ${split.length} split documents (one per page)`);

// mergeDocuments: combine into one multi-doc
const merged = mergeDocuments([bytes1, bytes2]);
await writeFile("examples/page-transfer-merge.pdf", merged);
console.log("Wrote examples/page-transfer-merge.pdf (pages: A1, A2, B1, B2)");
