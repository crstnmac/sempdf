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
import { createDocument, loadGoogleFont } from "@criston/sempdf";

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

::: warning Node-first
The Google Fonts API serves **woff2** (Brotli-compressed) to clients that advertise woff2 support — including browsers — and this zero-dependency engine cannot decode woff2. Node's `fetch` does not advertise woff2, so it receives an embeddable `.ttf`/`.otf`. Call `loadGoogleFont()` from Node. In the browser, download a `.ttf`/`.otf` yourself (for example from [@fontsource](https://fontsource.org/)) and pass the bytes straight to `embedTrueTypeFont()`.
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

If you prefer to manage handles yourself, you can still pass an embedded-font handle directly as `font` and skip the registry entirely. Variable fonts are embedded at their default instance; embed a separate file per named instance to ship multiple weights.

## Inline rich text (mixed styles on one line)

`page.text()` and `textBlock()` apply one style to the whole string. To mix fonts, weights, sizes, colors, or links **within a line** — and have them wrap together as one paragraph — use `page.richText()` with an array of `InlineTextRun`s:

```ts
import { rgb } from "@criston/sempdf";

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

Each run carries its own `font`, `bold`, `italic`, `fontSize`, `color`, `kerning`, and `characterSpacing`; anything omitted inherits from the block `options`, then the document defaults. A run with a `link` becomes a clickable URI annotation covering exactly that span (contiguous linked runs on a line merge into one rectangle). Include spaces in the run `text` where you want them between adjacent runs.

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
