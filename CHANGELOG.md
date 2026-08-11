# Changelog

All notable changes to `@crstnmac/sempdf` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [2.5.1] - 2026-08-10

### Added

- **`defaults.fallbackFonts`.** A document-wide fallback list, consulted by
  every text path that omits its own — paragraphs, headings, code, lists,
  tables, rich runs, and HTML — so a symbol font covering glyphs the body font
  lacks (`✓`, `✕`, arrows, CJK) is configured once at `createDocument` instead
  of on every call. Precedence is per-call → flow state → document default; a
  per-call list replaces the default rather than extending it, and `[]` opts a
  single call out. `RichTextOptions.fallbackFonts` is new too, so rich runs can
  set the list at block level.

### Fixed

- **`page.list()` ignored registered font families.** A family name in the
  list's `font` (or now `fallbackFonts`) reached layout unresolved instead of
  being mapped to a concrete face, so it rendered with the fallback font or
  threw `UNSUPPORTED_CHARACTER`. `page.list()` and `container.list()` now
  resolve families like every other block; `flow.list()` was unaffected.

## [2.5.0] - 2026-08-05

### Added

- **Compliance errors name the offending page and text.** A built-in font
  error under `pdfua-*`/`pdfa-*`/`wtpdf` said only that embedded fonts were
  required, leaving the offending content to be hunted by hand. The message now
  appends the first three offenders (`page 2 · font "Courier" · "const answer
  = 42;"`) and the issue carries a `locations` array
  (`PdfComplianceLocation[]`: 1-based `page`, `kind`, `font`, `annotation`,
  `name`, `snippet`) with up to 25 entries, on both `validateCompliance()` and
  the `INVALID_COMPLIANCE` error's `details.issues`.
- **`defaults.codeFont`.** Code content resolves its font as per-call `font` →
  `defaults.codeFont` → `defaults.font` → built-in `Courier`, covering
  `flow.code()`, `code` template blocks, and inline `<code>`/`<kbd>`/`<samp>`
  runs from HTML. Point it at an embedded monospaced family (e.g. the bundled
  Liberation Mono) to keep listings out of the built-in-font compliance error.

### Changed

- **Code blocks no longer hardcode built-in `Courier`.** A document whose
  `defaults.font` is embedded previously still emitted Courier for every code
  block, silently failing PDF/UA and PDF/A. Set `defaults.codeFont` to keep a
  monospaced face; documents that set neither default are unaffected.

## [2.4.0] - 2026-07-30

### Added

- **Multi-page continuity for code blocks.** A listing that spans pages or
  columns already split line-by-line; now it can say so. `continuedLabel` draws
  a note at the top of every fragment after the first and `continuesLabel` at
  the bottom of every fragment that carries on — a fixed string, or a callback
  given `{ fragmentIndex, firstLineNumber, lastLineNumber, totalLines }`. Notes
  are artifacts (never read as code) and reserve their own line, so they never
  overlap the listing. Styled with `continuationFontSize`,
  `continuationColor`, and `continuationAlign`.
- **Open borders at a split.** A bordered block now omits the rule under a
  fragment that continues and above one that resumes, so consecutive fragments
  read as one listing instead of a stack of boxes. `openSplitEdges: false`
  restores a closed box per fragment.

### Changed

- **One `Code` structure element per page instead of per fragment.** A block
  that split across the columns of a single page produced a separate `Code`
  element per column; the fragments now share the page's element, and a new one
  starts only on a new page.

## [2.3.1] - 2026-07-30

### Fixed

- **A block missing its content field crashed with a bare `TypeError`.**
  Template pagination estimates every block's height before any validation
  runs, so `{ type: "paragraph", code }` (a `code` block mistyped),
  `{ type: "heading" }` with no `text`, or a `richParagraph`/`list`/`table`
  with no `runs`/`items`/`rows` died on `Cannot read properties of undefined
  (reading 'replace' | 'map' | 'length')` from deep inside layout, naming
  neither the block nor the field. Every text-bearing block now throws
  `PdfEngineError` (`INVALID_TEXT`) naming what was expected and which field it
  belongs in, from both the render and estimate paths.
