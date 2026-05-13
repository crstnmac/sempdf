import { writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';

import { createDocument, parseDocument, rgb } from '../src/index.js';
import type { TemplateBlock } from '../src/index.js';

const logo = readFileSync('examples/assets/barrierbreak-logo.png');

const projectName = 'ACME Final Project';
const clientName = 'ACME Inc.';
const reportDate = 'May 5, 2026';

const pdfIssues: Array<{
  id: number;
  issue_id: string;
  name: string;
  wcagCriteria: string;
  wcagLevel: string;
  severity: string;
  page: string;
  environments: string[];
  actualResult: string;
  expectedResult: string;
  recommendation: string[];
  is17802: string;
  gigw: string;
  section508: string;
  en301549: string;
}> = [
  {
    id: 1,
    issue_id: 'ACC-001',
    name: 'Non-text content lacks text alternatives',
    wcagCriteria: '1.1.1 Non-text Content',
    wcagLevel: 'A',
    severity: 'High',
    page: 'Homepage',
    environments: [
      'Chrome / JAWS 2024',
      'Firefox / NVDA 2024.1',
      'Safari / VoiceOver',
    ],
    actualResult:
      'The hero banner image on the homepage lacks an alt attribute. Screen readers announce the image filename instead of meaningful descriptive text, preventing users who rely on assistive technology from understanding the banner content.',
    expectedResult:
      'All non-text content must have a text alternative serving the same purpose. The hero banner should include an alt attribute with a concise description of the image content.',
    recommendation: [
      'Add alt text describing the banner image content',
      "For decorative images use alt='' with role='presentation'",
      'Consider replacing image-as-text with CSS-styled HTML text',
    ],
    is17802: 'IS-17802-1.1.1',
    gigw: 'GIGW-1.1.1',
    section508: '1194.22(a)',
    en301549: '9.1.1.1',
  },
  {
    id: 2,
    issue_id: 'ACC-002',
    name: 'Insufficient color contrast on call-to-action buttons',
    wcagCriteria: '1.4.3 Contrast (Minimum)',
    wcagLevel: 'AA',
    severity: 'Medium',
    page: 'Products',
    environments: [
      'Chrome / Color Contrast Analyzer',
      'Firefox / Accessibility DevTools',
    ],
    actualResult:
      'Primary CTA buttons use light green text (#98FB98) on a white (#FFFFFF) background at 1.37:1 contrast ratio, far below the WCAG 2.2 AA minimum of 4.5:1 for normal text.',
    expectedResult:
      'The visual presentation of text must have a contrast ratio of at least 4.5:1 for normal text and 3:1 for large text against adjacent colors.',
    recommendation: [
      'Change button text color to #1B5E20 for 12.3:1 contrast',
      'Add borders or icons alongside color to convey meaning',
      'Run automated contrast audits on all UI components',
    ],
    is17802: 'IS-17802-1.4.3',
    gigw: 'GIGW-1.4.3',
    section508: '1194.21(g)',
    en301549: '9.1.4.3',
  },
  {
    id: 3,
    issue_id: 'ACC-003',
    name: 'Form input fields lack programmatically associated labels',
    wcagCriteria: '1.3.1 Info and Relationships',
    wcagLevel: 'A',
    severity: 'Critical',
    page: 'Contact Us',
    environments: ['Chrome / JAWS 2024', 'Firefox / NVDA 2024.1'],
    actualResult:
      'The Contact Us form uses placeholder attributes for visual labels without corresponding <label> elements. Screen readers cannot announce the purpose of each input, making the form unusable for blind users.',
    expectedResult:
      'Each form input must have a programmatically associated label element so assistive technology can convey the input purpose to the user.',
    recommendation: [
      "Add explicit <label for='name'>Name</label> elements with matching id attributes",
      'Use aria-label or aria-labelledby when visual labels cannot be used',
      'Associate error messages with inputs using aria-describedby',
    ],
    is17802: 'IS-17802-1.3.1',
    gigw: 'GIGW-1.3.1',
    section508: '1194.22(n)',
    en301549: '9.1.3.1',
  },
];

const exampleFontPath =
  process.env.PDF_EDITING_LIB_EXAMPLE_FONT ??
  process.env.PDF_EDITING_LIB_FONT_PATH;
const fontPath = [
  exampleFontPath,
  '/System/Library/Fonts/SFNS.ttf',
  '/System/Library/Fonts/SFNSMono.ttf',
  '/System/Library/Fonts/Geneva.ttf',
  '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
].find((path): path is string => path !== undefined && existsSync(path));

if (!fontPath) {
  throw new Error(
    'examples/tagged-pdf-report.ts needs a local TrueType font to generate PDF/UA-1 compliant embedded-font output. Set PDF_EDITING_LIB_EXAMPLE_FONT=/path/to/font.ttf to choose one.',
  );
}

const doc = createDocument({
  conformance: 'pdfua-1',
  tagged: true,
  language: 'en-US',
  structureRoot: 'Document',
  info: {
    title: `Accessibility Audit Report - ${projectName}`,
    author: 'BarrierBreak',
    creator: 'zeropdf',
    subject: `${clientName} Accessibility Audit`,
    keywords: ['accessibility', 'WCAG', 'Section 508', 'PDF/UA'],
  },
  encryption: {
    algorithm: 'aes-256-r6',
    userPassword: '',
    ownerPassword: 'barrierbreak2026',
    permissions: { printing: true, copying: true, accessibility: true },
  },
});

const font = doc.embedTrueTypeFont(readFileSync(fontPath), {
  family: 'ReportSans',
});
const BLUE = rgb(0.11, 0.2, 0.42);
const DARK = rgb(0.1, 0.1, 0.1);
const BODY = rgb(0.15, 0.15, 0.15);

function issueBlocks(issue: (typeof pdfIssues)[number]): TemplateBlock[] {
  return [
    {
      type: 'heading',
      text: `Issue ID ${issue.issue_id}`,
      options: { level: 3, color: BLUE },
    },
    {
      type: 'table',
      rows: [
        ['Issue name', issue.name],
        ['WCAG Success Criteria', issue.wcagCriteria],
        ['WCAG Conformance Level', issue.wcagLevel],
        ['IS 17802', issue.is17802],
        ['GIGW 3.0', issue.gigw],
        ['Section 508', issue.section508],
        ['EN 301 549', issue.en301549],
        ['Severity', issue.severity],
        ['Page', issue.page],
      ],
      options: {
        headerColumns: 1,
        fontSize: 10,
        color: BODY,
        rowGap: 2,
        marginTop: 6,
        marginBottom: 12,
      },
    },
    {
      type: 'heading',
      text: 'Environments Failed On',
      options: { level: 4, color: DARK },
    },
    {
      type: 'paragraph',
      text: issue.environments.join('; '),
      options: { fontSize: 10, color: BODY, align: 'justify' },
    },
    {
      type: 'heading',
      text: 'Actual Result',
      options: { level: 4, color: DARK },
    },
    {
      type: 'paragraph',
      text: issue.actualResult,
      options: { fontSize: 10, color: BODY, align: 'justify' },
    },
    {
      type: 'heading',
      text: 'Expected Result',
      options: { level: 4, color: DARK },
    },
    {
      type: 'paragraph',
      text: issue.expectedResult,
      options: { fontSize: 10, color: BODY, align: 'justify' },
    },
    {
      type: 'heading',
      text: 'Recommendation',
      options: { level: 4, color: DARK },
    },
    {
      type: 'paragraph',
      text: issue.recommendation.join('; '),
      options: { fontSize: 10, color: BODY, align: 'justify' },
    },
  ];
}

const refs: Array<{ label: string; url: string }> = [
  { label: 'WCAG 2.1 Guidelines', url: 'https://www.w3.org/TR/WCAG21/' },
  { label: 'WCAG 2.2 Guidelines', url: 'https://www.w3.org/TR/WCAG22/' },
  {
    label: 'WAI - ARIA 1.2 Specification',
    url: 'https://www.w3.org/TR/wai-aria-1.2/',
  },
  { label: 'ARIA Practice Guide', url: 'https://www.w3.org/WAI/ARIA/apg/' },
];

doc.renderTemplate({
  info: {
    title: `Accessibility Audit Report - ${projectName}`,
    author: 'BarrierBreak',
  },
  xmpMetadata: {
    title: `Accessibility Audit Report - ${projectName}`,
    creator: 'BarrierBreak',
    createDate: '2026-05-05T00:00:00Z',
    modifyDate: '2026-05-05T00:00:00Z',
    metadataDate: '2026-05-05T00:00:00Z',
  },
  page: {
    size: 'A4',
    font,
    spacing: {
      paragraphBefore: 0,
      paragraphAfter: 8,
      headingBefore: { 1: 24, 2: 18, 3: 14, 4: 10, 5: 8, 6: 6 },
      headingAfter: { 1: 14, 2: 10, 3: 8, 4: 6, 5: 4, 6: 4 },
      tableBefore: 8,
      tableAfter: 14,
      imageBefore: 10,
      imageAfter: 10,
    },
  },
  autoOutline: { maxLevel: 3, expanded: true },
  blocks: [
    {
      type: 'heading',
      text: 'Accessibility Audit Report',
      options: { color: BLUE, align: 'center', marginBottom: 200 },
    },
    {
      type: 'png',
      data: logo,
      options: {
        maxWidth: 180,
        align: 'center',
        altText: 'BarrierBreak logo',
      },
    },
    {
      type: 'heading',
      text: projectName,
      options: { level: 2, color: DARK, align: 'center', marginBottom: 24 },
    },
    {
      type: 'paragraph',
      text: reportDate,
      options: { color: DARK, align: 'center', marginBottom: 80 },
    },
    {
      type: 'paragraph',
      text: 'Prepared by',
      options: { color: DARK, align: 'left', marginBottom: 4 },
    },
    {
      type: 'heading',
      text: 'BarrierBreak',
      options: { level: 2, color: BLUE, align: 'left', marginBottom: 8 },
    },
    {
      type: 'paragraph',
      text: [
        'Office No. 102, Highway Commercial Complex',
        'IB Patel Road, Opposite Laghu Udyog Industrial Estate',
        'Goregaon (E), Mumbai 400 063',
        'Maharashtra, India',
      ].join('\n'),
      options: {
        fontSize: 10,
        align: 'left',
        blockWidth: 320,
        lineHeight: 14,
        marginBottom: 6,
      },
    },
    {
      type: 'paragraph',
      text: [
        'Tel: +91 (22) 2686 0485 / +91 (22) 2686 0486',
        'Tel: +1 586 232 9773',
      ].join(' \n'),
      options: {
        fontSize: 10,
        align: 'left',
        blockWidth: 320,
        lineHeight: 14,
        marginBottom: 8,
      },
    },
    {
      type: 'link',
      text: 'BarrierBreak website',
      url: 'https://www.barrierbreak.com/',
      options: {
        align: 'left',
        structure: { altText: 'BarrierBreak website' },
      },
    },
    {
      type: 'pageBreak',
    },
    {
      type: 'heading',
      text: 'Document history and Status',
      options: { level: 2, color: BLUE },
    },
    {
      type: 'table',
      rows: [
        ['Report by', 'BarrierBreak'],
        ['Prepared for', clientName],
        ['Version', '1.0'],
      ],
      options: {
        headerColumns: 1,
        fontSize: 11,
        rowGap: 2,
        marginTop: 6,
        marginBottom: 12,
      },
    },
    {
      type: 'heading',
      text: 'Detailed findings and recommendations',
      options: { level: 2, color: BLUE },
    },
    {
      type: 'paragraph',
      text: 'Findings are grouped based on WCAG 2.2 Guidelines and the related success criterion. For most of the issues mentioned below, few examples are included. Findings discussed in these examples need to be applied to rest of the website.',
      options: { fontSize: 11, color: DARK, align: 'justify' },
    },
    {
      type: 'heading',
      text: 'Accessibility Issues',
      options: { level: 3, color: BLUE },
    },
    {
      type: 'table',
      rows: pdfIssues.map((issue) => [
        issue.issue_id,
        issue.name,
        issue.severity,
        issue.wcagCriteria,
      ]),
      options: {
        headerColumns: 1,
        fontSize: 9,
        rowGap: 2,
        marginTop: 6,
        marginBottom: 12,
      },
    },
    { type: 'pageBreak' },
    ...pdfIssues.flatMap((issue) => issueBlocks(issue)),
    { type: 'pageBreak' },
    { type: 'heading', text: 'References', options: { level: 2, color: BLUE } },
    ...refs.map(
      (ref): TemplateBlock => ({
        type: 'link',
        text: ref.label,
        url: ref.url,
        options: { structure: { altText: ref.label } },
      }),
    ),
  ],
  header: ({ title }) => [
    {
      type: 'paragraph',
      text: title ?? 'Accessibility Audit Report',
      options: { fontSize: 8, color: DARK, tag: 'Artifact' },
    },
  ],
  pageNumber: {
    region: 'footer',
    align: 'center',
  },
});

const pdfBytes = doc.toUint8Array();

const complianceIssues = doc.validateCompliance();
if (complianceIssues.length > 0) {
  console.log('Compliance issues found:');
  for (const issue of complianceIssues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
} else {
  console.log('No compliance issues detected.');
}

const parsed = parseDocument(pdfBytes, { password: '' });
const elements = parsed.listStructureElements();
console.log(`\nStructure tree has ${elements.length} top-level element(s):`);
for (const el of elements) {
  console.log(`  ${el.role}`);
  if (el.children) {
    for (const child of el.children) {
      console.log(`    ${child.role}`);
    }
  }
}

await writeFile('examples/tagged-pdf-report.pdf', pdfBytes);
console.log('\nWrote examples/tagged-pdf-report.pdf');
