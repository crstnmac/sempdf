# HTML to PDF

`htmlToBlocks()` converts an HTML fragment into template blocks: headings, paragraphs with inline styling, nested lists, tables, code blocks, rules, and images. The result is ordinary block data, so converted content paginates, tags itself for accessibility, feeds the TOC and auto-outline, and picks up your stylesheet — exactly like hand-authored blocks.

It is a mapper, not a browser: there is no CSS, no layout engine, and no scripting. That keeps it fast, synchronous, and dependency-free, and it is why the output is predictable enough to ship in a report pipeline.

```ts
import { createDocument, htmlToBlocks } from "@sempdf/sempdf-pdf"

const doc = createDocument({ title: "Report", tagged: true, language: "en" })
doc.renderTemplate({
  blocks: [
    { type: "heading", text: "Findings", options: { level: 1 } },
    ...htmlToBlocks(record.descriptionHtml, { headingOffset: 1 }),
  ],
  autoOutline: true,
})
```

Three ways to use it, same converter underneath:

| Form | Use when |
|------|----------|
| `htmlToBlocks(html, options)` spread into `blocks` | Most cases — you see and can post-process the blocks |
| `{ type: "html", html, options }` block | The block list is data (including `renderDocumentJson`), so you cannot call a function |
| `flow.html(html, options)` | You are drawing with the flow cursor directly |

`html` blocks are expanded *before* pagination, so headings inside them still reach the TOC and auto-outline, and each generated block breaks across pages on its own.

## What maps to what

