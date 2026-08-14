---
title: "Security Hardening"
---

Threat model, encryption best practices, signature trust considerations, and guidance for handling untrusted PDFs.

## Threat model

### What encryption protects

Password-based PDF encryption (Standard Security Handler, ISO 32000 §7.6) protects **content at rest** — the serialized PDF bytes. When a document is encrypted with a user password:

- Stream and string content is encrypted with a document key derived from the password
- Metadata (object structure, page count, font names) is NOT encrypted — only content streams and strings
- An attacker with the encrypted bytes but without the password cannot read text, extract images, or view embedded data

### What encryption does NOT protect

- **Password in transit**: The password must be communicated to the recipient through a separate channel
- **Password brute-force**: Short or common passwords are vulnerable to offline cracking (especially rc4-40/rc4-128)
- **Content before encryption**: The library works in memory; if the host process is compromised, plaintext content is exposed
- **Metadata visibility**: Page count, object structure, font names, and document outlines remain readable in encrypted PDFs
- **Evil maid attacks**: An attacker with write access to the file can swap ciphertext or modify metadata

### Threat actors relevant to this library

| Actor | Capability | Mitigation |
|-------|-----------|------------|
| Casual observer | Opens PDF in viewer | Password protection |
| Network eavesdropper | Intercepts file in transit | TLS for transport; encryption for file |
| Recipient with bad intent | Has password, wants to modify | Digital signature or owner password for modify restrictions |
| Malicious input (untrusted PDF) | Provides crafted PDF for parsing/editing | Validate input; see [Parsing untrusted PDFs](#parsing-untrusted-pdfs) |
| Host compromise | Has access to process memory | Out of scope — this library is not a sandbox |

## Password recommendations

### Algorithm selection

```ts
// Preferred: AES-256
createDocument({
  encryption: {
    algorithm: "aes-256",
    userPassword: process.env.PDF_ENCRYPTION_KEY!,
    permissions: { /* ... */ }
  }
});

// Legacy compatibility only
createDocument({
  encryption: {
    algorithm: "rc4-128",
    userPassword: "legacy-minimum",
    permissions: { /* ... */ }
  }
});
```

| Algorithm | Recommendation |
|-----------|---------------|
| `aes-256` | **Preferred.** Current best practice for password-protected PDFs. Supports PDF 1.7+. |
| `aes-256-r6` | PDF 2.0 encryption. Use when targeting PDF 2.0 exclusively. |
| `aes-128` | Acceptable. Available since PDF 1.6. |
| `rc4-128` | Legacy. Use only when compatibility with very old viewers is required (PDF 1.4–1.5). |
| `rc4-40` | Deprecated. Avoid unless no alternative is possible. Export-restricted algorithm with 40-bit effective key. |

### Password strength

Derive passwords from a cryptographically secure random source with at least 128 bits of entropy:

```ts
import { randomBytes } from "node:crypto";

// Good: 128 bits of entropy
const password = randomBytes(16).toString("hex");
// e.g., "a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5"
```

Avoid:
- Dictionary words
- Sequential numbers (`"invoice-001"`, `"invoice-002"`)
- Hardcoded passwords in source code
- Passwords derived from document metadata (title, author, date)

### Key management

Never store passwords alongside encrypted PDFs. Use a key management service (KMS), environment variables, or a secrets manager:

```ts
// ✅ Environment variable (reads once at startup)
const password = process.env.PDF_ENCRYPTION_KEY;

// ✅ Secrets manager
import { getSecret } from "./secrets.js";
const password = await getSecret("pdf-encryption-key");

// ❌ Hardcoded
const password = "SuperSecret123";

// ❌ Derived from document metadata (predictable)
const password = doc.info.title?.toLowerCase().replace(/\s/g, "-");
```

### Permissions

Set the minimum permissions necessary:

```ts
encryption: {
  algorithm: "aes-256",
  userPassword: "secret-key",
  permissions: {
    printing: true,              // Allow printing
    modifying: false,            // Prevent editing
    copying: false,              // Prevent text/image extraction
    annotating: false,           // Prevent annotation
    fillingForms: false,         // Prevent form fill
    accessibility: true,         // Allow accessibility tools
    assembling: false,           // Prevent page insertion/deletion
    highQualityPrinting: false  // Downgrade print to low-res
  }
}
```

Permissions are enforced by the PDF viewer, not cryptographically. A malicious viewer can ignore them. Permissions only protect against accidental misuse by compliant viewers.

## Digital signatures

### How signatures work in this library

The library generates the `/ByteRange` — the exact byte range of the PDF that the signature covers — and calls your `sign` function to produce the CMS/PKCS#7 signature blob. The serializer then reserves space for the signature value and inserts it at the correct byte offset.

```ts
createDocument({
  signature: {
    fieldName: "approval",
    reason: "Document approved",
    location: "San Francisco",
    contactInfo: "security@example.com",
    sign: (byteRange) => {
      // byteRange is a Uint8Array of the bytes to sign
      return signWithPrivateKey(byteRange, privateKey);
    }
  }
});
```

### Trust model

The library does NOT verify signatures. It provides the mechanism to create them. Trust is established by:

1. **Signer identity**: The private key used to sign must be protected
2. **Certificate chain**: Embed the signer's X.509 certificate chain in the CMS blob
3. **Timestamp**: Include a trusted timestamp token (TST) in the `UnsignedAttributes` of the CMS `SignerInfo`
4. **Long-term validation (LTV)**: For archival, include CRLs or OCSP responses and timestamps in the document security store (DSS)

### Security considerations

- **Private key protection**: The `sign` callback receives raw bytes — it is your responsibility to keep the signing key secure (HSM, KMS, secured environment)
- **Byte range stability**: Do not modify the document after signing. The `/ByteRange` covers a specific range; any subsequent edit invalidates the signature
- **No signature verification API**: This library does not verify signatures on parsed documents. Use a dedicated PDF signature validator (e.g., Adobe Acrobat, iText, or custom code) if verification is needed
- **One signature per document**: The library supports a single detached signature. Multiple signatures (sequential signing) is not supported

### Example: signing with Node.js crypto

```ts
import { createSign, createPrivateKey } from "node:crypto";

const privateKey = createPrivateKey({
  key: readFileSync("private-key.pem"),
  passphrase: process.env.KEY_PASSPHRASE
});

const doc = createDocument({
  signature: {
    fieldName: "approval",
    reason: "Approved for release",
    sign: (byteRange) => {
      const signer = createSign("SHA256");
      signer.update(Buffer.from(byteRange));
      return signer.sign(privateKey);
    }
  }
});
```

## Parsing untrusted PDFs

### Risks

When you parse or edit a PDF from an untrusted source:

1. **Malformed xref tables**: Can point to arbitrary offsets, causing out-of-bounds reads during parsing. The parser validates offset ranges and rejects out-of-bounds references.
2. **Infinite loops**: Recursive or self-referencing object graphs can cause unbounded CPU consumption during traversal.
3. **Large streams**: Embedded streams (images, fonts) with declared sizes much larger than actual data can cause memory exhaustion.
4. **Cryptographic padding oracle**: RC4-based encryption modes (rc4-40, rc4-128) are stream ciphers — a malicious PDF encrypted with a known password could be crafted to exploit RC4 biases. Use AES modes where possible.
5. **JavaScript injection**: PDFs can contain embedded JavaScript. This library does NOT execute JavaScript, but if you subsequently open the PDF in a viewer that does, embedded JS runs with the viewer's privileges.

### Defenses

| Risk | Library behavior | Additional hardening |
|------|-----------------|---------------------|
| Malformed xref | Validates offsets; rejects out-of-bounds references | — |
| Large streams | Allocates based on declared size | Set a maximum file size gate before parsing |
| Infinite loops | No recursion in parser; iterative traversal | Setting a timeout on parse operations |
| RC4 weaknesses | — | Use `aes-256` encryption; avoid rc4-40 |
| JavaScript | Library ignores `/JS` entries | Examine parsed document for `/AA` (additional actions) or `/OpenAction` with JavaScript |

### Pre-parse validation

```ts
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

async function safeParse(input: Uint8Array) {
  if (input.length > MAX_FILE_SIZE) {
    throw new Error("PDF exceeds maximum allowed size");
  }

  if (input.length < 5 || !startsWithPdfHeader(input)) {
    throw new Error("Not a valid PDF header");
  }

  return parseDocument(input);
}

function startsWithPdfHeader(bytes: Uint8Array): boolean {
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  return header === "%PDF-";
}
```

### After parsing

Inspect the parsed metadata before passing the document downstream:

```ts
const parsed = parseDocument(untrustedBytes);

// Check for JavaScript actions
if (parsed.metadata?.openAction) {
  throw new Error("PDF contains an open action — rejected");
}

// Check encryption (you need the password to read content)
if (parsed.metadata?.encrypted && !passwordProvided) {
  throw new Error("PDF is encrypted — password required");
}
```

## Environment hardening

### Node.js

- Run PDF generation in a worker thread or child process with limited memory
- Set `--max-old-space-size` to cap heap usage for bulk generation
- Never log password values or encryption keys

### Browser

- PDF content is generated in the main thread — large documents will block the UI. Use a Web Worker for generation.
- Never store passwords in `localStorage` or `sessionStorage` in plaintext
- Be aware that browser extensions can intercept `Uint8Array` content

## See also

- [Encryption and Signatures](/guide/encryption-and-signatures) — API reference for encryption and digital signatures
- [Edit Existing PDFs](/guide/edit-existing-pdfs) — parsing and editing workflows
- [PDF Versions and Conformance](/guide/pdf-versions-and-conformance) — conformance profiles