- **An `html` block given the wrong field rendered nothing at all.**
  `{ type: "html", text: "<p>…</p>" }` (rather than `html`) silently produced
  no output, so content vanished from the document with no error.
  `htmlToBlocks()` and the `html` block now throw `INVALID_TEXT` naming the
  `html` field for a non-string source; an empty or whitespace-only string
  still yields no blocks, as before.

## [2.3.0] - 2026-07-30

### Added

- **Accent folding, and `normalizeText: "ascii-only"`.** The built-in fonts
  encode ASCII only, so European text failed with `UNSUPPORTED_CHARACTER` even
  though it has an obvious ASCII form. `htmlToBlocks()`'s default
  `normalizeText: "ascii"` now strips accents through Unicode decomposition
  (`Muñoz` → `Munoz`, `café` → `cafe`) plus an explicit map for letters that do
  not decompose (`Æ` → `AE`, `ß` → `ss`, `Ø` → `O`, `Þ` → `TH`, `ı` → `i`,
  `Ł` → `L`, `ŋ` → `ng`). Characters with no ASCII form — Devanagari, CJK,
  emoji — are still left alone rather than silently dropped; the new
  `"ascii-only"` mode opts into dropping them for pipelines that must never
  fail and cannot embed a font. The folding helper is exported as
  `foldToAscii(text, asciiOnly?)`.
- **The Latin-1 named entities.** `&eacute;`, `&ntilde;`, `&uuml;`, `&Oslash;`,
  `&szlig;`, `&AElig;`, `&thorn;` and the rest of the accented set now decode;
  previously they passed through as literal `&eacute;` text.

### Changed

- **`UNSUPPORTED_CHARACTER` now says what failed and how to fix it.** The
  message names the character and its code point (`"日" (U+65E5)`) and points at
  `registerBundledFonts()` / `embedTrueTypeFont()` / `loadGoogleFont()` /
  `fallbackFonts` / text normalization. `details` gains `font` and `excerpt` —
  a window of the surrounding text — so the offending field is findable in a
  large document.

## [2.2.1] - 2026-07-30

### Fixed

- **A `code` block with a missing or misnamed source crashed with a bare
  `TypeError`.** Template pagination estimates every block's height before any
  text validation runs, so `{ type: "code" }` with no `code` field (or `text`
  used by mistake, or an undefined database column) reached
  `estimateCodeHeight` and died on `Cannot read properties of undefined
  (reading 'replace')` with no hint about the cause. Both the render and
  estimate paths now throw `PdfEngineError` (`INVALID_TEXT`) naming the `code`
  field and the type received.
- **An empty `code` block no longer throws or draws an empty band.** A blank or
  whitespace-only source (a CMS field with no content) previously threw
  `INVALID_TEXT` for `""` yet rendered a stray empty band for `"   "`. Both now
  render nothing and consume no vertical space.

## [2.2.0] - 2026-07-30

### Added

- **`htmlToBlocks()`, an `html` template block, and `flow.html()` — HTML to
  PDF blocks.** Converts the HTML that CMS fields and rich-text editors emit
  into template blocks: headings, paragraphs with inline runs, nested
  ordered/unordered lists, tables (`th`/`scope`/`colspan`/`rowspan`/`caption`),
  `pre` code blocks, blockquotes, rules, and images. Output is ordinary block
  data, so it paginates, tags itself, feeds the TOC/auto-outline, and takes
  stylesheets. `html` blocks are expanded before pagination, so headings inside
  them still reach the TOC — including from `renderDocumentJson`, which lets
  pure-JSON callers ship rich text.
  Entity decoding covers named, decimal, hex, and double-encoded
  (`&amp;mdash;`) references, exported on its own as `decodeHtmlEntities()`.
  `normalizeText: "ascii"` (default) folds smart quotes, dashes, `&nbsp;`,
  `&mdash;`, arrows, fractions, and currency symbols to ASCII so the built-in
  ASCII-only fonts render converted content; `"none"` keeps the original
  characters for embedded Unicode fonts. Untrusted input is handled by design:
  scripts, styles, embeds, and form controls are dropped with their content,
  link schemes are allow-listed (`javascript:` renders as plain text), and
  malformed markup recovers instead of throwing.

