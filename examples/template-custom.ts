import { writeFile } from "node:fs/promises";
import { createDocument, hex } from "../src/index.js";
import type { PdfFlow } from "../src/index.js";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Custom Blocks Demo",
    author: "sempdf",
    creationDate: "D:20260512000000Z",
    modificationDate: "D:20260512000000Z"
  }
});

doc.setXmpMetadata({
  title: "Custom Blocks Demo",
  creator: "sempdf",
  creatorTool: "sempdf",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "Custom Blocks", author: "sempdf" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "Custom Blocks",
      options: { level: 1, color: hex("#1c2f6b"), marginBottom: 8 }
    },
    {
      type: "paragraph",
      text: "This document demonstrates the custom template block type, which allows user-defined rendering logic via a callback that receives the PdfFlow layout engine. The render function must return the vertical height consumed.",
      options: { fontSize: 11, marginBottom: 14 }
    },
    {
      type: "heading",
      text: "Horizontal Rule Separator",
      options: { level: 2, color: hex("#1565c0"), marginBottom: 6 }
    },
    {
      type: "paragraph",
      text: "The line below is drawn by a custom block using flow.rect() to create a thin filled rectangle as a visual separator:",
      options: { fontSize: 10, marginBottom: 8 }
    },
    {
      type: "custom",
      render: (flow: PdfFlow): number => {
        flow.rect(undefined, undefined, undefined, 1, {
          paint: "fill",
          fill: { color: hex("#bdbdbd") }
        });
        const consumed = 6;
        return consumed;
      },
      estimate: (): number => 6
    },
    {
      type: "paragraph",
      text: "The horizontal rule above separates sections cleanly without requiring image assets or external resources.",
      options: { fontSize: 10, marginBottom: 16 }
    },
    {
      type: "heading",
      text: "Watermark Text",
      options: { level: 2, color: hex("#1565c0"), marginBottom: 6 }
    },
    {
      type: "paragraph",
      text: "Custom blocks can also render text. The watermark text below is rendered via a custom block using the flow layout engine:",
      options: { fontSize: 10, marginBottom: 8 }
    },
    {
      type: "custom",
      render: (flow: PdfFlow): number => {
        flow.textBlock("DRAFT -- Confidential", {
          fontSize: 28,
          color: hex("#e0e0e0"),
          align: "center",
          lineHeight: 36
        });
        const consumed = 40;
        return consumed;
      },
      estimate: (): number => 40
    },
    {
      type: "paragraph",
      text: "The watermark text above is rendered as a custom block with centered alignment and light gray color, suitable for draft document markings.",
      options: { fontSize: 10, marginBottom: 14 }
    },
    {
      type: "heading",
      text: "Colored Divider",
      options: { level: 2, color: hex("#1565c0"), marginBottom: 6 }
    },
    {
      type: "paragraph",
      text: "A thicker colored divider using flow.rect() with custom width and fill color:",
      options: { fontSize: 10, marginBottom: 8 }
    },
    {
      type: "custom",
      render: (flow: PdfFlow): number => {
        flow.rect(undefined, undefined, undefined, 3, {
          paint: "fill",
          fill: { color: hex("#1565c0") }
        });
        const consumed = 8;
        return consumed;
      },
      estimate: (): number => 8
    },
    {
      type: "paragraph",
      text: "Custom blocks give you complete control over inline PDF content rendering within the template flow system. Use flow.rect(), flow.path(), flow.textBlock(), and other PdfFlow methods.",
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

await writeFile(new URL("./template-custom.pdf", import.meta.url), doc.toUint8Array());
console.log("Wrote examples/template-custom.pdf");
console.log("  Blocks: heading, paragraph, custom (horizontal rule, watermark, colored divider)");
