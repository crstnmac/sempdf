import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

import { createDocument, rgb, parseDocument, PdfStructureContainer } from "../src/index.js";

// ── Dummy Data ──

const projectName = "MyCorp Public Website";
const clientName = "MyCorp Inc.";
const reportDate = "May 5, 2026";

// 1x1 transparent PNG placeholder for the logo
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC";
const logo = Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));

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
    issue_id: "ACC-001",
    name: "Non-text content lacks text alternatives",
    wcagCriteria: "1.1.1 Non-text Content",
    wcagLevel: "A",
    severity: "High",
    page: "Homepage",
    environments: ["Chrome / JAWS 2024", "Firefox / NVDA 2024.1", "Safari / VoiceOver"],
    actualResult:
      "The hero banner image on the homepage lacks an alt attribute. Screen readers announce the image filename instead of meaningful descriptive text, preventing users who rely on assistive technology from understanding the banner content.",
    expectedResult:
      "All non-text content must have a text alternative serving the same purpose. The hero banner should include an alt attribute with a concise description of the image content.",
    recommendation: [
      "Add alt text describing the banner image content",
      "For decorative images use alt='' with role='presentation'",
      "Consider replacing image-as-text with CSS-styled HTML text"
    ],
    is17802: "IS-17802-1.1.1",
    gigw: "GIGW-1.1.1",
    section508: "1194.22(a)",
    en301549: "9.1.1.1"
  },
  {
    id: 2,
    issue_id: "ACC-002",
    name: "Insufficient color contrast on call-to-action buttons",
    wcagCriteria: "1.4.3 Contrast (Minimum)",
    wcagLevel: "AA",
    severity: "Medium",
    page: "Products",
    environments: ["Chrome / Color Contrast Analyzer", "Firefox / Accessibility DevTools"],
    actualResult:
      "Primary CTA buttons use light green text (#98FB98) on a white (#FFFFFF) background at 1.37:1 contrast ratio, far below the WCAG 2.2 AA minimum of 4.5:1 for normal text.",
    expectedResult:
      "The visual presentation of text must have a contrast ratio of at least 4.5:1 for normal text and 3:1 for large text against adjacent colors.",
    recommendation: [
      "Change button text color to #1B5E20 for 12.3:1 contrast",
      "Add borders or icons alongside color to convey meaning",
      "Run automated contrast audits on all UI components"
    ],
    is17802: "IS-17802-1.4.3",
    gigw: "GIGW-1.4.3",
    section508: "1194.21(g)",
    en301549: "9.1.4.3"
  },
  {
    id: 3,
    issue_id: "ACC-003",
    name: "Form input fields lack programmatically associated labels",
    wcagCriteria: "1.3.1 Info and Relationships",
    wcagLevel: "A",
    severity: "Critical",
    page: "Contact Us",
    environments: ["Chrome / JAWS 2024", "Firefox / NVDA 2024.1"],
    actualResult:
      "The Contact Us form uses placeholder attributes for visual labels without corresponding <label> elements. Screen readers cannot announce the purpose of each input, making the form unusable for blind users.",
    expectedResult:
      "Each form input must have a programmatically associated label element so assistive technology can convey the input purpose to the user.",
    recommendation: [
      "Add explicit <label for='name'>Name</label> elements with matching id attributes",
      "Use aria-label or aria-labelledby when visual labels cannot be used",
      "Associate error messages with inputs using aria-describedby"
    ],
    is17802: "IS-17802-1.3.1",
    gigw: "GIGW-1.3.1",
    section508: "1194.22(n)",
    en301549: "9.1.3.1"
  }
];

// ── Font ──

const fontPath = [
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/SFNSMono.ttf",
  "/System/Library/Fonts/Geneva.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
].find((path) => existsSync(path));

if (!fontPath) {
  throw new Error(
    "examples/tagged-pdf-report.ts needs a local TrueType font to generate PDF/UA-1 compliant embedded-font output."
  );
}

// ── Build Document ──

const doc = createDocument({
  conformance: "pdfua-1",
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  info: {
    title: `Accessibility Audit Report - ${projectName}`,
    author: "sempdf"
  }
});

doc.setXmpMetadata(
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">' +
  `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Accessibility Audit Report - ${projectName}</rdf:li></rdf:Alt></dc:title>` +
  '<dc:creator><rdf:Seq><rdf:li>sempdf</rdf:li></rdf:Seq></dc:creator>' +
  '<xmp:CreateDate>2026-05-05T00:00:00Z</xmp:CreateDate>' +
  '<xmp:ModifyDate>2026-05-05T00:00:00Z</xmp:ModifyDate>' +
  '<xmp:MetadataDate>2026-05-05T00:00:00Z</xmp:MetadataDate>' +
  '</rdf:Description>' +
  '</rdf:RDF>' +
  '</x:xmpmeta>' +
  '<?xpacket end="w"?>'
);

