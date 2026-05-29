# Encryption and Signatures

Generated PDFs can be password-protected with permissions, and the parser/editor accept passwords for protected input. Detached PKCS#7/CMS digital signatures are supported with caller-supplied signing.

## Password protection

```ts
import { createDocument, parseDocument } from "@criston/sempdf";

const doc = createDocument({
  encryption: {
    algorithm: "aes-256",
    userPassword: "reader",
    ownerPassword: "owner-secret",
    permissions: {
      printing: false,
      modifying: false,
      copying: false,
      annotating: false
    }
  }
});

const bytes = doc.toUint8Array();
const parsed = parseDocument(bytes, { password: "reader" });
```

Algorithms: `"rc4-40"` (legacy compatibility), `"rc4-128"` (default), `"aes-128"`, `"aes-256"`.

## Metadata-Only Encryption

Encrypt document content but leave metadata (title, author, XMP) in plaintext so search engines and indexers can read it:

```ts
const doc = createDocument({
  encryption: {
    algorithm: "aes-256",
    userPassword: "reader",
    ownerPassword: "owner-secret",
    encryptMetadata: false
  }
});
```

## Permissions

| Flag | Meaning |
|------|---------|
| `printing` | Allow printing |
| `modifying` | Allow document modification |
| `copying` | Allow text/image copy |
| `annotating` | Allow annotation creation |
| `fillingForms` | Allow form fill |
| `accessibility` | Allow accessibility extraction |
| `assembling` | Allow page assembly |
| `highQualityPrinting` | Allow full-resolution print |

Omit `permissions` to grant all rights.

### Complete Permission Bits

All available permission flags used in full:

```ts
permissions: {
  printing: true,
  highQualityPrinting: false,
  modifying: true,
  copying: true,
  annotating: true,
  fillingForms: true,
  accessibility: true,
  assembling: false
}
```

## Cross-Version Encryption Upgrade

Call `setEncryption()` on an editable document to upgrade legacy RC4 encryption to AES:

```ts
const editable = editDocument(rc4Bytes, { password: "reader" });
editable.setEncryption({ algorithm: "aes-256", userPassword: "reader" });
const upgraded = editable.toUint8Array();
```

## Empty Password

An empty string `""` is a valid user password—useful when you only want an owner password to restrict permissions:

```ts
encryption: {
  algorithm: "aes-256",
  userPassword: "",
  ownerPassword: "admin-secret"
}
```

Readers can open the PDF without entering a password, but permissions are enforced.

## Certificate-Based Encryption

Encrypt for specific recipients using X.509 certificates:

```ts
import { readFileSync } from "node:fs";

const cert = readFileSync("recipient.pem");
const doc = createDocument({
  encryption: doc.encryptForRecipients([cert], {
    permissions: { printing: true, modifying: false }
  })
});
```

## Default Permissions for Missing /P

PDFs missing the `/P` permissions entry are handled gracefully—the library defaults to granting all rights when no permissions dictionary is present.

## Editing protected PDFs

`editDocument` accepts `{ password }` and re-encrypts with the original parameters when serializing:

```ts
const editable = editDocument(protectedBytes, { password: "reader" });
editable.updateInfo({ title: "Revised" });
const updated = editable.toUint8Array();
```

## Detached signatures

Generate a `/ByteRange` and let your signing code produce the CMS blob:

```ts
const signed = createDocument({
  signature: {
    fieldName: "approval",
    reason: "Approved for release",
    location: "Berlin",
    contactInfo: "ops@example.com",
    sign: (byteRange) => signDetachedCms(byteRange)
  }
});

signed.addPage().text("Print proof", { x: 56, y: 760 });
const bytes = signed.toUint8Array();
```

`sign` receives the bytes covered by `/ByteRange` and must return a DER-encoded CMS `SignedData` value. Use Node `crypto`, `node-forge`, or any PKCS#7 toolkit. The serializer pads `/Contents` to fit the returned blob.
