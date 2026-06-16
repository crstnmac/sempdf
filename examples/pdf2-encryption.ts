import { writeFile } from "node:fs/promises";
import { createDocument, parseDocument } from "../src/index.js";

// PDF 2.0 (ISO 32000-2) AES-256 R=6 encryption.
// Emits %PDF-2.0 header + V=5/R=6 + OE/UE/Perms entries.
// Uses Algorithm 2.B (SHA-256/384/512 + AES-128-CBC) and SASLprep on passwords.

const doc = createDocument({
  language: "en-US",
  info: { title: "PDF 2.0 Encrypted Sample" },
  encryption: {
    algorithm: "aes-256-r6",
    userPassword: "reader",
    ownerPassword: "owner",
    permissions: { printing: true, copying: false, modifying: false, annotating: false }
  }
});

doc.setXmpMetadata({
  title: "PDF 2.0 Encrypted Sample",
  creator: "a11ydocs",
  creatorTool: "a11ydocs",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "PDF 2.0 Encrypted Sample" },
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "PDF 2.0 Encrypted Document",
      options: { level: 1 }
    },
    {
      type: "paragraph",
      text: "This document is encrypted with AES-256-R6 (V=5/R=6) per ISO 32000-2. The encryption uses Algorithm 2.B with SHA-256/384/512 and AES-128-CBC for key derivation, plus SASLprep normalization on passwords.",
      options: { fontSize: 11, marginBottom: 14 }
    },
    {
      type: "heading",
      text: "Security",
      options: { level: 2 }
    },
    {
      type: "paragraph",
      text: "Printing is permitted. Copying, modifying, and annotating are restricted. This is the production encryption pattern for PDF 2.0 confidential documents.",
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
await writeFile(new URL("./pdf2-encryption.pdf", import.meta.url), bytes);

// Verify round-trip.
const header = new TextDecoder().decode(bytes.slice(0, 16)).split("\n")[0];
console.log(`Header: ${header}`);

const parsedAsUser = parseDocument(bytes, { password: "reader" });
console.log(`Pages (user pwd): ${parsedAsUser.getPageCount()}`);

const parsedAsOwner = parseDocument(bytes, { password: "owner" });
console.log(`Pages (owner pwd): ${parsedAsOwner.getPageCount()}`);

try {
  parseDocument(bytes, { password: "wrong" });
  console.log("UNEXPECTED: wrong password accepted");
} catch {
  console.log("Wrong password rejected (expected).");
}
