import { createDocument, rgb } from "@crstnmac/zeropdf";

const doc = createDocument({
  title: "Single Page Demo",
  language: "en-US",
  xmpMetadata: {
    creator: "zeropdf playground"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  blocks: [
    {
      type: "heading",
      text: "Hello from zeropdf",
      options: { level: 1, fontSize: 28, color: rgb(0.11, 0.22, 0.45) }
    },
    {
      type: "paragraph",
      text: "Rendered from a declarative template on a single page.",
      options: { fontSize: 12 }
    }
  ]
});

export default doc;
