import { createDocument, rgb } from "@barrierbreak/sempdf-pdf";

const doc = createDocument({
  title: "SemPDF PDF Engine Integration Guide",
  language: "en-US",
  structureRoot: "Document",
  info: { author: "Accessibility Engineering Division" },
  defaults: { font: "Helvetica", fontSize: 11, color: rgb(0.1, 0.1, 0.15) },
});

const BRAND  = rgb(0.05, 0.25, 0.55);
const MUTED  = rgb(0.45, 0.45, 0.5);

doc.renderTemplate({
  page: {
    size: "A4",
    margin: 48,
    spacing: {
      paragraphAfter: 5,
      headingBefore: { 2: 18, 3: 12 },
      headingAfter:  { 1: 4,  2: 8, 3: 6 },
      tableBefore: 6,
      tableAfter: 14,
    },
  },
  autoOutline: { maxLevel: 6 },
  styles: {
    heading1:  { fontSize: 22, color: BRAND },
    heading2:  { fontSize: 16, color: BRAND },
    heading3:  { fontSize: 12, color: BRAND },
    paragraph: { fontSize: 10, lineHeight: 15 },
    muted:     { fontSize: 9,  color: MUTED, lineHeight: 14 },
  },

  blocks: [
    {
      type: "heading",
      text: "barrierbreak/sempdf-pdf User Manual",
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
          { text: "System Profile Requirement", header: true, bold: true },
          { text: "Minimum Operational Standard" },
        ],
        [
          { text: "Node.js Environment", header: true, bold: true },
          { text: "v18.12.0 LTS or superior runtime engine" },
        ],
        [
          { text: "Font Embedding Engine", header: true, bold: true },
          { text: "TrueType (.ttf) or OpenType (.otf) with full Unicode maps" },
        ],
        [
          { text: "Metadata Engine", header: true, bold: true },
          { text: "XMP (Extensible Metadata Platform) schema injection reader" },
        ],
      ],
      options: { headerRows: 1 },
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
          { text: "Terminal CLI Command Execution String", header: true, bold: true },
        ],
        ["Step 1", "npm config set @barrierbreak:registry=https://npm.barrierbreak.net"],
        ["Step 2", "npm install @barrierbreak/sempdf-pdf"],
      ],
      options: { headerRows: 1 },
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
        ["language", "\"en-US\"", "Forces correct pronunciation synthesizer engine activation"],
        ["structureRoot", "\"Document\"", "Initializes the primary parent tree tag structural layer"],
        ["tagged", "true", "Enables explicit reading order flow boundaries throughout parsing"],
      ],
      options: { headerRows: 1 },
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
        ["header: true", "Maps cell directly to <TH> element", "Announces coordinates context to user"],
        ["bold: true", "Injects weight properties securely", "Maintains clean structural layout rules"],
        ["options.headerRows", "Binds repeating headers explicitly", "Maintains context reference on layout splits"],
      ],
      options: { headerRows: 1 },
    },

    {
      type: "heading",
      text: "5. PDF/UA-1 Deployment Checklist",
      options: { level: 2 },
    },
    {
      type: "list",
      items: [
        { body: "Always use explicit layout tag rules on your footers ('Artifact' or 'P') to prevent reading sequence disruption." },
        { body: "Provide alternative descriptive strings explicitly whenever rendering visual chart files or svg layout structures." },
        { body: "Maintain logical structural level indexing pipelines consistently (e.g., skip from Level 1 straight down to Level 3 is prohibited)." },
        { body: "Verify output binaries using validation automation engines like PAC3 or Adobe Accessibility Checker prior to deployment." },
      ],
    },
  ],

  footer: ({ pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: `Accessibility System Documentation  |  Page ${pageNumber} of ${totalPages}  |  Ref: BB-A11Y-PDF-2026`,
      options: { fontSize: 8, color: MUTED, align: "center", tag: pageNumber === totalPages ? "P" : "Artifact" },
    },
  ],
});

export default doc;