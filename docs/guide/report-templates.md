# Report Templates

`renderTemplate()` is the recommended path for multi-page reports. It paginates a block tree, applies semantic spacing, runs headers/footers after pagination, and emits proper structure tags when the document is tagged.

```ts
doc.renderTemplate({
  title: "Quarterly Report",
  info: { author: "Finance" },
  page: {
    size: "A4",
    font,
    margin: 56,
    spacing: {
      paragraphAfter: 8,
      headingBefore: { 2: 18, 3: 14 },
      headingAfter: { 1: 14, 2: 10, 3: 8 },
      tableBefore: 6,
      tableAfter: 14
    }
  },
  blocks: [
    { type: "heading", text: "Quarterly Report" },
    { type: "paragraph", text: "Summary and scope." },
    {
      type: "table",
      rows: [
        [{ text: "Metric", header: true }, { text: "Result", header: true }],
        ["Revenue", "$2.6M"]
      ],
      options: { headerRows: 1 }
    },
    { type: "pageBreak" },
    { type: "heading", text: "References", options: { level: 2 } },
    { type: "link", text: "WCAG 2.2", url: "https://www.w3.org/TR/WCAG22/" }
  ],
  header: ({ title, pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: `${title} - page ${pageNumber} of ${totalPages}`,
      options: { fontSize: 8, tag: "Artifact" }
    }
  ],
  pageNumber: { region: "footer", align: "center" }
});
```

## Embedded fonts in templates

Pass an object of family-name → faces to the `fonts` option to register embedded fonts before the template renders. Registered families are available by name in every block and style:

```ts
doc.renderTemplate({
  fonts: {
    Roboto: {
      regular: robotoRegularBytes,
      bold: robotoBoldBytes,
    }
  },
  page: { size: "A4", margin: 56, font: "Roboto" },
  styles: {
    heading1: { font: "Roboto", bold: true, fontSize: 24 },
    paragraph: { font: "Roboto", fontSize: 12 }
  },
  blocks: [
    { type: "heading", text: "Report Title" },
    { type: "paragraph", text: "Body text in Roboto." }
  ]
});
```

Each face accepts raw TrueType/OpenType bytes (embedded automatically), a handle from `embedTrueTypeFont()`, or a built-in `FontName`. Only `regular` is required; missing faces fall back to the closest available one.

