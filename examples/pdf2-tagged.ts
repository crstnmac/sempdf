import { writeFile } from "node:fs/promises";

import { createDocument, parseDocument, validatePdf2Conformance } from "../src/index.js";

// Tagged PDF 2.0 with /Namespaces array on StructTreeRoot, per-element /NS,
// and synthesized base14 ToUnicode CMap on built-in Type1 fonts.
// 2.0 is reached because the document is encrypted with AES-256 R=6.

const doc = createDocument({
  info: { title: "Tagged PDF 2.0 Sample" },
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  encryption: {
    algorithm: "aes-256-r6",
    userPassword: "reader",
    ownerPassword: "owner"
  }
});

const page = doc.addPage({ size: "A4" });
page.text("Tagged 2.0 Heading", { x: 72, y: 780, fontSize: 18, tag: "H1" });
page.text("Body paragraph with structure tagging.", { x: 72, y: 750, fontSize: 11, tag: "P" });

const bytes = doc.toUint8Array();
await writeFile(new URL("./pdf2-tagged.pdf", import.meta.url), bytes);

// Header, audit, and structure check.
const header = new TextDecoder().decode(bytes.slice(0, 16)).split("\n")[0];
console.log(`Header: ${header}`);

const parsed = parseDocument(bytes, { password: "reader" });
console.log(`Tagged: ${parsed.isTagged()}`);
console.log(`Effective version: ${parsed.getEffectiveVersion()}`);
console.log(`Structure roles: ${parsed.listStructureElements().map((e) => e.role).join(", ")}`);

const issues = validatePdf2Conformance(parsed);
console.log(`PDF 2.0 audit issues: ${issues.length === 0 ? "none" : issues.map((i) => i.message).join("; ")}`);
