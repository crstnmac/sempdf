import { createDocument, rgb } from "@sempdf/sempdf-pdf";

const doc = createDocument({
  title: "Bank Statement",
  language: "en-US",
  structureRoot: "Document",
  info: { author: "NovaBanc" },
  defaults: { font: "Helvetica", fontSize: 11, color: rgb(0.1, 0.1, 0.15) },
});

const BRAND  = rgb(0.05, 0.25, 0.55);
const MUTED  = rgb(0.45, 0.45, 0.5);
const TABLE_BORDER = rgb(0.72, 0.76, 0.82);
const TABLE_HEADER = rgb(0.92, 0.94, 0.98);

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
    paragraph: { fontSize: 10, lineHeight: 15 },
    muted:     { fontSize: 9,  color: MUTED, lineHeight: 14 },
  },

  blocks: [
    {
      type: "heading",
      text: "NovaBanc",
      options: { level: 1 },
    },
    {
      type: "paragraph",
      text: "Customer Care: 1800-123-4567  |  support@novabanc.com  |  www.novabanc.com",
      class: "muted",
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
          { text: "Account Holder", header: true, bold: true },
          { text: "Mr. John Adam" },
        ],
        [
          { text: "Account Number", header: true, bold: true },
          { text: "NOVA 0042 8871 0016" },
        ],
        [
          { text: "Account Type", header: true, bold: true },
          { text: "Savings Account",  },
        ],
        [
          { text: "Branch", header: true, bold: true },
          { text:  "Mumbai - Fort Branch",  },
        ],
        [
          { text: "Statement Period", header: true, bold: true },
          { text: "01 May 2026 - 31 May 2026" },
        ],
        [
          { text: "Statement No.", header: true, bold: true },
          { text: "STM-2026-05-0042" },
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
        [
          "Rs. 42,500.00",
          "Rs. 1,15,000.00",
          "Rs. 78,340.50",
          "Rs. 79,159.50",
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
      text: "Spend Summary",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Category",           header: true, bold: true },
          { text: "No. of Txns",        header: true, bold: true },
          { text: "Amount Spent (Rs.)",   header: true, bold: true },
        ],
        ["Food & Dining",       "3",  "2,049.00"],
        ["Shopping",            "2",  "4,998.00"],
        ["Bills & Utilities",   "3",  "2,188.00"],
        ["Rent",                "1",  "18,000.00"],
        ["Investments",         "1",  "10,000.00"],
        ["Entertainment",       "2",  "2,148.00"],
        ["Transfer / UPI",      "2",  "5,300.00"],
        ["Fuel",                "1",  "2,500.00"],
        ["Health",              "1",  "521.00"],
        [{ text: "Total", header: true, bold: true }, { text: "16", header: true, bold: true }, { text: "47,704.00", header: true, bold: true }],
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
      text: "Transaction History",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Date",        header: true, bold: true },
          { text: "Txn ID",      header: true, bold: true },
          { text: "Desc", header: true, bold: true },
          { text: "Type",        header: true, bold: true },
          { text: "Debit (Rs.)",   header: true, bold: true },
          { text: "Credit (Rs.)",  header: true, bold: true },
          { text: "Balance (Rs.)", header: true, bold: true },
        ],

        ["01 May '26", "TXN810021", "Opening Balance",              "-",      "-",         "-",          "42,500.00"],
        ["02 May '26", "TXN810034", "Salary Credit - FutureBit",   "Credit", "-",         "75,000.00",  "1,17,500.00"],
        ["03 May '26", "TXN810047", "Zomato Food Order",            "Debit",  "840.00",    "-",          "1,16,660.00"],
        ["04 May '26", "TXN810061", "Amazon.in Purchase",           "Debit",  "3,499.00",  "-",          "1,13,161.00"],
        ["05 May '26", "TXN810078", "UPI - Rahul Kumar",            "Debit",  "5,000.00",  "-",          "1,08,161.00"],
        ["07 May '26", "TXN810092", "Netflix Subscription",         "Debit",  "649.00",    "-",          "1,07,512.00"],
        ["08 May '26", "TXN810105", "Interest Credit",              "Credit", "-",         "320.00",     "1,07,832.00"],
        ["10 May '26", "TXN810119", "Electricity Bill - MSEDCL",    "Debit",  "1,240.00",  "-",          "1,06,592.00"],
        ["12 May '26", "TXN810133", "NEFT - FD Renewal",            "Debit",  "30,000.00", "-",          "76,592.00"],
        ["14 May '26", "TXN810148", "Swiggy Order",                 "Debit",  "560.00",    "-",          "76,032.00"],
        ["15 May '26", "TXN810162", "Rent Payment - UPI",           "Debit",  "18,000.00", "-",          "58,032.00"],
        ["17 May '26", "TXN810175", "Freelance Receipt - Upwork",   "Credit", "-",         "40,000.00",  "98,032.00"],
        ["18 May '26", "TXN810189", "Petrol - HPCL",                "Debit",  "2,500.00",  "-",          "95,532.00"],
        ["19 May '26", "TXN810203", "Mobile Recharge - Jio",        "Debit",  "299.00",    "-",          "95,233.00"],
        ["20 May '26", "TXN810217", "SIP Investment - Zerodha",     "Debit",  "10,000.00", "-",          "85,233.00"],
        ["22 May '26", "TXN810231", "Grocery - DMart",              "Debit",  "3,753.50",  "-",          "81,479.50"],
        ["24 May '26", "TXN810245", "Consulting Payment",           "Credit", "-",         "-",          "81,479.50"],
        ["25 May '26", "TXN810259", "Amazon Prime Renewal",         "Debit",  "1,499.00",  "-",          "79,980.50"],
        ["27 May '26", "TXN810273", "Medical - Apollo Pharmacy",    "Debit",  "521.00",    "-",          "79,459.50"],
        ["29 May '26", "TXN810287", "UPI - Mom",             "Debit",  "300.00",    "-",          "79,159.50"],
        ["31 May '26", "TXN810291", "Closing Balance",              "-",      "-",         "-",          "79,159.50"],
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
      text: "Important Notes",
      options: { level: 2 },
    },
    {
      type: "list",
      items: [
        { body: "This is a system-generated statement and does not require a signature or stamp." },
        { body: "Please report any unauthorised transactions within 7 days to customercare@novabanc.com." },
        { body: "For disputes or queries, quote your Statement No. STM-2026-05-0042." },
        { body: "TDS deducted on interest income as per applicable Income Tax rules." },
        { body: "NovaBanc is regulated by the Reserve Bank of India. DICGC insured up to Rs.5,00,000." },
      ],
    },

    {
      type: "paragraph",
      text: "NovaBanc Pvt. Ltd.  |  Regd Office: 14B Northern Street, Fort, Mumbai - 400001  |  CIN: U65191 MH2001 134567",
      class: "muted",
    },
  ],

  footer: ({ pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: `NovaBanc - Confidential  |  Page ${pageNumber} of ${totalPages}  |  Statement No. STM-2026-05-0042`,
      options: { fontSize: 8, color: MUTED, align: "center", tag: pageNumber === totalPages ? "P" : "Artifact", },
    },
  ],
});

export default doc;
