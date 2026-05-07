# Encryption and Signatures

Generated PDFs can be password-protected with permissions, and the parser/editor accept passwords for protected input. Detached PKCS#7/CMS digital signatures are supported with caller-supplied signing.

## Password protection

```ts
import { createDocument, parseDocument } from "pdf-editing-lib";

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
