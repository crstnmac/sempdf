# PDF Versions and Conformance

The serializer auto-detects the minimum PDF header version required by the features used. Conformance profiles add stricter validation and metadata.

## Auto-detected versions

| Feature | Minimum version |
|---------|-----------------|
| Baseline | 1.4 |
| `objectStreams: true` | 1.5 |
| AES-128 encryption | 1.6 |
| AES-256 (R=5) | 1.7 |
| Attachments / signatures / `pdfua-1` | 1.7 |
| AES-256 (R=6) | 2.0 |

`mergeDocuments`, `appendPages`, `extractPages`, and `splitDocument` carry the maximum source version forward so output never declares a lower version than its inputs.

## Conformance profiles

Set `conformance` to enforce PDF/A or PDF/UA invariants at serialization time:

```ts
const archive = createDocument({ title: "Archive", conformance: "pdfa-1b" });
const accessible = createDocument({ conformance: "pdfua-1", tagged: true, language: "en-US" });
```

| Profile | Notes |
|---------|-------|
| `pdfa-1b` | Static archival. Fonts must be embedded. ICC output intent required. |
| `pdfua-1` | Accessibility. Tags, language, alt text, embedded fonts required. |

When a profile is set, missing inputs throw `PdfEngineError` instead of silently producing non-conformant output. Use `validateCompliance()` to collect all warnings/errors first:

```ts
const issues = doc.validateCompliance();
for (const issue of issues) {
  console.log(issue.severity, issue.message);
}
```

## ICC output intents

PDF/A documents require an output intent. Provide an ICC profile and identifier:

```ts
const doc = createDocument({
  conformance: "pdfa-1b",
  outputIntent: {
    profile: cmykIccBytes,
    outputConditionIdentifier: "Press CMYK",
    alternate: "DeviceCMYK",
    channels: 4
  }
});
```

For RGB workflows, omit `alternate`/`channels` to use the bundled sRGB profile.

## PDF 2.0 considerations

PDF 2.0 changes structure namespace handling and AES-256 (R=6) key derivation. The library tracks PDF 2.0 namespacing for tagged elements and emits `2.0` headers automatically when AES-256-R6 or PDF 2.0-only features are used. `validatePdf2Conformance(bytes)` runs additional namespace and structure checks for 2.0 output.

## veraPDF for standards-level checks

`validateCompliance()` is intentionally lightweight. For full PDF/A and PDF/UA validation, install veraPDF:

```sh
npm run validate:pdf -- output.pdf
npm run validate:pdf -- output.pdf -- --flavour 1b
VERAPDF_BIN=/opt/verapdf/verapdf npm run validate:pdf -- output.pdf
```
