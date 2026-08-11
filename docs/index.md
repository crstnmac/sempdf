---
layout: home

hero:
  name: zeropdf
  text: Zero-dependency PDF generation and editing in TypeScript.
  tagline: Build, inspect, tag, encrypt, merge, and incrementally edit PDFs with a small public API and browser-friendly Uint8Array output.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/

features:
  - title: Generate precise PDFs
    details: Create pages, draw text and vector paths, embed JPEG/PNG images, attach files, add outlines, and serialize deterministic bytes.
  - title: Edit existing documents
    details: Parse classic and xref-stream PDFs, update metadata and form fields, append overlays, reorder pages, and preserve incremental history.
  - title: Build accessible output
    details: Create tagged PDFs with semantic flow helpers, scalable report templates, structure trees, image alt text, role maps, language metadata, inferred structure bounding boxes, table helpers, and validation warnings.
---

## Designed for library authors and product code

`zeropdf` keeps PDF workflows close to regular TypeScript: you compose a document, add pages and annotations, then write bytes wherever your runtime needs them.

```ts
import { createDocument, rgb } from "@crstnmac/zeropdf";

const doc = createDocument({
  title: "Invoice"
});

const page = doc.addPage({ size: "A4" });
page.text("Invoice #1007", {
  x: 56,
  y: 780,
  fontSize: 18,
  color: rgb(0.13, 0.2, 0.34)
});

const bytes = doc.toUint8Array();
```

Start with the [getting started guide](/guide/getting-started), then use the [API reference](/api/) when you need exact option types.
