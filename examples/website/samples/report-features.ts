import { createDocument, rgb } from "@barrierbreak/sempdf-pdf";

// Showcases the report-template features: a table of contents, cross-references,
// footnotes, pagination controls, auto-sized table columns with a repeating
// footer, and a master-page background watermark.
const doc = createDocument({
  title: "Report Features Demo",
  language: "en-US",
  xmpMetadata: { creator: "sempdf playground" },
});

doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  autoOutline: { maxLevel: 2 },

  // A diagonal watermark drawn centered behind every page (always an artifact).
  watermark: { text: "DRAFT", opacity: 0.12, color: rgb(0.2, 0.3, 0.6) },

  // Page numbers in the footer.
  pageNumber: { region: "footer", align: "right", format: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` },

  styles: {
    heading1: { fontSize: 24, color: rgb(0.11, 0.22, 0.45) },
    heading2: { fontSize: 15, color: rgb(0.11, 0.22, 0.45) },
    muted: { color: rgb(0.45, 0.45, 0.45) },
  },

  blocks: [
    { type: "heading", text: "Quarterly Report", options: { level: 1 } },
    { type: "paragraph", text: "Everything below is generated in the browser.", class: "muted" },

    // The TOC lists the headings that follow and links to their pages, with
    // hierarchical section numbers, per-level styling, and dotted leaders.
    { type: "heading", text: "Contents", options: { level: 2 } },
    {
      type: "toc",
      options: {
        maxLevel: 2,
        numbering: true,
        leader: "dots",
        levelStyles: { 1: { fontSize: 13, color: rgb(0.11, 0.22, 0.45) }, 2: { fontSize: 11 } },
      },
    },

    // Start each section on a fresh page.
    { type: "heading", text: "Summary", options: { level: 1 }, breakBefore: true },
    {
      type: "paragraph",
      text: "Revenue grew for the third consecutive quarter.",
      footnote: "Figures are unaudited; see the appendix for methodology.",
    },
    { type: "paragraph", text: "Full details appear later.", },
    { type: "crossRef", to: "financials", text: "See the financial results on page {page}." },

    { type: "heading", text: "Financials", options: { level: 1 }, breakBefore: true, anchor: "financials" },
    {
      type: "table",
      // "auto" sizes each column to its content; the last row repeats as a footer
      // if the table splits across pages.
      options: { headerRows: 1, footerRows: 1, columnWidths: "auto", borders: "horizontal", headerBackground: rgb(0.92, 0.94, 0.98) },
      rows: [
        [{ text: "Line item", header: true }, { text: "Q3", header: true }, { text: "Q4", header: true }],
        ["Subscriptions", "$1.2M", "$1.5M"],
        ["Professional services", "$0.3M", "$0.4M"],
        [{ text: "Total", bold: true }, { text: "$1.5M", bold: true }, { text: "$1.9M", bold: true }],
      ],
    },

    { type: "heading", text: "Appendix", options: { level: 1 }, breakBefore: true },
    { type: "paragraph", text: "Methodology and notes.", footnote: "Compiled from internal dashboards." },
  ],
});

export default doc;
