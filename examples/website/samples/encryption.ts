import { createDocument, rgb } from "@zeropdf/zeropdf-pdf";

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

const page = doc.addPage({ size: "A4" });
page.text("Confidential", { x: 56, y: 760, fontSize: 28, color: rgb(0.6, 0.1, 0.1) });
page.text("This PDF was AES-256 encrypted client-side.", { x: 56, y: 730, fontSize: 12 });
page.text("Open password: reader", { x: 56, y: 706, fontSize: 12 });

export default doc;
