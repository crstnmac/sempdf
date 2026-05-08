import { writeFile } from "node:fs/promises";

import { createDocument, parseDocument } from "../src/index.js";

// PDF 2.0 (ISO 32000-2) AES-256 R=6 encryption.
// Emits %PDF-2.0 header + V=5/R=6 + OE/UE/Perms entries.
// Uses Algorithm 2.B (SHA-256/384/512 + AES-128-CBC) and SASLprep on passwords.

const doc = createDocument({
  info: { title: "PDF 2.0 Encrypted Sample" },
  encryption: {
    algorithm: "aes-256-r6",
    userPassword: "reader",
    ownerPassword: "owner",
    permissions: { printing: true, copying: false, modifying: false, annotating: false }
  }
});

doc.addPage({ size: "A4" }).text("PDF 2.0 secret content", { x: 72, y: 780, fontSize: 16 });

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
