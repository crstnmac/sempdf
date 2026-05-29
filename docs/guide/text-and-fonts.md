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

Pass the custom shaper when embedding the font:

```ts
const font = doc.embedTrueTypeFont(fontBytes, {
  family: "CustomScript",
  textShaper: myShaper
});
```

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
| **TrueType Collection** | `.ttc` | Multi-font archive. Pass the collection file and specify a `fontIndex` to select a face |

```ts
// OpenType CFF
const otfBytes = await readFile("fonts/SourceSerif4-Regular.otf");
const otfFont = doc.embedTrueTypeFont(otfBytes, { family: "SourceSerif4" });

// TTC collection, second face
const ttcBytes = await readFile("fonts/Cambria.ttc");
const cambria = doc.embedTrueTypeFont(ttcBytes, {
  family: "Cambria",
  fontIndex: 1
});
```

Type 1 fonts are supported for compatibility with legacy documents but should be avoided in new documents due to the 256-glyph limit and lack of Unicode mapping.
