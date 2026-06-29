import { createDocument, hex } from "@barrierbreak/sempdf-pdf";

const doc = createDocument({
  info: {
    title: "PDF Outlines (Bookmarks) Demo",
    author: "sempdf"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 72 },
  autoOutline: { maxLevel: 2 },
  styles: {
    heading1: { fontSize: 20, color: hex("#1a1a2e") },
    heading2: { fontSize: 14 }
  },
  blocks: [
    { type: "heading", text: "Chapter 1: Introduction", options: { level: 1 } },
    { type: "heading", text: "Overview", options: { level: 2 } },
    { type: "paragraph", text: "This is the first chapter covering basic concepts.", options: { fontSize: 12 } },
    { type: "pageBreak" },
    { type: "heading", text: "Chapter 2: Advanced Topics", options: { level: 1 } },
    { type: "heading", text: "Section 2.1 - Deep Dive", options: { level: 2 } },
    { type: "heading", text: "Section 2.2 - Examples", options: { level: 2 } },
    { type: "pageBreak" },
    { type: "heading", text: "Appendix A: Reference", options: { level: 1 } }
  ]
});

export default doc;