- **`code` template block and `flow.code()` — preformatted code blocks.**
  Renders monospaced text with leading whitespace and hard line breaks kept
  verbatim (paragraphs collapse both), on a background band that repeats on
  every page or column the block spans, so a code listing longer than a page
  paginates itself. Options cover typography, band fill/border/padding, tab
  expansion, soft wrap with a hanging indent (or clipping), a line-number
  gutter, and ordered regex highlight rules; `pattern` accepts a string so
  rules stay JSON-serializable for `renderDocumentJson`. Tagged as a `Code`
  element inside a `P` by default (`tag: "P"` or `"Artifact"` to change it).
  Adds `codeBefore`/`codeAfter` to `FlowSpacingScale`.

### Fixed

- **A rich paragraph ignored its runs' `highlight` color.** `flow.richParagraph()`
  (and so `richParagraph` blocks) pushed underline/strike decorations but never
  the highlight fills, so a run with `highlight` rendered without its
  background. The page-level rich-text API was unaffected.

## [2.1.5] - 2026-07-20

### Fixed

- **Security: certificate-recipient encryption used a predictable RNG for
  cryptographic material.** `generateRandom20ByteSeed()` (RSA public-key
  encryption seed) and the PKCS#1 v1.5 padding bytes in `rsaEncryptPkcs1`
  were both filled with `Math.random()` — not cryptographically secure, so
  the seed and padding were theoretically predictable to an attacker who
  could observe enough output. Both now draw from
  `globalThis.crypto.getRandomValues` (CSPRNG), falling back to
  `Math.random()` only in runtimes without a Web Crypto API. No API change;
  affects only documents encrypted for certificate recipients.

## [2.1.0] - 2026-07-17

### Changed


### Added

- **`hsl()` color helper.** `hsl(h, s, l)` converts to an RGB color, alongside the existing `rgb`/`cmyk`/`gray`/`hex`/`color` helpers. Saturation/lightness accept a `0–1` fraction, a percentage string (`"87%"`), or a `0–100` number; `color()` also parses CSS `hsl(...)` strings (e.g. `color("hsl(87, 87%, 80%)")`).
- **Report pagination controls.** Every template block now accepts `breakBefore`/`breakAfter` (force a fresh region before/after), `keepTogether` (never split; for paragraphs this disables column line-splitting), and `widows`/`orphans` (minimum lines to carry into / leave before a break when a paragraph splits across columns).
- **Table of contents.** A `{ type: "toc" }` template block builds a linked, page-numbered contents list from the document's heading blocks. Page numbers resolve after layout, so the TOC can sit at the front and point forward. Tagged for PDF/UA as a `TOC` → `TOCI` → `Reference` → `Link` hierarchy, with the entry text inside the `Link` (accessible name) and the link annotation nested in the same `Link`. Options: `maxLevel`, `font`, `fontSize`, `lineHeight`, `indent`, `link`, `pageNumbers`, a decorative `leader` (`"dots"` | `"line"` | `"none"`) with `leaderColor` (drawn as an artifact so AT never announces it), `levelStyles` (per-level font/size/color), and `numbering` (hierarchical `Lbl` section numbers like `1.2`). Page numbers are right-aligned into a column.
- **Cross-references.** Any block can declare a named `anchor`; a `{ type: "crossRef", to, text }` block links to it and substitutes the resolved page number (via a `{page}` placeholder or appended).
- **Footnotes.** A `footnote` on a text block appends a numbered marker and renders the note at the bottom of the page it lands on; the paginator reserves the space so notes never overlap content.
- **Smarter tables.** `columnWidths: "auto"` sizes columns to their content (natural width scaled to fill, shrinking toward the longest word). `footerRows: N` repeats the last `N` rows at the bottom of every page when a table splits (mirroring `headerRows`).
- **Image fit, positioning, and clipping.** Raster image placements accept `fit` (`"fill"` | `"contain"` | `"cover"`), `position` (9 anchors), and `clip` (`"none"` | `"circle"` | `"ellipse"`), applied consistently across page, flow, and template image blocks.
- **Page background color.** `createDocument` accepts a `pageBackground` color that fills every page (via `addPage` and `renderTemplate`) behind all content, tagged as an artifact; `renderTemplate` also accepts a `pageBackground` that overrides it per template.
- **Watermarks.** `renderTemplate` accepts a `watermark` option (a string or `TemplateWatermarkOptions`) that draws a diagonal, centered, semi-transparent mark behind every page, auto-sized to span the page and always tagged as an artifact.
- **Master-page backgrounds.** `renderTemplate` accepts a `background` callback returning blocks drawn behind every page's content (tints, rules, logos).
- **Rich text in list items.** List items accept `InlineTextRun[]` bodies (mixed fonts, sizes, colors, bold/italic, links) in addition to plain strings, across page-level `list()`, flow lists, and template list blocks — with layout estimation handling the rich runs correctly.
- **Text formatting run options.** Superscript/subscript, baseline `rise`, render modes (`stroke` outline, `fillStroke`, `invisible`), and inline `highlight` (marker-pen fill behind text) — on whole text calls, `richText`/`richParagraph` runs, and template paragraphs.
- **Per-cell table borders.** Cells accept individual border overrides (per-side width/color) on top of the table-wide `borders`/`borderColor` options.
- **Liberation fonts bundled.** Metric-compatible embedded replacements for Helvetica/Times/Courier (SIL OFL) ship in the package with fetch/verify scripts — the recommended fonts for PDF/UA output, where standard-14 name references don't satisfy the embedded-font requirement.

