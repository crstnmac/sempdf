import { createDocument, hex } from "../../dist/src/index.js";

export const name = "invoice";

const defaultInvoice = {
  invoiceNumber: "INV-PIXEL-001",
  title: "Invoice #INV-PIXEL-001",
  company: {
    name: "ACME Corp",
    address: "123 Business Park Drive, Suite 400, San Francisco, CA 94105",
  },
  customer: {
    name: "Globex Corporation",
    address: "456 Innovation Way\nPalo Alto, CA 94301\nAttn: Accounts Payable",
  },
  date: "May 8, 2026",
  dueDate: "June 7, 2026",
  terms: "Net 30",
  items: [
    ["Design system audit", "1", "$1,200.00", "$1,200.00"],
    ["Invoice template implementation", "8", "$175.00", "$1,400.00"],
    ["Visual QA setup", "2", "$225.00", "$450.00"],
  ],
  totals: [
    ["Subtotal", "$3,050.00"],
    ["Tax (8.25%)", "$251.63"],
    [{ text: "Total", header: true }, { text: "$3,301.63", header: true }],
  ],
  note: "Please include the invoice number on all payments. Thank you for your business.",
};

export const dataSets = [
  {
    id: "default",
    label: "Approved one-page invoice",
    data: defaultInvoice,
  },
  {
    id: "long-items",
    label: "Long line-item descriptions",
    data: {
      ...defaultInvoice,
      invoiceNumber: "INV-PIXEL-002",
      title: "Invoice #INV-PIXEL-002",
      items: [
        [
          "Deep implementation support for designer-approved invoice line items with unusually long service names",
          "3",
          "$320.00",
          "$960.00",
        ],
        [
          "Accessibility and layout review for payment instructions, remittance notes, and totals",
          "5",
          "$180.00",
          "$900.00",
        ],
        ["Visual QA setup", "2", "$225.00", "$450.00"],
      ],
      totals: [
        ["Subtotal", "$2,310.00"],
        ["Tax (8.25%)", "$190.58"],
        [{ text: "Total", header: true }, { text: "$2,500.58", header: true }],
      ],
    },
  },
  {
    id: "discount-tax",
    label: "Discount and tax variant",
    data: {
      ...defaultInvoice,
      invoiceNumber: "INV-PIXEL-003",
      title: "Invoice #INV-PIXEL-003",
      customer: {
        name: "Stark Industries",
        address: "200 Park Avenue\nNew York, NY 10166\nAttn: Finance Operations",
      },
      totals: [
        ["Subtotal", "$3,050.00"],
        ["Discount", "-$305.00"],
        ["Tax (8.25%)", "$226.46"],
        [{ text: "Total", header: true }, { text: "$2,971.46", header: true }],
      ],
    },
  },
];

export function render(data = defaultInvoice) {
  const doc = createDocument({
    info: {
      title: data.title,
      author: data.company.name,
      creationDate: "D:20260508093000Z",
      modificationDate: "D:20260508093000Z",
    },
    xmpMetadata: {
      title: data.title,
      creator: data.company.name,
      createDate: "2026-05-08T09:30:00Z",
      modifyDate: "2026-05-08T09:30:00Z",
      metadataDate: "2026-05-08T09:30:00Z",
    },
  });

  doc.renderTemplate({
    strictLayout: { maxPages: 1 },
    page: {
      size: "A4",
      margin: 48,
      font: "Helvetica",
      fontSize: 10,
      lineHeight: 13,
      spacing: {
        paragraphAfter: 8,
        headingAfter: { 1: 12, 2: 8 },
        tableBefore: 4,
        tableAfter: 14,
      },
    },
    blocks: [
      {
        type: "heading",
        text: data.company.name,
        options: { level: 1, font: "Helvetica-Bold", color: hex("#16213e"), marginBottom: 4 },
      },
      {
        type: "paragraph",
        text: data.company.address,
        options: { fontSize: 9, color: hex("#595970"), marginBottom: 22 },
      },
      {
        type: "heading",
        text: "INVOICE",
        options: { level: 1, font: "Helvetica-Bold", color: hex("#16213e") },
      },
      {
        type: "table",
        rows: [
          ["Invoice #", data.invoiceNumber],
          ["Date", data.date],
          ["Due date", data.dueDate],
          ["Terms", data.terms],
        ],
        options: {
          width: 499.28,
          columnWidths: [120, 379.28],
          headerColumns: 1,
          fontSize: 10,
          lineHeight: 13,
          cellPadding: 5,
          rowGap: 1,
          marginBottom: 24,
        },
      },
      {
        type: "heading",
        text: "Bill To",
        options: { level: 2, font: "Helvetica-Bold", color: hex("#1a1a2e"), marginBottom: 6 },
      },
      {
        type: "paragraph",
        text: `${data.customer.name}\n${data.customer.address}`,
        options: { lineHeight: 14, marginBottom: 24 },
      },
      {
        type: "table",
        rows: [
          [
            { text: "Description", header: true },
            { text: "Qty", header: true },
            { text: "Unit Price", header: true },
            { text: "Amount", header: true },
          ],
          ...data.items,
        ],
        options: {
          width: 499.28,
          columnWidths: [259.28, 50, 95, 95],
          headerRows: 1,
          fontSize: 10,
          lineHeight: 13,
          cellPadding: 6,
          rowGap: 2,
          marginBottom: 16,
        },
      },
      {
        type: "table",
        rows: data.totals,
        options: {
          width: 220,
          columnWidths: [120, 100],
          headerColumns: 1,
          fontSize: 11,
          lineHeight: 14,
          cellPadding: 6,
          rowGap: 2,
          marginLeft: 279.28,
          marginBottom: 30,
        },
      },
      {
        type: "paragraph",
        text: data.note,
        options: { align: "center", color: hex("#4a4a5e") },
      },
    ],
  });

  return doc.toUint8Array();
}
