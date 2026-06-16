import { createDocument, rgb } from "@barrierbreak/a11ydocs-pdf";

const doc = createDocument({
  title: "Invoice 1042",
  language: "en-US",
  xmpMetadata: {
    creator: "a11ydocs playground"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  styles: {
    heading1: { fontSize: 26, color: rgb(0.1, 0.1, 0.12) },
    muted: { color: rgb(0.5, 0.5, 0.5), fontSize: 10 },
    paragraph: { fontSize: 11, lineHeight: 16 }
  },
  blocks: [
    { type: "heading", text: "Invoice #1042", options: { level: 1 } },
    { type: "paragraph", text: "Acme Corp  -  Issued 2026-05-29", class: "muted" },
    {
      type: "table",
      rows: [
        [{ text: "Description", header: true }, { text: "Qty", header: true }, { text: "Amount", header: true }],
        ["Design work", "10", "$1,000.00"],
        ["Development", "20", "$3,000.00"],
        [{ text: "Total", header: true }, "-", "$4,000.00"]
      ],
      options: { headerRows: 1 }
    }
  ]
});

export default doc;
