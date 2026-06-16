import { createDocument, rgb } from "@barrierbreak/a11ydocs-pdf";

// Build a PDF and `export default` the document.
const doc = createDocument({
  title: "Stylesheets and Tables Demo",
  language: "en-US",
  xmpMetadata: {
    creator: "zeropdf playground"
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
    { type: "heading", text: "Hello from zeropdf", options: { level: 1 } },
    { type: "paragraph", text: "Generated in the browser - no server, no dependencies.", class: "muted" },

    { type: "heading", text: "Stylesheets", options: { level: 2 } },
    { type: "paragraph", text: "Define reusable styles once and apply them by block type or via a class." },
    { type: "paragraph", text: "Edit this code on the left and hit Run.", class: "muted" },

    { type: "heading", text: "Tables", options: { level: 2 } },
    {
      type: "table",
      rows: [
        [{ text: "Item", header: true }, { text: "Qty", header: true }, { text: "Price", header: true }],
        ["Notebook", "2", "$11.00"],
        ["Pen", "5", "$7.50"]
      ],
      options: { headerRows: 1 }
    }
  ]
});

export default doc;