### Fixed

- **TOC, footnotes, and cross-references now inherit the selected font from any source.** They previously ignored the template's font and rendered in the built-in default. They now resolve the font from `page.font`, the document `defaults.font`, or the stylesheet `paragraph` style (still overridable per feature/level).
- **`PdfPage.container()` and `PdfPage.structure()` now inherit the document's font families and text defaults.** Text drawn through a page-level structure container previously lost the default font and registered families (falling back to Helvetica); this also drove the TOC font regression above.
- **Master-page background text is no longer clipped off the top of the page.** The `background` flow started at the exact top edge, so a background paragraph's first line was drawn above the page and never appeared. It now starts at the top content edge like the body flow.
- **Horizontal text scaling now affects layout.** `horizontalScaling` (the `Tz` operator) is now included in width measurement, so wrapping, alignment, justification, and highlight/annotation rectangles are correct for condensed/expanded text.

## [2.0.0] - 2026-06-25

## [1.9.0] - 2026-06-24

### Added

- **AES PDF encryption now works in the browser.** AES (`aes-128`, `aes-256`, `aes-256-r6`) previously required Node's `crypto` and threw `"AES PDF encryption requires Node.js crypto support"` in browsers. The library now falls back to a built-in, zero-dependency AES-CBC + SHA-256/384/512 implementation when `node:crypto` is unavailable, so encrypting and decrypting run client-side. Output is byte-for-byte compatible with the Node path (verified against Node's native crypto), so a document encrypted in the browser opens with the same password in any reader. Node continues to use its native crypto for speed. The only browser requirement is a secure-random source for the IV/key, read from the Web Crypto API. A "Browser AES encryption" playground sample and docs were added.

## [1.8.0] - 2026-06-24

### Added

- **Optional veraPDF validation adapter.** New `validateWithVeraPdf(bytes, options)` shells out to a veraPDF executable when one is available and returns the supplied custom-checker issues otherwise — veraPDF is never bundled and adds no dependencies. The result reports its `source` (`"verapdf"` or `"custom"`), whether veraPDF was `available`, the `compliant` flag, and issues normalized to `PdfComplianceIssue`. The flavour is auto-derived from the `conformance` profile (e.g. `pdfa-2b` → `2b`, `pdfua-1` → `ua1`) or set explicitly; the executable resolves from `verapdfBin`, then `VERAPDF_BIN`, then `verapdf` on `PATH`. Node-only: `node:*` modules are imported lazily so browser bundles never reach this code. The defensive report parser is exported separately as `parseVeraPdfReport`.

## [1.7.2] - 2026-06-24

### Fixed

- **Page- and container-level `table()` still ignored `textDefaults` (incomplete 1.7.1 fix).** `1.7.1` seeded the cell base font from `textDefaults` only on the flow (`flow.table`) path. The direct `page.table()` and structure-container `table()` methods passed call `options` straight through as the cell base and the table-wide font, so with no per-call `font` a styled/header cell hit the hardcoded `base.font ?? "Helvetica"` and plain cells inherited an unseeded table font — `pdfua-1` `INVALID_COMPLIANCE` again. Both methods now seed `font`/`fontSize`/`color`/`kerning` from `textDefaults` (call options still win).
- **Page- and container-level `list()` had the same gap.** `page.list()` and the structure-container `list()` passed `options` to `normalizeListOptions` without merging `textDefaults`, so a list with no explicit `font` fell back to `"Helvetica"`. They now seed list defaults from `textDefaults` too, matching the flow list path fixed in 1.7.1.

