import { writeFile } from "node:fs/promises";

import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  info: {
    title: "Structure Containers Demo",
    author: "pdf-editing-lib"
  }
});

doc.setXmpMetadata({
  title: "Structure Containers Demo",
  creator: "pdf-editing-lib",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "Structure Containers Demo", author: "pdf-editing-lib" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "Structure Containers & Tagged Content",
      options: { level: 1, color: hex("#1c2f6b") }
    },
    {
      type: "paragraph",
      text: "This document demonstrates how renderTemplate section blocks map to PDF structure containers. Each section wraps child blocks inside a tagged container element for accessible document navigation.",
      options: { fontSize: 11, marginBottom: 10 }
    },
    {
      type: "section",
      role: "Sect",
      blocks: [
        {
          type: "heading",
          text: "Section Container",
          options: { level: 2, color: hex("#1565c0") }
        },
        {
          type: "paragraph",
          text: "Structure containers group content into tagged <Sect> elements. Screen readers use this structure for document navigation and content hierarchy traversal.",
          options: { fontSize: 11, tag: "P" }
        },
        {
          type: "section",
          role: "Sect",
          structure: {
            language: "en-US",
            actualText: "Nested Subsection"
          },
          blocks: [
            {
              type: "heading",
              text: "Nested Subsection",
              options: { level: 3, color: hex("#2e7d32") }
            },
            {
              type: "paragraph",
              text: "Containers can be nested to build deep document hierarchies for complex, well-structured PDF content. Each nested section inherits and extends the logical structure tree.",
              options: {
                fontSize: 10,
                tag: "P",
                structure: {
                  language: "en-US",
                  actualText: "Nested subsection body text with accessibility metadata."
                }
              }
            }
          ]
        }
      ]
    },
    {
      type: "heading",
      text: "Custom Structure Roles",
      options: { level: 2, color: hex("#1565c0"), marginTop: 12 }
    },
    {
      type: "section",
      role: "Div",
      structure: {
        language: "en-US",
        actualText: "Note: Structure containers enable full control over the PDF logical structure tree for maximum accessibility."
      },
      blocks: [
        {
          type: "paragraph",
          text: "Note: Structure containers enable full control over the PDF logical structure tree for maximum accessibility. Use the structure option on individual blocks to attach metadata like alt text, language tags, or actual text replacement.",
          options: { fontSize: 10, tag: "Note" }
        }
      ]
    },
    {
      type: "section",
      role: "BlockQuote",
      blocks: [
        {
          type: "paragraph",
          text: "\u201CWell-structured PDFs are accessible to all.\u201D \u2014 PDF/UA",
          options: {
            fontSize: 11,
            tag: "P",
            color: hex("#555566"),
            structure: {
              language: "en-US",
              actualText: "Well-structured PDFs are accessible to all. \u2014 PDF/UA"
            }
          }
        }
      ]
    },
    {
      type: "heading",
      text: "Container with Table",
      options: { level: 2, color: hex("#1565c0"), marginTop: 12 }
    },
    {
      type: "section",
      role: "Sect",
      structure: {
        language: "en-US"
      },
      blocks: [
        {
          type: "paragraph",
          text: "Tables inside section blocks inherit the container's structure context. Table headers and cells are automatically tagged for screen-reader navigation.",
          options: { fontSize: 10, tag: "P", marginBottom: 6 }
        },
        {
          type: "table",
          rows: [
            [
              { text: "Item", header: true },
              { text: "Status", header: true },
              { text: "Notes", header: true }
            ],
            [
              { text: "Design", header: true, scope: "row" },
              "Complete",
              "Lead approved"
            ],
            [
              { text: "Development", header: true, scope: "row" },
              "In Progress",
              "Sprint 3"
            ],
            [
              { text: "Testing", header: true, scope: "row" },
              "Pending",
              "Starts Mon"
            ]
          ],
          options: {
            headerRows: 1,
            headerColumns: 1,
            fontSize: 9.5,
            width: 450
          }
        }
      ]
    }
  ]
});

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
} else {
  console.log("No compliance issues detected.");
}

await writeFile("examples/containers.pdf", doc.toUint8Array());
console.log("Wrote examples/containers.pdf");
console.log("  Containers: section blocks, structure options, nested containers, tagged content");
