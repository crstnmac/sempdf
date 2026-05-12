import { writeFile } from "node:fs/promises";
import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Hello World",
    author: "Codex",
    creationDate: "D:20260413213000Z",
    modificationDate: "D:20260413213000Z"
  }
});

doc.setXmpMetadata({
  title: "Hello World",
  creator: "Codex",
  creatorTool: "pdf-editing-lib",
  createDate: "2026-04-13T21:30:00Z",
  modifyDate: "2026-04-13T21:30:00Z",
  metadataDate: "2026-04-13T21:30:00Z"
});

doc.renderTemplate({
  info: { title: "Hello World", author: "Codex" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "Hello from pdf-editing-lib",
      options: { level: 1, color: hex("1c2f6b") }
    },
    {
      type: "paragraph",
      text: "This PDF was generated using the renderTemplate API, which provides a production-grade template system with automatic page breaks, headings, tables, and images.",
      options: { fontSize: 12 }
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

await writeFile(new URL("./hello-world.pdf", import.meta.url), doc.toUint8Array());