## [1.7.1] - 2026-06-24

### Fixed

- **Lists and tables ignored `defaultFont` / document `textDefaults`.** Paragraphs and headings inherit document-wide text defaults, but the list and table block paths merged only the flow-configured defaults — never the document `textDefaults` — so list items and table cells fell back to the hardcoded `"Helvetica"`. Under `pdfua-1` this produced `INVALID_COMPLIANCE` (visible text in a non-embedded font). List render/estimate and table render/row-height paths now merge `textDefaults` at lowest priority (matching paragraph behavior), and table cell base styling seeds `font`/`fontSize`/`color`/`kerning` from `textDefaults` too. A font set "for the whole page" now applies to lists and tables without an explicit per-block override.
- **List height estimate threw when block options were present.** The estimate path only injected the auto-width when a list block carried no options, so passing any option (e.g. `font`) dropped the width and `normalizeListOptions` threw `width must be a finite number`. The estimate path now always seeds the flow width, still overridable by an explicit `options.width`.

## [1.7.0] - 2026-06-16

### Changed

- **`renderTemplate` now wraps all content under a single `Document` structure root by default.** A template produces a complete document, but without an explicit `structureRoot` its tagged content (headings, paragraphs, figures, tables) was emitted as a flat list of top-level structure elements directly under `StructTreeRoot` — PDF/UA-1 expects a single top-level `Document` element. `renderTemplate` now defaults the structure root to `Document` when the document was created without one. Pass `structureRoot: false` to `createDocument` to opt out and keep bare roots; an explicit `structureRoot` is still respected. The low-level `addPage`/manual-structure API is unaffected (no implicit wrapper).

## [1.6.2] - 2026-06-16

### Fixed

- **Template running header drawn last in the content stream.** `1.6.1` hoisted a running header's structure roots to the front of the tag tree, but the body was still drawn first in the page content, so the header logo `Figure` received the highest marked-content id (MCID). Reading order and content order disagreed — content-order tools and PDF/UA validators saw the logo last. The header's content operators are now hoisted to the front of the page content stream alongside its structure roots, so the header is drawn first (lowest MCID) and reading order matches content order. Footers/page numbers are unaffected (they correctly remain last). Safe because text operators are self-contained (`BT`/`ET` with an absolute `Tm`) and image operators are wrapped in their own `q`/`Q`.
- **`richParagraph` threw on non-string run text.** A run whose `text` was `null` or `undefined` (e.g. `localStorage.getItem(...)` returning `null` on a miss) crashed `normalizeRichRuns` with `Cannot read properties of null (reading 'length')`. Such runs are now dropped like empty runs, so bad input degrades to nothing instead of aborting the whole render.

## [1.6.1] - 2026-06-15

### Fixed

- **Tagged links never referenced from the structure tree.** A link annotation was only tied to a `Link` structure element when the caller passed `tag: "Link"` explicitly. Inline links — `flow.richParagraph` runs, page-level `richText` runs, table-cell links, and paragraph text-annotation links — and the public `page.link()` omitted it, so the annotation was emitted with no OBJR back-reference (an untagged annotation, a PDF/UA-1 failure). An unspecified link tag now defaults to `Link`; pass `tag: "Artifact"` to opt out for decorative links.
- **Inline link text was stranded outside its `Link` element.** `flow.richParagraph` placed the visible link glyphs under the surrounding `P` and left the `Link` element holding only the annotation. The link's text is now grouped inside the `Link` structure element together with its OBJR.
- **Marked content read after child elements.** A structure element's `/K` array always listed child elements before the node's own marked content, so a paragraph like `"Page URL: " + link` was announced as the link first, then the leading text. `/K` now interleaves a node's own marked content with its child elements in content (reading) order; pure containers still keep their children's insertion order, so the hoisted running header is unaffected.
- **Per-cell header cells emitted no `/Scope`.** A table cell promoted to `TH` purely via `cell.header` (outside any `headerRows`/`headerColumns` band — e.g. a row-label column) was written without a `/Scope`, which auditors flag as a missing row header. Such cells now default to `/Scope /Row` (still overridable via `cell.scope`).
- **Template running header read last in the tag tree.** Headers/footers render after the body, so a header logo `Figure` landed at the end of the page's structure order instead of the start. Header structure roots are now hoisted to the front of the reading order; footers remain last (their correct final-appearance position).

