import { writeFile } from "node:fs/promises";
import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Document Review - Template Annotations",
    author: "pdf-editing-lib",
    creationDate: "D:20260512000000Z",
    modificationDate: "D:20260512000000Z"
  }
});

doc.setXmpMetadata({
  title: "Document Review - Template Annotations",
  creator: "pdf-editing-lib",
  creatorTool: "pdf-editing-lib",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "Document Review", author: "pdf-editing-lib" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "Document Review",
      options: { level: 1, color: hex("#1c2f6b"), marginBottom: 10 }
    },
    {
      type: "paragraph",
      text: "This document demonstrates how annotations integrate with the renderTemplate block system. Annotations are placed inline within the flow layout, following the surrounding text.",
      options: { fontSize: 11, marginBottom: 12 }
    },
    {
      type: "highlight",
      options: { width: 200, height: 16, color: hex("#ffeb3b") }
    },
    {
      type: "paragraph",
      text: "The sentence above has a highlight annotation rendered as a template block, making it easy to mark important passages inline.",
      options: { fontSize: 11, marginBottom: 12 }
    },
    {
      type: "note",
      options: { width: 24, height: 24, contents: "Reviewer note: Please verify the accuracy of the data in this section before publication.", open: false }
    },
    {
      type: "paragraph",
      text: "A sticky note annotation is placed to the left. Click the note icon in any PDF viewer to read the reviewer's comment.",
      options: { fontSize: 11, marginBottom: 12 }
    },
    {
      type: "freeText",
      options: { width: 220, height: 50, text: "Approved by Reviewer\nMay 12, 2026", fontSize: 10, color: hex("#2e7d32"), borderWidth: 1 }
    },
    {
      type: "paragraph",
      text: "The free-text annotation above displays approval status directly on the page without requiring user interaction.",
      options: { fontSize: 11, marginBottom: 20 }
    },
    {
      type: "heading",
      text: "References",
      options: { level: 2, color: hex("#1565c0"), marginBottom: 8 }
    },
    {
      type: "pageLink",
      target: 2,
      options: { width: 200, height: 18 }
    },
    {
      type: "paragraph",
      text: "Click the page link above to jump to the appendix on page 2.",
      options: { fontSize: 11, marginBottom: 12 }
    },
    {
      type: "link",
      text: "View documentation online",
      url: "https://example.com/docs",
      options: { fontSize: 11, color: hex("#1565c0"), marginBottom: 4 }
    },
    {
      type: "paragraph",
      text: "The link block above creates a clickable URI annotation rendered inline within the paragraph flow.",
      options: { fontSize: 11 }
    }
  ]
});

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
}

await writeFile(new URL("./template-annotations.pdf", import.meta.url), doc.toUint8Array());
console.log("Wrote examples/template-annotations.pdf");
console.log("  Blocks: heading, paragraph, highlight, note, freeText, pageLink, link");
