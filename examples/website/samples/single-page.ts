import { createDocument, rgb } from "@barrierbreak/sempdf-pdf";

const doc = createDocument({
  title: "Single Page Demo",
  language: "en-US",
  xmpMetadata: {
    creator: "sempdf playground"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  blocks: [
    {
      type: "heading",
      text: "Hello from sempdf",
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
