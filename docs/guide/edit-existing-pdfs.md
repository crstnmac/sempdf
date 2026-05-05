# Edit Existing PDFs

Use `parseDocument` when you need to inspect a PDF and `editDocument` when you need to produce an incremental update.

```ts
import { editDocument, parseDocument } from "pdf-editing-lib";

const parsed = parseDocument(existingBytes);

console.log(parsed.version);
console.log(parsed.pages.length);
console.log(parsed.formFields);

const editable = editDocument(existingBytes);
editable.setInfo({ title: "Updated document" });
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
} from "pdf-editing-lib";

const firstPageOnly = extractPages(sourceBytes, [0]);
const combined = mergeDocuments([coverBytes, bodyBytes, appendixBytes]);
const sections = splitDocument(sourceBytes, [[0, 1], [2, 3]]);
const withAppendix = appendPages(sourceBytes, appendixBytes);
```

## Encrypted PDFs

Generated PDFs can be password protected, and parser/editing workflows can accept a password when reading protected input.

```ts
import { createDocument, parseDocument } from "pdf-editing-lib";

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