| HTML | Block |
|------|-------|
| `h1`–`h6` | `heading` (level shifted by `headingOffset`, clamped to 1–6) |
| `p`, `div`, bare text | `paragraph`, or `richParagraph` when inline styles/links are present |
| `ul`, `ol`, `li` | `list`, nested through item `children` |
| `dl`, `dt`, `dd` | Paragraphs (`dt` bold) |
| `pre`, `pre > code` | `code` (indentation preserved; `class="language-x"` becomes the block's `language`) |
| `blockquote` | Indented paragraphs tagged `Quote` |
| `table` (`thead`/`tbody`/`tfoot`, `th`, `scope`, `colspan`, `rowspan`, `caption`) | `table` (+ a caption paragraph) |
| `hr` | Full-width rule |
| `img` | Image block when `options.images` resolves bytes, else its alt text |
| `strong`/`b`, `em`/`i`, `u`, `s`/`del`, `mark`, `code`/`kbd`/`samp`, `sup`, `sub`, `small`, `a`, `br` | Inline runs on the paragraph |
| `section`, `article`, `main`, `header`, `footer`, `nav`, `figure`, unknown elements | Unwrapped — the content still renders |
| `script`, `style`, `iframe`, `object`, form controls | Dropped with their content |

## Entities, `&mdash;`, and `&nbsp;`

Character references are decoded — named, decimal (`&#8212;`), hex (`&#x2014;`), and the double-encoded `&amp;mdash;` that database round-trips produce. Unknown references are left as written rather than mangled.

The built-in (non-embedded) fonts encode ASCII only, so `&mdash;` or `&nbsp;` would fail to render with them. `normalizeText` decides what happens:

```ts
htmlToBlocks("<p>A&mdash;B&nbsp;C &hellip; &euro;5</p>")
// default, normalizeText: "ascii" → "A-B C ... EUR5"

htmlToBlocks("<p>A&mdash;B&nbsp;C &hellip; &euro;5</p>", { normalizeText: "none" })
// "A—B C … €5" — needs an embedded Unicode font
```

`"ascii"` (the default) folds smart quotes, dashes, ellipses, non-breaking spaces, bullets, arrows, comparison operators, fractions, superscript digits, and currency symbols to ASCII equivalents. Use `"none"` with an embedded font when you want the real typography:

```ts
const inter = doc.embedTrueTypeFont(interBytes)
doc.renderTemplate({
  blocks: htmlToBlocks(html, {
    normalizeText: "none",
    paragraph: { font: inter },
    heading: { font: inter },
  }),
})
```

`decodeHtmlEntities(text)` is exported separately for when you only need the decoding step.

## Styling the output

Every generated block type takes its options from one place, so you style once:

```ts
htmlToBlocks(html, {
  headingOffset: 1,                                  // <h1> becomes a level-2 heading
  paragraph: { fontSize: 11, lineHeight: 16 },
  heading: { color: hex("#1f2328") },
  list: { bullet: "disc", itemSpacing: 4 },
  code: { lineNumbers: true, borderWidth: 0.75 },     // see Code blocks
  table: { borders: "all", headerBackground: hex("#f6f8fa") },
  codeFont: mono,                                    // inline <code>
  linkColor: hex("#0969da"),
  baseFontSize: 11,                                  // enables relative <small>/<sup>/<sub> sizing
  blockquoteIndent: 24,
})
```

A stylesheet still applies on top, because the converter emits normal blocks — `styles: { paragraph: {...}, heading2: {...}, list: {...} }` works unchanged. Inline `options` from the converter win over stylesheet values, so pass converter options only for what the stylesheet should not own.

## Images

Nothing is fetched for you — the converter is synchronous and does no I/O. Resolve `src` yourself:

```ts
const assets = new Map([["hero.png", heroBytes]])

htmlToBlocks(html, {
  images: (src, attributes) => {
    const data = assets.get(src)
    return data ? { type: "png", data, altText: attributes.alt } : undefined
  },
})
```

Unresolved images fall back to their alt text as a paragraph (`imageFallback: "alt"`, the default) so content is never silently lost. `alt=""` marks a decorative image and is always dropped; `imageFallback: "drop"` discards every unresolved image.

## Untrusted HTML

The converter is built for content you did not write:

- `<script>`, `<style>`, `<iframe>`, `<object>`, and form controls are dropped along with their content.
- Link schemes are allow-listed — `http`, `https`, `mailto`, `tel` by default. A `javascript:` URL renders as plain text instead of becoming a clickable annotation. Override with `allowedLinkSchemes`.
- No attribute is executed or interpreted as CSS; only structural attributes (`href`, `src`, `alt`, `colspan`, `rowspan`, `scope`, `start`, `value`, `class` for code languages) are read.
- Malformed markup never throws: unclosed tags, stray end tags, and bare `<` are recovered the way browsers do.

Blocks are data, so you can audit or rewrite them before rendering:

```ts
const blocks = htmlToBlocks(untrusted).filter((block) => block.type !== "table")
```

## Known limits

- **No CSS.** `style` attributes, classes, and stylesheets are ignored (except `class="language-x"` on code). Style through converter options and stylesheets instead.
- **Headings are flattened to text**, so inline markup inside `<h2>` is dropped — that keeps headings usable as TOC and outline entries.
- **A list item body is one paragraph.** Block content inside an `<li>` (a nested `<p>`, for example) is folded into the item's text; nested `<ul>`/`<ol>` become proper child items.
- **One `ordered` flag per list block.** A nested list of the opposite type gets explicit per-item labels (`1.`, `•`) so it still reads correctly.
- **`<br>` in a styled paragraph** splits it into tightly spaced fragments, because rich runs cannot carry a hard break. Plain paragraphs keep a real `\n`.
- **`colgroup`/`col` widths are ignored**; set `table.columnWidths` (or `"auto"`) yourself.

## Accessibility

Converted content is tagged like any other block content: headings become `H1`–`H6`, lists become `L`/`LI`/`LBody`, `th` cells become `TH` with the right `scope`, links become `Link` elements with their text as the accessible name, code becomes `Code`, and rules and table decoration are artifacts. Pass real alt text through `images` (or leave the alt text fallback in place) and a converted document passes `validateCompliance()` for tagged output.

For `pdfua-1`/`pdfa-*` conformance, supply embedded fonts (`paragraph.font`, `heading.font`, `code.font`) — the built-in fonts are not embeddable.

## See also

- [Report Templates](./report-templates) — the block types this produces, including [code blocks](./report-templates#code-blocks)
- [Template Stylesheets](./template-stylesheets) — styling generated blocks by selector
- [JSON to PDF](./json-to-pdf) — using `{ type: "html" }` from pure data
