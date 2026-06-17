import { createDocument, rgb } from "@sempdf/sempdf-pdf";

const doc = createDocument({
  title: "Joining Letter - John Adam",
  language: "en-US",
  info: { author: "Star Solutions" },
  structureRoot: "Document",
  defaults: { font: "Helvetica", fontSize: 11, color: rgb(0.1, 0.1, 0.15) },
});

const BRAND = rgb(0.05, 0.25, 0.55);
const MUTED = rgb(0.45, 0.45, 0.5);

doc.renderTemplate({
  page: {
    size: "A4",
    margin: 56,
    spacing: {
      paragraphAfter: 8,
      headingBefore: { 2: 18, 3: 12 },
      headingAfter: { 1: 4, 2: 8, 3: 6 },
      tableBefore: 6,
      tableAfter: 14,
    },
  },
  autoOutline: { maxLevel: 6 },
  styles: {
    heading1: { fontSize: 22, color: BRAND },
    heading2: { fontSize: 16, color: BRAND },
    paragraph: { fontSize: 11, lineHeight: 17 },
    muted: { fontSize: 9, color: MUTED, lineHeight: 14 },
  },

  blocks: [
    {
      type: "heading",
      text: "Star Solutions",
      options: { level: 1 },
    },
    {
      type: "paragraph",
      text: "42, Tech Park Avenue, Whitefield, Bengaluru - 560066  |  hr@starsolutions.in  |  www.starsolutions.in",
      class: "muted",
    },

    {
      type: "paragraph",
      text: "To,\nMr. John Adam\n47, Rose Garden Apartments\nKoramangala, Bengaluru - 560034",
      options: { marginBottom: 20 }
    },
    {
      type: "paragraph",
      text: "Dear Mr. John Adam,",
    },

    {
      type: "paragraph",
      text: "Subject: Offer of Employment - Senior Software Engineer",
    },

    {
      type: "paragraph",
      text: "We are delighted to welcome you to Star Solutions Pvt. Ltd. Following the successful completion of our selection process, we are pleased to offer you the position of Senior Software Engineer within our Engineering department. This letter confirms the terms and conditions of your employment with us.",
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
          { text: "Mr. John Adam" },
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
          { text: "Reporting To", header: true, bold: true },
          { text: "Ms. Priya Sharma, Engineering Manager" },
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
          { text: "42, Tech Park Avenue, Whitefield, Bengaluru - 560066" },
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
      options: { headerRows: 0 },
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
        ["Basic Salary",              "75,000.00",   "9,00,000.00"],
        ["House Rent Allowance (HRA)", "30,000.00",  "3,60,000.00"],
        ["Special Allowance",          "20,000.00",  "2,40,000.00"],
        ["Transport Allowance",         "3,200.00",    "38,400.00"],
        ["Medical Allowance",           "1,250.00",    "15,000.00"],
        ["Employer PF Contribution",    "9,000.00",  "1,08,000.00"],
        [
          { text: "Gross CTC", bold: true, header: true },
          { text: "1,38,450.00", bold: true, header: true },
          { text: "16,61,400.00", bold: true, header: true },
        ],
      ],
      options: { headerRows: 1 },
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
        { body: "Group Health Insurance: Coverage of Rs. 5,00,000 for employee and immediate family members." },
        { body: "Group Term Life Insurance: Coverage of Rs. 50,00,000." },
        { body: "Annual Leave: 18 days of paid annual leave per calendar year." },
        { body: "Sick Leave: 12 days per calendar year." },
        { body: "Learning & Development Budget: Rs. 30,000 per year for certifications and courses." },
        { body: "Internet Reimbursement: Rs. 1,000 per month for remote working days." },
        { body: "Laptop and accessories provided by the company from Day 1." },
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
        { body: "This offer is contingent upon the satisfactory verification of your educational qualifications, previous employment records, and background check." },
        { body: "You are required to submit all original documents for verification on or before your date of joining." },
        { body: "During the probation period, either party may terminate employment with 15 days written notice. Post-confirmation, the notice period is 60 days." },
        { body: "You will be bound by the company's Code of Conduct, Confidentiality Agreement, and Non-Disclosure Agreement, copies of which will be provided during onboarding." },
        { body: "Any intellectual property developed in the course of your employment will remain the property of Star Solutions Pvt. Ltd." },
        { body: "This offer lapses if not accepted in writing by 25 June 2026." },
      ],
    },

    {
      type: "heading",
      text: "Joining Instructions",
      options: { level: 2 },
    },
    {
      type: "paragraph",
      text: "Please report to the HR department at our Bengaluru office on 01 July 2026 at 9:30 AM. Kindly carry the following documents in original along with one set of self-attested photocopies:",
    },
    {
      type: "list",
      items: [
        { body: "Government-issued photo ID (Aadhaar Card / Passport / Driving Licence)" },
        { body: "PAN Card" },
        { body: "Educational qualification certificates (10th, 12th, Degree, Post-graduation)" },
        { body: "Last 3 months' salary slips and latest Form 16" },
        { body: "Experience letters and relieving letters from all previous employers" },
        { body: "2 recent passport-size photographs" },
        { body: "Cancelled cheque or bank passbook for salary account setup" },
      ],
    },
    {
      type: "paragraph",
      text: "For any queries regarding onboarding, please contact our HR team at onboarding@starsolutions.in or call +91-80-4567-8910.",
    },

    {
      type: "heading",
      text: "Acceptance",
      options: { level: 2 },
    },
    {
      type: "paragraph",
      text: "Please indicate your acceptance of this offer by signing and returning a copy of this letter to hr@starsolutions.in on or before 25 June 2026. By accepting this offer, you confirm that you are not bound by any non-compete or other restrictive agreements that would prevent you from joining Star Solutions Pvt. Ltd.",
    },
    {
      type: "table",
      rows: [
        [
          { text: "For Star Solutions Pvt. Ltd.", header: true, bold: true },
          { text: "Accepted by Employee", header: true, bold: true },
        ],
        [
          "Signature: ___________________\nName: Ms. Kavita Rao\nDesignation: Chief HR Officer\nDate: 16 June 2026",
          "Signature: ___________________\nName: Mr. John Adam\nDate: ___________________",
        ],
      ],
      options: { headerRows: 1 },
    },

    {
      type: "richParagraph",
      runs: [
        { text: "We look forward to having you on board and wish you a rewarding career at " },
        { text: "Star Solutions", bold: true, color: BRAND },
        { text: ". Welcome to the team!" },
      ],
    },
  ],

  footer: ({ pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: `Star Solutions - Confidential  |  Joining Letter - Mr. John Adam  |  Ref: SS/HR/JL/2026/0148  |  Page ${pageNumber} of ${totalPages}`,
      options: {
        fontSize: 8,
        color: MUTED,
        align: "center",
        tag: pageNumber === totalPages ? "P" : "Artifact",
      },
    },
  ],
});

export default doc;