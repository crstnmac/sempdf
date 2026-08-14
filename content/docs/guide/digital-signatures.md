---
title: "Digital Signatures"
---

sempdf prepares the PDF structure for a detached digital signature — the `/Sig`
field, the `/ByteRange`, and a padded `/Contents` placeholder — and calls back
into your code for the actual cryptography. Because the engine is
zero-dependency, it never bundles a signing toolkit: you supply the CMS/PKCS#7
`SignedData` blob using Node's `crypto`, `node-forge`, or any PKI library.

The signature is always **detached** (`/SubFilter /adbe.pkcs7.detached`): the
`/Contents` field holds the CMS blob, and `/ByteRange` covers every byte of the
file except that blob.

## How signing works

1. You call `createDocument({ signature })` or `doc.sign(options)`.
2. At serialize time the engine reserves an empty `/Contents` placeholder and
   writes a `/ByteRange` covering the file around it.
3. The engine invokes your `sign` callback with the exact bytes spanned by
   `/ByteRange`.
4. Your callback returns a DER-encoded CMS `SignedData` value.
5. The engine hex-encodes the blob into `/Contents`, padding to the reserved
   width.

Your callback owns the private key and certificate chain — the engine never
sees them.

## Signing a new document

Pass `signature` to `createDocument`. The signature is applied when you
serialize.

```ts
import { createDocument } from "@crstnmac/sempdf";

const signed = createDocument({
  signature: {
    fieldName: "approval",
    reason: "Approved for release",
    location: "Berlin",
    contactInfo: "ops@example.com",
    name: "Criston Mascarenhas",
    placeholderBytes: 8192,
    sign: (byteRange) => signDetachedCms(byteRange),
  },
});

signed.addPage().text("Print proof", { x: 56, y: 760 });
const bytes = signed.toUint8Array();
```

### Options

| Option            | Purpose                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `sign`            | **Required.** `(bytes) => Uint8Array` returning the CMS blob.      |
| `fieldName`       | Signature form-field name recorded in the AcroForm.               |
| `reason`          | Reason string stored in the signature dictionary.                 |
| `location`        | Signing location.                                                 |
| `contactInfo`     | Signer contact information.                                        |
| `name`            | Signer / item name.                                               |
| `placeholderBytes`| Reserved hex width for `/Contents`. Must fit the full CMS blob.   |

## Signing an existing PDF (incremental update)

`doc.sign()` appends the signature as an **incremental update** — the original
bytes are preserved and a new cross-reference section is written with `/Prev`
pointing at the previous one. This keeps any earlier signatures valid.

```ts
import { editDocument } from "@crstnmac/sempdf";

const editable = editDocument(existingPdfBytes);
editable.sign({
  fieldName: "incremental-approval",
  reason: "Counter-signed",
  placeholderBytes: 8192,
  sign: (byteRange) => signDetachedCms(byteRange),
});

const signedBytes = editable.toUint8Array();
```

## Implementing the `sign` callback

The callback receives the bytes covered by `/ByteRange` and must return a
DER-encoded CMS `SignedData` value. Below is a minimal detached signer built on
[`node-forge`](https://www.npmjs.com/package/node-forge), which produces a
standards-compliant PKCS#7 blob from a PEM key and certificate.

```ts
import forge from "node-forge";

function makeSigner(certPem: string, keyPem: string) {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

  return (byteRange: Uint8Array): Uint8Array => {
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(
      Buffer.from(byteRange).toString("binary"),
    );
    p7.addCertificate(cert);
    p7.addSigner({
      key,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: new Date() as any },
      ],
    });
    // `true` = detached: omit the content from the CMS structure.
    p7.sign({ detached: true });

    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return Uint8Array.from(der, (c) => c.charCodeAt(0));
  };
}
```

Wire it in:

```ts
const sign = makeSigner(certPem, keyPem);
const signed = createDocument({ signature: { fieldName: "approval", sign } });
```

For PKCS#12 (`.p12` / `.pfx`) bundles, decode with
`forge.pkcs12.pkcs12FromAsn1` to extract the key and certificate chain, then add
every chain certificate with `p7.addCertificate(...)` so verifiers can build a
path to the trust anchor.

## Sizing `placeholderBytes`

`placeholderBytes` reserves hex width for the signature. If your CMS blob is
larger than the reservation, serialization fails. A bare self-signed SHA-256
signature is small, but real signatures grow with the certificate chain and any
embedded RFC 3161 timestamp.

- Lone self-signed cert: ~2 KB is plenty.
- Full chain + timestamp: budget **8–16 KB**.

Reserving more than you need is harmless — the unused space is zero-padded. When
in doubt, set `placeholderBytes: 16384`.

## Adding a visible signature field

Signing populates an invisible signature dictionary. To draw a visible "sign
here" widget on a page, add a signature field placeholder, then sign with the
matching `fieldName`.

```ts
const page = doc.addPage();
page.signatureField("approval", { x: 36, y: 600, width: 180, height: 36 });
```

## Verifying output

Any conformant reader (Adobe Acrobat, the `pdfsig` tool from Poppler) can
validate the result:

```sh
pdfsig signed.pdf
```

A self-signed certificate validates cryptographically but is reported as
untrusted unless its CA is added to the reader's trust store.

## Notes and limits

- Only detached PKCS#7/CMS (`adbe.pkcs7.detached`) is emitted.
- The engine does **not** generate keys, build CMS, or contact a timestamp
  authority — those live entirely in your `sign` callback.
- Signing an encrypted document signs the encrypted bytes; supply the password
  to `editDocument` first. See [Encryption and Signatures](/guide/encryption-and-signatures).
