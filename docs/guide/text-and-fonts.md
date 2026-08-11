# Text and Fonts

The library supports the standard 14 fonts out of the box and embedded TrueType fonts for Unicode, kerning, ligatures, and complex scripts.

## Built-in fonts

Use any of the standard 14 PostScript names without loading font data:

```ts
page.text("Helvetica sample", { x: 56, y: 760, font: "Helvetica" });
page.text("Times sample", { x: 56, y: 740, font: "Times-Roman" });
page.text("Courier sample", { x: 56, y: 720, font: "Courier" });
```

Available names: `Helvetica`, `Helvetica-Bold`, `Helvetica-Oblique`, `Helvetica-BoldOblique`, `Times-Roman`, `Times-Bold`, `Times-Italic`, `Times-BoldItalic`, `Courier`, `Courier-Bold`, `Courier-Oblique`, `Courier-BoldOblique`, `Symbol`, `ZapfDingbats`.

## Embedded TrueType fonts

Embed any `.ttf` for Unicode coverage and PDF/UA conformance:

```ts
import { readFile } from "node:fs/promises";

const fontBytes = await readFile("fonts/SourceSans3-Regular.ttf");
const font = doc.embedTrueTypeFont(fontBytes, { family: "SourceSans3" });

page.text("Hello Ω 漢", { x: 56, y: 700, font, fontSize: 14 });
```

The embedder subsets glyphs, computes widths, and writes a `ToUnicode` CMap so extracted text round-trips.

## Google Fonts

