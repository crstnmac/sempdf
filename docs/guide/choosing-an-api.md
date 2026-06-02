# Choosing an API

zeropdf offers a few layers, from absolute drawing to automatic multi-page layout. This page maps common goals to the right tool so you don't have to scan the whole reference.

## Text

| Goal | Use |
|------|-----|
| Draw one line at an exact spot | [`page.text(text, options)`](./text-and-fonts) |
| Wrap a paragraph to a width | [`page.textBlock(text, options)`](./text-and-fonts#wrapped-text-blocks) |
| Mixed fonts/sizes/colors/links on the same line | [`page.richText(runs, options)`](./text-and-fonts#inline-rich-text-mixed-styles-on-one-line) |
| Inline link/highlight over a substring of a uniform paragraph | `paragraph` + `annotations` (see [Forms and Annotations](./forms-and-annotations)) |
| Flowing content with auto-pagination, headers/footers | [`renderTemplate()`](./report-templates) or the [`PdfFlow`](./report-templates) cursor |
| Know a size before drawing | [`doc.measureText` / `measureTextBlock` / `measureRichText`](./text-and-fonts#measuring-text) |
| Draw and stack manually using the consumed height | `page.placeText` / `page.placeTextBlock` (return `endY`) |

### Manual vertical stacking

`text`/`textBlock`/`richText` return the page (for chaining) and don't tell you where the text ended. When you're laying out by hand and need the next `y`, use the `place*` variants, which draw **and** return metrics:

```ts
let y = 760;
y = page.placeTextBlock("Intro paragraph…", { x: 56, y, width: 480 }).endY - 8;
y = page.placeTextBlock("Next paragraph…", { x: 56, y, width: 480 }).endY - 8;
```

For anything beyond a few blocks, prefer the flow/template APIs — they track the cursor, wrap, and paginate for you.

## Graphics and images

| Goal | Use |
|------|-----|
| Rectangle / line / circle / ellipse | [`page.rect` / `line` / `circle` / `ellipse`](./vector-graphics#shape-helpers) |
| Arbitrary vector geometry | [`page.path(commands, style)`](./vector-graphics#path-commands) |
| Embed an image, format known | `page.png` / `page.jpeg` / … (see [Images](./images)) |
| Embed an image, format unknown | [`page.image(data, options)`](./images#auto-detecting-the-format) |
| SVG | `page.svg(data, options)` |
| Default stroke/fill for many shapes | `createDocument({ shapeDefaults })` |

## Color, fonts, units, coordinates

| Goal | Use |
|------|-----|
| Color | `rgb()`, `cmyk()`, `gray()`, `hex()`, or a [named color](./vector-graphics#colors) string / `color()` |
| Bold/italic, font families | [`registerFontFamily()`](./text-and-fonts#embedded-fonts-font-families) + `bold`/`italic` flags |
| Underline / strike-through | `underline` / `strike` text options |
| Physical units | `mm()`, `cm()`, `inch()`, `pt()` |
| Document-wide text defaults | `createDocument({ defaults })` |
| `y` grows downward from the top | `addPage({ origin: "top-left" })` (see [Coordinate system](./getting-started#coordinate-system)) |

## Structure, forms, and assembly

| Goal | Use |
|------|-----|
| Tables | `page.table(rows, options)` or a `table` template block |
| Lists | `page.list(items, options)` |
| Form fields | `page.textField` / `checkBox` / `choiceField` / `radioGroup` / `pushButton` / `signatureField` (see [Forms and Annotations](./forms-and-annotations)) |
| Tagged structure for accessibility | `page.container()` / `page.structure()` (see [Accessibility](./accessibility-and-compliance)) |
| Edit an existing PDF | [`editDocument()` / `parseDocument()`](./edit-existing-pdfs) |
| Merge / split / extract / append pages | [Page Assembly](./page-assembly) helpers |

## Page vs. flow vs. template — which layout model?

- **Page methods** (`page.text`, `page.rect`, …) — you place everything at explicit coordinates. Most control; you manage layout.
- **Flow** (`page.flow()`) — a cursor that advances as you add blocks; wraps and (with an overflow handler) continues across columns/pages. Good for one-off flowing sections.
- **Template** (`doc.renderTemplate()`) — declarative blocks with stylesheets, headers/footers, page numbers, and automatic pagination. Best for reports and documents.

Start with templates for documents, drop to flow for a flowing region inside a hand-laid page, and use page methods for pixel-precise placement.
