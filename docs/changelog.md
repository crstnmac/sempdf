# Changelog

All notable changes to `@criston/zeropdf` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [1.5.1] - 2026-06-10

### Fixed

- `PdfFlow.richParagraph()` and `PdfPage.richText()` produced text ops without a `tag`, so the tagged PDF structure tree showed the `P` element with empty marked-content identifiers. The block-level tag now flows through to each run's options so the structure tree carries the correct MCIDs.

## [1.5.0] - 2026-06-06

### Added

- `renderDocumentJson(document)` and `renderDocumentJsonSync(document)` — render a PDF from a single, fully serializable [`PdfDocumentJson`](./guide/json-to-pdf) value. Closes the three parts of the template API that cannot be expressed as JSON: fonts are declared by source (`base64` / file `path` / `url` / Google Fonts) and referenced by name; images carry a `src` instead of raw bytes; headers/footers are static block arrays with `{{pageNumber}}` / `{{pageCount}}` / `{{title}}` / `{{author}}` tokens. Document options (encryption, conformance, language, tagged, metadata) live on the root. `renderDocumentJson` is async (assets may load from disk or network); `renderDocumentJsonSync` handles fully inline (`base64`) documents.
- Absolute positioning in `PdfDocumentJson`: add a `position` (`{ x, y, width?, height?, page?, origin? }`) to a block to draw it at exact PDF-point coordinates instead of flowing. Positionable types: `paragraph`, the image formats, `rect`, `textField`, `checkBox`, `signatureField`. Flow and positioned blocks mix in the same `blocks` array. See [JSON to PDF](./guide/json-to-pdf#absolute-positioning-coordinate-system).
- `PdfDocument.getPage(index, origin?)` and `PdfDocument.pageCount` — return a `PdfPage` builder for an already-created page (for example one produced by `renderTemplate`), so finished pages can be drawn on with the absolute-coordinate APIs.
- `PdfErrorCode.INVALID_DOCUMENT_JSON`, thrown for a malformed `PdfDocumentJson` with a message that names the offending path.

### Fixed

- `ParsedPdfDocument.extractText()` returned empty text for pages whose content stream was FlateDecode-compressed (common once a page carried a table, list, or header/footer). `getObject()` inflates a lazy stream while leaving its `Filter` in the dict; the extractor then decoded the already-inflated bytes a second time and silently discarded the page. Text and `ToUnicode` decoding now tolerate the pre-decoded bytes.

## [1.4.1] - 2026-06-03

### Added

- `loadGoogleFont(family, { weight, italic, text })` — downloads a Google Font and returns its TrueType/OpenType bytes, ready for `embedTrueTypeFont()` or `registerFontFamily()`. Node-first: the Google Fonts API serves `woff2` to browsers (which the zero-dependency engine cannot decode) and an embeddable `.ttf`/`.otf` to Node. Supports `&text=` subsetting and a custom `fetch`.

## [1.4.0] - 2026-06-03

### Added

- `description` option on all form fields (`textField`, `checkBox`, `choiceField`, `radioGroup`, `pushButton`, `signatureField`, and their `renderTemplate` blocks), emitted as `/TU`. Assistive technology reads it as the field's accessible name, and it satisfies the "form fields have a description" accessibility check.

### Changed

- `renderTemplate` now tags form-field widgets into the structure tree automatically (default `tag: "Annot"`, emitting an `OBJR` reference), so generated forms pass the "tagged annotations" and "tagged form fields" accessibility checks without per-field configuration. Set `tag: "Artifact"` on a field block to opt out.

## [1.3.0] - 2026-06-02

### Added

- Shape helpers on `PdfPage`: `rect()`, `line()`, `circle()`, `ellipse()` with a simplified `ShapeStyle` (inferred fill/stroke paint mode).
- Text measurement: `PdfDocument.measureText()`, `measureTextBlock()`, and `measureRichText()` return width/height/line-count without drawing.
- `PdfPage.image()` auto-detects the raster format (PNG, JPEG, GIF, BMP, TIFF, WebP, JPEG 2000) from the data.
- `addPage({ origin: "top-left" })` flips the y-axis so coordinates grow downward from the top edge — applied across the page drawing, annotation, and form-field methods.
- `underline` and `strike` options on text and inline runs, drawn as decorative lines.
- Named colors: text/shape `color` options accept names like `"red"`, plus a `color()` helper that resolves named and `#hex` colors.
- Shape and image helpers on `PdfStructureContainer` (`rect`, `line`, `circle`, `ellipse`, `image`, `path`) and `ellipse`/`line` on `PdfFlow`.
- `registerFontFamily()` accepts raw font bytes per face (embedded automatically) in addition to handles and built-in names (`FontFamilyInput`).
- Document-wide shape defaults via `createDocument({ shapeDefaults })`, merged beneath per-call styles by the page shape helpers.
- Layout-feedback methods `PdfPage.placeText()` and `placeTextBlock()` that draw and return `{ width, height, (lineCount,) endY }` for manual stacking.
- "Choosing an API" guide page mapping common goals to the right API.

### Changed

- The `font` option now reports a clear "did you mean" error (`INVALID_FONT`) for an unknown string font instead of silently falling back, suggesting the closest standard-14 name. Unknown page-size names throw `INVALID_PAGE_SIZE` with the same suggestion treatment.
- `PdfStructureContainer` builder methods (`text`, `textBlock`, `list`, `table`, image, `link`) now return `this` for chaining, consistent with `PdfPage` and `PdfFlow`.

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
