import { createDocument, rgb } from "@crstnmac/sempdf";

async function ttf(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

const cdn = "https://cdn.jsdelivr.net/npm/@expo-google-fonts";
const FONTS = {
  inter400: `${cdn}/inter/400Regular/Inter_400Regular.ttf`,
  inter700: `${cdn}/inter/700Bold/Inter_700Bold.ttf`,
};

const saasLogo = fetch("examples/assets/saas-logo.png");
const logo = await saasLogo.then((res) => res.arrayBuffer());

const doc = createDocument({
  language: "en-US",
  conformance: "pdfua-1",
  tagged: true,
  structureRoot: "Document",
  title: "Rivermint Invoice INV-2026-0847",
  info: { author: "Rivermint Technologies" },
  defaults: { fontSize: 12, color: rgb(0.15, 0.15, 0.2) },
});

const [inter400, inter700] = await Promise.all([
  ttf(FONTS.inter400),
  ttf(FONTS.inter700),
]);

const BRAND = rgb(0.05, 0.35, 0.75);
const MUTED = rgb(0.45, 0.45, 0.5);
const TABLE_BORDER = rgb(0.72, 0.76, 0.82);
const TABLE_HEADER = rgb(0.92, 0.94, 0.98);

doc.registerFontFamily("Inter", { regular: inter400, bold: inter700 });

doc.renderTemplate({
  autoOutline: { maxLevel: 6 },

  page: {
    size: "A4",
    margin: 56,
    font: "Inter",
    spacing: {
      paragraphAfter: 6,
      headingBefore: { 2: 20, 3: 14 },
      headingAfter: { 1: 6, 2: 8, 3: 6 },
      tableBefore: 0,
      tableAfter: 24,
    },
  },

  styles: {
    heading1: { fontSize: 26, color: BRAND, marginTop: 40 },
    heading2: { fontSize: 14, color: BRAND, marginTop: 16, marginBottom: 0 },
    heading3: { fontSize: 11, color: rgb(0.2, 0.2, 0.25) },
    paragraph: { fontSize: 11, lineHeight: 17 },
    muted: { fontSize: 10, color: MUTED, lineHeight: 15 },
    label: { fontSize: 9, color: MUTED },
  },

  blocks: [
    {
      type: "png",
      data: logo,
      options: { altText: "Rivermint Technologies logo", maxWidth: 100 },
    },

    {
      type: "heading",
      text: "Invoice INV-2026-0847",
      options: { level: 1 },
    },

    {
      type: "heading",
      text: "Billing Details",
      options: { level: 2 },
    },
    {
      type: "paragraph",
      text: "Issued: 08 August 2026  |  Due: 07 September 2026",
    },
    {
      type: "table",
      rows: [
        [
          { text: "Bill From:", header: true, bold: true },
          { text: "Bill To:", header: true, bold: true },
        ],
        [
          "Rivermint Technologies\n548 Market Street, Suite 410\nSan Francisco, CA 94104\nbilling@rivermint.example",
          "Harbor & Pine Logistics\nAttn: Maya Rodriguez\n1200 NW Everett Street\nPortland, OR 97209",
        ],
      ],
      options: {
        headerRows: 1,
        borders: "all",
        borderColor: TABLE_BORDER,
        headerBackground: TABLE_HEADER,
      },
    },

    {
      type: "heading",
      text: "Bill Breakdown",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Description", header: true, bold: true },
          { text: "Quantity", header: true, bold: true },
          { text: "Unit Price", header: true, bold: true },
          { text: "Amount", header: true, bold: true },
        ],
        [
          { text: "Operations Cloud - Business plan", header: true, scope: "row" },
          { text: "25 seats" },
          { text: "$48.00" },
          { text: "$1,200.00" },
        ],
        [
          { text: "Route optimization add-on", header: true, scope: "row" },
          { text: "1" },
          { text: "$320.00" },
          { text: "$320.00" },
        ],
        [
          { text: "EDI onboarding and data migration", header: true, scope: "row" },
          { text: "6 hours" },
          { text: "$145.00" },
          { text: "$870.00" },
        ],
      ],
      options: {
        headerRows: 1,
        headerColumns: 1,
        borders: "all",
        borderColor: TABLE_BORDER,
        headerBackground: TABLE_HEADER,
      },
    },

    {
      type: "heading",
      text: "Bill Summary",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [{ text: "Subtotal", header: true, bold: true }, { text: "$2,390.00" }],
        [
          { text: "Annual commitment discount (8%)", header: true, bold: true },
          { text: "-$191.20" },
        ],
        [{ text: "Sales tax (8.5%)", header: true, bold: true }, { text: "$186.90" }],
        [{ text: "Total Due", header: true, bold: true }, { text: "$2,385.70" }],
      ],
      options: {
        headerRows: 0,
        borders: "all",
        borderColor: TABLE_BORDER,
        headerBackground: TABLE_HEADER,
      },
    },

    {
      type: "paragraph",
      text: "Payment terms: Net 30. Please include INV-2026-0847 with your ACH remittance. This invoice was generated electronically and does not require a signature.",
      class: "muted",
      options: { marginTop: 30 },
    },
  ],

  footer: ({ pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: "Rivermint Technologies | billing@rivermint.example",
      options: {
        fontSize: 10,
        tag: pageNumber === totalPages ? "P" : "Artifact",
      },
    },
  ],

  pageNumber: { region: "footer", align: "right" },
});

export default doc;
