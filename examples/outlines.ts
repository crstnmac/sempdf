import { writeFile } from "node:fs/promises";

import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  info: {
    title: "PDF Outlines (Bookmarks) Demo",
    author: "pdf-editing-lib"
  }
});

// Page 1: Chapter 1
const page1 = doc.addPage({ size: "A4" });
page1.text("Chapter 1: Introduction", { x: 56, y: 780, fontSize: 20, color: hex("#1a1a2e") });
page1.text("This is the first chapter covering basic concepts.", {
  x: 56, y: 740, fontSize: 12
});

// Page 2: Chapter 2
const page2 = doc.addPage({ size: "A4" });
page2.text("Chapter 2: Advanced Topics", { x: 56, y: 780, fontSize: 20, color: hex("#1a1a2e") });
page2.text("Section 2.1 - Deep Dive", { x: 56, y: 740, fontSize: 14 });
page2.text("Section 2.2 - Examples", { x: 56, y: 710, fontSize: 14 });

// Page 3: Appendices
const page3 = doc.addPage({ size: "A4" });
page3.text("Appendix A: Reference", { x: 56, y: 780, fontSize: 20, color: hex("#1a1a2e") });

// Build outline tree manually
const ch1Outline = doc.addOutline("Chapter 1: Introduction", page1);
ch1Outline.addChild("Overview", page1);

const ch2Outline = doc.addOutline("Chapter 2: Advanced Topics", page2);
ch2Outline.addChild("Section 2.1 - Deep Dive", page2);
ch2Outline.addChild("Section 2.2 - Examples", page2);

doc.addOutline("Appendix A: Reference", page3);

await writeFile("examples/outlines.pdf", doc.toUint8Array());
console.log("Wrote examples/outlines.pdf");
console.log("  Outline: 3 chapters, 3 nested subsections (viewable in PDF reader bookmarks pane)");