## [1.6.0] - 2026-06-10

### Added

- **WOFF2 decoding** — new `@crstnmac/sempdf/woff2` subpath export. `decodeWoff2(bytes)` converts a `.woff2` file (the format browsers and font CDNs serve) into standard TTF/OTF bytes ready for `embedTrueTypeFont()`/`registerFontFamily()`. Implements a zero-dependency Brotli (RFC 7932) decompressor — full prefix codes, context modeling, block switching, and the 122 KB static dictionary with all 121 word transforms — plus WOFF2 glyf/loca triplet reconstruction and hmtx transform reversal. Ships as a separate subpath so the embedded dictionary never loads with the core library. `isWoff2(bytes)` and `brotliDecompress(bytes)` are also exported.
- `loadGoogleFont()` now works in browsers: when Google serves a woff2 file, the decoder is loaded on demand and the result is returned as TTF bytes. Node continues to receive a plain `.ttf`/`.otf` with no decoder loaded.
- Table cell styling: per-cell `font`, `color`, `align`, and `background` overrides on `TableCellDefinition` (joining `bold`/`italic`). Cell fonts resolve registered families and built-in variants.
- Table decoration options: `borderColor`/`borderWidth` draw the cell grid, `headerBackground` fills header cells, and `zebra` (boolean or color) stripes alternate body rows. All decoration is emitted as tagged-PDF artifacts.
- Rich text in table cells: cells accept inline `runs` instead of `text` — mixed fonts, sizes, colors, bold/italic, underline/strike, and links wrap together inside the cell, with row heights tracking the tallest line.

### Fixed

- `fallbackFonts` entries naming a registered font family never matched (the family name was passed through as if it were a built-in font, so fallback glyph coverage silently failed). Family names in `fallbackFonts` now resolve to the matching face, honoring the call's `bold`/`italic` flags and case-insensitive matching.

## [1.5.5] - 2026-06-10

### Added

- Table cells accept `bold` and `italic` flags (`{ text: "Results", header: true, bold: true }`). The flags resolve against the table font: a registered family picks the matching face, a built-in base family picks its standard-14 variant. Works in `page.table()`, `flow.table()`, structure-container tables, and template `table` blocks; row heights account for the styled face.

### Fixed

- Registered font families did not resolve in `flow.table()`, `flow.list()`, and their height estimators — a template with `page: { font: "Roboto" }` and a `table` or `list` block threw `Unknown font "Roboto"` even though the family was registered. All table/list entry points now resolve families like the text APIs do.

## [1.5.4] - 2026-06-10

### Changed

- Font family names are now matched **case-insensitively** (like CSS `font-family`). Registering a font as `"Roboto"` and referencing it as `"roboto"` or `"ROBOTO"` in text/template APIs now works correctly. This applies to `registerFontFamily()`, `renderTemplate({ fonts })`, and all text APIs.

### Fixed

- `loadExtensionFontBytes()` now strips `"./"` prefixes from paths before resolving via `chrome.runtime.getURL()`, which would otherwise produce URLs that fail to fetch.
- `loadExtensionFontBytes()` now accepts absolute extension URLs (`chrome-extension://...`, `moz-extension://...`, `https://...`), passing them through without calling `getURL`.
- `loadExtensionFontBytes()` wraps `fetch` failures with a detailed diagnostic message mentioning `web_accessible_resources`, file path, and case-sensitivity — saving debugging time when a content script can't reach a bundled font.

## [1.5.3] - 2026-06-10

### Added

- `renderTemplate()` now accepts a `fonts` option — a `Record<string, FontFamilyInput>` of family-name → faces that are registered before the template renders. Faces accept raw bytes, embedded handles, or built-in names.
- `loadExtensionFontFaces(paths)` — loads bundled extension font files and returns `FontFamilyInput` without registering, so it composes directly with `renderTemplate({ fonts })`.

