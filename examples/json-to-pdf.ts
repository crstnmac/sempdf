/**
 * Declarative JSON -> PDF, the full surface in one value.
 *
 * A tagged (accessible) two-page report described entirely as `PdfDocumentJson`:
 * document metadata and language, a tagged structure tree, an auto-generated
 * bookmark outline, artifact header/footer with page tokens, headings, rich
 * inline text, ordered/unordered lists, a header-row table, a sectioned figure
 * with alternate text, a note annotation, a hyperlink, and absolute-positioned
 * blocks (an approval stamp and a signature field) placed at exact coordinates.
 *
 *   npm run build && node dist/examples/json-to-pdf.js
 */
import { writeFile } from "node:fs/promises";

import { renderDocumentJson, type PdfDocumentJson } from "../src/index.js";

/** A 1x1 solid-color 24-bit BMP, base64-encoded — embedded inline as a figure. */
function solidBmpBase64(r: number, g: number, b: number): string {
  const bmp = Buffer.alloc(58);
  bmp.write("BM", 0, "ascii");
  bmp.writeUInt32LE(58, 2); // file size
  bmp.writeUInt32LE(54, 10); // pixel-data offset
  bmp.writeUInt32LE(40, 14); // DIB header size
  bmp.writeInt32LE(1, 18); // width
  bmp.writeInt32LE(1, 22); // height
  bmp.writeUInt16LE(1, 26); // planes
  bmp.writeUInt16LE(24, 28); // bits per pixel
  bmp.writeUInt32LE(4, 34); // image size
  bmp[54] = b; // BMP stores BGR
  bmp[55] = g;
  bmp[56] = r;
  return bmp.toString("base64");
}

const report: PdfDocumentJson = {
  // ── Document options ──────────────────────────────────────────────────────
  title: "Accessibility Conformance Report",
  info: { author: "a11ydocs", subject: "WCAG 2.2 audit", keywords: "accessibility, pdf, tagged" },
  language: "en-US",
  tagged: true,
  compress: true,
  autoOutline: { maxLevel: 3 },

  // ── Page, header, footer ──────────────────────────────────────────────────
  page: { size: "A4", margin: 56, headerHeight: 40, footerHeight: 40 },
  header: [
    { type: "paragraph", text: "{{title}}", options: { fontSize: 8, color: "gray", tag: "Artifact" } },
  ],
  footer: [
    {
      type: "paragraph",
      text: "Page {{pageNumber}} of {{pageCount}}",
      options: { fontSize: 8, color: "gray", align: "center", tag: "Artifact" },
    },
  ],

  // ── Body ──────────────────────────────────────────────────────────────────
  blocks: [
    { type: "heading", text: "Accessibility Conformance Report", options: { level: 1 } },
    {
      type: "paragraph",
      text: "This report records the results of a tagged-PDF audit and is itself produced as a tagged, PDF/UA-style document.",
    },
    {
      type: "richParagraph",
      runs: [
        { text: "Overall status: " },
        { text: "PASS", bold: true, color: "green" },
        { text: " - reviewed against " },
        { text: "WCAG 2.2 AA", italic: true },
        { text: "." },
      ],
    },

    { type: "heading", text: "Findings", options: { level: 2 } },
    {
      type: "list",
      items: [
        "The document language is declared (en-US).",
        "Headings follow a logical, gap-free hierarchy.",
        { body: "Images carry alternate text", children: ["Decorative images are marked as artifacts."] },
      ],
      options: { ordered: false, width: 483 },
    },

    { type: "heading", text: "Scores", options: { level: 2 } },
    {
      type: "table",
      rows: [
        [
          { text: "Criterion", header: true },
          { text: "Result", header: true },
          { text: "Notes", header: true },
        ],
        ["Tagged structure", "Pass", "Complete structure tree"],
        ["Color contrast", "Pass", "4.8:1 body text"],
        ["Reading order", "Pass", "Matches visual order"],
      ],
      options: { headerRows: 1 },
    },

    {
      type: "section",
      role: "Sect",
      blocks: [
        { type: "heading", text: "Evidence", options: { level: 3 } },
        { type: "paragraph", text: "The figure below summarizes the four checks; all passed." },
      ],
    },
    // Image blocks use `src` at the top level of `blocks`. A 1x1 BMP is stretched
    // into a bar; `altText` + `tag: "Figure"` make it accessible.
    {
      type: "bmp",
      src: { base64: solidBmpBase64(34, 139, 87) },
      options: {
        width: 160,
        height: 36,
        altText: "Green bar indicating all four accessibility checks passed",
        tag: "Figure",
      },
    },

    { type: "note", options: { contents: "Re-audit scheduled for the next quarter." } },
    { type: "link", text: "Read the WCAG 2.2 specification", url: "https://www.w3.org/TR/WCAG22/" },

    { type: "pageBreak" },

    { type: "heading", text: "Sign-off", options: { level: 2 } },
    { type: "paragraph", text: "Reviewed and approved by the accessibility team." },

    // ── Absolute-positioned blocks (coordinate system) ──────────────────────
    {
      type: "rect",
      width: 150,
      height: 54,
      style: { paint: "stroke", stroke: { color: "green", width: 2 } },
      position: { x: 360, y: 660 },
    },
    {
      type: "paragraph",
      text: "APPROVED",
      options: { fontSize: 22, color: "green" },
      position: { x: 378, y: 678 },
    },
    {
      type: "textField",
      name: "reviewerSignature",
      options: { description: "Reviewer signature", width: 240, height: 16 },
      position: { x: 56, y: 640 },
    },
  ],
};

const bytes = await renderDocumentJson(report);
await writeFile("examples/json-to-pdf.pdf", bytes);
console.log(`Wrote examples/json-to-pdf.pdf (${bytes.length} bytes)`);
