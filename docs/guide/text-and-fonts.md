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
