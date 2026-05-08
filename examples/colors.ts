import { writeFile } from "node:fs/promises";

import { createDocument, hex, rgb, gray, cmyk } from "../src/index.js";

const doc = createDocument({
  info: {
    title: "Color Spaces Demo",
    author: "pdf-editing-lib"
  }
});

const page = doc.addPage({ size: "A4" });

const y = 780;

page.text("PDF Color Spaces", { x: 56, y: 800, fontSize: 18 });

// Hex colors
page.text("hex('#1565c0') - DeviceRGB hex", { x: 56, y, fontSize: 12 });
page.path(
  [{ type: "rect", x: 56, y: y - 24, width: 60, height: 18 }],
  { paint: "fill", fill: { color: hex("#1565c0") } }
);

// RGB colors
page.text(`rgb(${0.08}, ${0.4}, ${0.75}) - DeviceRGB float`, { x: 56, y: y - 44, fontSize: 12 });
page.path(
  [{ type: "rect", x: 56, y: y - 68, width: 60, height: 18 }],
  { paint: "fill", fill: { color: rgb(0.08, 0.4, 0.75) } }
);

// Grayscale
page.text("gray(0.5) - DeviceGray", { x: 56, y: y - 88, fontSize: 12 });
page.path(
  [{ type: "rect", x: 56, y: y - 112, width: 60, height: 18 }],
  { paint: "fill", fill: { color: gray(0.5) } }
);
page.path(
  [{ type: "rect", x: 130, y: y - 112, width: 60, height: 18 }],
  { paint: "fill", fill: { color: gray(0.2) } }
);
page.path(
  [{ type: "rect", x: 204, y: y - 112, width: 60, height: 18 }],
  { paint: "fill", fill: { color: gray(0.8) } }
);

// CMYK colors
page.text(`cmyk(${0.8}, ${0.2}, ${0}, ${0.15}) - DeviceCMYK`, { x: 56, y: y - 132, fontSize: 12 });
page.path(
  [{ type: "rect", x: 56, y: y - 156, width: 60, height: 18 }],
  { paint: "fill", fill: { color: cmyk(0.8, 0.2, 0, 0.15) } }
);
page.path(
  [{ type: "rect", x: 130, y: y - 156, width: 60, height: 18 }],
  { paint: "fill", fill: { color: cmyk(0, 1, 1, 0) } }
);
page.path(
  [{ type: "rect", x: 204, y: y - 156, width: 60, height: 18 }],
  { paint: "fill", fill: { color: cmyk(0, 0, 1, 0) } }
);

// Separation spot color (Pantone-like)
page.text("Separation spot color (Pantone 286 C)", { x: 56, y: y - 176, fontSize: 12 });
page.path(
  [{ type: "rect", x: 56, y: y - 200, width: 60, height: 18 }],
  {
    paint: "fill",
    fill: {
      color: {
        kind: "separation",
        name: "Pantone 286 C",
        tint: 1,
        alternate: cmyk(1, 0.66, 0, 0.04)
      }
    }
  }
);

// DeviceN (multi-ink)
page.text("DeviceN - Multi-ink spot color", { x: 56, y: y - 220, fontSize: 12 });
page.path(
  [{ type: "rect", x: 56, y: y - 244, width: 60, height: 18 }],
  {
    paint: "fill",
    fill: {
      color: {
        kind: "deviceN",
        names: ["Pantone 286 C", "Black"],
        tints: [1, 0.8],
        alternate: cmyk(1, 0.66, 0, 0.04)
      }
    }
  }
);

await writeFile("examples/colors.pdf", doc.toUint8Array());
console.log("Wrote examples/colors.pdf");
console.log("  Colors: hex, rgb, gray, cmyk, separation, deviceN");
