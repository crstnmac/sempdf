# JSON to PDF

`renderDocumentJson()` turns a single, fully serializable value into PDF bytes — no callbacks, no in-memory font or image handles. Everything the document needs (metadata, fonts, images, headers/footers, encryption, and absolute-positioned content) is described as plain JSON, so a document can come straight from a config file, an API request, or an LLM.

```ts
import { renderDocumentJson } from "@criston/zeropdf";

const bytes = await renderDocumentJson({
  title: "Hello",
  blocks: [
    { type: "heading", text: "Invoice #42", options: { level: 1 } },
    { type: "paragraph", text: "Thanks for your business." }
  ]
});
```

It is a thin layer over [`createDocument()`](./getting-started) and [`renderTemplate()`](./report-templates): the body `blocks` are the same template blocks, and `renderDocumentJson` adds the three things a template spec cannot carry as JSON — declared fonts, image bytes, and data-driven headers/footers — plus document-level options at the root.

`renderDocumentJson` is asynchronous because fonts and images may load from disk or the network. For a fully inline document (every asset is `base64`), [`renderDocumentJsonSync()`](#synchronous-rendering) returns the bytes directly.

## The document shape

`PdfDocumentJson` is the input type. Every field is optional except `blocks`.

```ts
interface PdfDocumentJson {
  // Document options (applied at creation)
  title?: string;
  info?: DocumentInfo;
  language?: string;             // BCP 47, e.g. "en-US"
  tagged?: boolean;              // accessible structure tree
  conformance?: DocumentConformanceProfile;  // "pdfa-2b", "pdfua-1", …
  compress?: boolean;
  encryption?: DocumentEncryptionOptions;
  defaultPageSize?: PageSize;

  // Assets, declared once and referenced by name
  fonts?: JsonFontDeclaration[];
  defaultFont?: string;
  defaults?: TextDefaults;

  // Layout
  page?: TemplatePageOptions;    // size, margin, header/footer heights
  styles?: TemplateStylesheet;
  pageNumber?: TemplatePageNumberOptions;
  autoOutline?: boolean | TemplateAutoOutlineOptions;
  strictLayout?: boolean | TemplateStrictLayoutOptions;

  // Header / footer as data (page tokens interpolated)
  header?: JsonBlock[];
  footer?: JsonBlock[];

  // Body — required, non-empty
  blocks: JsonBlock[];
}
```

Block types, styles, and page options are identical to the [template API](./report-templates); see [Template Stylesheets](./template-stylesheets) for `styles`.

## Fonts

Declare fonts once under `fonts`, then reference them by `name` from any block's `font` option (a registered family name is a valid `PdfFont`). Each source is `base64`, a file `path` (Node), a `url`, or a Google Fonts lookup.

```ts
await renderDocumentJson({
  fonts: [
    { name: "Body", source: { google: { family: "Inter" } } },
    { name: "Mono", source: { path: "fonts/JetBrainsMono.ttf" } },
    { name: "Brand", source: { base64: "<base64 ttf>" } }
  ],
  defaultFont: "Body",
  blocks: [
    { type: "paragraph", text: "Set in Inter.", options: { font: "Body" } },
    { type: "paragraph", text: "code()", options: { font: "Mono" } }
  ]
});
```

A font may declare weighted faces so the `bold` / `italic` flags resolve:

```ts
{
  name: "Body",
  source: {
    regular: { google: { family: "Inter" } },
    bold: { google: { family: "Inter", weight: 700 } }
  }
}
```

No `fonts` and no `defaultFont` falls back to the engine's built-in font, which renders Latin text without an embed.

## Images

Image blocks carry a `src` instead of raw bytes — `base64`, a file `path`, or a `url`:

```ts
blocks: [
  { type: "png", src: { path: "assets/logo.png" }, options: { width: 96 } },
  { type: "jpeg", src: { base64: "<base64 jpeg>" }, options: { width: 200 } }
]
```

The block `type` is the image format (`png`, `jpeg`, `bmp`, `jbig2`, `tiff`, `jp2`, `webp`, `gif`, `svg`).

## Headers and footers

In the template API, headers and footers are callbacks. Over JSON they are static block arrays with tokens interpolated on every page: `{{pageNumber}}`, `{{pageCount}}` (alias `{{totalPages}}`), `{{title}}`, and `{{author}}`.

```ts
await renderDocumentJson({
  title: "Quarterly Report",
  page: { size: "A4", footerHeight: 40 },
  footer: [
    { type: "paragraph", text: "{{title}} — page {{pageNumber}} of {{pageCount}}" }
  ],
  blocks: [/* … */]
});
```

## Document options

Encryption, conformance, language, tagged structure, and metadata live on the root and are applied when the document is created:

```ts
await renderDocumentJson({
  tagged: true,
  language: "en-US",
  conformance: "pdfua-1",
  encryption: { userPassword: "open-sesame", algorithm: "aes-256" },
  blocks: [{ type: "paragraph", text: "Confidential." }]
});
```

## Absolute positioning (coordinate system)

A block flows by default. Add a `position` and it is drawn at exact PDF-point coordinates instead — useful for stamps, labels, logos, and form fields placed on a designed page. Positioned and flow blocks mix freely in the same `blocks` array.

```ts
interface BlockPosition {
  x: number;
  y: number;
  width?: number;   // required for `rect` and image blocks
  height?: number;
  page?: number;    // 1-based; pages are created as needed. Default 1.
  origin?: "bottom-left" | "top-left";  // default "bottom-left"
}
```

```ts
await renderDocumentJson({
  page: { size: "A4" },
  blocks: [
    { type: "paragraph", text: "Body text flows normally." },

    // Placed at exact coordinates:
    { type: "paragraph", text: "PAID", options: { fontSize: 28, color: "red" },
      position: { x: 400, y: 736 } },
    { type: "rect", width: 130, height: 48,
      style: { paint: "stroke", stroke: { color: "red", width: 2 } },
      position: { x: 380, y: 720 } },
    { type: "textField", name: "signature",
      position: { x: 72, y: 600, width: 220, height: 14 } }
  ]
});
```

Coordinates are in PDF points. With the default `bottom-left` origin, `y` grows upward; set `origin: "top-left"` on a block to measure from the top. See [the coordinate system](./getting-started#coordinate-system).

**Positionable block types:** `paragraph`, the image formats (`png`, `jpeg`, …), `rect`, `textField`, `checkBox`, `signatureField`. A `position` on any other type (for example `table` or `list`) throws `INVALID_DOCUMENT_JSON`. A positioned `paragraph` is a single line — the page text API does not wrap, so `width`/`height` are ignored for it.

A document whose blocks are all positioned (no flow content) is valid; blank pages are created up to the highest `page` referenced, and each created page must receive at least one block.

## Synchronous rendering

When every font and image source is inline `base64`, render without `await`:

```ts
import { renderDocumentJsonSync } from "@criston/zeropdf";

const bytes = renderDocumentJsonSync({
  blocks: [{ type: "paragraph", text: "No async assets here." }]
});
```

`path`, `url`, and `google` sources require loading and throw `INVALID_DOCUMENT_JSON` in the sync variant — use `renderDocumentJson` for those.

## Node and the browser

`base64`, `url` (fetch), and `google` sources work in both Node and the browser. A `path` source reads from the filesystem and is Node-only; `node:fs` is imported lazily, only when a `path` appears, so the browser bundle stays clean. See [Browser Usage](./browser-usage).

## What JSON cannot express

The format covers the full declarative surface but not the callback-based or low-level imperative APIs:

- **Custom blocks** (`render(flow)` callbacks) — see [Custom Blocks](./custom-blocks).
- **Digital signing** — `DocumentSignatureOptions.sign` is a callback; sign with the programmatic API (see [Digital Signatures](./digital-signatures)).
- **`pageNumber.format`** callback — use footer tokens for numbering.
- **Free imperative drawing** beyond positioned blocks — soft masks, blend modes, transparency groups, and arbitrary `PdfPage` graphics.

For those, drop down to [`createDocument()`](./getting-started) and the page/flow APIs.

## Validation

A malformed document throws [`PdfEngineError`](./troubleshooting) with code `INVALID_DOCUMENT_JSON` and a message that names the offending path — for example a missing `blocks` array, an undeclared font name, a bad image `src`, or a `position` on a non-positionable block. The caller's input object is never mutated during rendering.
