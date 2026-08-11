import { createDocument, rgb } from "@crstnmac/sempdf";

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
  title: "Crestview Cloud Q2 2026 Business Review",
  info: { author: "Crestview Cloud Finance & Operations" },
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
    { type: "heading", text: "Q2 2026 Business Review", options: { level: 1 } },
    {
      type: "paragraph",
      text: "Prepared for the leadership meeting on 11 August 2026. Figures are fictional but modeled on a real SaaS operating review.",
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
      text: "Annual recurring revenue reached $18.7M, up 14.6% quarter over quarter, while gross retention improved to 94.2%.",
      footnote: "Management figures are unaudited and exclude foreign-exchange adjustments; see the appendix for methodology.",
    },
    { type: "paragraph", text: "Enterprise expansion in logistics and healthcare offset softer new-business bookings in the education segment." },
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
        ["Subscription revenue", "$4.08M", "$4.67M"],
        ["Implementation services", "$0.62M", "$0.71M"],
        [
          { text: "Total", bold: true },
          { text: "$4.70M", bold: true },
          { text: "$5.38M", bold: true },
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
      text: "Revenue is recognized under the company's standard subscription and professional-services policies. Retention metrics use beginning-of-period recurring revenue as the denominator.",
      footnote: "Compiled from the fictional billing ledger, CRM opportunity snapshot, and customer-success health dashboard as of 31 July 2026.",
    },
  ],

  pageNumber: {
    region: "footer",
    align: "right",
    format: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`,
  },
});

export default doc;