## [1.5.2] - 2026-06-10

### Added

- `loadExtensionFont(doc, family, paths)` and `loadExtensionFontBytes(path)` — load font files bundled with a Chrome extension via `chrome.runtime.getURL()` and register them as a font family in one call. Fonts are fetched in parallel and passed to `registerFontFamily()`. Exported as `@crstnmac/sempdf/chrome-extension-fonts`.

## [1.5.1] - 2026-06-10

### Fixed

- `PdfFlow.richParagraph()` and `PdfPage.richText()` produced text ops without a `tag`, so the tagged PDF structure tree showed the `P` element with empty marked-content identifiers. The block-level tag now flows through to each run's options so the structure tree carries the correct MCIDs.

## [1.5.0] - 2026-06-06

### Added

- `renderDocumentJson(document)` and `renderDocumentJsonSync(document)` — render a PDF from a single, fully serializable `PdfDocumentJson` value. Fonts are declared by source (`base64` / file `path` / `url` / Google Fonts) and referenced by name; images carry a `src` instead of raw bytes; headers/footers are static block arrays with `{{pageNumber}}` / `{{pageCount}}` / `{{title}}` / `{{author}}` tokens; document options (encryption, conformance, language, tagged, metadata) live on the root. `renderDocumentJson` is async; `renderDocumentJsonSync` handles fully inline (`base64`) documents.
- Absolute positioning in `PdfDocumentJson`: add a `position` (`{ x, y, width?, height?, page?, origin? }`) to a block to draw it at exact PDF-point coordinates instead of flowing. Positionable types: `paragraph`, the image formats, `rect`, `textField`, `checkBox`, `signatureField`.
- `PdfDocument.getPage(index, origin?)` and `PdfDocument.pageCount` — return a `PdfPage` builder for an already-created page so finished pages can be drawn on with the absolute-coordinate APIs.
- `PdfErrorCode.INVALID_DOCUMENT_JSON` for a malformed `PdfDocumentJson`.

### Fixed

- `ParsedPdfDocument.extractText()` returned empty text for pages whose content stream was FlateDecode-compressed (common once a page carried a table, list, or header/footer). The extractor decoded the already-inflated lazy-stream bytes a second time and discarded the page; text and `ToUnicode` decoding now tolerate the pre-decoded bytes.

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
- `bold` and `italic` text options that resolve to the matching font face for the standard-14 base families (Helvetica, Times, Courier)
- `PdfDocument.registerFontFamily()` to group font faces (built-in or embedded) under a name, selectable with the `bold`/`italic` flags
- Document-wide text defaults via `createDocument({ defaults })` (font, bold, italic, fontSize, color, kerning, direction)
- Unit helpers `mm()`, `cm()`, `inch()`, and `pt()` for authoring layouts in physical units
- `PdfDocument.save(path)` convenience alias for `writeToFile()`

### Changed
- `PdfPage` builder methods (text, images, annotations, form fields, graphics state, transforms) now return `this` for fluent chaining
- `bold`/`italic`, registered font families, and document defaults resolve uniformly across `page.text()`/`textBlock()`, the `PdfFlow` cursor API, `renderTemplate()` blocks, and structure containers

## [1.0.0] - 2026-05-11

### Added
- Zero-dependency PDF 1.4+ generation engine in TypeScript
- PDF 1.5 object streams and 2.0 encryption support
- Text rendering with 14 standard fonts plus embedded TrueType (Unicode, kerning, ligatures, RTL/Arabic)
- Image support: JPEG, PNG (transparency/alpha)
- Tagged PDF for accessibility: PDF/UA-1, structure trees, MCID-based marked content
- Flow-based coordinate-free layout engine
- Template-based report/document rendering with headers, footers, page numbers, and auto-outline
- Forms (AcroForm): text, checkbox, radio, choice, push button, signature
- Annotations: URI links, highlights, notes, free-text
- Encryption: rc4-40, rc4-128, AES-128, AES-256
- PDF parsing and incremental editing: metadata, pages, forms, overlays
- Page transfer utilities: extract, split, merge, append
- Streaming output via ByteSink abstraction
- XMP metadata support
- Linearized (Fast Web View) output for single-page documents
- PDF version auto-detection and conformance validation
