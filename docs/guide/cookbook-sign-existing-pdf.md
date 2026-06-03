# Cookbook: Sign an Existing PDF

Load a PDF you already have and apply a detached PKCS#7/CMS digital signature as
an incremental update with `editDocument().sign()`. The original bytes are
preserved and a new cross-reference section is appended, so any earlier
signatures stay valid.

This example is self-contained: it generates a throwaway self-signed
certificate with [`node-forge`](https://www.npmjs.com/package/node-forge) so it
runs with no setup. In production you would load a real key and certificate
chain instead. sempdf ships zero runtime dependencies — the CMS signer lives
entirely in your own code.

Run it with:

```sh
npm install --save-dev node-forge @types/node-forge
npm run example:cookbook-sign
```

See [Digital Signatures](./digital-signatures) for the full reference.

## The CMS signer

`sign` receives the bytes covered by `/ByteRange` and returns a DER-encoded CMS
`SignedData` value. `{ detached: true }` keeps the signed content in the PDF
rather than inside the blob.

```ts
import forge from "node-forge";

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
    p7.sign({ detached: true });

    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return Uint8Array.from(der, (char) => char.charCodeAt(0));
  };
}
```

## Sign the document

Load the existing bytes, then call `sign()`. Reserve enough `placeholderBytes`
for the full CMS blob — the certificate chain dominates the size; 16 KB is a
safe default.

```ts
import { editDocument } from "@criston/sempdf";

const editable = editDocument(existingPdfBytes);
editable.sign({
  fieldName: "approval",
  reason: "Approved for distribution",
  location: "Berlin",
  contactInfo: "finance@example.com",
  name: "SemPDF Demo Signer",
  placeholderBytes: 16384,
  sign: makeDetachedSigner(cert, key)
});

const signedPdf = editable.toUint8Array();
```

## Verify

Confirm the signature field landed:

```ts
import { parseDocument } from "@criston/sempdf";

const parsed = parseDocument(signedPdf);
const signed = parsed
  .listFormFields()
  .some((field) => field.name === "approval" && field.fieldType === "Sig");
```

Or validate the cryptography with Poppler's `pdfsig`:

```sh
pdfsig examples/cookbook-sign-existing-pdf.pdf
# Signature Type: adbe.pkcs7.detached
# Total document signed
# Signature Validation: Signature is Valid.
```

A self-signed certificate validates cryptographically but is reported as
untrusted (`Certificate issuer is unknown`) until its CA is added to the
reader's trust store.
