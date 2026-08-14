import { writeFile } from "node:fs/promises";

import forge from "node-forge";

import { createDocument, editDocument, parseDocument } from "../src/index.js";

// ---------------------------------------------------------------------------
// 1. Produce a self-signed certificate so the example runs with no setup.
//    In production you would load a real key + certificate chain instead.
// ---------------------------------------------------------------------------
function generateSelfSignedCert(): {
  cert: forge.pki.Certificate;
  key: forge.pki.PrivateKey;
} {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: "commonName", value: "ZeroPDF Demo Signer" },
    { name: "organizationName", value: "ZeroPDF" },
    { name: "countryName", value: "US" }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return { cert, key: keys.privateKey };
}

// ---------------------------------------------------------------------------
// 2. Build the `sign` callback. It receives the bytes spanned by /ByteRange
//    and must return a DER-encoded CMS (PKCS#7) detached SignedData value.
// ---------------------------------------------------------------------------
function makeDetachedSigner(
  cert: forge.pki.Certificate,
  key: forge.pki.PrivateKey
): (byteRange: Uint8Array) => Uint8Array {
  return (byteRange) => {
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(
      Buffer.from(byteRange).toString("binary")
    );
    p7.addCertificate(cert);
    p7.addSigner({
      key: key as forge.pki.rsa.PrivateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256!,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType!, value: forge.pki.oids.data! },
        { type: forge.pki.oids.messageDigest! },
        { type: forge.pki.oids.signingTime!, value: new Date().toString() }
      ]
    });
    // detached: the signed content lives in the PDF, not inside the CMS blob.
    p7.sign({ detached: true });

    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return Uint8Array.from(der, (char) => char.codePointAt(0)!);
  };
}

// ---------------------------------------------------------------------------
// 3. Create an "existing" PDF to stand in for a document you already have.
// ---------------------------------------------------------------------------
const original = createDocument({ title: "Quarterly Report" });
original
  .addPage()
  .text("Quarterly Report - Q2 2026", { x: 56, y: 760, fontSize: 18 })
  .text("Prepared by the finance team.", { x: 56, y: 730, fontSize: 11 });
const existingPdf = original.toUint8Array();

// ---------------------------------------------------------------------------
// 4. Load the existing PDF and sign it as an incremental update. The original
//    bytes are preserved; a new xref section with /Prev is appended, so any
//    earlier signatures stay valid.
// ---------------------------------------------------------------------------
const { cert, key } = generateSelfSignedCert();

const editable = editDocument(existingPdf);
editable.sign({
  fieldName: "approval",
  reason: "Approved for distribution",
  location: "Berlin",
  contactInfo: "finance@example.com",
  name: "ZeroPDF Demo Signer",
  // Reserve hex room for the full CMS blob (cert chain + signature).
  placeholderBytes: 16384,
  sign: makeDetachedSigner(cert, key)
});

const signedPdf = editable.toUint8Array();
await writeFile("examples/cookbook-sign-existing-pdf.pdf", signedPdf);

// ---------------------------------------------------------------------------
// 5. Confirm the signature field landed in the AcroForm.
// ---------------------------------------------------------------------------
const parsed = parseDocument(signedPdf);
const sigField = parsed
  .listFormFields()
  .find((field) => field.name === "approval" && field.fieldType === "Sig");

console.log("Wrote examples/cookbook-sign-existing-pdf.pdf");
console.log(`  signature field present: ${sigField !== undefined}`);
console.log(`  signed size: ${signedPdf.length} bytes`);
console.log("  verify with: pdfsig examples/cookbook-sign-existing-pdf.pdf");
