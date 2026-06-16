import { createDocument, hex } from "@barrierbreak/a11ydocs-pdf";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Hello World",
    author: "a11ydocs",
    creationDate: "D:20260413213000Z",
    modificationDate: "D:20260413213000Z"
  }
});

doc.setXmpMetadata({
  title: "Hello World",
  creator: "a11ydocs",
  creatorTool: "a11ydocs",
  createDate: "2026-04-13T21:30:00Z",
  modifyDate: "2026-04-13T21:30:00Z",
  metadataDate: "2026-04-13T21:30:00Z"
});

doc.renderTemplate({
  info: { title: "Hello World", author: "a11ydocs" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "Hello from a11ydocs",
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
