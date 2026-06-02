# Changelog

All notable changes to `@criston/sempdf` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [1.2.1] - 2026-06-02

### Fixed

- The `font` text option now accepts a font-family name registered with `registerFontFamily()` (and any `string`-typed value), instead of rejecting it at compile time. `PdfFont` widened to `FontName | PdfEmbeddedFont | (string & {})`, preserving built-in name autocomplete.

## [1.2.0] - 2026-06-02

### Added

- Inline rich text: `PdfPage.richText()` and `PdfFlow.richParagraph()` lay out an array of `InlineTextRun` segments that flow on the same line and wrap together, each with its own font, weight, size, color, and optional `link`.
- `richParagraph` template block (`TemplateRichParagraphBlock`) for inline rich text in `renderTemplate()`.
- Inline rich text supports `align: "justify"`, line-level `direction` (`"ltr" | "rtl" | "auto"`), and `writingMode: "vertical"` (single-column stacking); flow and template rich paragraphs wrap and split across columns and pages.
- Vertical alignment: `verticalAlign` (`"top" | "middle" | "bottom"`) on table cells (`TableOptions` default and per-`TableCellDefinition`).
- Vertical alignment within a fixed-height box via `height` + `verticalAlign` on `TextBlockOptions` and `RichTextOptions`.
- New exported types: `InlineTextRun`, `RichTextOptions`, `FlowRichTextOptions`, `TemplateRichParagraphBlock`, `VerticalAlign`.

## [1.1.0] - 2026-06-02

### Added

- `bold` and `italic` text options that resolve to the matching font face for the standard-14 base families (Helvetica, Times, Courier).
- `PdfDocument.registerFontFamily()` to group font faces (built-in or embedded) under a name, selectable with the `bold`/`italic` flags.
- Document-wide text defaults via `createDocument({ defaults })` (`font`, `bold`, `italic`, `fontSize`, `color`, `kerning`, `direction`).
- Unit helpers `mm()`, `cm()`, `inch()`, and `pt()` for authoring layouts in physical units.
- `PdfDocument.save(path)` convenience alias for `writeToFile()`.

### Changed

- `PdfPage` builder methods (text, images, annotations, form fields, graphics state, transforms) now return `this` for fluent chaining.
- `bold`/`italic`, registered font families, and document defaults resolve uniformly across `page.text()`/`textBlock()`, the `PdfFlow` cursor API, `renderTemplate()` blocks, and structure containers.

## [1.0.0] - 2026-05-11

### Added

- Zero-dependency PDF 1.4+ generation engine in TypeScript.
- PDF 1.5 object streams and 2.0 encryption support.
- Text rendering with 14 standard fonts plus embedded TrueType (Unicode, kerning, ligatures, RTL/Arabic).
- Image support: JPEG, PNG (transparency/alpha).
- Tagged PDF for accessibility: PDF/UA-1, structure trees, MCID-based marked content.
- Flow-based coordinate-free layout engine.
- Template-based report/document rendering with headers, footers, page numbers, and auto-outline.
- Forms (AcroForm): text, checkbox, radio, choice, push button, signature.
- Annotations: URI links, highlights, notes, free-text.
- Encryption: rc4-40, rc4-128, AES-128, AES-256.
- PDF parsing and incremental editing: metadata, pages, forms, overlays.
- Page transfer utilities: extract, split, merge, append.
- Streaming output via ByteSink abstraction.
- XMP metadata support.
- Linearized (Fast Web View) output for single-page documents.
- PDF version auto-detection and conformance validation.
