# sempdf

Zero-dependency PDF generation engine written in TypeScript. Pure `Uint8Array`
output, PDF 1.4–2.0, embedded fonts and images, parsing and incremental editing,
forms, tagged/PDF-UA structure, encryption, and signing — Node and browser friendly.

## Install

The package is published to a private registry. Point the `@sempdf` scope at it
once, in your `.npmrc` (public npm stays untouched for every other package):

```ini
@sempdf:registry=https://npm.sempdf.net
```

Then install:

```sh
npm i @sempdf/sempdf-pdf
```

## Quick Start

```ts
import { createDocument, rgb } from "@sempdf/sempdf-pdf";

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
claude mcp add sempdf -- npx --registry=https://npm.sempdf.net @sempdf/sempdf-pdf-mcp
```

Optionally set a workspace directory for scoped file operations:

```bash
claude mcp add sempdf -- npx --registry=https://npm.sempdf.net @sempdf/sempdf-pdf-mcp --env WORKSPACE_DIR=~/Documents/pdf-workspace
```

Tools: `generate_pdf`, `extract_text`, `get_pdf_info`, `inspect_pdf`, `merge_pdfs`, `split_pdf`, `extract_pages`, `append_pages`, `validate_pdf2`.

## Development

```bash
npm install
npm test
npm run docs:dev      # work on the docs site locally
npm run example:web   # browser playground at http://localhost:4173/
```
