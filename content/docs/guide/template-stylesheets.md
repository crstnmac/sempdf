---
title: "Template Stylesheets"
---

Stylesheets let you define reusable typography and spacing once and apply them across many template blocks, instead of repeating the same `options` on every block. They slot into `renderTemplate()` via the `styles` map and an optional `class` on each block.

```ts
doc.renderTemplate({
  styles: {
    paragraph: { fontSize: 11, lineHeight: 16 },
    heading1: { fontSize: 28, color: rgb(0.1, 0.2, 0.5) },
    callout: { color: rgb(0.8, 0, 0), marginTop: 12 }
  },
  blocks: [
    { type: "heading", text: "Quarterly Report", options: { level: 1 } },
    { type: "paragraph", text: "Every paragraph inherits the shared style." },
    { type: "paragraph", text: "Important note.", class: "callout" }
  ]
});
```

## Selectors

A stylesheet is a flat map of selector → style. A selector is either a **type selector** (matches a block's `type`) or a **class name** (referenced by a block's `class` field).

| Selector | Matches |
|----------|---------|
| `paragraph`, `table`, `link`, `list` | All blocks of that type |
| `image` | All image blocks (any format) |
| `png`, `jpeg`, `bmp`, `tiff`, `jp2`, `jbig2`, `webp`, `gif`, `svg` | One image format |
| `heading` | All headings |
| `heading1` … `heading6` | One heading level |
| *anything else* | A class name, applied only to blocks that list it in `class` |

Type selector names are reserved---avoid using them as class names. `class` accepts a single name or an ordered array:

```ts
{ type: "paragraph", text: "...", class: "callout" }
{ type: "paragraph", text: "...", class: ["callout", "danger"] }
```

`class` is supported on `heading`, `paragraph`, `table`, `image`, `link`, and `list` blocks.

## Cascade

For each block, styles merge from lowest to highest priority:

1. **Page defaults** --- `page.font`, `page.fontSize`, `page.spacing`, etc.
2. **Type selectors** --- generic before specific (`heading` then `heading2`, `image` then `png`).
3. **Classes** --- each name in `class`, in array order (later wins).
4. **Inline `options`** --- always wins.

Merging is **shallow**: a nested object such as `margin` replaces the lower layer's value rather than merging key-by-key.

```ts
styles: {
  heading: { color: gray(0.3) },     // all headings grey
  heading1: { fontSize: 28 },        // H1 also 28pt, still grey
  big: { fontSize: 40 }
},
blocks: [
  // 28pt grey (heading1 over heading)
  { type: "heading", text: "Title", options: { level: 1 } },
  // 40pt grey (class over type selector)
  { type: "heading", text: "Big", options: { level: 1 }, class: "big" },
  // 18pt grey (inline over everything)
  { type: "heading", text: "Override", options: { level: 1, fontSize: 18 } }
]
```

## Style properties

A `TemplateStyle` carries cross-cutting typography and spacing:

`font`, `fallbackFonts`, `fontSize`, `color`, `lineHeight`, `align`, `kerning`, `direction`, `writingMode`, `margin`, `marginTop`, `marginRight`, `marginBottom`, `marginLeft`.

`align` accepts the full alignment union; image and link blocks ignore `"justify"` and treat it as `"left"`.

## Scope

Stylesheets also apply to blocks rendered inside `section` blocks and in `header`/`footer` callbacks, so nested and running-region content stays consistent with the body. Block-specific options that are not part of `TemplateStyle` (table column widths, list markers, image dimensions) stay on the block's inline `options`.

Everything is optional and backward compatible: omit `styles` and `class` and rendering behaves exactly as before.