`loadGoogleFont()` downloads a [Google Font](https://fonts.google.com/) and returns its bytes, ready for `embedTrueTypeFont()` or `registerFontFamily()`:

```ts
import { createDocument, loadGoogleFont } from "@crstnmac/zeropdf";

const doc = createDocument({ language: "en-US" });
const interBytes = await loadGoogleFont("Inter", { weight: 700 });
const inter = doc.embedTrueTypeFont(interBytes, { family: "Inter" });

doc.addPage().text("Hello from Inter", { x: 56, y: 760, font: inter, fontSize: 24 });
```

Register multiple weights as a family so `bold`/`italic` resolve by flag:

```ts
doc.registerFontFamily("Roboto", {
  regular: doc.embedTrueTypeFont(await loadGoogleFont("Roboto"), { family: "Roboto" }),
  bold: doc.embedTrueTypeFont(await loadGoogleFont("Roboto", { weight: 700 }), { family: "Roboto" }),
  italic: doc.embedTrueTypeFont(await loadGoogleFont("Roboto", { italic: true }), { family: "Roboto" })
});

page.text("Roboto bold", { x: 56, y: 700, font: "Roboto", bold: true });
```

Options: `weight` (1–1000, default 400), `italic` (default false), `text` (restrict the download to the glyphs in this string via Google's `&text=` subsetting), `signal` (an `AbortSignal`), and `fetch` (a custom `fetch` implementation).

::: tip Works in browsers too (woff2)
The Google Fonts API serves **woff2** (Brotli-compressed) to clients that advertise woff2 support — including browsers. `loadGoogleFont()` detects a woff2 response and decodes it with the zero-dependency `@crstnmac/zeropdf/woff2` decoder, loaded lazily so Node users (who receive a plain `.ttf`/`.otf`) never pay for it.
:::

## Bundled fonts (offline, PDF/A-ready)

The PDF **Standard-14** fonts (Helvetica/Times/Courier) are never embedded — the viewer supplies them — which **PDF/A and PDF/UA forbid**. For accessible or archival output you must embed a real font. `registerBundledFonts()` registers a bundled, openly-licensed family set so this works offline with no font sourcing:

```ts
import { createDocument, registerBundledFonts } from "@crstnmac/zeropdf";

const doc = createDocument({ conformance: "pdf/a-2a" });
const fonts = await registerBundledFonts(doc);

doc.addPage().text("Accessible heading", { x: 56, y: 760, font: fonts.sans, bold: true });
```

`defaults.fallbackFonts` supplies the same list to every text path — paragraphs, headings, code, lists, tables, rich runs, and HTML — so a symbol font covering glyphs your body font lacks (dingbats like `✓`/`✕`, arrows, CJK) is configured once:

```ts
const doc = createDocument({
  defaults: { font: "Liberation Sans", fallbackFonts: ["Symbols"] },
});
doc.registerFontFamily("Symbols", { regular: symbolFontBytes });
```

A per-call `fallbackFonts` replaces the default rather than extending it; pass `[]` to opt a single call out.

Code content resolves its own default: `defaults.codeFont`, else `defaults.font`, else built-in `Courier`. Set `codeFont` to a monospaced family so code blocks and inline `<code>` runs stay embedded under PDF/A and PDF/UA:

```ts
const doc = createDocument({ defaults: { font: "Liberation Sans", codeFont: "Liberation Mono" } });
await registerBundledFonts(doc);
```

`fonts` is `{ sans, serif, mono }` — the **Liberation Sans/Serif/Mono** families (SIL OFL 1.1). They are **metric-compatible** with Helvetica/Times/Courier (and Arial/Times New Roman/Courier New), so swapping a built-in font for the bundled one embeds cleanly **without reflowing** your layout. Each family resolves `bold`/`italic`/`boldItalic` by flag, exactly like a font you register yourself.

The fonts ship in the package under `fonts/liberation/`. They are OFL-licensed (redistributable, embeddable); the license travels with them. If you build from source, fetch them once with:

```sh
npm run fetch-fonts
```

In the browser (where the on-disk default reader isn't available), pass `read` to supply the bytes:

```ts
await registerBundledFonts(doc, {
  read: (file) => fetch(`/fonts/${file}`).then((r) => r.arrayBuffer()),
});
```

## WOFF2 fonts

`decodeWoff2()` converts a `.woff2` file — the format browsers download and most font CDNs serve — into standard TTF/OTF bytes ready for `embedTrueTypeFont()` or `registerFontFamily()`:

```ts
import { createDocument } from "@crstnmac/zeropdf";
import { decodeWoff2 } from "@crstnmac/zeropdf/woff2";

const response = await fetch(woff2Url);
const ttf = decodeWoff2(new Uint8Array(await response.arrayBuffer()));

const doc = createDocument();
doc.registerFontFamily("Roboto", { regular: ttf });
```

The decoder implements Brotli (RFC 7932) and the WOFF2 glyf/loca and hmtx transform reversal with zero dependencies. It embeds the 122&nbsp;KB Brotli static dictionary, which is why it ships as a separate `@crstnmac/zeropdf/woff2` subpath — importing the core library never loads it. `isWoff2(bytes)` checks for the `wOF2` signature.

## Chrome Extension Fonts

`loadExtensionFont()` loads font files bundled with a Chrome extension and registers them as a named family in one call, ready for `text()`, `textBlock()`, and flow/template APIs:

```ts
import { createDocument } from "@crstnmac/zeropdf";
import { loadExtensionFont } from "@crstnmac/zeropdf/chrome-extension-fonts";

const doc = createDocument({ language: "en-US" });
await loadExtensionFont(doc, "Roboto", {
  regular: "fonts/Roboto-Regular.ttf",
  bold: "fonts/Roboto-Bold.ttf",
  italic: "fonts/Roboto-Italic.ttf",
  boldItalic: "fonts/Roboto-BoldItalic.ttf",
});

doc.addPage().text("Hello from Roboto", { x: 56, y: 760, font: "Roboto", fontSize: 24 });
doc.addPage().text("Roboto Bold", { x: 56, y: 730, font: "Roboto", bold: true });
```

Each path is relative to the extension root and resolved via `chrome.runtime.getURL()`. Fonts are fetched in parallel, converted to bytes, and passed to [`registerFontFamily()`](./text-and-fonts#embedded-fonts-font-families). Only `regular` is required — missing faces fall back to the closest available one.

For more control, use `loadExtensionFontBytes()` to fetch a single face and register it yourself:

```ts
import { loadExtensionFontBytes } from "@crstnmac/zeropdf/chrome-extension-fonts";

const bytes = await loadExtensionFontBytes("fonts/Inter-Regular.ttf");
const inter = doc.embedTrueTypeFont(bytes, { family: "Inter" });
```

To load fonts without registering them (e.g. to pass to `renderTemplate({ fonts })`), use `loadExtensionFontFaces()`:

```ts
import { loadExtensionFontFaces } from "@crstnmac/zeropdf/chrome-extension-fonts";

doc.renderTemplate({
  fonts: {
    Roboto: await loadExtensionFontFaces({
      regular: "fonts/Roboto-Regular.ttf",
      bold: "fonts/Roboto-Bold.ttf",
    })
  },
  blocks: [
    { type: "heading", text: "Title", options: { level: 1 } },
    { type: "paragraph", text: "Body text." }
  ]
});
```

::: warning Extension context only
`loadExtensionFont()`, `loadExtensionFontBytes()`, and `loadExtensionFontFaces()` require `chrome.runtime.getURL` to be available. They work in service workers, background scripts, and extension pages. When used from a content script, the font files must be listed in `web_accessible_resources` in `manifest.json` — a `Failed to fetch` error from a content script almost always means this entry is missing or its `matches` pattern does not cover the current page:

```json
{
  "web_accessible_resources": [{
    "resources": ["fonts/*.ttf"],
    "matches": ["<all_urls>"]
  }]
}
```
:::

## Font weights and styles (bold & italic)

The library does not synthesize bold or italic with a faux transform — each weight is a real font face for correct glyph metrics. But you don't have to juggle face names by hand: the `bold` and `italic` options on `text()` and `textBlock()` resolve to the right face.

### Built-in fonts

Set `bold` and/or `italic` against a base family name:

```ts
page.text("Regular",     { x: 56, y: 760, font: "Helvetica" });
page.text("Bold",        { x: 56, y: 740, font: "Helvetica", bold: true });
page.text("Italic",      { x: 56, y: 720, font: "Helvetica", italic: true });
page.text("Bold Italic", { x: 56, y: 700, font: "Helvetica", bold: true, italic: true });
```

The base name resolves to the matching standard-14 variant:

| Family | Regular | Bold | Italic | Bold + Italic |
|--------|---------|------|--------|---------------|
| Helvetica | `Helvetica` | `Helvetica-Bold` | `Helvetica-Oblique` | `Helvetica-BoldOblique` |
| Times | `Times-Roman` | `Times-Bold` | `Times-Italic` | `Times-BoldItalic` |
| Courier | `Courier` | `Courier-Bold` | `Courier-Oblique` | `Courier-BoldOblique` |

You can still pass an explicit variant name (e.g. `font: "Helvetica-Bold"`) directly. `Symbol` and `ZapfDingbats` have no weight variants. The `bold`/`italic` flags only resolve against the three base families above; on an already-styled name or an embedded handle they are ignored.

### Embedded fonts: font families

Register the weights as a **font family** so the `bold`/`italic` flags work the same way as for built-ins. Pass raw font bytes per face — they are embedded automatically under the family name:

```ts
const inter = doc.registerFontFamily("Inter", {
  regular:    await readFile("fonts/Inter-Regular.ttf"),
  bold:       await readFile("fonts/Inter-Bold.ttf"),
  italic:     await readFile("fonts/Inter-Italic.ttf"),
  boldItalic: await readFile("fonts/Inter-BoldItalic.ttf"),
});

page.text("Regular", { x: 56, y: 700, font: inter, fontSize: 14 });
page.text("Bold",    { x: 56, y: 680, font: inter, fontSize: 14, bold: true });
page.text("Italic",  { x: 56, y: 660, font: inter, fontSize: 14, italic: true });
```

`registerFontFamily()` returns the family name, so you can use it inline as the `font` value. Each face may be raw font **bytes** (embedded for you), a handle from `embedTrueTypeFont()`, or a built-in name. Only `regular` is required; a missing face falls back to the closest available one (bold italic → bold → italic → regular).

The `bold`/`italic` flags and registered families resolve the same way across `page.text()`, `page.textBlock()`, the `PdfFlow` cursor API (`flow.paragraph()`, `flow.heading()`), and `renderTemplate()` blocks. Document-wide [text defaults](./getting-started#convenience-helpers) (`createDocument({ defaults })`) also apply to all of these; per-call options always win, and a font configured on a flow takes precedence over document defaults.

You can also register fonts inline with `renderTemplate()` via the `fonts` option, without calling `registerFontFamily()` separately:

```ts
doc.renderTemplate({
  fonts: {
    Roboto: {
      regular: robotoRegularBytes,
      bold: robotoBoldBytes,
    }
  },
  page: { font: "Roboto" },
  blocks: [
    { type: "heading", text: "Title", options: { level: 1 } },
    { type: "paragraph", text: "Body text." }
  ]
});
```

See [Report Templates](./report-templates) for details.

If you prefer to manage handles yourself, you can still pass an embedded-font handle directly as `font` and skip the registry entirely. Variable fonts are embedded at their default instance; embed a separate file per named instance to ship multiple weights.

## Inline rich text (mixed styles on one line)

`page.text()` and `textBlock()` apply one style to the whole string. To mix fonts, weights, sizes, colors, or links **within a line** — and have them wrap together as one paragraph — use `page.richText()` with an array of `InlineTextRun`s:

```ts
import { rgb } from "@crstnmac/zeropdf";

page.richText(
  [
    { text: "Read the " },
    { text: "terms", bold: true, link: "https://example.com/terms" },
    { text: " and " },
    { text: "privacy policy", italic: true, color: rgb(0.1, 0.3, 0.8) },
    { text: " before continuing." },
  ],
  { x: 56, y: 700, width: 280, fontSize: 12 }
);
```

Each run carries its own `font`, `bold`, `italic`, `underline`, `strike`, `fontSize`, `color`, `kerning`, `characterSpacing`, `superscript`/`subscript` (or `rise`), `renderMode` (`strokeColor`/`strokeWidth`), `horizontalScaling`, and `highlight`; anything omitted inherits from the block `options`, then the document defaults. A run with a `link` becomes a clickable URI annotation covering exactly that span (contiguous linked runs on a line merge into one rectangle). Include spaces in the run `text` where you want them between adjacent runs.

In the flow/template layout, the same thing is `flow.richParagraph(runs, options)`, or a `richParagraph` template block:

```ts
flow.richParagraph([
  { text: "Status: " },
  { text: "PASSED", bold: true, color: rgb(0, 0.5, 0) },
]);

// As a template block:
doc.renderTemplate({
  blocks: [
    {
      type: "richParagraph",
      runs: [
        { text: "See the " },
        { text: "report", link: "https://example.com/report" },
        { text: " for details." },
      ],
    },
  ],
});
```

`align` supports `"left" | "center" | "right" | "justify"`, and `direction` accepts `"ltr" | "rtl" | "auto"` (line-level direction — runs are laid out from the right edge, not full mixed-direction bidi). Set `writingMode: "vertical"` to stack the runs in a single column. In flow and template layouts a `richParagraph` wraps and **splits across columns and pages** like a normal paragraph (vertical rich text stays in one column).

> For inline **links, highlights, underlines, or notes** over a substring of an *otherwise uniform* paragraph, you can also keep using `paragraph(text, options, annotations)` with `{ type: "link", match, url }` annotations — no need to split the text into runs. Reach for `richText`/`richParagraph` when you need differing **fonts/sizes/colors** on the same line.

## Underline and strike-through

Set `underline` and/or `strike` on any text call. They draw a line beneath or through the text (as a decorative artifact), and work per-run in `richText`:

```ts
page.text("Important", { x: 56, y: 700, underline: true });
page.text("Removed", { x: 56, y: 684, strike: true, color: "red" });

page.richText(
  [{ text: "See " }, { text: "the link", underline: true, link: "https://example.com" }],
  { x: 56, y: 660, width: 200 }
);
```

## Superscript, subscript, and baseline shift

`superscript` and `subscript` raise or lower the baseline and shrink the text to ~62% — the usual treatment for exponents, footnote markers, ordinals, and chemical formulas. For manual control, set `rise` (PDF points; positive lifts, negative drops) and an explicit `fontSize`.

```ts
page.richText(
  [
    { text: "E = mc" },
    { text: "2", superscript: true },
  ],
  { x: 56, y: 700, width: 200, fontSize: 16 }
);

page.richText(
  [
    { text: "H" },
    { text: "2", subscript: true },
    { text: "O" },
  ],
  { x: 56, y: 676, width: 200, fontSize: 16 }
);

// Raw baseline shift, no auto-resize:
page.text("™", { x: 120, y: 700, fontSize: 8, rise: 6 });
```

## Outlined and invisible text (render modes)

`renderMode` chooses how glyphs are painted (the PDF `Tr` operator):

- `"fill"` — fill with the text color (the default).
- `"stroke"` — outline only, using `strokeColor` (defaults to the text color) and `strokeWidth` (defaults to 1).
- `"fillStroke"` — fill **and** outline.
- `"invisible"` — render nothing (useful for an OCR text layer over a scanned image so it stays selectable/searchable).

```ts
page.text("OUTLINE", {
  x: 56, y: 700, fontSize: 36, bold: true,
  renderMode: "stroke", strokeWidth: 0.75, strokeColor: "red",
});
```

## Horizontal scaling

`horizontalScaling` stretches or condenses glyphs horizontally as a percentage (100 = normal; the `Tz` operator). Useful for fitting a label to a fixed width without changing the font size.

```ts
page.text("CONDENSED", { x: 56, y: 700, fontSize: 18, horizontalScaling: 75 });
page.text("EXPANDED",  { x: 56, y: 676, fontSize: 18, horizontalScaling: 130 });
```

## Highlighting text

`highlight` paints a filled rectangle behind the text (a tagged artifact), like a marker pen. It works on whole text calls and per-run in `richText`:

```ts
page.text("Action required", { x: 56, y: 700, highlight: "yellow" });

page.richText(
  [
    { text: "Status: " },
    { text: "APPROVED", bold: true, highlight: rgb(0.8, 1, 0.8) },
  ],
  { x: 56, y: 676, width: 240 }
);
```

> For a highlight that behaves as a reviewable PDF **annotation** (rather than baked-in page content), use the `highlight` text-markup annotation or the `{ type: "highlight", match }` paragraph annotation instead — see [Forms and annotations](./forms-and-annotations).

## Measuring text

Measure text without drawing it — useful for fitting, dynamic box sizing, or manual layout. The document's registered fonts and defaults are applied.

```ts
const { width, height } = doc.measureText("Heading", { fontSize: 24, bold: true });
const block = doc.measureTextBlock("Long copy…", { width: 200, fontSize: 12 });
// block => { width, height, lineCount }
const rich = doc.measureRichText([{ text: "A " }, { text: "B", bold: true }], { width: 200 });
```

`measureText` returns the single-line `{ width, height }`; `measureTextBlock` and `measureRichText` return `{ width, height, lineCount }` after wrapping to the given `width`. Measurements use the same engine that draws the text, so they account for the resolved font, `bold`/`italic`, kerning, and registered families.

A common use is sizing a box to its content — for example a right-aligned label or a background that hugs the text:

```ts
const label = "Total: $1,240.00";
const { width } = doc.measureText(label, { fontSize: 12, bold: true });
const x = pageRight - width;                 // right-align without a text block
page.rect(x - 6, y - 4, width + 12, 20, { fill: "silver" });
page.text(label, { x, y, fontSize: 12, bold: true });
```

## Kerning and ligatures

Embedded fonts emit kerning-aware `TJ` strings and apply common GSUB ligatures by default. Toggle with `kerning`:

```ts
page.text("office", { x: 56, y: 676, font, fontSize: 16, kerning: true });
page.text("office", { x: 56, y: 656, font, fontSize: 16, kerning: false });
```

## Wrapped text blocks

`textBlock()` lays out paragraphs with width, alignment, and line height:

```ts
page.textBlock("Wrapped copy with predictable line breaks.", {
  x: 56,
  y: 740,
  width: 240,
  fontSize: 12,
  lineHeight: 16,
  align: "center"
});
```

Alignment: `"left" | "center" | "right" | "justify"`.

## Vertical alignment

Horizontal `align` positions lines across the width. To position content *vertically* within a box of known height, give the box a `height` and a `verticalAlign` of `"top"` (default), `"middle"`, or `"bottom"`. The text is laid out as usual, then shifted down within the box. Works on `textBlock()` and `page.richText()`:

```ts
// Vertically centered within a 120pt-tall box starting at y
page.textBlock("Centered label", {
  x: 56, y: 700, width: 200, height: 120, verticalAlign: "middle"
});

page.richText(
  [{ text: "Card " }, { text: "title", bold: true }],
  { x: 56, y: 560, width: 200, height: 100, verticalAlign: "bottom" }
);
```

`height`/`verticalAlign` apply to horizontal writing mode; without `verticalAlign` the box `height` has no effect (text still starts at `y`).

### Table cells

Tables accept `verticalAlign` for the whole table and per cell. In a row where one cell wraps to several lines, shorter cells align within the row height:

```ts
page.table(
  [[
    { text: "A long cell that wraps across several lines in its column." },
    { text: "Top",    verticalAlign: "top" },
    { text: "Middle", verticalAlign: "middle" },
    { text: "Bottom", verticalAlign: "bottom" },
  ]],
  { x: 56, y: 760, width: 460, columnWidths: [160, 100, 100, 100], verticalAlign: "middle" }
);
```

Per-cell `verticalAlign` overrides the table default; the table default overrides the built-in `"top"`.

## Font fallback

Mix built-in and embedded fonts to cover scripts the primary font lacks:

```ts
const unicode = doc.embedTrueTypeFont(fallbackBytes, { family: "Fallback" });
page.text("Hello Ω", {
  x: 56,
  y: 700,
  font: "Helvetica",
  fallbackFonts: [unicode],
  fontSize: 14
});
```

Each glyph is resolved against the primary font, then each fallback in order.

## RTL and Arabic shaping

Set `direction` to `"rtl"` or `"auto"` to reverse glyph order. Arabic text receives contextual joining forms; `‌` (ZWNJ) and `‍` (ZWJ) override default joining.

```ts
page.text("שלום עולם", {
  x: 56,
  y: 620,
  font: hebrewFont,
  fontSize: 14,
  direction: "auto"
});

page.text("سلام", {
  x: 240,
  y: 620,
  font: arabicFont,
  fontSize: 18,
  direction: "auto"
});
```

`textBlock()` with `direction: "rtl"` right-aligns by default.

## Complex Script Shaping

Scripts requiring reordering, mark positioning, or syllable clustering—Devanagari, Khmer, Myanmar, Thai—are shaped by the default shaper built into the text engine. The shaper handles:

- **Devanagari** — conjuncts, half-forms, repha, and nukta
- **Khmer** — subjoined consonants and coeng clusters
- **Myanmar** — medial consonants, kinzi, and asat
- **Thai** — tone marks, upper/lower vowel positioning, no reordering needed (left-to-right)

```ts
const devaFont = doc.embedTrueTypeFont(devaBytes, { family: "NotoDeva" });
page.text("देवनागरी", { x: 56, y: 600, font: devaFont, fontSize: 14 });
```

### Custom shapers

If your script requires engine-specific shaping logic, implement the `TextShaper` interface:

```ts
interface TextShaper {
  shape(text: string, font: EmbeddedFont): ShapedGlyph[];
}
```

The shaper is document-wide, not per-font. Set it at construction or with `setTextShaper()`:

```ts
const doc = new PdfDocument({ textShaper: myShaper });
// or, later:
doc.setTextShaper(myShaper);
```

External shapers such as harfbuzzjs or fontkit can be plugged in here to enable full complex-script shaping.

## Vertical Writing Mode

Set `writingMode: "vertical"` for CJK vertical text. Glyphs are stacked top-to-bottom:

```ts
page.text("縦書きのテキスト", {
  x: 56,
  y: 600,
  font: cjkFont,
  fontSize: 14,
  writingMode: "vertical"
});
```

### Tate-chu-yoko

Horizontal-in-vertical digits trigger tate-chu-yoko (horizontal within vertical). Two-digit numbers and short runs of Latin characters are automatically rendered horizontally within a single vertical glyph cell:

```ts
page.text("令和5年", {
  x: 56,
  y: 600,
  font: cjkFont,
  fontSize: 14,
  writingMode: "vertical"
});
// "5" rendered horizontally inline
```

## Soft Hyphens

The soft hyphen character (`\xAD`, U+00AD) inserts an invisible break opportunity. When a line wraps at a soft hyphen, a visible hyphen glyph is rendered at the break point:

```ts
page.textBlock("super­cali­fragilistic­expi­ali­docious", {
  x: 56,
  y: 720,
  width: 120,
  fontSize: 12,
  lineHeight: 16,
  font
});
// Wraps with visible hyphens at each \xAD position
```

Use soft hyphens to control line-breaking in narrow columns without hard-coding line endings.

## Unicode Supplementary Plane

Characters beyond the Basic Multilingual Plane (U+10000–U+10FFFF) occupy 4-byte code points in UTF-16 and map to surrogate pairs. The library handles:

- **Emoji** (U+1F600–U+1F9FF) — rendered via embedded color-capable fonts or monochrome fallback glyphs
- **CJK Extension B and beyond** (U+20000–U+2FFFF) — mapped through `ToUnicode` CMap entries for text extraction

```ts
page.text("Hello 😊🌍", {
  x: 56,
  y: 580,
  font: emojiFont,
  fontSize: 16
});
```

Glyphs without a corresponding font table entry are silently omitted; use a font with full supplementary-plane coverage to avoid missing characters.

## Bi-Directional Embedding

Explicit directional marks control embedding levels within a single text run:

| Character | Code | Effect |
|-----------|------|--------|
| LRE (Left-to-Right Embedding) | `\u202A` | Starts a left-to-right embedding |
| RLE (Right-to-Left Embedding) | `\u202B` | Starts a right-to-left embedding |
| PDF (Pop Directional Formatting) | `\u202C` | Terminates the most recent embedding |
| LRM (Left-to-Right Mark) | `\u200E` | Invisible LTR marker |
| RLM (Right-to-Left Mark) | `\u200F` | Invisible RTL marker |

```ts
page.text("\u202Bשלום\u202C world", {
  x: 56,
  y: 560,
  font,
  fontSize: 14,
  direction: "auto"
});
// "שלום" rendered RTL inside an otherwise LTR run
```

These control characters work alongside the `direction` option for mixed-direction text blocks.

## Built-in Font Encoding

The standard 14 fonts support three encodings via the `encoding` option:

| Encoding | Character set | Use case |
|----------|--------------|----------|
| `"WinAnsiEncoding"` | Windows-1252 (default) | Latin-1 + common symbols |
| `"MacRomanEncoding"` | Mac OS Roman | Legacy Mac documents |
| `"PDFDocEncoding"` | PDFDocEncoding glyph set | ISO Latin-1 with additional characters (Euro, florin, dagger) |

```ts
page.text("Åççèñtèd téxt", {
  x: 56,
  y: 540,
  font: "Helvetica",
  encoding: "WinAnsiEncoding"
});
```

Embedded TrueType fonts always use the font's native cmap and are not affected by the `encoding` option.

## Font Format Support

The font embedder accepts TrueType-based formats via `embedTrueTypeFont()`:

| Format | Extension | Notes |
|--------|-----------|-------|
| **TrueType** | `.ttf` | Quadratic Bézier outlines, full Unicode cmap |
| **OpenType CFF** | `.otf` | PostScript outlines (Type 2 charstrings), compact file size |
| **OpenType CFF2** | `.otf` | Variable-font version of CFF, reduced charstring overhead |
| **Type 1** | `.pfb` / `.pfa` | PostScript Type 1 format. PFA (ASCII) and PFB (binary) both supported. Limited to 256 glyphs; no Unicode cmap—use only for legacy compatibility |
| **TrueType Collection** | `.ttc` | Multi-font archive. Pass the collection file and specify a `ttcIndex` to select a face |

```ts
// OpenType CFF
const otfBytes = await readFile("fonts/SourceSerif4-Regular.otf");
const otfFont = doc.embedTrueTypeFont(otfBytes, { family: "SourceSerif4" });

// TTC collection, second face
const ttcBytes = await readFile("fonts/Cambria.ttc");
const cambria = doc.embedTrueTypeFont(ttcBytes, {
  family: "Cambria",
  ttcIndex: 1
});
```

Type 1 fonts are supported for compatibility with legacy documents but should be avoided in new documents due to the 256-glyph limit and lack of Unicode mapping.
