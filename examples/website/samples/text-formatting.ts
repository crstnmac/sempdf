import { createDocument, rgb, mm } from "@barrierbreak/sempdf-pdf";

// Superscript/subscript, baseline rise, render modes (outline/invisible),
// horizontal scaling, and inline highlight — all of the text-run formatting
// options, on both whole text calls and per-run in richText.
const doc = createDocument({
  title: "Text Formatting",
  language: "en-US",
  defaults: { font: "Helvetica", fontSize: 13, color: rgb(0.15, 0.15, 0.2) }
});

const page = doc.addPage({ size: "A4" });
let y = mm(272);
const heading = (text: string) => {
  page.text(text, { x: mm(20), y, bold: true, fontSize: 11, color: "navy" });
  y -= mm(9);
};

// Superscript & subscript — exponents and chemical formulas.
heading("Superscript & subscript");
page.richText(
  [
    { text: "Einstein: E = mc" },
    { text: "2", superscript: true },
    { text: "      Water: H" },
    { text: "2", subscript: true },
    { text: "O" },
    { text: "      Footnote" },
    { text: "12", superscript: true }
  ],
  { x: mm(20), y, width: mm(170), fontSize: 15 }
);
y -= mm(14);

// Render modes — filled (default), outlined, and fill+stroke.
heading("Render modes (fill / stroke / fillStroke)");
page
  .text("Filled", { x: mm(20), y, fontSize: 26, bold: true })
  .text("Outline", {
    x: mm(70), y, fontSize: 26, bold: true,
    renderMode: "stroke", strokeWidth: 0.6, strokeColor: rgb(0.8, 0.1, 0.1)
  })
  .text("Both", {
    x: mm(130), y, fontSize: 26, bold: true,
    renderMode: "fillStroke", strokeWidth: 0.5, strokeColor: "navy", color: rgb(0.85, 0.9, 1)
  });
y -= mm(16);

// Horizontal scaling — condense or expand glyphs to fit a width.
heading("Horizontal scaling");
page
  .text("CONDENSED 70%", { x: mm(20), y, fontSize: 16, horizontalScaling: 70 })
  .text("NORMAL 100%", { x: mm(20), y: y - mm(8), fontSize: 16 })
  .text("EXPANDED 140%", { x: mm(20), y: y - mm(16), fontSize: 16, horizontalScaling: 140 });
y -= mm(26);

// Highlight — a marker-pen fill behind the text, whole-call and per-run.
heading("Highlight");
page.text("Whole line highlighted like a marker.", { x: mm(20), y, highlight: "yellow" });
y -= mm(10);
page.richText(
  [
    { text: "Review status: " },
    { text: "APPROVED", bold: true, highlight: rgb(0.8, 1, 0.8) },
    { text: "  then  " },
    { text: "REJECTED", bold: true, color: "white", highlight: rgb(0.85, 0.2, 0.2) }
  ],
  { x: mm(20), y, width: mm(170) }
);

export default doc;
