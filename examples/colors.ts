import { writeFile } from "node:fs/promises";

import { createDocument, hex, rgb, gray, cmyk } from "../src/index.js";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Color Spaces Demo",
    author: "sempdf"
  }
});

doc.setXmpMetadata({
  title: "Color Spaces Demo",
  creator: "sempdf",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "Color Spaces Demo", author: "sempdf" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "PDF Color Spaces",
      options: { level: 1, color: hex("#1c2f6b") }
    },
    {
      type: "paragraph",
      text: "hex('#1565c0') \u2014 DeviceRGB hex color. Useful for web-originated palettes and design tokens.",
      options: { color: hex("#1565c0"), fontSize: 12, marginTop: 8 }
    },
    {
      type: "paragraph",
      text: "rgb(0.08, 0.40, 0.75) \u2014 DeviceRGB float. Programmatic color mixing with 0-1 range per channel.",
      options: { color: rgb(0.08, 0.4, 0.75), fontSize: 12, marginTop: 4 }
    },
    {
      type: "paragraph",
      text: "rgb(0.09, 0.67, 0.36) \u2014 Another RGB example, demonstrating a green tone.",
      options: { color: rgb(0.09, 0.67, 0.36), fontSize: 12, marginTop: 4 }
    },
    {
      type: "paragraph",
      text: "gray(0.5) \u2014 DeviceGray mid-tone. Single-channel lightness, ideal for monochrome content.",
      options: { color: gray(0.5), fontSize: 12, marginTop: 8 }
    },
    {
      type: "paragraph",
      text: "gray(0.2) \u2014 DeviceGray dark. Lower values produce deeper shades.",
      options: { color: gray(0.2), fontSize: 12, marginTop: 4 }
    },
    {
      type: "paragraph",
      text: "gray(0.8) \u2014 DeviceGray light. Higher values produce lighter shades.",
      options: { color: gray(0.8), fontSize: 12, marginTop: 4 }
    },
    {
      type: "paragraph",
      text: "cmyk(0.80, 0.20, 0.00, 0.15) \u2014 DeviceCMYK. Process color for professional print workflows.",
      options: { color: cmyk(0.8, 0.2, 0, 0.15), fontSize: 12, marginTop: 8 }
    },
    {
      type: "paragraph",
      text: "cmyk(0.00, 1.00, 1.00, 0.00) \u2014 Bright red in CMYK process.",
      options: { color: cmyk(0, 1, 1, 0), fontSize: 12, marginTop: 4 }
    },
    {
      type: "paragraph",
      text: "cmyk(0.00, 0.00, 1.00, 0.00) \u2014 Bright yellow in CMYK process.",
      options: { color: cmyk(0, 0, 1, 0), fontSize: 12, marginTop: 4 }
    },
    {
      type: "heading",
      text: "Advanced Color Spaces",
      options: { level: 2, color: hex("#1565c0"), marginTop: 16 }
    },
    {
      type: "paragraph",
      text: "Separation spot color \u2014 Pantone 286 C. Named ink with a tint value (0-1) and CMYK fallback for on-screen previews and composite printing.",
      options: {
        fontSize: 12,
        color: {
          kind: "separation",
          name: "Pantone 286 C",
          tint: 1,
          alternate: cmyk(1, 0.66, 0, 0.04)
        }
      }
    },
    {
      type: "paragraph",
      text: "DeviceN multi-ink \u2014 Pantone 286 C + Black. Combines multiple named colorants into a single color specification. Each ink has its own tint, with a CMYK alternate for fallback.",
      options: {
        fontSize: 12,
        marginTop: 4,
        color: {
          kind: "deviceN",
          names: ["Pantone 286 C", "Black"],
          tints: [1, 0.8],
          alternate: cmyk(1, 0.66, 0, 0.04)
        }
      }
    }
  ]
});

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
}

await writeFile("examples/colors.pdf", doc.toUint8Array());
console.log("Wrote examples/colors.pdf");
console.log("  Colors: hex, rgb, gray, cmyk, separation, deviceN");
