import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createDocument, parseDocument } from "../src/index.js";

const exampleFontPath = process.env.PDF_EDITING_LIB_EXAMPLE_FONT ?? process.env.PDF_EDITING_LIB_FONT_PATH;
const fontPath = [
  exampleFontPath,
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/SFNSMono.ttf",
  "/System/Library/Fonts/Geneva.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
].find((path): path is string => path !== undefined && existsSync(path));

if (!fontPath) {
  throw new Error("examples/tagged-pdf.ts needs a local TrueType font to generate PDF/UA-1 compliant embedded-font output. Set PDF_EDITING_LIB_EXAMPLE_FONT=/path/to/font.ttf to choose one.");
}

const doc = createDocument({
  conformance: "pdfua-1",
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  info: {
    title: "Quarterly Business Review",
    author: "a11ydocs"
  }
});

doc.setXmpMetadata({
  title: "Quarterly Business Review",
  creator: "a11ydocs",
  createDate: "2026-05-05T00:00:00Z",
  modifyDate: "2026-05-05T00:00:00Z",
  metadataDate: "2026-05-05T00:00:00Z"
});

const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "TaggedPdfExample" });

doc.renderTemplate({
  page: { size: "A4", font },
  autoOutline: { maxLevel: 2, expanded: false },
  blocks: [
    {
      type: "heading",
      text: "Quarterly Business Review",
      options: { level: 1 }
    },
    {
      type: "paragraph",
      text: "Q1 2026 \u2014 Executive Summary",
      options: { fontSize: 14, marginBottom: 8 }
    },
    {
      type: "paragraph",
      text: "This report covers key financial metrics, product milestones, and compliance status for the first quarter of 2026. All figures have been audited and are presented in accordance with our standard reporting framework.",
      options: { fontSize: 11, marginBottom: 8 }
    },
    {
      type: "paragraph",
      text: "Prepared by: Internal Audit Team",
      options: { fontSize: 10 }
    },
    {
      type: "pageBreak"
    },
    {
      type: "heading",
      text: "Financial Metrics",
      options: { level: 2 }
    },
    {
      type: "table",
      rows: [
        [
          { text: "Metric", header: true },
          { text: "Target", header: true },
          { text: "Actual", header: true },
          { text: "Variance", header: true }
        ],
        [
          { text: "Revenue", header: true, scope: "row" },
          "$2.4M",
          "$2.6M",
          "+8.3%"
        ],
        [
          { text: "Gross Margin", header: true, scope: "row" },
          "62%",
          "64%",
          "+2pp"
        ],
        [
          { text: "Operating Costs", header: true, scope: "row" },
          "$1.1M",
          "$1.0M",
          "-9.1%"
        ]
      ],
      options: {
        headerRows: 1,
        headerColumns: 1,
        fontSize: 11,
        marginBottom: 14
      }
    },
    {
      type: "heading",
      text: "Product Milestones",
      options: { level: 2 }
    },
    {
      type: "paragraph",
      text: "Launch v2.4 with tagged PDF export.",
      options: { fontSize: 11 }
    },
    {
      type: "paragraph",
      text: "Accessibility improvements: screen-reader navigation support and WCAG 2.1 Level AA compliance.",
      options: { fontSize: 11 }
    },
    {
      type: "paragraph",
      text: "Migrate analytics pipeline to streaming.",
      options: { fontSize: 11 }
    },
    {
      type: "pageBreak"
    },
    {
      type: "heading",
      text: "Compliance Status",
      options: { level: 2 }
    },
    {
      type: "table",
      rows: [
        [
          { text: "Standard", header: true },
          { text: "Status", header: true },
          { text: "Audit Date", header: true }
        ],
        [
          { text: "SOC 2 Type II", header: true, scope: "row" },
          "Passed",
          "2026-02-15"
        ],
        [
          { text: "ISO 27001", header: true, scope: "row" },
          "In Progress",
          "2026-04-30"
        ],
        [
          { text: "GDPR", header: true, scope: "row" },
          "Compliant",
          "2026-03-01"
        ]
      ],
      options: {
        headerRows: 1,
        headerColumns: 1,
        fontSize: 11,
        marginBottom: 14
      }
    },
    {
      type: "heading",
      text: "Resources",
      options: { level: 2 }
    },
    {
      type: "link",
      text: "View full audit reports",
      url: "https://example.com/audit-reports",
      options: {
        structure: {
          altText: "View full audit reports"
        }
      }
    }
  ]
});

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues found:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
} else {
  console.log("No compliance issues detected.");
}

const pdfBytes = doc.toUint8Array();
const parsed = parseDocument(pdfBytes);
const elements = parsed.listStructureElements();
console.log(`\nStructure tree has ${elements.length} top-level element(s).`);

for (const el of elements) {
  console.log(`  ${el.role}`);
  if (el.children) {
    for (const child of el.children) {
      console.log(`    ${child.role}`);
    }
  }
}

await writeFile("examples/tagged-pdf.pdf", pdfBytes);
console.log("\nWrote examples/tagged-pdf.pdf");
