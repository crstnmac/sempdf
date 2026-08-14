<p align="center">
  <img src="./brand/logo-mark.svg" alt="sempdf" width="112" height="112" />
</p>

<h1 align="center">sempdf</h1>

Zero-dependency PDF generation engine written in TypeScript. Pure `Uint8Array`
output, PDF 1.4–2.0, embedded fonts and images, parsing and incremental editing,
forms, tagged/PDF-UA structure, encryption, and signing — Node and browser friendly.

## Install

The package is published to a private registry. Point the `@crstnmac` scope at it
once, in your `.npmrc` (public npm stays untouched for every other package):

```ini
@crstnmac:registry=https://nodeproxy.criston.dev
```

Then install:

```sh
npm i @crstnmac/sempdf
```

## Quick Start

```ts
import { createDocument, rgb } from "@crstnmac/sempdf";

const doc = createDocument({
  title: "Hello PDF",
  info: { author: "sempdf" }
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

## MCP Server

Register the MCP server with Claude for PDF generation and manipulation as tools:

```bash
claude mcp add sempdf -- npx --registry=https://nodeproxy.criston.dev @crstnmac/sempdf-mcp
```

Optionally set a workspace directory for scoped file operations:

```bash
claude mcp add sempdf -- npx --registry=https://nodeproxy.criston.dev @crstnmac/sempdf-mcp --env WORKSPACE_DIR=~/Documents/pdf-workspace
```

Tools: `generate_pdf`, `extract_text`, `get_pdf_info`, `inspect_pdf`, `merge_pdfs`, `split_pdf`, `extract_pages`, `append_pages`, `validate_pdf2`.

## Development

```bash
npm install
npm test
npm run docs:dev      # work on the docs site locally
```

## Optional font package

```sh
npm i @crstnmac/sempdf-fonts
```

```ts
import { createDocument } from "@crstnmac/sempdf";
import { liberation } from "@crstnmac/sempdf-fonts/liberation";

const doc = createDocument();
await doc.fonts(liberation);
doc.addPage().text("Typography · café — Привет", { x: 56, y: 760 });
```

The optional `@crstnmac/sempdf-fonts` package contains the Liberation Sans,
Serif, and Mono files under [`fonts/liberation/`](./fonts/liberation). They are © Red Hat, Inc. and Google, distributed under the
**SIL Open Font License 1.1** (see [`fonts/liberation/LICENSE`](./fonts/liberation/LICENSE)).
The OFL permits bundling and embedding the fonts in software and documents; the
fonts retain reserved names ("Liberation", "Arimo", "Tinos", "Cousine") and may
not be released under a different license. PDFs you generate with these fonts
are your own and are unaffected by the OFL.
