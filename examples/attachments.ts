import { writeFile } from "node:fs/promises";

import { createDocument, BufferSink, parseDocument } from "../src/index.js";

const doc = createDocument({
  info: {
    title: "Attachments & Page Labels Demo",
    author: "pdf-editing-lib"
  }
});

// Attach a file
const readmeText = "# Project README\n\nThis is an embedded attachment.\n";
doc.attachFile("README.md", Buffer.from(readmeText), {
  description: "Project README file"
});

// Add pages with labels (save page references for setPageLabel)
const page1 = doc.addPage({ size: "A4" });
page1.text("Front Matter (roman numerals)", { x: 56, y: 780, fontSize: 16 });
doc.setPageLabel(page1, { style: "romanUpper", prefix: "Intro-" });

const page2 = doc.addPage({ size: "A4" });
page2.text("Chapter 1 - Decimal numbering starts here", { x: 56, y: 780, fontSize: 16 });
doc.setPageLabel(page2, { style: "decimal", startAt: 1, prefix: "Chapter 1-" });

const page3 = doc.addPage({ size: "A4" });
page3.text("Chapter 1 - Continued", { x: 56, y: 780, fontSize: 16 });
doc.setPageLabel(page3, { style: "decimal", startAt: 2, prefix: "Chapter 1-" });

const page4 = doc.addPage({ size: "A4" });
page4.text("Appendix A - Letter-style numbering", { x: 56, y: 780, fontSize: 16 });
doc.setPageLabel(page4, { style: "lettersUpper", prefix: "Appendix-" });

// Named destination
doc.addNamedDestination("chapter1", page2);

// BufferSink - stream to buffer
const sink = new BufferSink();
await doc.writeTo(sink);
const sinkBytes = sink.collect();
await writeFile("examples/attachments-sink.pdf", sinkBytes);
console.log("Wrote examples/attachments-sink.pdf (via BufferSink)");

// Standard write
const stdBytes = doc.toUint8Array();
await writeFile("examples/attachments.pdf", stdBytes);

// Verify
const parsed = parseDocument(stdBytes);
console.log("Wrote examples/attachments.pdf");
console.log(`  Attachments: ${parsed.listAttachments().length}`);
console.log("  Page labels: roman, decimal, letters");
console.log("  Named destination: 'chapter1' -> page 2");