const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "ReportSans" });

// ── Helpers ──

const BLUE = rgb(0.11, 0.2, 0.42);
const DARK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.4, 0.4, 0.4);
const BODY = rgb(0.15, 0.15, 0.15);

interface RenderCtx {
  section: PdfStructureContainer;
  y: number;
}

function labelValue(ctx: RenderCtx, label: string, value: string): number {
  ctx.section.text(label, {
    x: 56, y: ctx.y, font, fontSize: 10, color: DARK, tag: "P",
    structure: { actualText: label }
  });
  ctx.y -= 13;
  ctx.section.text(value || "-", {
    x: 56, y: ctx.y, font, fontSize: 10, color: BODY, tag: "P"
  });
  ctx.y -= 18;
  return ctx.y;
}

function h4(ctx: RenderCtx, text: string): number {
  ctx.section.text(text, {
    x: 56, y: ctx.y, font, fontSize: 10, color: DARK, tag: "H4"
  });
  ctx.y -= 15;
  return ctx.y;
}

function bodyBlock(ctx: RenderCtx, text: string, width?: number): number {
  ctx.section.textBlock(text, {
    x: 56, y: ctx.y, font,
    width: width ?? 480,
    fontSize: 10,
    color: BODY,
    tag: "P",
    lineHeight: 14
  });
  ctx.y -= 55;
  return ctx.y;
}

function renderIssue(
  section: RenderCtx["section"],
  startY: number,
  issue: (typeof pdfIssues)[number]
): number {
  const ctx: RenderCtx = { section, y: startY };

  section.text(`Issue ID ${issue.issue_id}`, {
    x: 56, y: ctx.y, font, fontSize: 14, color: DARK, tag: "H3"
  });
  ctx.y -= 26;

  const fields: Array<[string, string]> = [
    ["Issue name", issue.name],
    ["WCAG Success Criteria", issue.wcagCriteria],
    ["WCAG Conformance Level", issue.wcagLevel],
    ["IS 17802", issue.is17802],
    ["GIGW 3.0", issue.gigw],
    ["Section 508", issue.section508],
    ["EN 301 549", issue.en301549],
    ["Severity", issue.severity],
    ["Page", issue.page]
  ];
  for (const [label, value] of fields) {
    labelValue(ctx, label, value);
  }

  h4(ctx, "Environments Failed On");
  section.list(issue.environments, {
    x: 56, y: ctx.y, font, width: 480,
    fontSize: 10, color: BODY, itemSpacing: 2, indent: 18
  });
  ctx.y -= 10 + issue.environments.length * 14;

  h4(ctx, "Actual Result");
  bodyBlock(ctx, issue.actualResult);

  h4(ctx, "Expected Result");
  bodyBlock(ctx, issue.expectedResult);

  h4(ctx, "Recommendation");
  bodyBlock(ctx, "Apply the following changes:");
  ctx.y += 55;
  ctx.y -= 12;
  section.list(issue.recommendation, {
    x: 56, y: ctx.y, font, width: 480,
    fontSize: 10, color: BODY, itemSpacing: 2, indent: 18
  });
  ctx.y -= 10 + issue.recommendation.length * 14;
  ctx.y -= 10;

  return ctx.y;
}

// ════ PAGE 1: COVER ════

const cover = doc.addPage({ size: "A4" });

cover.container("Sect", (section) => {
  section.text(`Accessibility Audit Report - ${projectName}`, {
    x: 56, y: 760, font, fontSize: 24, color: BLUE, tag: "H1"
  });

  section.text(reportDate, {
    x: 56, y: 726, font, fontSize: 11, color: DARK, tag: "P"
  });

  // Logo with BBox attribute for PDF/UA compliance
  section.png(logo, {
    x: 200, y: 580, width: 150, height: 40,
    altText: "sempdf Logo",
    structure: {
      attributes: {
        BBox: [200, 580, 350, 620]
      }
    }
  });

  section.text("Prepared by", {
    x: 56, y: 500, font, fontSize: 11, color: DARK, tag: "P"
  });

  section.text("sempdf", {
    x: 56, y: 476, font, fontSize: 14, color: BLUE, tag: "H2"
  });

  section.structure("P", { actualText: "sempdf address" }, (addr) => {
    addr.text("Office No. 102, Highway Commercial Complex,", {
      x: 56, y: 448, font, fontSize: 10, color: GRAY, tag: "Span"
    });
    addr.text("IB Patel Road, Opposite Laghu Udyog Industrial Estate,", {
      x: 56, y: 434, font, fontSize: 10, color: GRAY, tag: "Span"
    });
    addr.text("Goregaon (E), Mumbai - 400 063.", {
      x: 56, y: 420, font, fontSize: 10, color: GRAY, tag: "Span"
    });
    addr.text("Telephone: +91 (22) 2686 0485/6, +15862329773", {
      x: 56, y: 400, font, fontSize: 10, color: GRAY, tag: "Span"
    });
  });

  section.structure("P", (p) => {
    p.structure("Link", { altText: "sempdf website" }, (link) => {
      link.text("Website: https://www.sempdf.com/", {
        x: 56, y: 382, font, fontSize: 10, color: BLUE, tag: "Span"
      });
      link.link("https://www.sempdf.com/", {
        x: 56, y: 378, width: 200, height: 16, tag: "Link"
      });
    });
  });
});

