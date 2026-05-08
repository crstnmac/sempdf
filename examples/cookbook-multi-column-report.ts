import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

import { createDocument, hex } from "../src/index.js";

const exampleFontPath =
  process.env.PDF_EDITING_LIB_EXAMPLE_FONT ??
  process.env.PDF_EDITING_LIB_FONT_PATH;
const fontPath = [
  exampleFontPath,
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/SFNSMono.ttf",
  "/System/Library/Fonts/Geneva.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
].find((path): path is string => path !== undefined && existsSync(path));

if (!fontPath) {
  throw new Error(
    "examples/cookbook-multi-column-report.ts needs a local TrueType font. Set PDF_EDITING_LIB_EXAMPLE_FONT=/path/to/font.ttf to choose one."
  );
}

const doc = createDocument({
  info: {
    title: "Monthly Performance Report",
    author: "Analytics Team",
    creationDate: "D:20260508090000Z"
  }
});

const font = doc.embedTrueTypeFont(readFileSync(fontPath), {
  family: "ReportSans"
});
const DARK = hex("#1a1a2e");
const GRAY = hex("#555566");
const ACCENT = hex("#2c6fce");
const LIGHT = hex("#9a9aae");

doc.renderTemplate({
  info: {
    title: "Monthly Performance Report",
    author: "Analytics Team"
  },
  page: {
    size: "A4",
    font,
    spacing: {
      paragraphAfter: 8,
      headingBefore: { 2: 16, 3: 12 },
      headingAfter: { 1: 12, 2: 8, 3: 6 },
      tableBefore: 6,
      tableAfter: 12
    }
  },
  blocks: [
    // ── Metric dashboard tiles ─────────────────────
    {
      type: "table",
      rows: [
        [
          { text: "$2.67M", header: true },
          { text: "1,842", header: true },
          { text: "72", header: true }
        ],
        [
          { text: "Revenue", header: true },
          { text: "Customers", header: true },
          { text: "NPS", header: true }
        ],
        [
          { text: "+12.3%", header: true },
          { text: "+8.1%", header: true },
          { text: "+4 pts", header: true }
        ]
      ],
      options: {
        headerRows: 1,
        fontSize: 9,
        marginBottom: 28
      }
    },

    // ── Executive summary ──────────────────────────
    {
      type: "heading",
      text: "Executive Summary",
      options: { level: 1, color: DARK }
    },
    {
      type: "paragraph",
      text: [
        "Summary of key metrics and performance indicators for April 2026. ",
        "Overall performance was strong across all segments, with revenue ",
        "growth accelerating and customer satisfaction metrics trending ",
        "positively."
      ].join(""),
      options: { color: GRAY }
    },

    // ── Revenue analysis ───────────────────────────
    {
      type: "heading",
      text: "Revenue Analysis",
      options: { level: 2, color: ACCENT }
    },
    {
      type: "paragraph",
      text: [
        "Total revenue grew 12.3% quarter-over-quarter, driven by enterprise ",
        "subscription upgrades and the launch of the analytics add-on. ",
        "All three segments posted double-digit growth."
      ].join("")
    },
    {
      type: "table",
      rows: [
        [
          { text: "Category", header: true },
          { text: "Q1", header: true },
          { text: "Q2", header: true },
          { text: "Change", header: true }
        ],
        ["Enterprise", "$1.2M", "$1.4M", "+16.7%"],
        ["SMB", "$800K", "$890K", "+11.3%"],
        ["Self-Serve", "$340K", "$380K", "+11.8%"]
      ],
      options: {
        headerRows: 1,
        fontSize: 10,
        marginBottom: 12
      }
    },

    // ── Customer metrics ───────────────────────────
    {
      type: "heading",
      text: "Customer Metrics",
      options: { level: 2, color: ACCENT }
    },
    {
      type: "paragraph",
      text: [
        "Net revenue retention improved to 128%, indicating strong expansion ",
        "within existing accounts. Churn decreased to 2.1% (from 2.8% in Q1), ",
        "the lowest rate in company history."
      ].join("")
    },

    // ── Risk assessment ────────────────────────────
    { type: "pageBreak" },
    {
      type: "heading",
      text: "Risk Assessment",
      options: { level: 2, color: ACCENT }
    },
    {
      type: "paragraph",
      text: [
        "Supply chain dependencies remain the top operational risk. ",
        "Mitigation: vendor diversification program launched in March with ",
        "three additional logistics partners onboarded. Secondary risks ",
        "include regulatory changes in EU markets and key-person dependency ",
        "on the engineering lead."
      ].join("")
    },

    // ── Recommendations ────────────────────────────
    {
      type: "heading",
      text: "Recommendations",
      options: { level: 2, color: ACCENT }
    },
    {
      type: "paragraph",
      text: [
        "1. Expand the analytics add-on to mid-market tiers by Q3.\n",
        "2. Invest in onboarding automation to sustain churn reduction.\n",
        "3. Pilot usage-based pricing for the self-serve segment.\n",
        "4. Hire a dedicated regulatory compliance officer for EU operations."
      ].join("")
    }
  ],
  header: ({ title, pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: `${title ?? "Monthly Performance Report"} \u2014 Page ${pageNumber} of ${totalPages}`,
      options: { fontSize: 8, color: LIGHT, tag: "Artifact" }
    },
    {
      type: "paragraph",
      text: [
        "Sections: Executive Summary \u00b7 Revenue Analysis \u00b7 ",
        "Customer Metrics \u00b7 Risk Assessment \u00b7 Recommendations"
      ].join(""),
      options: { fontSize: 7, color: LIGHT, tag: "Artifact" }
    }
  ],
  pageNumber: {
    region: "footer",
    align: "center"
  }
});

await writeFile("examples/cookbook-multi-column-report.pdf", doc.toUint8Array());
console.log("Wrote examples/cookbook-multi-column-report.pdf");
console.log("  Uses renderTemplate() with blocks for all content");
console.log("  Metrics: Revenue ($2.67M), Customers (1,842), NPS (72)");
console.log("  Revenue table: 3 categories, 4 sections, 2 pages");
