import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

import { createDocument, rgb, parseDocument } from "../src/index.js";

const fontPath = [
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/SFNSMono.ttf",
  "/System/Library/Fonts/Geneva.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
].find((path) => existsSync(path));

if (!fontPath) {
  throw new Error("examples/tagged-pdf.ts needs a local TrueType font to generate PDF/UA-1 compliant embedded-font output.");
}

const doc = createDocument({
  conformance: "pdfua-1",
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  info: {
    title: "Quarterly Business Review",
    author: "pdf-editing-lib"
  }
});

// Supply explicit XMP metadata with ISO 8601 dates (required by PDF/UA).
// The library auto-builds XMP from `info` dates, but those use PDF date
// format (D:YYYYMMDDHHmmSS) which is not valid XMP.  Passing the full XMP
// packet bypasses the auto-generation.
doc.setXmpMetadata(
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">' +
  '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Quarterly Business Review</rdf:li></rdf:Alt></dc:title>' +
  '<dc:creator><rdf:Seq><rdf:li>pdf-editing-lib</rdf:li></rdf:Seq></dc:creator>' +
  '<xmp:CreateDate>2026-05-05T00:00:00Z</xmp:CreateDate>' +
  '<xmp:ModifyDate>2026-05-05T00:00:00Z</xmp:ModifyDate>' +
  '<xmp:MetadataDate>2026-05-05T00:00:00Z</xmp:MetadataDate>' +
  '</rdf:Description>' +
  '</rdf:RDF>' +
  '</x:xmpmeta>' +
  '<?xpacket end="w"?>'
);

const font = doc.embedTrueTypeFont(readFileSync(fontPath), { family: "TaggedPdfExample" });

// ── Page 1: Cover ──

const cover = doc.addPage({ size: "A4" });

cover.container("Sect", (section) => {
  section.text("Quarterly Business Review", {
    x: 56,
    y: 760,
    font,
    fontSize: 24,
    color: rgb(0.11, 0.2, 0.42),
    tag: "H1"
  });

  section.text("Q1 2026 - Executive Summary", {
    x: 56,
    y: 720,
    font,
    fontSize: 14,
    color: rgb(0.3, 0.3, 0.3),
    tag: "P"
  });

  section.textBlock(
    "This report covers key financial metrics, product milestones, and compliance status for the first quarter of 2026. All figures have been audited and are presented in accordance with our standard reporting framework.",
    {
      x: 56,
      y: 660,
      width: 400,
      font,
      fontSize: 11,
      tag: "P"
    }
  );

  section.text("Prepared by: Internal Audit Team", {
    x: 56,
    y: 600,
    font,
    fontSize: 10,
    color: rgb(0.4, 0.4, 0.4),
    tag: "P"
  });
});

cover.path(
  [
    { type: "rect", x: 48, y: 520, width: 470, height: 1 },
    { type: "rect", x: 48, y: 516, width: 470, height: 1 }
  ],
  {
    paint: "stroke",
    stroke: { width: 1, color: rgb(0.11, 0.2, 0.42) },
    tag: "Artifact"
  }
);

// ── Page 2: Metrics & Milestones ──

const metrics = doc.addPage({ size: "A4" });

metrics.container("Sect", (section) => {
  section.text("Financial Metrics", {
    x: 56,
    y: 760,
    font,
    fontSize: 18,
    color: rgb(0.11, 0.2, 0.42),
    tag: "H2"
  });

  section.table(
    [
      [
        { text: "Metric", header: true },
        { text: "Target", header: true },
        { text: "Actual", header: true },
        { text: "Variance", header: true }
      ],
      [
        { text: "Revenue", header: true, scope: "row" },
        { text: "$2.4M" },
        { text: "$2.6M" },
        { text: "+8.3%" }
      ],
      [
        { text: "Gross Margin", header: true, scope: "row" },
        { text: "62%" },
        { text: "64%" },
        { text: "+2pp" }
      ],
      [
        { text: "Operating Costs", header: true, scope: "row" },
        { text: "$1.1M" },
        { text: "$1.0M" },
        { text: "-9.1%" }
      ]
    ],
    {
      x: 56,
      y: 690,
      width: 400,
      columnWidths: [120, 100, 90, 90],
      headerRows: 1,
      headerColumns: 1,
      font,
      fontSize: 11
    }
  );

  section.text("Product Milestones", {
    x: 56,
    y: 560,
    font,
    fontSize: 18,
    color: rgb(0.11, 0.2, 0.42),
    tag: "H2"
  });

  section.list(
    [
      "Launch v2.4 with tagged PDF export",
      {
        body: "Accessibility improvements",
        children: [
          "Screen-reader navigation support",
          "WCAG 2.1 Level AA compliance"
        ]
      },
      "Migrate analytics pipeline to streaming"
    ],
    {
      x: 56,
      y: 520,
      width: 400,
      font,
      fontSize: 11
    }
  );
});

// ── Page 3: Compliance & Links ──

const compliance = doc.addPage({ size: "A4" });

compliance.container("Sect", (section) => {
  section.text("Compliance Status", {
    x: 56,
    y: 760,
    font,
    fontSize: 18,
    color: rgb(0.11, 0.2, 0.42),
    tag: "H2"
  });

  section.table(
    [
      [
        { text: "Standard", header: true },
        { text: "Status", header: true },
        { text: "Audit Date", header: true }
      ],
      [
        { text: "SOC 2 Type II", header: true, scope: "row" },
        { text: "Passed" },
        { text: "2026-02-15" }
      ],
      [
        { text: "ISO 27001", header: true, scope: "row" },
        { text: "In Progress" },
        { text: "2026-04-30" }
      ],
      [
        { text: "GDPR", header: true, scope: "row" },
        { text: "Compliant" },
        { text: "2026-03-01" }
      ]
    ],
    {
      x: 56,
      y: 690,
      width: 400,
      columnWidths: [140, 120, 140],
      headerRows: 1,
      headerColumns: 1,
      font,
      fontSize: 11
    }
  );

  section.text("Resources", {
    x: 56,
    y: 560,
    font,
    fontSize: 18,
    color: rgb(0.11, 0.2, 0.42),
    tag: "H2"
  });

  section.structure("P", (p) => {
    p.structure("Link", { altText: "Full audit reports" }, (link) => {
      link.text("View full audit reports: https://example.com/audit-reports", {
        x: 56,
        y: 525,
        font,
        fontSize: 10,
        color: rgb(0.11, 0.2, 0.42),
        tag: "Span"
      });
      link.link("https://example.com/audit-reports", {
        x: 56,
        y: 521,
        width: 320,
        height: 18,
        tag: "Link"
      });
    });
  });
});

const pdfBytes = doc.toUint8Array();

// Validate compliance
const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues found:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
} else {
  console.log("No compliance issues detected.");
}

// Round-trip: verify structure
const parsed = parseDocument(pdfBytes);
const elements = parsed.listStructureElements();
console.log(`\nStructure tree has ${elements.length} top-level element(s).`);

for (const el of elements) {
  console.log(`  ${el.role}`);
  if (el.children) {
    for (const child of el.children) {
      console.log(`    ${child.role}`);
    }
  }
}

await writeFile("examples/tagged-pdf.pdf", pdfBytes);
console.log("\nWrote examples/tagged-pdf.pdf");
