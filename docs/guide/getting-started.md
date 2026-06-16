# Getting Started

The package is published to a private registry. Point the `@barrierbreak` scope at it
once, in your project's `.npmrc` (public npm stays untouched for every other package):

```ini
@barrierbreak:registry=https://npm.barrierbreak.net
```

Then install in a TypeScript project:

```sh
npm i @barrierbreak/a11ydocs-pdf
```

Create a document, add a page, write content, and serialize the result:

```ts
import { createDocument, rgb } from "@barrierbreak/a11ydocs-pdf";

const doc = createDocument({
  title: "Hello PDF",
  info: {
    author: "zeropdf"
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
import { createDocument, mm, rgb } from "@barrierbreak/a11ydocs-pdf";

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
- **Top-left origin** — see [Coordinate system](#coordinate-system) below.

## Coordinate system

All positions and sizes are in **points** (1 pt = 1/72 inch). By default the origin is the **bottom-left** corner and `y` grows **upward** — the native PDF convention. So on an A4 page (842 pt tall) `y: 800` is near the top and `y: 40` is near the bottom.

If you prefer the screen/CSS convention where `y` grows **downward** from the top, pass `origin: "top-left"` when creating the page:

```ts
const page = doc.addPage({ size: "A4", origin: "top-left" });
page.text("Near the top", { x: 56, y: 56 });   // 56 pt down from the top edge
page.rect(56, 100, 200, 80, { stroke: "navy" }); // y is the box's top edge
```

With `origin: "top-left"`:

- For text, `y` is the baseline distance from the top.
- For boxes and images (`rect`, `image`, `path` rectangles), `y` is the **top** edge.
- Lines, circles, and ellipses flip their `y`/`cy` coordinates accordingly.

This applies to the page drawing methods (`text`, `textBlock`, `richText`, `rect`, `line`, `circle`, `ellipse`, `image`, `path`) **and** the annotation and form-field methods (`link`, `highlight`, `note`, `freeText`, `textField`, `checkBox`, `choiceField`, `radioGroup`, `pushButton`, `signatureField`). The flow/template layout APIs always use bottom-left coordinates. Use the [unit helpers](#convenience-helpers) (`mm`/`cm`/`inch`) with either origin.

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
} from "@barrierbreak/a11ydocs-pdf";
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
