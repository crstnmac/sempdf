import { createDocument, rgb } from "@crstnmac/zeropdf";

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
  title: "ZeroPDF PDF Engine Integration Guide",
  info: { author: "Accessibility Engineering Division" },
  defaults: { fontSize: 11, color: rgb(0.1, 0.1, 0.15) },
});

const [inter400, inter700] = await Promise.all([
  ttf(FONTS.inter400),
  ttf(FONTS.inter700),
]);

const BRAND = rgb(0.05, 0.25, 0.55);
const MUTED = rgb(0.45, 0.45, 0.5);
const TABLE_BORDER = rgb(0.72, 0.76, 0.82);
const TABLE_HEADER = rgb(0.92, 0.94, 0.98);

doc.registerFontFamily("Inter", { regular: inter400, bold: inter700 });

doc.renderTemplate({
  autoOutline: { maxLevel: 6 },

  page: {
    size: "A4",
    margin: 48,
    font: "Inter",
    spacing: {
      paragraphAfter: 5,
      headingBefore: { 2: 18, 3: 12 },
      headingAfter: { 1: 4, 2: 8, 3: 6 },
      tableBefore: 0,
      tableAfter: 24,
    },
  },

  styles: {
    heading1: { fontSize: 22, color: BRAND },
    heading2: { fontSize: 16, color: BRAND, marginTop: 16, marginBottom: 0 },
    heading3: { fontSize: 12, color: BRAND },
    paragraph: { fontSize: 10, lineHeight: 15 },
    muted: { fontSize: 9, color: MUTED, lineHeight: 14 },
  },

  blocks: [
    {
      type: "heading",
      text: "zeropdf/zeropdf-pdf User Manual",
      options: { level: 1 },
    },
    {
      type: "paragraph",
      text: "Version: 1.7.0  |  Target Framework: Node.js / TypeScript  |  Compliance: PDF/UA-1 & WCAG 2.2",
      class: "muted",
    },

    {
      type: "heading",
      text: "1. Environmental Compliance Profiles",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          {
            text: "System Profile Requirement",
            header: true,
            bold: true,
            scope: "row",
          },
          { text: "Minimum Operational Standard" },
        ],
        [
          {
            text: "Node.js Environment",
            header: true,
            bold: true,
            scope: "row",
          },
          { text: "v18.12.0 LTS or superior runtime engine" },
        ],
        [
          {
            text: "Font Embedding Engine",
            header: true,
            bold: true,
            scope: "row",
          },
          { text: "TrueType (.ttf) or OpenType (.otf) with full Unicode maps" },
        ],
        [
          { text: "Metadata Engine", header: true, bold: true, scope: "row" },
          {
            text: "XMP (Extensible Metadata Platform) schema injection reader",
          },
        ],
      ],
      options: {
        headerColumns: 1,
        borders: "all",
        borderColor: TABLE_BORDER,
        headerBackground: TABLE_HEADER,
      },
    },

    {
      type: "heading",
      text: "2. Package Installation Pipeline",
      options: { level: 2 },
    },
    {
      type: "paragraph",
      text: "Pull the package binaries down from your private registry endpoints using standard shell environment commands:",
    },
    {
      type: "table",
      rows: [
        [
          { text: "Phase", bold: true, header: true },
          {
            text: "Terminal CLI Command Execution String",
            header: true,
            bold: true,
          },
        ],
        [
          { text: "Step 1", header: true, scope: "row" },
          "npm config set @crstnmac:registry=https://nodeproxy.criston.dev",
        ],
        [
          { text: "Step 2", header: true, scope: "row" },
          "npm install @crstnmac/zeropdf",
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
      text: "3. Tagged Document Root Definitions",
      options: { level: 2 },
    },
    {
      type: "paragraph",
      text: "To maintain legal compliance profiles, you must explicitly declare document languages and screen-reader landscape variables:",
    },
    {
      type: "table",
      rows: [
        [
          { text: "Configuration Option", header: true, bold: true },
          { text: "Value Variable Input", header: true, bold: true },
          { text: "A11y Screen Reader Purpose", header: true, bold: true },
        ],
        [
          { text: "language", header: true, scope: "row" },
          { text: "en-US" },
          {
            text: "Forces correct pronunciation synthesizer engine activation",
          },
        ],
        [
          { text: "structureRoot", header: true, scope: "row" },
          { text: '"Document"' },
          { text: "Initializes the primary parent tree tag structural layer" },
        ],
        [
          { text: "tagged", header: true, scope: "row" },
          { text: "true" },
          {
            text: "Enables explicit reading order flow boundaries throughout parsing",
          },
        ],
      ],
      options: {
        headerRows: 1,
        borders: "all",
        borderColor: TABLE_BORDER,
        headerBackground: TABLE_HEADER,
      },
    },

    { type: "pageBreak" },

    {
      type: "heading",
      text: "4. Accessible Structural Component Mappings",
      options: { level: 2 },
    },
    {
      type: "paragraph",
      text: "When passing multi-dimensional elements across the framework parser grid, map columns properties safely to clear semantic nodes.",
    },
    {
      type: "heading",
      text: "4.1 Tabular Component Configuration Schema",
      options: { level: 3 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Raw Data Property", header: true, bold: true },
          { text: "Required Layout Tag Property", header: true, bold: true },
          { text: "Screen Reader Action Output", header: true, bold: true },
        ],
        [
          { text: "header: true", header: true, scope: "row" },
          { text: "Maps cell directly to <TH> element" },
          { text: "Announces coordinates context to user" },
        ],
        [
          { text: "bold: true", header: true, scope: "row" },
          { text: "Injects weight properties securely" },
          { text: "Maintains clean structural layout rules" },
        ],
        [
          { text: "options.headerRows", header: true, scope: "row" },
          { text: "Binds repeating headers explicitly" },
          { text: "Maintains context reference on layout splits" },
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
      text: "5. PDF/UA-1 Deployment Checklist",
      options: { level: 2 },
    },
    {
      type: "list",
      items: [
        {
          body: "Always use explicit layout tag rules on your footers ('Artifact' or 'P') to prevent reading sequence disruption.",
        },
        {
          body: "Provide alternative descriptive strings explicitly whenever rendering visual chart files or svg layout structures.",
        },
        {
          body: "Maintain logical structural level indexing pipelines consistently (e.g., skip from Level 1 straight down to Level 3 is prohibited).",
        },
        {
          body: "Verify output binaries using validation automation engines like PAC3 or Adobe Accessibility Checker prior to deployment.",
        },
      ],
    },
  ],

  footer: ({ pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: "Accessibility Documentation",
      options: {
        fontSize: 10,
        tag: pageNumber === totalPages ? "P" : "Artifact",
      },
    },
  ],

  pageNumber: { region: "footer", align: "right" },
});

export default doc;
