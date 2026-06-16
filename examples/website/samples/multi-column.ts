import { createDocument } from "@barrierbreak/sempdf-pdf";

const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(8);

const doc = createDocument({
  title: "Newspaper Layout Demo",
  language: "en-US",
  xmpMetadata: {
    creator: "sempdf playground"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 48, columns: { count: 2, gap: 24 } },
  styles: {
    heading1: { fontSize: 22 },
    paragraph: { fontSize: 11, lineHeight: 16 }
  },
  blocks: [
    { type: "heading", text: "Newspaper layout", options: { level: 1 } },
    { type: "paragraph", text: lorem },
    { type: "paragraph", text: lorem }
  ]
});

export default doc;