cover.path(
  [
    { type: "rect", x: 48, y: 340, width: 498, height: 1 },
    { type: "rect", x: 48, y: 336, width: 498, height: 1 }
  ],
  { paint: "stroke", stroke: { width: 1, color: BLUE }, tag: "Artifact" }
);

// ════ PAGE 2: DOCUMENT HISTORY ════

const history = doc.addPage({ size: "A4" });

history.container("Sect", (section) => {
  section.text("Document history and Status", {
    x: 56, y: 760, font, fontSize: 18, color: BLUE, tag: "H2"
  });

  function infoRow(label: string, value: string, y: number): void {
    section.text(`${label}: ${value}`, {
      x: 56, y, font, fontSize: 11, color: DARK, tag: "P",
      structure: { actualText: `${label}: ${value}` }
    });
  }

  infoRow("Report by", "sempdf", 710);
  infoRow("Prepared for", clientName, 684);
  infoRow("Version", "1.0", 658);
});

// ════ PAGE 3: FINDINGS (Issue 1) ════

const findingsPage1 = doc.addPage({ size: "A4" });

findingsPage1.container("Sect", (section) => {
  section.text("Detailed findings and recommendations", {
    x: 56, y: 760, font, fontSize: 18, color: BLUE, tag: "H2"
  });

  section.textBlock(
    "Findings are grouped based on WCAG 2.2 Guidelines and the related success criterion. For most of the issues mentioned below, few examples are included. Findings discussed in these examples need to be applied to rest of the website.",
    {
      x: 56, y: 728, font, width: 480,
      fontSize: 11, color: DARK, tag: "P", lineHeight: 15
    }
  );

  section.text("Accessibility Issues", {
    x: 56, y: 668, font, fontSize: 14, color: BLUE, tag: "H3"
  });

  renderIssue(section, 636, pdfIssues[0]!);
});

// ════ PAGE 4: FINDINGS (Issues 2-3) ════

const findingsPage2 = doc.addPage({ size: "A4" });

findingsPage2.container("Sect", (section) => {
  section.text("Accessibility Issues (continued)", {
    x: 56, y: 760, font, fontSize: 14, color: BLUE, tag: "H3"
  });

  const endY = renderIssue(section, 726, pdfIssues[1]!);
  renderIssue(section, endY, pdfIssues[2]!);
});

// ════ PAGE 5: REFERENCES ════

const references = doc.addPage({ size: "A4" });

references.container("Sect", (section) => {
  section.text("References", {
    x: 56, y: 760, font, fontSize: 18, color: BLUE, tag: "H2"
  });

  const refs: Array<{ label: string; url: string }> = [
    { label: "WCAG 2.1 Guidelines", url: "https://www.w3.org/TR/WCAG21/" },
    { label: "WCAG 2.2 Guidelines", url: "https://www.w3.org/TR/WCAG22/" },
    { label: "WAI - ARIA 1.2 Specification", url: "https://www.w3.org/TR/wai-aria-1.2/" },
    { label: "ARIA Practice Guide", url: "https://www.w3.org/WAI/ARIA/apg/" }
  ];

  let y = 720;
  for (const ref of refs) {
    section.structure("P", (p) => {
      p.structure("Link", { altText: ref.label }, (link) => {
        link.text(ref.label, {
          x: 56, y, font, fontSize: 11, color: BLUE, tag: "Span"
        });
        link.link(ref.url, {
          x: 56, y: y - 2, width: 300, height: 14, tag: "Link"
        });
      });
    });
    y -= 22;
  }
});

// ── Serialize & Validate ──

const pdfBytes = doc.toUint8Array();

const complianceIssues = doc.validateCompliance();
if (complianceIssues.length > 0) {
  console.log("Compliance issues found:");
  for (const issue of complianceIssues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
} else {
  console.log("No compliance issues detected.");
}

const parsed = parseDocument(pdfBytes);
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

await writeFile("examples/tagged-pdf-report.pdf", pdfBytes);
console.log("\nWrote examples/tagged-pdf-report.pdf");
