import { createDocument, rgb } from "@zeropdf/zeropdf-pdf";

async function ttf(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

const cdn = "https://cdn.jsdelivr.net/npm/@expo-google-fonts";
const FONTS = {
  inter400: `${cdn}/inter/400Regular/Inter_400Regular.ttf`,
  inter700: `${cdn}/inter/700Bold/Inter_700Bold.ttf`,
};

const companyLogo = fetch("examples/assets/company-logo.png");
const logo = await companyLogo.then((res) => res.arrayBuffer());

const doc = createDocument({
  language: "en-US",
  conformance: "pdfua-1",
  tagged: true,
  structureRoot: "Document",
  title: "Joining Letter - John Doe",
  info: { author: "Lorem Ipsum" },
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
    margin: 56,
    font: "Inter",
    spacing: {
      paragraphAfter: 8,
      headingBefore: { 2: 18, 3: 12 },
      headingAfter: { 1: 4, 2: 8, 3: 6 },
      tableBefore: 0,
      tableAfter: 24,
    },
  },

  styles: {
    heading1: { fontSize: 22, color: BRAND, marginTop: 20 },
    heading2: { fontSize: 16, color: BRAND, marginTop: 16, marginBottom: 0 },
    paragraph: { fontSize: 11, lineHeight: 17 },
    muted: { fontSize: 9, color: MUTED, lineHeight: 14 },
  },

  blocks: [
    {
      type: "png",
      data: logo,
      options: { altText: "Lorem Ipsum Logo", maxWidth: 100 },
    },
    {
      type: "heading",
      text: "Lorem Ipsum",
      options: { level: 1 },
    },

    {
      type: "paragraph",
      text: "To,\nMr. John Doe\n47, Lorem ipsum dolor sit amet",
      options: { marginBottom: 20 },
    },
    {
      type: "paragraph",
      text: "Dear Mr. John Doe,",
    },
    {
      type: "paragraph",
      text: "Subject: Offer of Employment - Senior Software Engineer",
    },
    {
      type: "paragraph",
      text: "We are delighted to welcome you to Lorem Ipsum. Following the successful completion of our selection process, we are pleased to offer you the position of Senior Software Engineer within our Engineering department. This letter confirms the terms and conditions of your employment with us.",
    },

    {
      type: "heading",
      text: "Appointment Details",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Full Name", header: true, bold: true },
          { text: "Mr. John Doe" },
        ],
        [
          { text: "Employee ID", header: true, bold: true },
          { text: "SS-EMP-2026-0148" },
        ],
        [
          { text: "Designation", header: true, bold: true },
          { text: "Senior Software Engineer" },
        ],
        [
          { text: "Department", header: true, bold: true },
          { text: "Engineering - Platform Team" },
        ],
        [
          { text: "Date of Joining", header: true, bold: true },
          { text: "01 July 2026" },
        ],
        [
          { text: "Employment Type", header: true, bold: true },
          { text: "Full-Time, Permanent" },
        ],
        [
          { text: "Work Location", header: true, bold: true },
          { text: "47, Lorem ipsum dolor sit amet" },
        ],
        [
          { text: "Work Mode", header: true, bold: true },
          { text: "Hybrid (3 days in-office, 2 days remote)" },
        ],
        [
          { text: "Probation Period", header: true, bold: true },
          { text: "6 months (01 Jul 2026 - 31 Dec 2026)" },
        ],
      ],
      options: {
        headerRows: 0,
        borders: "all",
        borderColor: TABLE_BORDER,
        headerBackground: TABLE_HEADER,
      },
    },

    {
      type: "heading",
      text: "Compensation & Benefits",
      options: { level: 2 },
    },
    {
      type: "table",
      rows: [
        [
          { text: "Component", header: true, bold: true },
          { text: "Monthly (Rs.)", header: true, bold: true },
          { text: "Annual (Rs.)", header: true, bold: true },
        ],
        [
          { text: "Basic Pay", header: true, scope: "row" },
          { text: "75,000.00" },
          { text: "9,00,000.00" },
        ],
        [
          { text: "House Rent Allowance", header: true, scope: "row" },
          { text: "30,000.00" },
          { text: "3,60,000.00" },
        ],
        [
          { text: "Special Allowance", header: true, scope: "row" },
          { text: "20,000.00" },
          { text: "2,40,000.00" },
        ],
        [
          { text: "Transport Allowance", header: true, scope: "row" },
          { text: "3,200.00" },
          { text: "38,400.00" },
        ],
        [
          { text: "Medical Allowance", header: true, scope: "row" },
          { text: "1,250.00" },
          { text: "15,000.00" },
        ],
        [
          { text: "Employer PF Contribution", header: true, scope: "row" },
          { text: "9,000.00" },
          { text: "1,08,000.00" },
        ],
        [
          { text: "Gross CTC", header: true, scope: "row" },
          { text: "1,38,450.00" },
          { text: "16,61,400.00" },
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
      type: "paragraph",
      text: "In addition to the above, you will be eligible for an annual performance bonus of up to 15% of your annual basic salary, subject to individual and company performance. All statutory deductions (PF, TDS, Professional Tax) will be applied as per applicable laws.",
      class: "muted",
    },

    {
      type: "heading",
      text: "Additional Benefits",
      options: { level: 2 },
    },
    {
      type: "list",
      items: [
        { body: "Group Term Life Insurance: Coverage of Rs. 50,00,000." },
        {
          body: "Annual Leave: 18 days of paid annual leave per calendar year.",
        },
        { body: "Sick Leave: 12 days per calendar year." },
      ],
    },

    {
      type: "heading",
      text: "Terms & Conditions",
      options: { level: 2 },
    },
    {
      type: "list",
      items: [
        {
          body: "This offer is contingent upon the satisfactory verification of your educational qualifications, previous employment records, and background check.",
        },
        {
          body: "You are required to submit all original documents for verification on or before your date of joining.",
        },
        {
          body: "During the probation period, either party may terminate employment with 15 days written notice. Post-confirmation, the notice period is 60 days.",
        },
      ],
    },

    {
      type: "heading",
      text: "Joining Instructions",
      options: { level: 2 },
    },
    {
      type: "paragraph",
      text: "Please report to the HR department at our office on 01 July 2026 at 9:30 AM. Kindly carry the following documents in original along with one set of self-attested photocopies:",
    },
    {
      type: "list",
      items: [
        {
          body: "Government-issued photo ID",
        },
        { body: "Last 3 months' salary slips and latest Form 16" },
        {
          body: "Experience letters and relieving letters from all previous employers",
        },
        { body: "2 recent passport-size photographs" },
      ],
    },
    {
      type: "richParagraph",
      runs: [
        {
          text: "For any queries regarding joining, please contact our HR team at ",
        },
        {
          text: "hr@loremipsum.in",
          link: "mailto:hr@loremipsum.in",
          underline: true,
        },
      ],
    },

    {
      type: "heading",
      text: "Acceptance",
      options: { level: 2 },
    },
    {
      type: "paragraph",
      text: "Please indicate your acceptance of this offer by signing and returning a copy of this letter on or before 25 June 2026. By accepting this offer, you confirm that you are not bound by any non-compete or other restrictive agreements that would prevent you from joining Lorem Ipsum.",
    },
    {
      type: "table",
      rows: [
        [
          {
            text: "For Lorem Ipsum.",
            header: true,
            bold: true,
          },
          { text: "Accepted by Employee", header: true, bold: true },
        ],
        [
          "Signature: ___________________\nName: Ms. Jane Doe\nDesignation: Chief HR Officer\nDate: 16 June 2026",
          "Signature: ___________________\nName: Mr. John Doe\nDate: ___________________",
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
      type: "richParagraph",
      runs: [
        {
          text: "We look forward to having you on board and wish you a rewarding career at ",
        },
        { text: "Lorem Ipsum", bold: true, color: BRAND },
        { text: ". Welcome to the team!" },
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
