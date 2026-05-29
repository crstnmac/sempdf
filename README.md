# zeropdf

Zero-dependency PDF generation engine written in TypeScript. Pure `Uint8Array`
output, PDF 1.4–2.0, embedded fonts and images, parsing and incremental editing,
forms, tagged/PDF-UA structure, encryption, and signing — Node and browser friendly.

## Install

The package is published to a private registry. Point the `@criston` scope at it
once, in your `.npmrc` (public npm stays untouched for every other package):

```ini
@criston:registry=https://nodeproxy.criston.dev
```

Then install:

```sh
npm i @criston/zeropdf
```

## Quick Start

```ts
import { createDocument, rgb } from "@criston/zeropdf";

const doc = createDocument({
  title: "Hello PDF",
  info: { author: "zeropdf" }
});

const page = doc.addPage({ size: "A4" });
page.text("Hello from TypeScript", {
  x: 56,
  y: 780,
  fontSize: 18,
  color: rgb(0.13, 0.2, 0.34)
});

const bytes = doc.toUint8Array();
```

`bytes` is standard binary data — write it in Node, upload it, or wrap it in a
`Blob` in the browser.

## Development

```bash
npm install
npm test
npm run docs:dev      # work on the docs site locally
npm run example:web   # browser playground at http://localhost:4173/
```
