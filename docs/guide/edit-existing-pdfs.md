# Edit Existing PDFs

Use `parseDocument` when you need to inspect a PDF and `editDocument` when you need to produce an incremental update.

```ts
import { editDocument, parseDocument } from "@sempdf/sempdf-pdf";

const parsed = parseDocument(existingBytes);

console.log(parsed.version);
console.log(parsed.listPages().length);
console.log(parsed.listFormFields());

const editable = editDocument(existingBytes);
editable.updateInfo({ title: "Updated document" });
editable.setFieldValue("status", "approved");

const updatedBytes = editable.toUint8Array();
```

## Page workflows

The page transfer helpers cover common document assembly tasks:

```ts
import {
  appendPages,
  extractPages,
  mergeDocuments,
  splitDocument
} from "@sempdf/sempdf-pdf";

const firstPageOnly = extractPages(sourceBytes, [0]);
const combined = mergeDocuments([coverBytes, bodyBytes, appendixBytes]);
const perPage = splitDocument(sourceBytes); // one single-page PDF per page
const withAppendix = appendPages(sourceBytes, appendixBytes);
```

## Encrypted PDFs

Generated PDFs can be password protected, and parser/editing workflows can accept a password when reading protected input.

```ts
import { createDocument, parseDocument } from "@sempdf/sempdf-pdf";

const protectedDoc = createDocument({
  encryption: {
    algorithm: "rc4-128",
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

const bytes = protectedDoc.toUint8Array();
const parsed = parseDocument(bytes, { password: "reader" });
```

## Content Stream Overlay

`writePageContent()` lets you inject raw content stream operators onto an existing page without altering the original objects. The mode controls placement:

```ts
const editable = editDocument(sourceBytes);

editable.writePageContent(0, "1 0 0 rg 72 72 100 100 re f", "append");
editable.writePageContent(0, "q BT /F1 12 Tf 72 700 Td (Overlay) Tj ET Q", "prepend");
```

| Mode | Behavior |
|------|----------|
| `"append"` | Add operators after the existing page content (default) |
| `"prepend"` | Insert operators before the existing page content |
| `"replace"` | Replace the entire content stream with the provided content |

## Xref Recovery

When `parseDocument` encounters a damaged or missing cross-reference table, it automatically attempts reconstruction by scanning the file for object markers. This handles cases where the `startxref` pointer is invalid or xref entries point to wrong offsets.

No additional API call is needed — the recovery runs transparently during `parseDocument()`.

## Repair Warnings

Call `getRepairWarnings()` after parsing to inspect what the xref recovery fixed:

```ts
const parsed = parseDocument(bytes);
const warnings = parsed.getRepairWarnings();
for (const w of warnings) {
  console.log(`[${w.objectNumber}] ${w.message}`);
}
```

Each warning includes the affected object number and a description of the repair.

## Encrypted PDF without Permissions

If an encrypted PDF omits the permissions (`/P`) entry, the parser defaults to granting all permissions (print, modify, copy, annotate, etc.). This ensures the document is editable without needing an owner password.
