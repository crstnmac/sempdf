import { writeFile } from "node:fs/promises";
import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Graphics Demo - Template Path/Rect",
    author: "pdf-editing-lib",
    creationDate: "D:20260512000000Z",
    modificationDate: "D:20260512000000Z"
  }
});

doc.setXmpMetadata({
  title: "Graphics Demo - Template Path/Rect",
  creator: "pdf-editing-lib",
  creatorTool: "pdf-editing-lib",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "Graphics Demo", author: "pdf-editing-lib" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "Graphics Demo",
      options: { level: 1, color: hex("#1c2f6b"), marginBottom: 8 }
    },
    {
      type: "paragraph",
      text: "This document demonstrates the rect and path template blocks for inline vector graphics within the flow layout system. Both filled and stroked shapes are supported.",
      options: { fontSize: 11, marginBottom: 14 }
    },
    {
      type: "rect",
      width: 360,
      height: 40,
      style: {
        paint: "fill",
        fill: { color: hex("#e3f2fd") },
        stroke: { width: 1, color: hex("#1565c0") }
      },
      keepWithNext: true
    },
    {
      type: "paragraph",
      text: "Rect Block: A colored rectangle rendered inline with the text flow. Use this for section dividers, colored backgrounds, or callout regions.",
      options: { fontSize: 10, marginBottom: 14 }
    },
    {
      type: "heading",
      text: "Triangle via Path Block",
      options: { level: 2, color: hex("#1565c0"), marginBottom: 8 }
    },
    {
      type: "path",
      commands: [
        { type: "moveTo", x: 180, y: 0 },
        { type: "lineTo", x: 260, y: 60 },
        { type: "lineTo", x: 100, y: 60 },
        { type: "closePath" }
      ],
      style: {
        paint: "fillStroke",
        fill: { color: hex("#fff3e0") },
        stroke: { width: 1.5, color: hex("#e65100") }
      },
      height: 65,
      keepWithNext: true
    },
    {
      type: "paragraph",
      text: "Path Block: A custom triangle shape drawn using moveTo, lineTo, and closePath commands. Path blocks support arbitrary vector geometry for diagrams and decorations.",
      options: { fontSize: 10, marginBottom: 14 }
    },
    {
      type: "heading",
      text: "Decorative Rectangles",
      options: { level: 2, color: hex("#1565c0"), marginBottom: 8 }
    },
    {
      type: "paragraph",
      text: "Colored rect blocks can serve as visual accents. The example below shows three rect blocks with different fills used as inline decorations.",
      options: { fontSize: 11 }
    },
    {
      type: "rect",
      width: 100,
      height: 16,
      style: { paint: "fill", fill: { color: hex("#c8e6c9") } },
      keepWithNext: true
    },
    {
      type: "paragraph",
      text: "Green accent - suitable for success indicators or positive status tags.",
      options: { fontSize: 10, marginBottom: 6 }
    },
    {
      type: "rect",
      width: 100,
      height: 16,
      style: { paint: "fill", fill: { color: hex("#ffcdd2") } },
      keepWithNext: true
    },
    {
      type: "paragraph",
      text: "Red accent - suitable for error indicators or negative status tags.",
      options: { fontSize: 10, marginBottom: 6 }
    },
    {
      type: "rect",
      width: 100,
      height: 16,
      style: { paint: "fill", fill: { color: hex("#fff9c4") } },
      keepWithNext: true
    },
    {
      type: "paragraph",
      text: "Yellow accent - suitable for warning indicators or pending status tags.",
      options: { fontSize: 10 }
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

await writeFile(new URL("./template-graphics.pdf", import.meta.url), doc.toUint8Array());
console.log("Wrote examples/template-graphics.pdf");
console.log("  Blocks: heading, paragraph, rect, path");
