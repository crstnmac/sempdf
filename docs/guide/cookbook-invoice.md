# Cookbook: Invoice

Generate a professional invoice with company header, customer details, line items, and tax calculations using `renderTemplate()`.

## Quick start

```ts
import { createDocument, hex } from "sempdf";
import { readFileSync } from "node:fs";

const fontData = readFileSync("fonts/SourceSans3-Regular.ttf");

const doc = createDocument({
  title: "Invoice #INV-2026-0042",
  info: {
    author: "ACME Corp",
    creationDate: "D:20260508093000Z"
  },
  xmpMetadata: {
    creator: "ACME Corp",
    createDate: "2026-05-08T09:30:00Z",
    modifyDate: "2026-05-08T09:30:00Z",
    metadataDate: "2026-05-08T09:30:00Z"
  }
});

const font = doc.embedTrueTypeFont(fontData, { family: "SourceSans3" });
const BOLD = hex("#1a1a2e");
const GRAY = hex("#4a4a5e");
const LIGHT = hex("#9a9aae");
const ACCENT = hex("#16213e");
```

## Building the invoice

### Line items as a function

Extract repeating line-item blocks so your invoice can be data-driven:

```ts
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
```

### Render the document

```ts
const items: LineItem[] = [
  { description: "Consulting — Q1 strategy review", quantity: 12.5, unitPrice: 180.0 },
  { description: "Infrastructure audit", quantity: 1, unitPrice: 2400.0 },
  { description: "On-site training (3 days)", quantity: 3, unitPrice: 950.0 },
  { description: "Monthly retainer — April", quantity: 1, unitPrice: 1500.0 }
];

const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
const taxRate = 0.0825;
const tax = subtotal * taxRate;
const total = subtotal + tax;

doc.renderTemplate({
  title: "Invoice #INV-2026-0042",
  info: { author: "ACME Corp" },
  xmpMetadata: {
    creator: "ACME Corp",
    createDate: "2026-05-08T09:30:00Z",
    modifyDate: "2026-05-08T09:30:00Z",
    metadataDate: "2026-05-08T09:30:00Z"
  },
  page: { size: "A4", font, margin: 48 },
  autoOutline: { maxLevel: 1, expanded: false },
  blocks: [
    // ── Company header ──────────────────────────────
    {
      type: "heading",
      text: "ACME Corp",
      options: { level: 1, color: ACCENT, marginBottom: 4 }
    },
    {
      type: "paragraph",
      text: "123 Business Park Drive · Suite 400 · San Francisco, CA 94105",
      options: { fontSize: 9, color: LIGHT, marginBottom: 2 }
    },
    {
      type: "paragraph",
      text: "Phone: (415) 555-0192 · Email: billing@acme.example.com",
      options: { fontSize: 9, color: LIGHT, marginBottom: 24 }
    },

    // ── Invoice title ───────────────────────────────
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
        cellPadding: 6,
        rowGap: 2,
        marginBottom: 28
      }
    },

    // ── Bill to / Ship to ───────────────────────────
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

    // ── Line items table ────────────────────────────
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
        cellPadding: 8,
        rowGap: 3,
        marginBottom: 28
      }
    },

    // ── Totals summary ──────────────────────────────
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
        cellPadding: 8,
        rowGap: 4,
        marginBottom: 36
      }
    },

    // ── Payment instructions ────────────────────────
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
      text: `${title ?? "Invoice"} — Page ${pageNumber} of ${totalPages}`,
      options: { fontSize: 8, color: LIGHT, tag: "Artifact" }
    }
  ],
  pageNumber: { region: "footer", align: "center" }
});

await doc.writeTo(/* your sink */);
```

## Key techniques

| Technique | Purpose |
|-----------|---------|
| `headerColumns: 1` | Creates a label/value layout for metadata and totals |
| `headerRows: 1` | Marks the first row of line items as column headers |
| Data-driven `rows` | Map your invoice items array to table rows |
| `spread: last item` | A `pageBreak` before the totals section keeps summary on a fresh page for multi-page invoices |
| Color palette | Use `hex()` for brand colors; keep body text at `#4a4a5e` for readability |

## Designer-locked invoices

For invoice templates that must match approved designs, make the layout deterministic:

- set fixed page margins, font names, font sizes, line heights, table widths, and `columnWidths`
- provide deterministic `info` and `xmpMetadata` dates
- keep tax, currency, rounding, discounts, and payment-status logic outside the PDF layer
- enable `strictLayout` so oversized content fails instead of silently overflowing

```ts
doc.renderTemplate({
  strictLayout: { maxPages: 1 },
  page: {
    size: "A4",
    margin: 48,
    font,
    fontSize: 10,
    lineHeight: 13
  },
  blocks: [
    {
      type: "table",
      rows: invoiceRows,
      options: {
        width: 499.28,
        columnWidths: [259.28, 50, 95, 95],
        headerRows: 1
      }
    }
  ]
});
```

Use the optional visual regression scripts described in [Pixel-Perfect Invoices](./pixel-perfect-invoices) to compare generated PDFs against approved baselines. These scripts use dev-only Poppler tooling; the published library remains dependency-free.

## Multi-page invoices

For invoices that span multiple pages, the template engine paginates automatically. Add a `pageBreak` before the totals section to keep the summary together:

```ts
// After line items block:
{ type: "pageBreak" },
// Then totals summary
```

## Encrypting invoices

Wrap the serialized bytes with password protection when sending invoices via email:

```ts
const doc = createDocument({
  encryption: {
    algorithm: "aes-256",
    userPassword: "inv-2026-0042-secure",
    permissions: {
      printing: true,
      copying: false,
      modifying: false
    }
  }
});
```

## See also

- [Report Templates](./report-templates) — template block reference
- [Pixel-Perfect Invoices](./pixel-perfect-invoices) — strict layout and optional visual QA
- [Encryption and Signatures](./encryption-and-signatures) — protect sensitive documents
- [Text and Fonts](./text-and-fonts) — font APIs
