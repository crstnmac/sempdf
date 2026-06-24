import { createDocument, rgb } from "@barrierbreak/sempdf-pdf";

// The playground runs in the browser, so load the image with fetch instead of
// node:fs. page.image() detects the image format from its bytes.
const response = await fetch("/examples/assets/barrierbreak-logo.png");
if (!response.ok) {
  throw new Error(`Could not load image: ${response.status} ${response.statusText}`);
}
const imageBytes = await response.arrayBuffer();

const doc = createDocument({
  title: "Imported Image",
  language: "en-US"
});
const page = doc.addPage({ size: "A4" });

page.text("Import an image in the browser", {
  x: 56,
  y: 790,
  fontSize: 24,
  color: rgb(0.11, 0.22, 0.45)
});
page.text("Fetch the image as an ArrayBuffer, then pass its bytes to page.image().", {
  x: 56,
  y: 760,
  fontSize: 11
});
page.image(imageBytes, {
  x: 56,
  y: 640,
  width: 360,
  height: 81,
  altText: "BarrierBreak logo"
});

export default doc;
