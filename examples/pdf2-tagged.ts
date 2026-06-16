import { writeFile } from "node:fs/promises";
import { createDocument, parseDocument, validatePdf2Conformance } from "../src/index.js";

// Tagged PDF 2.0 with /Namespaces array on StructTreeRoot, per-element /NS,
// and synthesized base14 ToUnicode CMap on built-in Type1 fonts.
// 2.0 is reached because the document is encrypted with AES-256 R=6.

const doc = createDocument({
  conformance: "pdfua-2",
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  encryption: {
    algorithm: "aes-256-r6",
    userPassword: "reader",
    ownerPassword: "owner"
  },
  info: { title: "Tagged PDF 2.0 Sample" }
});

doc.setXmpMetadata({
  title: "Tagged PDF 2.0 Sample",
  creator: "a11ydocs",
  creatorTool: "a11ydocs",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "Tagged PDF 2.0 Sample" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "Tagged PDF 2.0",
      options: { level: 1 }
    },
    {
      type: "paragraph",
      text: "This document demonstrates PDF 2.0 features with tagged structure, namespace support, and AES-256-R6 encryption. The structure tree includes proper heading and paragraph tags.",
      options: { fontSize: 11, marginBottom: 14 }
    },
    {
      type: "heading",
      text: "Structure Tagging",
      options: { level: 2 }
    },
    {
      type: "paragraph",
      text: "Body paragraph with structure tagging. All content is properly mapped to standard PDF structure elements for accessibility and semantic document processing.",
      options: { fontSize: 11 }
    }
  ]
});

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
}

const bytes = doc.toUint8Array();
await writeFile(new URL("./pdf2-tagged.pdf", import.meta.url), bytes);

// Header, audit, and structure check.
const header = new TextDecoder().decode(bytes.slice(0, 16)).split("\n")[0];
console.log(`Header: ${header}`);

const parsed = parseDocument(bytes, { password: "reader" });
console.log(`Tagged: ${parsed.isTagged()}`);
console.log(`Effective version: ${parsed.getEffectiveVersion()}`);
console.log(`Structure roles: ${parsed.listStructureElements().map((e) => e.role).join(", ")}`);

const auditIssues = validatePdf2Conformance(parsed);
console.log(`PDF 2.0 audit issues: ${auditIssues.length === 0 ? "none" : auditIssues.map((i) => i.message).join("; ")}`);
