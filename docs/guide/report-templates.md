# Report Templates

`renderTemplate()` is the recommended path for multi-page reports. It paginates a block tree, applies semantic spacing, runs headers/footers after pagination, and emits proper structure tags when the document is tagged.

```ts
doc.renderTemplate({
  info: { title: "Quarterly Report", author: "Finance" },
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

## Block types

| Type | Purpose |
|------|---------|
| `paragraph` | Body text with wrapping |
| `heading` | H1–H6 with semantic spacing |
| `table` | Grid with header rows/columns |
| `image` | Embedded JPEG/PNG with alt text |
| `link` | URI link with paragraph spacing |
| `list` | Ordered/unordered/nested |
| `pageBreak` | Force next block to a new page |
| `section` | Logical grouping in structure tree |

## Spacing model

Spacing is semantic, not a single fixed gap:

- paragraphs: compact rhythm after the text
- headings: stronger before-space, smaller after-space, no leading space at top of page
- tables and figures: object spacing before and after
- links: paragraph-like spacing after

Override per block with `marginTop` / `marginBottom`. Override globally with `page.spacing`.

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
