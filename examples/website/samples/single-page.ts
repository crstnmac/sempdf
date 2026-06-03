import { createDocument, rgb } from "@criston/zeropdf";

const doc = createDocument({
  title: "Single Page Demo",
  language: "en-US",
  xmpMetadata: {
    creator: "zeropdf playground"
  }
});
const page = doc.addPage({ size: "A4" });

page.text("Hello from zeropdf", { x: 56, y: 760, fontSize: 28, color: rgb(0.11, 0.22, 0.45) });
page.text("Drawn at absolute coordinates on a single page.", { x: 56, y: 730, fontSize: 12 });

export default doc;
