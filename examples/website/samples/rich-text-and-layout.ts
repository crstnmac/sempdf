import { createDocument, rgb, mm } from "@crstnmac/sempdf";

const TABLE_BORDER = rgb(0.72, 0.76, 0.82);
const TABLE_HEADER = rgb(0.92, 0.94, 0.98);

// Document-wide text defaults are inherited by every text call.
const doc = createDocument({
  title: "Rich Text & Layout",
  language: "en-US",
  defaults: { font: "Helvetica", fontSize: 12, color: rgb(0.15, 0.15, 0.2) }
});

// Register a font family so bold/italic resolve by flag. Faces may be built-in
// names (shown here), embedded font handles, or raw font bytes.
const sans = doc.registerFontFamily("Sans", {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique"
});

const page = doc.addPage({ size: "A4" });

// mm() units, chained calls, bold/italic flags, and underline/strike decoration.
page
  .text("Rich text & layout", { x: mm(20), y: mm(272), font: sans, bold: true, fontSize: 22 })
  .text("Authored with mm() units and chained calls.", { x: mm(20), y: mm(264), italic: true, color: "navy" })
  .text("Underlined and struck-through runs.", { x: mm(20), y: mm(257), underline: true, strike: true, fontSize: 11 });

// Inline rich text - mixed styles and an inline link wrapping together.
page.richText(
  [
    { text: "Inline rich text mixes " },
    { text: "bold", bold: true },
    { text: ", " },
    { text: "italic", italic: true },
    { text: ", " },
    { text: "color", color: rgb(0.80, 0.10, 0.10) },
    { text: ", " },
    { text: "underline", underline: true },
    { text: ", and a " },
    { text: "clickable link", color: rgb(0.10, 0.30, 0.80), link: "https://sempdf.sempdf.net" },
    { text: " on the same wrapping lines." }
  ],
  { x: mm(20), y: mm(247), width: mm(170), fontSize: 13, lineHeight: 18 }
);

// Justified alignment for rich text.
page.richText(
  [{ text: "Justify spreads words across the full measure so both edges of the column line up cleanly along its width." }],
  { x: mm(20), y: mm(227), width: mm(170), fontSize: 12, align: "justify" }
);

// Vertical alignment inside a fixed-height box (framed with a 1.3 shape helper).
page.rect(mm(20), mm(165), mm(80), mm(40), { stroke: rgb(0.7, 0.7, 0.7), lineWidth: 0.5 });
page.textBlock("Centered in a 40mm box (verticalAlign: middle).", {
  x: mm(22), y: mm(203), width: mm(76), height: mm(36),
  verticalAlign: "middle", align: "center", fontSize: 12, lineHeight: 16
});

// Shape helpers: a labelled circle alongside the box.
page.circle(mm(140), mm(185), mm(18), { fill: "teal" });
page.text("circle()", { x: mm(130), y: mm(150), fontSize: 11, color: rgb(0.45, 0.45, 0.45) });

// Per-cell vertical alignment in a table row.
page.table(
  [[
    { text: "A long cell that wraps onto a few lines inside its column to make the row tall." },
    { text: "top", verticalAlign: "top", header: true },
    { text: "middle", verticalAlign: "middle", header: true },
    { text: "bottom", verticalAlign: "bottom", header: true }
  ]],
  {
    x: mm(20),
    y: mm(120),
    width: mm(170),
    columnWidths: [mm(85), mm(28), mm(28), mm(29)],
    fontSize: 11,
    cellPadding: 4,
    borders: "all",
    borderColor: TABLE_BORDER,
    headerBackground: TABLE_HEADER
  }
);

// richParagraph template block (rendered on a second page).
doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  styles: { heading1: { fontSize: 22, color: rgb(0.11, 0.22, 0.45) } },
  blocks: [
    { type: "heading", text: "richParagraph template block", options: { level: 1 } },
    {
      type: "richParagraph",
      runs: [
        { text: "Status: " },
        { text: "PASSED", bold: true, color: rgb(0, 0.5, 0) },
        { text: " - see the " },
        { text: "report", link: "https://sempdf.sempdf.net", color: rgb(0.1, 0.3, 0.8) },
        { text: " for details." }
      ]
    }
  ]
});

export default doc;
