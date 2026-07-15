import { createDocument, rgb } from "@sempdf/sempdf-pdf";

async function ttf(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

const cdn = "https://cdn.jsdelivr.net/npm/@expo-google-fonts";
const FONTS = {
  inter400: `${cdn}/inter/400Regular/Inter_400Regular.ttf`,
  inter700: `${cdn}/inter/700Bold/Inter_700Bold.ttf`,
};

const doc = createDocument({
  language: "en-US",
  conformance: "pdfua-1",
  tagged: true,
  structureRoot: "Document",
  title: "Report Features Demo",
  info: { author: "Lorem Ipsum" },
  defaults: { fontSize: 11, color: rgb(0.1, 0.1, 0.15) },
});

const [inter400, inter700] = await Promise.all([
  ttf(FONTS.inter400),
  ttf(FONTS.inter700),
]);

const TABLE_BORDER = rgb(0.72, 0.76, 0.82);
const TABLE_HEADER = rgb(0.92, 0.94, 0.98);

doc.registerFontFamily("Inter", { regular: inter400, bold: inter700 });

doc.renderTemplate({
  autoOutline: { maxLevel: 6 },

  page: { size: "A4", margin: 56, font: "Inter" },

  // A diagonal watermark drawn centered behind every page (always an artifact).
  // watermark: { text: "DRAFT", opacity: 0.12, color: rgb(0.2, 0.3, 0.6) },

  styles: {
    heading1: { fontSize: 24, color: rgb(0.11, 0.22, 0.45) },
    heading2: { fontSize: 15, color: rgb(0.11, 0.22, 0.45) },
    muted: { color: rgb(0.45, 0.45, 0.45) },
  },

  blocks: [
    { type: "heading", text: "Quarterly Report", options: { level: 1 } },
    {
      type: "paragraph",
      text: "Everything below is generated in the browser.",
      class: "muted",
    },

    // The TOC lists the headings that follow and links to their pages, with hierarchical section numbers, per-level styling, and dotted leaders.
    { type: "heading", text: "Contents", options: { level: 2 } },
    {
      type: "toc",
      options: {
        maxLevel: 2,
        numbering: true,
        leader: "dots",
        levelStyles: {
          1: { fontSize: 13, color: rgb(0.11, 0.22, 0.45) },
          2: { fontSize: 11 },
        },
      },
    },

    {
      type: "heading",
      text: "Summary",
      options: { level: 2 },
      breakBefore: true,
    },
    {
      type: "paragraph",
      text: "Revenue grew for the third consecutive quarter.",
      footnote: "Figures are unaudited; see the appendix for methodology.",
    },
    { type: "paragraph", text: "Full details appear later." },
    {
      type: "crossRef",
      to: "financials",
      text: "See the financial results on page {page}.",
    },

    {
      type: "heading",
      text: "Financials",
      options: { level: 1 },
      breakBefore: true,
      anchor: "financials",
    },
    {
      type: "table",
      options: {
        headerRows: 1,
        footerRows: 1,
        columnWidths: "auto",
        borders: "all",
        borderColor: TABLE_BORDER,
        headerBackground: TABLE_HEADER,
      },
      rows: [
        [
          { text: "Line item", header: true },
          { text: "Q3", header: true },
          { text: "Q4", header: true },
        ],
        ["Subscriptions", "$1.2M", "$1.5M"],
        ["Professional services", "$0.3M", "$0.4M"],
        [
          { text: "Total", bold: true },
          { text: "$1.5M", bold: true },
          { text: "$1.9M", bold: true },
        ],
      ],
    },

    {
      type: "heading",
      text: "Appendix",
      options: { level: 1 },
      breakBefore: true,
    },
    {
      type: "paragraph",
      text: "Methodology and notes.",
      footnote: "Compiled from internal dashboards.",
    },
  ],

  pageNumber: {
    region: "footer",
    align: "right",
    format: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`,
  },
});

export default doc;
