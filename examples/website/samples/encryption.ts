import { createDocument, rgb } from "@barrierbreak/sempdf-pdf";

// AES encryption runs entirely in the browser — no server round-trip. When
// node:crypto is unavailable the library uses a built-in, zero-dependency
// AES/SHA-2 implementation whose output matches Node byte-for-byte, so the
// password works in any reader.
//
// This document is encrypted as the playground serializes it. Open the
// downloaded PDF and you will be prompted for the password below.
const doc = createDocument({
  title: "Encrypted in the Browser",
  language: "en-US",
  encryption: {
    algorithm: "aes-256-r6", // PDF 2.0 hardened key derivation (recommended)
    userPassword: "reader",   // password required to open
    ownerPassword: "owner-secret",
    permissions: {
      printing: true,
      copying: false,
      modifying: false
    }
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 56 },
  blocks: [
    {
      type: "heading",
      text: "Confidential",
      options: { level: 1, fontSize: 28, color: rgb(0.6, 0.1, 0.1) }
    },
    {
      type: "paragraph",
      text: "This PDF was AES-256 encrypted client-side.",
      options: { fontSize: 12 }
    },
    {
      type: "paragraph",
      text: "Open password: reader",
      options: { fontSize: 12 }
    }
  ]
});

export default doc;
