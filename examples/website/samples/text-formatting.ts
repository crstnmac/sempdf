import { createDocument, rgb } from "@barrierbreak/sempdf-pdf";

// Superscript/subscript, baseline rise, render modes (outline/invisible),
// horizontal scaling, and inline highlight — on both template paragraphs and
// per-run richParagraph content.
const doc = createDocument({
  title: "Text Formatting",
  language: "en-US",
  defaults: { font: "Helvetica", fontSize: 13, color: rgb(0.15, 0.15, 0.2) }
});

doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  styles: {
    heading2: { fontSize: 11, color: "navy", marginTop: 12, marginBottom: 8 }
  },
  blocks: [
    { type: "heading", text: "Superscript & subscript", options: { level: 2 } },
    {
      type: "richParagraph",
      runs: [
        { text: "Einstein: E = mc" },
        { text: "2", superscript: true },
        { text: "      Water: H" },
        { text: "2", subscript: true },
        { text: "O" },
        { text: "      Footnote" },
        { text: "12", superscript: true }
      ],
      options: { fontSize: 15, marginBottom: 14 }
    },
    { type: "heading", text: "Render modes (fill / stroke / fillStroke)", options: { level: 2 } },
    {
      type: "richParagraph",
      runs: [
        { text: "Filled     ", fontSize: 26, bold: true },
        {
          text: "Outline     ",
          fontSize: 26,
          bold: true,
          renderMode: "stroke",
          strokeWidth: 0.6,
          strokeColor: rgb(0.8, 0.1, 0.1)
        },
        {
          text: "Both",
          fontSize: 26,
          bold: true,
          renderMode: "fillStroke",
          strokeWidth: 0.5,
          strokeColor: "navy",
          color: rgb(0.85, 0.9, 1)
        }
      ],
      options: { marginBottom: 14 }
    },
    { type: "heading", text: "Horizontal scaling", options: { level: 2 } },
    { type: "paragraph", text: "CONDENSED 70%", options: { fontSize: 16, horizontalScaling: 70, marginBottom: 6 } },
    { type: "paragraph", text: "NORMAL 100%", options: { fontSize: 16, marginBottom: 6 } },
    { type: "paragraph", text: "EXPANDED 140%", options: { fontSize: 16, horizontalScaling: 140, marginBottom: 14 } },
    { type: "heading", text: "Highlight", options: { level: 2 } },
    {
      type: "paragraph",
      text: "Whole line highlighted like a marker.",
      options: { highlight: "yellow", marginBottom: 10 }
    },
    {
      type: "richParagraph",
      runs: [
        { text: "Review status: " },
        { text: "APPROVED", bold: true, highlight: rgb(0.8, 1, 0.8) },
        { text: "  then  " },
        { text: "REJECTED", bold: true, color: "white", highlight: rgb(0.85, 0.2, 0.2) }
      ]
    }
  ]
});

export default doc;
