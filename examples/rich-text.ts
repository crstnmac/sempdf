import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createDocument, parseDocument, rgb } from "../src/index.js";

const fontPath = [
  process.env.PDF_EDITING_LIB_EXAMPLE_FONT,
  process.env.PDF_EDITING_LIB_FONT_PATH,
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/SFNSMono.ttf",
  "/System/Library/Fonts/Geneva.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
].find((path): path is string => path !== undefined && existsSync(path));

const doc = createDocument({
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  info: {
    title: "Rich Text Style Demo",
    author: "a11ydocs"
  }
});

const font = fontPath ? doc.embedTrueTypeFont(readFileSync(fontPath)) : undefined;

// ---- Page 1: page.richText() with absolute positioning ----
{
  const page = doc.addPage({ size: "Letter" });

  page.richText(
    [
      { text: "page.richText() API", bold: true, fontSize: 18 }
    ],
    { x: 36, y: 740, width: 400, tag: "H1" }
  );

  page.richText(
    [
      { text: "Bold red ", bold: true, color: rgb(0.8, 0, 0) },
      { text: "italic blue ", italic: true, color: rgb(0, 0, 0.8) },
      { text: "underline green ", underline: true, color: rgb(0, 0.47, 0) },
      { text: "strikethrough", strike: true }
    ],
    { x: 36, y: 715, width: 500, tag: "P", fontSize: 12 }
  );

  page.richText(
    [
      { text: "Mixed sizes: ", bold: true },
      { text: "20pt ", fontSize: 20 },
      { text: "14pt ", fontSize: 14 },
      { text: "10pt normal", fontSize: 10 }
    ],
    { x: 36, y: 690, width: 500, tag: "P", fontSize: 12 }
  );

  page.richText(
    [
      { text: "Rich text supports ", fontSize: 12 },
      { text: "bold", bold: true },
      { text: ", ", fontSize: 12 },
      { text: "italic", italic: true },
      { text: ", ", fontSize: 12 },
      { text: "underline", underline: true },
      { text: ", ", fontSize: 12 },
      { text: "strikethrough", strike: true },
      { text: ", ", fontSize: 12 },
      { text: "font sizes", fontSize: 16 },
      { text: ", and ", fontSize: 12 },
      { text: "colors", color: rgb(0.8, 0.2, 0.6) },
      { text: " -- all on the same line." }
    ],
    { x: 36, y: 660, width: 500, tag: "P", fontSize: 12 }
  );
}

// ---- Page 2: flow.richParagraph() with built-in fonts ----
{
  const page = doc.addPage({ size: "Letter" });
  const flow = page.flow({ margin: 48, width: 400 });

  flow.richParagraph(
    [
      { text: "flow.richParagraph() with built-in fonts", bold: true, fontSize: 16 }
    ],
    { tag: "H2" }
  );

  flow.richParagraph(
    [
      { text: "Bold ", bold: true, fontSize: 14 },
      { text: "italic ", italic: true, fontSize: 14, color: rgb(0, 0, 0.7) },
      { text: "underline orange ", underline: true, color: rgb(1, 0.5, 0) },
      { text: "strikethrough", strike: true, color: rgb(0.7, 0, 0) }
    ],
    { tag: "P", marginBottom: 8 }
  );

  flow.richParagraph(
    [
      { text: "18pt ", fontSize: 18, bold: true },
      { text: "12pt ", fontSize: 12 },
      { text: "8pt tiny", fontSize: 8, italic: true }
    ],
    { tag: "P", marginBottom: 8 }
  );

  flow.richParagraph(
    [
      { text: "Custom H3 tag ", bold: true, fontSize: 14 },
      { text: "with inline styles", fontSize: 12, color: rgb(0.4, 0, 0.8) }
    ],
    { tag: "H3" }
  );
}

// ---- Page 3: flow.richParagraph() with embedded font ----
if (font) {
  const page = doc.addPage({ size: "Letter" });
  const flow = page.flow({ margin: 48, width: 400, font });

  flow.richParagraph(
    [
      { text: "flow.richParagraph() with embedded font", bold: true, fontSize: 16 }
    ],
    { tag: "H2" }
  );

  flow.richParagraph(
    [
      { text: "Embedded ", bold: true, fontSize: 14 },
      { text: "font ", italic: true, fontSize: 14 },
      { text: "with ", underline: true },
      { text: "rich", strike: true },
      { text: " styles", color: rgb(0.6, 0, 0.6) }
    ],
    { tag: "P", marginBottom: 8 }
  );
}

// ---- renderTemplate() with richParagraph blocks ----
doc.renderTemplate({
  page: { size: "Letter", margin: 36 },
  blocks: [
    {
      type: "heading",
      text: "renderTemplate() with richParagraph",
      options: { level: 1 }
    },
    {
      type: "richParagraph",
      runs: [
        { text: "Template rich paragraph: ", bold: true, fontSize: 14 },
        { text: "bold red ", bold: true, color: rgb(0.8, 0, 0) },
        { text: "italic blue ", italic: true, color: rgb(0, 0, 0.8) },
        { text: "underline green", underline: true, color: rgb(0, 0.47, 0) }
      ],
      options: { marginBottom: 8 }
    },
    {
      type: "richParagraph",
      runs: [
        { text: "Second template ", fontSize: 16, color: rgb(0.4, 0.2, 0.6) },
        { text: "richParagraph ", italic: true, strike: true },
        { text: "with mixed ", fontSize: 10 },
        { text: "sizes", fontSize: 20, bold: true },
        { text: "." }
      ],
      options: { tag: "H3" }
    },
    {
      type: "richParagraph",
      runs: [
        { text: "Inline runs ", bold: true },
        { text: "flow together ", underline: true, color: rgb(0.8, 0.4, 0) },
        { text: "and wrap", fontSize: 8, italic: true },
        { text: " across lines when the text block width is exceeded by the combined run widths." }
      ],
      options: { tag: "P", marginBottom: 4 }
    }
  ]
});

// Write PDF
await writeFile(new URL("../../examples/rich-text.pdf", import.meta.url), doc.toUint8Array());
console.log("Wrote examples/rich-text.pdf");

// Parse and inspect
const parsed = parseDocument(doc.toUint8Array());
console.log("\n=== Structure Elements ===");
const roots = parsed.listStructureElements();
let totalMcids = 0;
for (const root of roots) {
  for (const child of root?.children ?? []) {
    totalMcids++;
    console.log(`  [${child.role}] MCIDs: [${(child.mcids ?? []).join(", ")}]`);
  }
}

console.log("\n=== Inspected Text Content ===");
for (const inspected of parsed.inspectStructureElements()) {
  for (const child of inspected?.children ?? []) {
    if (child.text) {
      const preview = child.text.length > 80 ? child.text.slice(0, 80) + "..." : child.text;
      console.log(`  [${child.role}]: "${preview}"`);
    }
  }
}

console.log(`\n=== Total structure elements: ${totalMcids} ===`);
