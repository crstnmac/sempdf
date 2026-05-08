import { writeFile } from "node:fs/promises";

import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  info: {
    title: "PDF Annotations Demo",
    author: "pdf-editing-lib"
  }
});

const page = doc.addPage({ size: "A4" });

page.text("PDF Annotations", { x: 56, y: 800, fontSize: 20 });

// Highlight annotation
page.text("This sentence has a highlight annotation on it.", { x: 56, y: 760, fontSize: 12 });
page.highlight({
  x: 56,
  y: 760,
  width: 350,
  height: 14,
  color: hex("#ffeb3b")
});

// Note annotation (sticky note)
page.text("Click the note icon to read the comment.", { x: 56, y: 720, fontSize: 12 });
page.note({
  x: 56,
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
page.text("Visit our website for documentation", { x: 56, y: 640, fontSize: 12 });
page.link("https://example.com/docs", {
  x: 56,
  y: 640,
  width: 220,
  height: 14
});

// Internal page link
const page2 = doc.addPage({ size: "A4" });
page2.text("You arrived via the 'Go to Page 2' link on Page 1.", {
  x: 56,
  y: 800,
  fontSize: 14
});

page.text("Go to Page 2", { x: 56, y: 610, fontSize: 12 });
page.linkToPage(page2, {
  x: 56,
  y: 610,
  width: 80,
  height: 14
});

await writeFile("examples/annotations.pdf", doc.toUint8Array());
console.log("Wrote examples/annotations.pdf");
console.log("  Annotations: highlight, note (sticky), freeText, URI link, page-to-page link");
