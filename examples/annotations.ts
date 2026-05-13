import { writeFile } from "node:fs/promises";
import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "PDF Annotations Demo",
    author: "sempdf"
  }
});

doc.setXmpMetadata({
  title: "PDF Annotations Demo",
  creator: "sempdf",
  creatorTool: "sempdf",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "PDF Annotations Demo", author: "sempdf" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "PDF Annotations",
      options: { level: 1, marginBottom: 6 }
    },
    {
      type: "paragraph",
      text: "This document demonstrates PDF annotation types. The document layout uses renderTemplate, while annotations are placed with the low-level page API for precise positioning.",
      options: { fontSize: 11, marginBottom: 14 }
    },
    {
      type: "paragraph",
      text: "Annotations below include highlight, sticky note, free text, URI link, and page-to-page link.",
      options: { fontSize: 11 }
    }
  ]
});

const page = doc.addPage({ size: "A4" });

page.text("PDF Annotations", { x: 72, y: 800, fontSize: 20 });

// Highlight annotation
page.text("This sentence has a highlight annotation on it.", { x: 72, y: 760, fontSize: 12 });
page.highlight({
  x: 72,
  y: 760,
  width: 350,
  height: 14,
  color: hex("#ffeb3b")
});

// Note annotation (sticky note)
page.text("Click the note icon to read the comment.", { x: 72, y: 720, fontSize: 12 });
page.note({
  x: 72,
  y: 720,
  width: 20,
  height: 20,
  contents: "This is a sticky note annotation with reviewer comments.",
  open: true
});

// FreeText annotation
page.freeText({
  x: 300,
  y: 680,
  width: 200,
  height: 60,
  text: "Approved by reviewer on May 8, 2026",
  fontSize: 10
});

// URI link
page.text("Visit our website for documentation", { x: 72, y: 640, fontSize: 12 });
page.link("https://example.com/docs", {
  x: 72,
  y: 640,
  width: 220,
  height: 14
});

// Internal page link
const page2 = doc.addPage({ size: "A4" });
page2.text("You arrived via the 'Go to Page 2' link on Page 1.", {
  x: 72,
  y: 800,
  fontSize: 14
});

page.text("Go to Page 2", { x: 72, y: 610, fontSize: 12 });
page.linkToPage(page2, {
  x: 72,
  y: 610,
  width: 80,
  height: 14
});

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
}

await writeFile("examples/annotations.pdf", doc.toUint8Array());
console.log("Wrote examples/annotations.pdf");
console.log("  Annotations: highlight, note (sticky), freeText, URI link, page-to-page link");
