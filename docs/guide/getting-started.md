# Getting Started

Install the package in a TypeScript project:

```sh
npm install sempdf
```

Create a document, add a page, write content, and serialize the result:

```ts
import { createDocument, rgb } from "sempdf";

const doc = createDocument({
  title: "Hello PDF",
  info: {
    author: "sempdf"
  }
});

const page = doc.addPage({ size: "A4" });

page.text("Hello from TypeScript", {
  x: 56,
  y: 780,
  fontSize: 18,
  color: rgb(0.13, 0.2, 0.34)
});

page.textBlock("Wrapped copy with predictable line breaks.", {
  x: 56,
  y: 740,
  width: 240,
  fontSize: 12,
  lineHeight: 16,
  align: "center"
});

const bytes = doc.toUint8Array();
```

The library returns standard binary data, so you can write the bytes in Node.js, upload them, or create a `Blob` in the browser.

## Common imports

```ts
import {
  appendPages,
  createDocument,
  editDocument,
  extractPages,
  mergeDocuments,
  parseDocument,
  rgb,
  splitDocument
} from "sempdf";
```

## Local examples

This repo includes executable examples:

```sh
npm run example:hello
npm run example:image
npm run example:png
npm run example:tagged
npm run example:web
```

The browser demo runs at `http://localhost:4173/` after `npm run example:web`.
