# Getting Started

The package is published to a private registry. Point the `@criston` scope at it
once, in your project's `.npmrc` (public npm stays untouched for every other package):

```ini
@criston:registry=https://nodeproxy.criston.dev
```

Then install in a TypeScript project:

```sh
npm i @criston/sempdf
```

Create a document, add a page, write content, and serialize the result:

```ts
import { createDocument, rgb } from "@criston/sempdf";

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

## Convenience helpers

A few options keep call sites short:

```ts
import { createDocument, mm, rgb } from "@criston/sempdf";

// Document-wide text defaults: fill in font/size/color so calls stay terse.
const doc = createDocument({
  defaults: { font: "Helvetica", fontSize: 12, color: rgb(0.1, 0.1, 0.1) }
});

// Author in physical units (mm/cm/inch) instead of raw points.
// Page builder methods are chainable.
doc.addPage({ size: "A4" })
  .text("Title", { x: mm(20), y: mm(270), fontSize: 18, bold: true })
  .text("Body copy uses the document defaults.", { x: mm(20), y: mm(258) });

// Node.js shortcut for writing to disk (alias of writeToFile).
await doc.save("out.pdf");
```

- **Units** — `mm()`, `cm()`, `inch()`, and `pt()` convert to PDF points.
- **`bold` / `italic`** — resolve to the right font face. See [Text and Fonts](./text-and-fonts).
- **`defaults`** — document-wide `font`, `fontSize`, `color`, `kerning`, `direction`, overridden per call.
- **Chaining** — page builder methods return the page, so calls compose.
- **`doc.save(path)`** — Node-only; in the browser use `toUint8Array()` or `toBlob()`.

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
} from "@criston/sempdf";
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
