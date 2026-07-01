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
import { loadExtensionFontFaces } from "@barrierbreak/a11ydocs-pdf/chrome-extension-fonts";

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
| `toc` | Table of contents built from heading blocks ([Table of contents](#table-of-contents)) |
| `crossRef` | Cross-reference to a named `anchor`, with resolved page number ([Cross-references](#cross-references)) |
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

## Tables

Cells are strings or objects. Cell objects take per-cell styling — `bold`/`italic` (resolved against the table font, including registered families), `font`, `color`, `align`, `background`, `border`, and `verticalAlign` — or inline rich-text `runs` instead of `text`. Table options add `borders` (with `borderColor`/`borderWidth`), `headerBackground`, and `zebra` striping; all decoration is emitted as artifacts so the structure tree stays clean:

```ts
{
  type: "table",
  rows: [
    [
      { text: "Results", header: true, bold: true },
      { text: "Level A", header: true, bold: true },
    ],
    ["Fail", { text: "3", align: "right", color: "red" }],
    ["Validate", { runs: [{ text: "2 ", bold: true }, { text: "(see notes)", italic: true }] }],
  ],
  options: {
    headerRows: 1,
    borders: "all",
    borderColor: "gray",
    borderWidth: 0.75,
    headerBackground: color("#eeeeee"),
    zebra: true,
  },
}
```

`zebra: true` fills every second body row with a light gray; pass a color to choose your own. A cell `background` overrides both the header fill and the stripe. The same options work on `page.table()` and `flow.table()`.

**Auto column sizing.** Set `columnWidths: "auto"` to size each column to its content instead of splitting the width equally. Columns take their natural (un-wrapped) width scaled to fill the table, shrinking toward their longest-word width when the content is too wide:

```ts
options: { columnWidths: "auto" }
```

**Repeating footers.** `footerRows: N` marks the last `N` rows as a footer. When a template splits a table across pages, those rows repeat at the bottom of every slice — the mirror of `headerRows`, which repeat at the top:

```ts
options: { headerRows: 1, footerRows: 1 } // e.g. a header row plus a totals row
```

### Borders

`borders` selects which lines the table draws. `borderColor` (default medium gray) and `borderWidth` (default `0.75`) style them.

| `borders` | Result |
| --- | --- |
| `"all"` | Full grid around every cell. The default when `borderColor`/`borderWidth` is set. |
| `"horizontal"` | Horizontal rules between rows plus the top and bottom edges; no vertical lines. |
| `"outer"` | A single frame around the whole table. |
| `"none"` | No borders, even if `borderColor`/`borderWidth` is set. |

When `borders` is omitted it defaults to `"all"` if a color or width is set, otherwise `"none"` — so existing tables keep their grid.

```ts
options: { headerRows: 1, borders: "horizontal", borderColor: "gray" }
```

### Per-cell borders

For finer control, set `border` on a cell to draw individual edges, overriding the table-level `borders`. Each side (`top`, `right`, `bottom`, `left`) accepts `true` (a default gray `0.75` line) or `{ color, width }`. Because a row is just its cells, setting the same side on every cell in a row rules that row — e.g. a line under the header or a top rule on a totals row:

```ts
{
  type: "table",
  rows: [
    // Rule under the header row.
    [
      { text: "Item", header: true, border: { bottom: { width: 1.2, color: color("#1a4db3") } } },
      { text: "Amount", header: true, border: { bottom: { width: 1.2, color: color("#1a4db3") } } },
    ],
    ["Subtotal", "$18.50"],
    // Top rule + a colored left accent on the totals row.
    [
      { text: "Total", border: { top: { width: 1.5 }, left: { width: 3, color: color("#cc3333") } } },
      { text: "$18.50", border: { top: { width: 1.5 } } },
    ],
  ],
  options: { headerRows: 1 },
}
```

Per-cell `border` is drawn on top of any table-level `borders`, so you can box a single cell inside a full grid, or skip the preset entirely and rule only the rows you want.

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

## Page breaks and pagination controls

`{ type: "pageBreak" }` forces the next block onto a fresh page. A break before any body content on the current page is ignored, so defensive breaks never produce blank pages.

Every block also accepts these pagination controls:

| Control | Effect |
|---------|--------|
| `breakBefore: true` | Advance to a fresh region (column, else page) before this block. No-op at the top of a region. |
| `breakAfter: true` | Advance to a fresh region after this block. |
| `keepWithNext: true` | Keep this block on the same page as the following one when both fit (headings default to `true`). |
| `keepTogether: true` | Never split this block across a boundary. For paragraphs, this disables line-by-line splitting across columns. |
| `widows` / `orphans` | Minimum lines to carry into a new region (`widows`) or leave before a break (`orphans`) when a paragraph splits. **Multi-column only** — single-column paragraphs never split. Default `1`. |

```ts
{ type: "heading", text: "Appendix A", breakBefore: true },
{ type: "paragraph", text: longCopy, orphans: 2, widows: 2 },
```

## Table of contents

A `{ type: "toc" }` block renders a table of contents from the template's top-level heading blocks. Page numbers and links are resolved after the whole document is laid out, so the TOC can sit at the front and still point forward:

```ts
{ type: "toc", options: { maxLevel: 2 } }
```

`TemplateTocOptions`: `maxLevel` (default 3), `font`, `fontSize`, `lineHeight`, `indent` (per level), `link` (default `true`), `pageNumbers` (default `true`), `leader` (`"dots"` default | `"line"` | `"none"`), `leaderColor` (default light gray), `levelStyles` (per-level `font`/`fontSize`/`color`), and `numbering` (hierarchical section numbers). Entries indent by heading level, show the resolved page number (right-aligned into a column), and link to the heading's page. The leader between the title and the page number is drawn as a decorative artifact, so assistive technology never announces it.

```ts
{
  type: "toc",
  options: {
    maxLevel: 2,
    numbering: true,                                  // "1", "1.1", "1.2" (tagged Lbl)
    levelStyles: { 1: { fontSize: 13, color: rgb(0.1, 0.2, 0.5) }, 2: { fontSize: 10 } },
    leader: "dots",
  },
}
```

With `numbering`, each item gains a hierarchical `Lbl` (e.g. `1.2`). `levelStyles` overrides font/size/color per heading level. Page numbers are right-aligned so they line up regardless of digit count.

The TOC is tagged for PDF/UA as a `TOC` → `TOCI` → `Reference` → `Link` hierarchy: each item's text (title and page number) lives inside the `Link` element so the link has an accessible name, and the link annotation is nested in that same `Link`. (v1: top-level headings only, single-line entries.)

## Cross-references

Give any block a unique `anchor`, then reference it from a `crossRef` block. The target page number is resolved after layout, so references may point forward or backward:

```ts
{ type: "heading", text: "Methodology", anchor: "methodology" },
// ...elsewhere...
{ type: "crossRef", to: "methodology", text: "See the methodology on page {page}." },
```

`{page}` in `text` is replaced with the resolved page number; without the placeholder the number is appended (unless `options.pageNumbers: false`). The reference links to the target page by default (`options.link`). Referencing a missing anchor throws.

## Footnotes

Attach `footnote` text to any text block. A numbered marker (`[1]`, `[2]`, …) is appended to the block, and the note is rendered at the bottom of the page the block lands on; the paginator reserves the space so notes never overlap body content:

```ts
{ type: "paragraph", text: "As reported last year", footnote: "Annual Review 2024, p. 12." }
```

Notes are numbered document-wide in reading order.

## Page background color

Set `pageBackground` to fill every page with a solid color, drawn behind all other content (and the watermark) and tagged as an artifact:

```ts
doc.renderTemplate({
  pageBackground: rgb(0.98, 0.96, 0.90),
  blocks: [/* ... */],
});
```

To apply a background to **every** page of a document — including pages you add with `doc.addPage()` outside a template — set `pageBackground` on `createDocument` instead:

```ts
const doc = createDocument({ pageBackground: rgb(0.98, 0.96, 0.90) });
```

A template's own `pageBackground` overrides the document-level one. To fill a single page ad hoc, draw a full-page rectangle first: `page.rect(0, 0, page.size.width, page.size.height, { fill: rgb(...), tag: "Artifact" })`.

## Watermarks

For a diagonal, centered watermark, use the first-class `watermark` option — it is drawn behind every page's content, rotated and centered automatically, and always tagged as an artifact (out of the reading order):

```ts
doc.renderTemplate({
  watermark: "DRAFT",                                    // or an options object
  // watermark: { text: "CONFIDENTIAL", rotation: 45, opacity: 0.15, color: rgb(0.5, 0.5, 0.5), fontSize: 120 },
  blocks: [/* ... */],
});
```

`TemplateWatermarkOptions`: `text`, `fontSize` (default auto-sized to span the page diagonally), `font` (default Helvetica-Bold), `color` (default medium gray), `opacity` (0–1, default `0.15`), `rotation` (degrees, default `45`).

## Master-page backgrounds

A `background` callback returns blocks drawn behind every page's content — tints, rules, logos. It runs per page like `header`/`footer` (a flow from the top content edge), and its output is layered behind everything else. Tag background blocks as `"Artifact"` so they stay out of the reading order. For a centered text watermark prefer the `watermark` option above.

```ts
doc.renderTemplate({
  background: ({ pageNumber }) => [
    // e.g. a full-width tint band or a rule behind the content.
    { type: "rect", width: 515, height: 6, style: { fill: rgb(0.93, 0.95, 0.99), tag: "Artifact" } },
  ],
  blocks: [/* ... */],
});
```

The background is a flow starting at the top content edge, so blocks lay out from there (use `align`/`blockAlign` for horizontal placement, or a `rect`/image sized to the page for full-bleed fills). For a centered, rotated text watermark, use the `watermark` option above instead — it handles positioning for you.

## Auto outlines

Headings are added to the document outline automatically when `autoOutline` is enabled:

```ts
autoOutline: { maxLevel: 3 }
```