In a Chrome extension, compose with [`loadExtensionFontFaces()`](./text-and-fonts#chrome-extension-fonts) to load bundled fonts and pass the result straight to `fonts`:

```ts
import { loadExtensionFontFaces } from "@criston/zeropdf/chrome-extension-fonts";

doc.renderTemplate({
  fonts: {
    Roboto: await loadExtensionFontFaces({
      regular: "fonts/Roboto-Regular.ttf",
      bold: "fonts/Roboto-Bold.ttf",
    })
  },
  page: { size: "A4", margin: 56, font: "Roboto" },
  blocks: [
    { type: "heading", text: "Report Title" },
    { type: "paragraph", text: "Body text in Roboto." }
  ]
});
```

## Multi-Column Flow

Set `columns: { count, gap }` on `page` for newspaper-style body flow. Paragraphs fill the current column and continue at the top of the next column on the same page; tables and other blocks advance to the next column before a new page. Short multi-column pages are balanced automatically so the final column set does not leave all content in the first column.

```ts
doc.renderTemplate({
  page: {
    size: "A4",
    margin: 56,
    columns: { count: 2, gap: 24 }
  },
  blocks: [
    { type: "heading", text: "Research Brief" },
    { type: "paragraph", text: longBodyCopy },
    { type: "paragraph", text: "Closing notes balance with the previous column." }
  ]
});
```

## Block types

| Type | Purpose |
|------|---------|
| `paragraph` | Body text with wrapping |
| `richParagraph` | Inline runs with mixed fonts/sizes/colors/links on one line ([Inline rich text](./text-and-fonts#inline-rich-text-mixed-styles-on-one-line)) |
| `heading` | H1–H6 with semantic spacing |
| `table` | Grid with header rows/columns; cells take `bold`/`italic` flags that resolve against the table font (built-in variant or registered family face) |
| `image` | Embedded JPEG/PNG with alt text |
| `link` | URI link with paragraph spacing |
| `list` | Ordered/unordered/nested |
| `pageBreak` | Force next block to a new page |
| `section` | Logical grouping in structure tree |
| `textField` | Single-line text input |
| `checkBox` | Boolean checkbox |
| `choiceField` | Dropdown or list selection |
| `radioGroup` | Mutually exclusive radio buttons |
| `pushButton` | Clickable push button |
| `signatureField` | Digital signature placeholder |
| `highlight` | Text highlight annotation |
| `note` | Sticky note annotation |
| `freeText` | Free-text annotation box |
| `pageLink` | Internal page link |
| `rect` | Rectangle vector shape |
| `path` | Custom path vector shape |
| `custom` | User-defined block with render/estimate |

## Form Fields

Form blocks auto-position within the flow---no manual x/y coordinates needed.

```ts
{ type: "textField", name: "email", value: "ada@example.com", width: 220, height: 24 },
{ type: "checkBox", name: "subscribe", checked: true, width: 16, height: 16 },
{ type: "choiceField", name: "dept", options: ["Eng", "Design", "Sales"], value: "Design", mode: "combo", width: 180, height: 24 },
{ type: "radioGroup", name: "method", items: [{ value: "email" }, { value: "phone" }], value: "phone" },
{ type: "pushButton", name: "submit", label: "Submit", width: 96, height: 24 },
{ type: "signatureField", name: "signHere", width: 180, height: 36 }
```

## Annotations

```ts
{ type: "highlight", width: 120, height: 14, color: rgb(1, 1, 0) },
{ type: "note", contents: "Review this paragraph", width: 24, height: 24 },
{ type: "freeText", text: "Inline annotation", width: 180, height: 32 },
{ type: "pageLink", destination: "intro", width: 96, height: 14 }
```

## Vector Graphics

`rect` and `path` blocks require an explicit `height` so the paginator can allocate space.

```ts
{ type: "rect", width: 200, height: 4, options: { color: rgb(0.2, 0.2, 0.2), fill: rgb(0.9, 0.9, 0.9) } },
{ type: "path", commands: "M0 0 L100 0 L50 50 Z", height: 50, options: { color: rgb(0, 0, 0), fill: rgb(0.8, 0.8, 0.8) } }
```

## Lists

Each item follows the `ListItem` format: `{ text: string, children?: ListItem[] }`. Use `options.ordered` for numbered lists or `options.bullet` for custom markers.

```ts
{
  type: "list",
  items: [
    { text: "First item" },
    { text: "Second item", children: [{ text: "Nested" }] }
  ],
  options: { ordered: true, bullet: "disc" }
}
```

## Custom Blocks

When built-in block types don't cover your needs, use the `custom` type with `render` and `estimate` callbacks.

```ts
{
  type: "custom",
  height: 12,
  render(ctx) {
    ctx.graphics()
      .moveTo(ctx.x, ctx.y + 1)
      .lineTo(ctx.x + ctx.width, ctx.y + 1)
      .stroke({ color: rgb(0.6, 0.6, 0.6) });
  },
  estimate() { return 12; }
}
```

- `render(ctx)` --- draws the block. `ctx` provides `x`, `y`, `width`, and drawing helpers.
- `estimate()` --- returns the vertical space (points) needed during pagination.

Ideal for horizontal rules, separators, watermarks, or any drawing that doesn't fit existing block types. See [Custom Blocks](./custom-blocks) for a deeper guide.

## Spacing model

Spacing is semantic, not a single fixed gap:

- paragraphs: compact rhythm after the text
- headings: stronger before-space, smaller after-space, no leading space at top of page
- tables and figures: object spacing before and after
- links: paragraph-like spacing after

Override per block with `marginTop` / `marginBottom`. Override globally with `page.spacing`.

## Stylesheets

Define reusable typography and spacing once with `styles`, then apply them by block type or via a `class` on each block, instead of repeating `options` everywhere. See [Template Stylesheets](./template-stylesheets) for the full selector and cascade rules.

```ts
doc.renderTemplate({
  styles: {
    paragraph: { fontSize: 11, lineHeight: 16 },
    heading1: { fontSize: 28, color: rgb(0.1, 0.2, 0.5) },
    callout: { color: rgb(0.8, 0, 0), marginTop: 12 }
  },
  blocks: [
    { type: "heading", text: "Title", options: { level: 1 } },
    { type: "paragraph", text: "Inherits the shared paragraph style." },
    { type: "paragraph", text: "Important.", class: "callout" }
  ]
});
```

## Headers, footers, page numbers

Header/footer callbacks run after body pagination, so `pageNumber` and `totalPages` are accurate. Use `pageNumber` for standard running labels:

```ts
pageNumber: { region: "footer", align: "right" }
```

`region`: `"header" | "footer"`. `align`: `"left" | "center" | "right"`.

## Page breaks

`{ type: "pageBreak" }` forces the next block onto a fresh page. A break before any body content on the current page is ignored, so defensive breaks never produce blank pages.

## Auto outlines

Headings are added to the document outline automatically when `autoOutline` is enabled:

```ts
autoOutline: { maxLevel: 3 }
```
