import { createDocument, rgb } from "@sempdf/sempdf-pdf";

async function ttf(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

const cdn = "https://cdn.jsdelivr.net/npm/@expo-google-fonts";
const FONTS = {
  inter400: `${cdn}/inter/400Regular/Inter_400Regular.ttf`,
  inter700: `${cdn}/inter/700Bold/Inter_700Bold.ttf`,
};

const bankLogo = fetch("examples/assets/bank-logo.png");
const logo = await bankLogo.then((res) => res.arrayBuffer());

const doc = createDocument({
  language: "en-US",
  conformance: "pdfua-1",
  tagged: true,
  structureRoot: "Document",
  title: "Bank Statement",
  info: { author: "Lorem Ipsum" },
  defaults: { fontSize: 11, color: rgb(0.1, 0.1, 0.15) },
  encryption: {
    algorithm: "rc4-128",
    userPassword: "admin123",
    permissions: {
      printing: false,
      modifying: false,
      copying: false,
      annotating: false,
    },
  },
});

const [inter400, inter700] = await Promise.all([
  ttf(FONTS.inter400),
  ttf(FONTS.inter700),
]);

const BRAND = rgb(0.05, 0.25, 0.55);
const MUTED = rgb(0.45, 0.45, 0.5);

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
      tableBefore: 6,
      tableAfter: 14,
    },
  },

  styles: {
    heading1: { fontSize: 22, color: BRAND, marginTop: 20 },
    heading2: { fontSize: 16, color: BRAND, marginTop: 1 },
    paragraph: { fontSize: 10, lineHeight: 15 },
    muted: { fontSize: 9, color: MUTED, lineHeight: 14 },
  },

  blocks: [
    {
      type: "png",
      data: logo,
      options: { altText: "Lorem Ipsum Logo", maxWidth: 100, marginBottom: 25 },
    },

    {
      type: "heading",
      text: "Account Summary",
      options: { level: 1 },
    },

    {
      type: "heading",
      text: "Account Details",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Account Holder", header: true, bold: true, scope: "row" },
          { text: "Mr. John Doe" },
        ],
        [
          { text: "Account Number", header: true, bold: true, scope: "row" },
          { text: "1234 0042 8871 0016" },
        ],
        [
          { text: "Account Type", header: true, bold: true, scope: "row" },
          { text: "Savings Account" },
        ],
        [
          { text: "Statement Period", header: true, bold: true, scope: "row" },
          { text: "01 May 2026 - 31 May 2026" },
        ],
        [
          { text: "Statement No.", header: true, bold: true, scope: "row" },
          { text: "STM-2026-05-0042" },
        ],
      ],
      options: { headerColumns: 1, width: 650 },
    },

    {
      type: "heading",
      text: "Balance Summary",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Opening Balance", header: true, bold: true },
          { text: "Total Credits", header: true, bold: true },
          { text: "Total Debits", header: true, bold: true },
          { text: "Closing Balance", header: true, bold: true },
        ],
        ["$ 42,500.00", "$ 1,15,000.00", "$ 78,340.50", "$ 79,159.50"],
      ],
      options: { headerRows: 1 },
    },

    {
      type: "heading",
      text: "Spend Summary",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Category", header: true, bold: true },
          { text: "No. of Txns", header: true, bold: true },
          { text: "Amount Spent ($)", header: true, bold: true },
        ],
        [
          { text: "Food & Dining", header: true, bold: true, scope: "row" },
          { text: "3" },
          { text: "2,049.00" },
        ],
        [
          { text: "Shopping", header: true, bold: true, scope: "row" },
          { text: "2" },
          { text: "4,998.00" },
        ],
        [
          { text: "Bills & Utilities", header: true, bold: true, scope: "row" },
          { text: "3" },
          { text: "2,188.00" },
        ],
        [
          { text: "Entertainment", header: true, bold: true, scope: "row" },
          { text: "2" },
          { text: "2,148.00" },
        ],
        [
          { text: "Rent", header: true, bold: true, scope: "row" },
          { text: "1" },
          { text: "18,000.00" },
        ],
        [
          { text: "Investments", header: true, bold: true, scope: "row" },
          { text: "1" },
          { text: "10,000.00" },
        ],
        [
          { text: "Transfer", header: true, bold: true, scope: "row" },
          { text: "2" },
          { text: "5,300.00" },
        ],
        [
          { text: "Fuel", header: true, bold: true, scope: "row" },
          { text: "1" },
          { text: "2,500.00" },
        ],
        [
          { text: "Health", header: true, bold: true, scope: "row" },
          { text: "1" },
          { text: "521.00" },
        ],
        [
          { text: "Total", header: true, bold: true, scope: "row" },
          { text: "16", bold: true },
          { text: "47,704.00", bold: true },
        ],
      ],
      options: { headerRows: 1, headerColumns: 1 },
    },

    { type: "pageBreak" },

    {
      type: "heading",
      text: "Transaction History",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Date", header: true, bold: true },
          { text: "Txn ID", header: true, bold: true },
          { text: "Desc", header: true, bold: true },
          { text: "Type", header: true, bold: true },
          { text: "Debit ($)", header: true, bold: true },
          { text: "Credit ($)", header: true, bold: true },
          { text: "Balance ($)", header: true, bold: true },
        ],
        [
          { text: "01 May '26", header: true, scope: "row" },
          { text: "TXN810021" },
          { text: "Opening Balance" },
          { text: "-" },
          { text: "-" },
          { text: "-" },
          { text: "42,500.00" },
        ],
        [
          { text: "02 May '26", header: true, scope: "row" },
          { text: "TXN810034" },
          { text: "Salary Credit" },
          { text: "Credit" },
          { text: "-" },
          { text: "75,000.00" },
          { text: "1,17,500.00" },
        ],
        [
          { text: "03 May '26", header: true, scope: "row" },
          { text: "TXN810047" },
          { text: "Food Order" },
          { text: "Debit" },
          { text: "840.00" },
          { text: "-" },
          { text: "1,16,660.00" },
        ],
        [
          { text: "04 May '26", header: true, scope: "row" },
          { text: "TXN810061" },
          { text: "Purchase" },
          { text: "Debit" },
          { text: "3,499.00" },
          { text: "-" },
          { text: "1,13,161.00" },
        ],
        [
          { text: "05 May '26", header: true, scope: "row" },
          { text: "TXN810078" },
          { text: "Money Transfer" },
          { text: "Debit" },
          { text: "5,000.00" },
          { text: "-" },
          { text: "1,08,161.00" },
        ],
        [
          { text: "07 May '26", header: true, scope: "row" },
          { text: "TXN810091" },
          { text: "OTT Subscription" },
          { text: "Debit" },
          { text: "649.00" },
          { text: "-" },
          { text: "1,07,812.00" },
        ],
        [
          { text: "08 May '26", header: true, scope: "row" },
          { text: "TXN810105" },
          { text: "Interest Credit" },
          { text: "Credit" },
          { text: "-" },
          { text: "320.00" },
          { text: "1,07,832.00" },
        ],
        [
          { text: "10 May '26", header: true, scope: "row" },
          { text: "TXN810118" },
          { text: "Electricity Bill" },
          { text: "Debit" },
          { text: "1,240.00" },
          { text: "-" },
          { text: "1,06,592.00" },
        ],
        [
          { text: "12 May '26", header: true, scope: "row" },
          { text: "TXN810133" },
          { text: "FD Renewal" },
          { text: "Debit" },
          { text: "30,000.00" },
          { text: "-" },
          { text: "76,592.00" },
        ],
        [
          { text: "14 May '26", header: true, scope: "row" },
          { text: "TXN810146" },
          { text: "Food Order" },
          { text: "Debit" },
          { text: "560.00" },
          { text: "-" },
          { text: "76,032.00" },
        ],
        [
          { text: "15 May '26", header: true, scope: "row" },
          { text: "TXN810162" },
          { text: "Rent Payment" },
          { text: "Debit" },
          { text: "18,000.00" },
          { text: "-" },
          { text: "58,032.00" },
        ],
        [
          { text: "17 May '26", header: true, scope: "row" },
          { text: "TXN810175" },
          { text: "Freelance Receipt" },
          { text: "Credit" },
          { text: "-" },
          { text: "40,000.00" },
          { text: "98,032.00" },
        ],
        [
          { text: "18 May '26", header: true, scope: "row" },
          { text: "TXN810189" },
          { text: "Petrol" },
          { text: "Debit" },
          { text: "2,500.00" },
          { text: "-" },
          { text: "95,532.00" },
        ],
        [
          { text: "19 May '26", header: true, scope: "row" },
          { text: "TXN810203" },
          { text: "Mobile Recharge" },
          { text: "Debit" },
          { text: "299.00" },
          { text: "-" },
          { text: "95,233.00" },
        ],
        [
          { text: "20 May '26", header: true, scope: "row" },
          { text: "TXN810217" },
          { text: "SIP Investment" },
          { text: "Debit" },
          { text: "10,000.00" },
          { text: "-" },
          { text: "85,233.00" },
        ],
        [
          { text: "22 May '26", header: true, scope: "row" },
          { text: "TXN810230" },
          { text: "Grocery" },
          { text: "Debit" },
          { text: "3,753.50" },
          { text: "-" },
          { text: "81,479.50" },
        ],
        [
          { text: "24 May '26", header: true, scope: "row" },
          { text: "TXN810245" },
          { text: "Consulting Payment" },
          { text: "Credit" },
          { text: "-" },
          { text: "-" },
          { text: "81,479.50" },
        ],
        [
          { text: "25 May '26", header: true, scope: "row" },
          { text: "TXN810259" },
          { text: "OTT Renewal" },
          { text: "Debit" },
          { text: "1,499.00" },
          { text: "-" },
          { text: "79,980.50" },
        ],
        [
          { text: "27 May '26", header: true, scope: "row" },
          { text: "TXN810273" },
          { text: "Medical Bill" },
          { text: "Debit" },
          { text: "521.00" },
          { text: "-" },
          { text: "79,459.50" },
        ],
        [
          { text: "29 May '26", header: true, scope: "row" },
          { text: "TXN810287" },
          { text: "Money Transfer" },
          { text: "Debit" },
          { text: "300.00" },
          { text: "-" },
          { text: "79,159.50" },
        ],
        [
          { text: "31 May '26", header: true, scope: "row" },
          { text: "TXN810291" },
          { text: "Closing Balance" },
          { text: "-" },
          { text: "-" },
          { text: "-" },
          { text: "79,159.50" },
        ],
      ],
      options: { headerRows: 1, headerColumns: 1 },
    },

    {
      type: "heading",
      text: "Important Notes",
      options: { level: 2 },
    },
    {
      type: "list",
      items: [
        {
          body: "This is a system-generated statement and does not require a signature or stamp.",
        },
        {
          body: "For disputes or queries, quote your Statement No. STM-2026-05-0042.",
        },
      ],
    },
  ],

  footer: ({ pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: "Generated by Lorem Ipsum",
      options: {
        fontSize: 10,
        tag: pageNumber === totalPages ? "P" : "Artifact",
      },
    },
  ],

  pageNumber: { region: "footer", align: "right" },
});

export default doc;
