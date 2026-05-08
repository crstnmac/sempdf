import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  info: {
    title: "Flow Images Demo",
    author: "pdf-editing-lib"
  }
});

const page = doc.addPage({ size: "A4" });

const png = readFileSync("examples/assets/zeropdf-logo.png");

const flow = page.flow({ fontSize: 12 });

flow.heading("Flow API with Images", { color: hex("#1a1a2e") });
flow.paragraph(
  "The flow API allows images to be laid out inline with text. " +
  "Images flow naturally within the page content, wrapping to the next line " +
  "when necessary. You can also control alignment and sizing."
);

flow.heading("PNG Image", { level: 2 });
flow.paragraph("Below is a PNG image embedded via the flow API:");
flow.png(png, { maxWidth: 200, align: "center" });

flow.heading("Aligned Images", { level: 2 });
flow.paragraph("Left-aligned image:");
flow.png(png, { maxWidth: 100, align: "left" });

flow.paragraph("Center-aligned image:");
flow.png(png, { maxWidth: 100, align: "center" });

flow.paragraph("Right-aligned image:");
flow.png(png, { maxWidth: 100, align: "right" });

flow.heading("Flow Cursor", { level: 2 });
const startY = flow.cursorY;
flow.paragraph(`Flow cursor position tracked automatically. ` +
  `Current Y: ${Math.round(startY)}pt. ` +
  `Remaining height on page: ${Math.round(flow.remainingHeight)}pt.`
);

// Move cursor down programmatically
flow.moveDown(20);
flow.paragraph("Moved cursor down 20pt with flow.moveDown()");

await writeFile("examples/flow-images.pdf", doc.toUint8Array());
console.log("Wrote examples/flow-images.pdf");
console.log("  Flow API: flow.png(), alignment, cursorY, remainingHeight, moveDown");
