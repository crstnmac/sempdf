import { createDocument, hex } from "@sempdf/sempdf-pdf";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Hello World",
    author: "sempdf",
    creationDate: "D:20260413213000Z",
    modificationDate: "D:20260413213000Z"
  }
});

doc.setXmpMetadata({
  title: "Hello World",
  creator: "sempdf",
  creatorTool: "sempdf",
  createDate: "2026-04-13T21:30:00Z",
  modifyDate: "2026-04-13T21:30:00Z",
  metadataDate: "2026-04-13T21:30:00Z"
});

doc.renderTemplate({
  info: { title: "Hello World", author: "sempdf" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "Hello from sempdf",
      options: { level: 1, color: hex("1c2f6b") }
    },
    {
      type: "paragraph",
      text: "This PDF was generated using the renderTemplate API, which provides a production-grade template system with automatic page breaks, headings, tables, and images.",
      options: { fontSize: 12 }
    }
  ]
});

export default doc;
