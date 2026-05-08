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
    "examples/cookbook-invoice.ts needs a local TrueType font. Set PDF_EDITING_LIB_EXAMPLE_FONT=/path/to/font.ttf to choose one."
  );
}

const doc = createDocument({
  info: {
    title: "Invoice #INV-2026-0042",
    author: "ACME Corp",
    creationDate: "D:20260508093000Z"
  }
});

const font = doc.embedTrueTypeFont(readFileSync(fontPath), {
  family: "InvoiceSans"
});
const BOLD = hex("#1a1a2e");
const GRAY = hex("#4a4a5e");
const LIGHT = hex("#9a9aae");
const ACCENT = hex("#16213e");

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

function lineItemRow(item: LineItem): string[] {
  const total = (item.quantity * item.unitPrice).toFixed(2);
  return [
    item.description,
    item.quantity.toString(),
    `$${item.unitPrice.toFixed(2)}`,
    `$${total}`
  ];
}

const items: LineItem[] = [
  { description: "Consulting \u2014 Q1 strategy review", quantity: 12.5, unitPrice: 180.0 },
  { description: "Infrastructure audit", quantity: 1, unitPrice: 2400.0 },
  { description: "On-site training (3 days)", quantity: 3, unitPrice: 950.0 },
  { description: "Monthly retainer \u2014 April", quantity: 1, unitPrice: 1500.0 }
];

const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
const taxRate = 0.0825;
const tax = subtotal * taxRate;
const total = subtotal + tax;

doc.renderTemplate({
  info: { title: "Invoice #INV-2026-0042", author: "ACME Corp" },
  page: { size: "A4", font },
  autoOutline: { maxLevel: 1, expanded: false },
  blocks: [
    {
      type: "heading",
      text: "ACME Corp",
      options: { level: 1, color: ACCENT, marginBottom: 4 }
    },
    {
      type: "paragraph",
      text: "123 Business Park Drive \u00b7 Suite 400 \u00b7 San Francisco, CA 94105",
      options: { fontSize: 9, color: LIGHT, marginBottom: 2 }
    },
    {
      type: "paragraph",
      text: "Phone: (415) 555-0192 \u00b7 Email: billing@acme.example.com",
      options: { fontSize: 9, color: LIGHT, marginBottom: 24 }
    },
    {
      type: "heading",
      text: "INVOICE",
      options: { level: 1, color: ACCENT }
    },
    {
      type: "table",
      rows: [
        ["Invoice #", "INV-2026-0042"],
        ["Date", "May 8, 2026"],
        ["Due date", "June 7, 2026"],
        ["Payment terms", "Net 30"]
      ],
      options: {
        headerColumns: 1,
        fontSize: 10,
        marginBottom: 28
      }
    },
    {
      type: "heading",
      text: "Bill To",
      options: { level: 2, color: BOLD, marginBottom: 6 }
    },
    {
      type: "paragraph",
      text: [
        "Globex Corporation",
        "456 Innovation Way",
        "Palo Alto, CA 94301",
        "Attn: Accounts Payable"
      ].join("\n"),
      options: {
        fontSize: 10,
        lineHeight: 14,
        blockWidth: 250,
        marginBottom: 28
      }
    },
    {
      type: "heading",
      text: "Line Items",
      options: { level: 2, color: BOLD, marginBottom: 6 }
    },
    {
      type: "table",
      rows: [
        [
          { text: "Description", header: true },
          { text: "Qty", header: true },
          { text: "Unit Price", header: true },
          { text: "Amount", header: true }
        ],
        ...items.map(lineItemRow)
      ],
      options: {
        headerRows: 1,
        fontSize: 10,
        marginBottom: 14
      }
    },
    {
      type: "table",
      rows: [
        ["Subtotal", `$${subtotal.toFixed(2)}`],
        [`Tax (${(taxRate * 100).toFixed(2)}%)`, `$${tax.toFixed(2)}`],
        [
          { text: "Total", header: true },
          { text: `$${total.toFixed(2)}`, header: true }
        ]
      ],
      options: {
        headerColumns: 1,
        fontSize: 11,
        marginBottom: 36
      }
    },
    {
      type: "paragraph",
      text: [
        "Please remit payment to: ACME Corp, Account # 123456789,",
        "Routing # 021000021. Include invoice number on all payments."
      ].join(" "),
      options: {
        fontSize: 9,
        color: GRAY,
        align: "justify",
        marginBottom: 8
      }
    },
    {
      type: "paragraph",
      text: "Thank you for your business.",
      options: { fontSize: 10, color: GRAY, align: "center" }
    }
  ],
  header: ({ title, pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: `${title ?? "Invoice"} \u2014 Page ${pageNumber} of ${totalPages}`,
      options: { fontSize: 8, color: LIGHT, tag: "Artifact" }
    }
  ],
  pageNumber: { region: "footer", align: "center" }
});

await writeFile("examples/cookbook-invoice.pdf", doc.toUint8Array());
console.log("Wrote examples/cookbook-invoice.pdf");
console.log(`  Line items: ${items.length}`);
console.log(`  Subtotal: $${subtotal.toFixed(2)}`);
console.log(`  Total: $${total.toFixed(2)}`);
