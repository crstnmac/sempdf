# Cookbook: Multi-Column Report

Build a multi-page report with metric dashboards, revenue tables, and per-section navigation using `renderTemplate()`.

## Choosing an approach

There are three strategies for multi-column layouts in `sempdf`:

| Strategy | Best for | API |
|----------|----------|-----|
| Coordinate-based | Exact placement, decorative layouts | `page.text()`, `page.textBlock()`, `page.path()` |
| Flow-based | Newspaper-style columns on one page | `page.flow({ columns: { count, gap } })` |
| Template-based | Multi-page reports with repeating blocks, headers, footers, and balanced columns | `doc.renderTemplate()` |

The example below uses `renderTemplate()` with `page.columns` — the recommended path for structured, paginated reports that should fill column 1, continue at the top of column 2, and only create a new page after the last column.

## Setup

```ts
import { createDocument, hex } from "@barrierbreak/sempdf-pdf";
import { readFileSync } from "node:fs";

const fontData = readFileSync("fonts/SourceSans3-Regular.ttf");

const doc = createDocument({
  title: "Monthly Performance Report",
  info: { author: "Analytics Team" }
});

const font = doc.embedTrueTypeFont(fontData, { family: "SourceSans3" });
const DARK = hex("#1a1a2e");
const GRAY = hex("#555566");
const ACCENT = hex("#2c6fce");
const LIGHT = hex("#9a9aae");
```

## Full report with `renderTemplate()`

```ts
doc.renderTemplate({
  title: "Monthly Performance Report",
  info: {
    author: "Analytics Team"
  },
  page: {
    size: "A4",
    font,
    margin: 48,
    columns: { count: 2, gap: 24 },
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
        cellPadding: 8,
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
        "growth accelerating and customer satisfaction metrics trending positively."
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
        cellPadding: 6,
        rowGap: 2,
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

    // ── Remaining sections continue in the next column ─────────
    {
      type: "heading",
      text: "Risk Assessment",
      options: { level: 2, color: ACCENT }
    },
    {
      type: "paragraph",
      text: "Supply chain dependencies remain the top operational risk."
    },
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
        "3. Pilot usage-based pricing for the self-serve segment."
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
```

## Metric dashboard as a table

The metric tiles at the top of the report are rendered as a `table` block. Each column represents a KPI with a large value, a label, and a change indicator:

```ts
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
  options: { headerRows: 1, fontSize: 9, cellPadding: 8, marginBottom: 28 }
}
```

Use `headerRows: 1` so the top row of values renders as bold column headers, creating a dashboard-like visual.

## Newspaper-style body columns

The `page.columns` option controls the body flow area, separate from table columns:

```ts
page: {
  size: "A4",
  margin: 48,
  columns: { count: 2, gap: 24 }
}
```

Template blocks fill the first column until they run out of vertical space, then continue at the top of the second column. If a final page has enough content to fit in one column set, `renderTemplate()` balances the columns automatically.

## Section navigation in headers

The `header` callback renders on every page. Use it to display a section breadcrumb so readers can navigate:

```ts
header: ({ title, pageNumber, totalPages }) => [
  {
    type: "paragraph",
    text: `${title ?? "Report"} \u2014 Page ${pageNumber} of ${totalPages}`,
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
]
```

Tag header blocks as `"Artifact"` so they are excluded from the document structure tree in tagged PDFs.

## Key techniques

| Technique | Purpose |
|-----------|---------|
| `renderTemplate()` | Multi-page paginated reports with automatic headers/footers |
| `page.columns` | Flow report body through balanced newspaper-style columns |
| Table as dashboard | Render KPI tiles in a table block with `headerRows: 1` |
| `header` callback | Section breadcrumb and page labels on every page |
| `{ type: "pageBreak" }` | Force a section onto a fresh page when columns are not desired |
| Semantic spacing | `headingBefore`/`headingAfter` for report-appropriate heading rhythm |
| `tag: "Artifact"` | Exclude header/footer text from tagged PDF structure tree |

## See also

- [Report Templates](./report-templates) — template block reference
- [Accessibility and Compliance](./accessibility-and-compliance) — tagged PDF and PDF/UA-1
- [Streaming and Output](./streaming-and-output) — write large reports directly to disk
