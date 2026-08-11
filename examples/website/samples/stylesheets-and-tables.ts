import { createDocument, rgb } from "@crstnmac/sempdf";

// Build a PDF and `export default` the document.
const doc = createDocument({
  title: "Stylesheets and Tables Demo",
  language: "en-US",
  xmpMetadata: {
    creator: "sempdf playground"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  styles: {
    heading1: { fontSize: 28, color: rgb(0.11, 0.22, 0.45) },
    heading2: { fontSize: 16, color: rgb(0.11, 0.22, 0.45) },
    paragraph: { fontSize: 12, lineHeight: 18 },
    muted: { color: rgb(0.45, 0.45, 0.45) }
  },
  blocks: [
    { type: "heading", text: "Hello from sempdf", options: { level: 1 } },
    { type: "paragraph", text: "Generated in the browser - no server, no dependencies.", class: "muted" },

    { type: "heading", text: "Stylesheets", options: { level: 2 } },
    { type: "paragraph", text: "Define reusable styles once and apply them by block type or via a class." },
    { type: "paragraph", text: "Edit this code on the left and hit Run.", class: "muted" },

    { type: "heading", text: "Tables", options: { level: 2 } },
    { type: "paragraph", text: "Pass `borders` to control which lines draw: \"all\", \"horizontal\", \"outer\", or \"none\". Set `borderColor`/`borderWidth` to style them.", class: "muted" },

    { type: "paragraph", text: "borders: \"all\" - full grid" },
    {
      type: "table",
      rows: [
        [{ text: "Item", header: true }, { text: "Qty", header: true }, { text: "Price", header: true }],
        ["Notebook", "2", "$11.00"],
        ["Pen", "5", "$7.50"]
      ],
      options: { headerRows: 1, borders: "all", borderColor: rgb(0.6, 0.6, 0.6), headerBackground: rgb(0.92, 0.94, 0.98) }
    },

    { type: "paragraph", text: "borders: \"horizontal\" - row rules only" },
    {
      type: "table",
      rows: [
        [{ text: "Item", header: true }, { text: "Qty", header: true }, { text: "Price", header: true }],
        ["Notebook", "2", "$11.00"],
        ["Pen", "5", "$7.50"]
      ],
      options: { headerRows: 1, borders: "horizontal", borderColor: rgb(0.2, 0.3, 0.5), borderWidth: 1, headerBackground: rgb(0.92, 0.94, 0.98) }
    },

    { type: "paragraph", text: "borders: \"outer\" - frame only, with zebra stripes" },
    {
      type: "table",
      rows: [
        [{ text: "Item", header: true }, { text: "Qty", header: true }, { text: "Price", header: true }],
        ["Notebook", "2", "$11.00"],
        ["Pen", "5", "$7.50"]
      ],
      options: { headerRows: 1, borders: "outer", borderColor: rgb(0.4, 0.4, 0.4), headerBackground: rgb(0.92, 0.94, 0.98), zebra: true }
    }
  ]
});

export default doc;
