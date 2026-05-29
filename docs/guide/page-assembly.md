# Page Assembly

Page transfer helpers cover extract, split, merge, and append workflows without serializing through the document API.

```ts
import {
  appendPages,
  extractPages,
  mergeDocuments,
  splitDocument
} from "@criston/zeropdf";
```

## Extract

Pull specific pages into a new PDF. Indexes are zero-based.

```ts
const firstAndThird = extractPages(sourceBytes, [0, 2]);
```

## Split

Split a PDF into multiple documents. Pass page-index ranges to control grouping; omit to split per page.

```ts
const perPage = splitDocument(sourceBytes);
const sections = splitDocument(sourceBytes, [[0, 1], [2, 3], [4, 9]]);
```

Each entry is `[startInclusive, endInclusive]`.

## Merge

Concatenate documents in order. Resources, fonts, and images are renumbered to avoid collisions.

```ts
const combined = mergeDocuments([coverBytes, bodyBytes, appendixBytes]);
```

## Append

Append selected pages from a source onto a base document.

```ts
const withAppendix = appendPages(baseBytes, sourceBytes, [0, 1]);
```

Omit the index list to append every page from the source.

## Editor-based reordering

For metadata-preserving in-place reorder, use `editDocument`:

```ts
import { editDocument } from "@criston/zeropdf";

const editable = editDocument(bytes);
editable.movePage(2, 0);
editable.removePage(1);
const newPage = editable.insertPage(1);
newPage.text("Inserted", { x: 48, y: 780 });

const updated = editable.toUint8Array();
```

Tagged and PDF/A-conformance documents support a safe incremental subset: metadata/XMP updates, overlay edits on existing pages, and appending new compliant pages. Reorder/remove/mid-insert and form flattening on those documents are blocked until full structure-tree-safe editing lands.
