# Changelog

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
