# Troubleshooting

Diagnose and fix common issues when generating, parsing, or editing PDFs.

## Error codes reference

Every `PdfEngineError` carries a `code` property from the `PdfErrorCode` enum. Catch and inspect it:

```ts
import { PdfEngineError, PdfErrorCode } from "sempdf";

try {
  const doc = createDocument({ /* ... */ });
} catch (err) {
  if (err instanceof PdfEngineError) {
    console.error(`[${err.code}] ${err.message}`);
    console.error("Details:", err.details);
  }
}
```

| Code | Typical cause | Fix |
|------|--------------|-----|
| `INVALID_PDF` | Malformed or unsupported PDF input | Verify the source PDF is valid (not truncated, correct header); check for PDF 2.0 xref streams if using classic mode |
| `UNSUPPORTED_XREF_FORMAT` | Cross-reference stream format is not recognized | The library supports classic xref tables and PDF 1.5+ xref streams. If you encounter this, the PDF may use a hybrid or compressed xref format |
| `INVALID_FONT` | Font name is not a standard 14 font, or embedded font data is corrupt | Use exact PostScript names (`"Helvetica"`, `"Times-Roman"`, etc.) or verify TTF data is valid |
| `UNSUPPORTED_CHARACTER` | A character has no glyph in any available font | Add an embedded font that covers the character or provide a `fallbackFonts` array |
| `INVALID_IMAGE` | Image is corrupt, unsupported format, or wrong color space | Verify image data; only JPEG and PNG are supported; avoid indexed PNGs >8 bpp; avoid CMYK JPEGs |
| `UNSUPPORTED_IMAGE_FORMAT` | Image is not JPEG or PNG | Convert the image to JPEG or PNG before embedding |
| `UNSUPPORTED_IMAGE_COLOR_SPACE` | PNG uses a color space other than RGB or Grayscale | Convert the image to RGB or grayscale |
| `UNSUPPORTED_IMAGE_BIT_DEPTH` | PNG bit depth is not 1, 2, 4, 8, or 16 | Convert to 8-bit or 16-bit |
| `UNSUPPORTED_IMAGE_INTERLACE` | PNG uses Adam7 interlacing | Re-encode the PNG without interlacing |
| `INVALID_ENCRYPTION` | Encryption parameters are inconsistent (e.g., wrong password, unsupported algorithm for current PDF version) | Check algorithm/password/revision combination; avoid `rc4-40` with object streams |
| `UNSUPPORTED_ENCRYPTION` | Encryption mode is not supported for parsing or editing | If parsing, the PDF may use public-key or custom security handlers (only Standard Security Handler revision 2+ is supported) |
| `INVALID_COMPLIANCE` | Document violates an enabled conformance profile (e.g., PDF/UA-1 missing language tag) | Run `doc.validateCompliance()` to see all issues; fix each before serialization |
| `INVALID_PAGE` | Page index is out of bounds, or page reference is invalid | Check page count and indices; use `parsed.pages.length` to verify |
| `INVALID_TEXT` | Text content or layout options are invalid (e.g., negative font size) | Verify `fontSize`, `lineHeight`, and `width` are positive |
| `INVALID_FORM_FIELD` | Form field name is empty, duplicate, or value type mismatch | Ensure unique field names; match value type to field type (string for text, boolean for checkbox) |
| `EMPTY_PAGE` | Attempting to serialize a document with zero pages | Add at least one page before calling `toUint8Array()` |
| `INVALID_PAGE_SIZE` | Unrecognized page size name or invalid custom dimensions | Use a name from `PAGE_SIZES` or specify `{ width, height }` |
| `INVALID_COLOR` | Color components outside valid range or invalid color type | RGB/CMYK values must be 0–1; hex must be 6 hex digits |
| `INVALID_PATH` | Invalid path command sequence (e.g., `fill()` without a closed path) | Ensure path commands form a valid drawing sequence |
| `INVALID_ATTACHMENT` | File attachment data or metadata is invalid | Verify MIME type string and that file data is non-empty |
| `INVALID_ANNOTATION` | Annotation rectangle or options are invalid | Verify annotation coordinates are within page bounds |
| `INVALID_DESTINATION` | Named destination target page is invalid | Ensure the target page exists in the document |
| `INVALID_LINK` | Link target URL or link rectangle is invalid | Verify URL format and rectangle dimensions |
| `INVALID_METADATA` | Document info or XMP metadata is malformed | Check date formats (`D:YYYYMMDDHHmmSS` for info, ISO 8601 for XMP) |
| `INVALID_OUTLINE` | Outline bookmark has missing or invalid target | Ensure each outline item has a valid page or named destination |
| `INVALID_TRANSFORM` | Matrix is singular or contains non-finite values | Verify matrix determinant is non-zero; all entries must be finite numbers |
| `INVALID_DASH_PATTERN` | Dash pattern contains zero or negative values | All dash array elements must be positive numbers |
| `INVALID_GRAPHICS_STATE` | Unbalanced `save()`/`restore()` calls | Ensure each `save()` has a matching `restore()` |
| `INVALID_PAGE_LABEL` | Page label range or style is invalid | Verify `style` is one of `"decimal"`, `"upperRoman"`, `"lowerRoman"`, `"upperLetter"`, `"lowerLetter"` |
| `INVALID_NUMBER` | A numeric API argument is out of range (e.g., negative page index) | Validate all numeric inputs against expected ranges |
| `INTERNAL_ERROR` | Unexpected internal state or assertion failure | Check for conflicting options or malformed internal structures |
| `INVALID_OPERATION` | API method called in an invalid state (e.g., writing to a closed document) | Verify the document or page object is still open/active |
| `SINK_CLOSED` | Attempted to write to a stream sink that has already been closed | Write all data before the sink completes; use a fresh sink for each document |
| `SINK_FULL` | Stream sink reached its capacity limit | Increase the sink's internal buffer size or switch to `NodeStreamSink` / `WebStreamSink` |
| `UNREACHABLE` | Code path that should never execute was reached | Likely a library bug; report with a minimal reproduction |
| `UNSUPPORTED_PAGE_TREE` | Page tree depth exceeds 50 levels or uses an unrecognized node type | Flatten deep page trees before parsing; avoid non-standard page tree layouts |
| `INVALID_NUMBER_TREE` | Number tree structure is corrupt or contains duplicate keys | The PDF's internal name/number tree is malformed; re-export from the source application |
| `INVALID_FORM_FIELD_NAME` | Form field name contains illegal characters or is empty | Use alphanumeric names; avoid `.` as prefix/suffix unless for hierarchy |
| `UNSUPPORTED_SCRIPT` | Text uses a writing system not supported by any loaded font | Add a fallback font with coverage for the required script |

## Broken xref (cross-reference) table

### Symptoms

- `PdfEngineError` with code `INVALID_PDF` when calling `parseDocument()`
- Error message includes "xref", "offset", "object not found", or "invalid xref"
- Viewer shows blank pages or missing content after editing

### Causes

1. **Truncated file**: The file was cut short during download or copy
2. **Non-classic xref format**: The PDF uses a compressed cross-reference format or hybrid xref that the library doesn't support
3. **Incremental updates not merged**: A PDF with multiple incremental updates (appended xref sections) may reference objects from earlier sections that have been superseded
4. **Object stream xref**: PDF 1.5+ files store objects in compressed streams; the library supports these, but malformed streams cause parse failures

### How to detect

```ts
try {
  const parsed = parseDocument(bytes);
  console.log("Valid PDF,", parsed.pages.length, "page(s)");
} catch (err) {
  if (err instanceof PdfEngineError && err.code === PdfErrorCode.INVALID_PDF) {
    console.error("Parse failed:", err.message);
    // Inspect raw bytes: is the header "%PDF-1.x"?
    const header = new TextDecoder().decode(bytes.slice(0, 8));
    console.log("Header:", header);
  }
}
```

### Fixes

1. **Verify file integrity**: Run `xxd output.pdf | head -5` — confirm the header is `%PDF-1.` followed by a version
2. **Re-export from source**: If the PDF was generated by another tool, re-export it without compression or incremental saves
3. **Use `editDocument` for minor fixes**: If parsing succeeds, use `editDocument` to produce a cleaned output: `editDocument(bytes).toUint8Array()`
4. **Check for PDF 2.0**: PDF 2.0 uses a different xref format. Use `parseDocument` with the version check:
   ```ts
   const parsed = parseDocument(bytes);
   if (parsed.version?.startsWith("2.")) {
     // PDF 2.0 — ensure the library version supports it
   }
   ```

## Missing or blank text (font issues)

### Symptoms

- Text renders as empty spaces, boxes (□), or `.notdef` glyphs
- `UNSUPPORTED_CHARACTER` errors during serialization
- CJK or special characters appear as blank space

### Causes

1. **Standard 14 font coverage**: The standard 14 fonts only cover Latin-1 (ISO 8859-1). Any character outside that range (CJK, Arabic, Greek, emoji) produces `.notdef`
2. **Embedded font doesn't cover the character**: The TrueType font has the character, but not in the subset produced
3. **Font family name mismatch**: The font was embedded with a different family name than what's requested in `text()` calls
4. **CJK-specific**: CJK TrueType fonts are large (5–20 MB); subsetting may inadvertently exclude needed glyphs if glyph IDs are not correctly tracked
5. **Fallback not configured**: A fallback font covers the character, but `fallbackFonts` was not passed to `text()`

### Fixes

**For standard 14 fonts — switch to an embedded font with Unicode coverage:**

```ts
const font = doc.embedTrueTypeFont(fontBytes, { family: "UnicodeSans" });
page.text("Hello 漢字", { font, fontSize: 14 });
```

**For mixed-script text — use fallback fonts:**

```ts
const latin = doc.embedTrueTypeFont(latinBytes, { family: "Latin" });
const cjk = doc.embedTrueTypeFont(cjkBytes, { family: "CJK" });
const arabic = doc.embedTrueTypeFont(arabicBytes, { family: "Arabic" });

page.text("Hello 世界 مرحبا", {
  font: latin,
  fallbackFonts: [cjk, arabic],
  fontSize: 14
});
```

**For CJK specifically:**

1. Use a CJK-capable TrueType font (Noto Sans CJK, Source Han Sans, etc.)
2. Be aware that subsetting preserves glyph IDs 1:1 — the PDF content references the original glyph index, so there's no remapping risk
3. CJK subsetting can take 20–50ms for fonts with thousands of used glyphs; this is expected
4. If CJK text is still blank, verify the font `.ttf` file is valid TrueType (not OpenType CFF/PostScript outlines):

```ts
// Quick check: TrueType fonts start with 0x00010000 or 'true' tag
const isTrueType = (bytes: Uint8Array): boolean => {
  const sfVersion = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  return sfVersion === 0x00010000 || sfVersion === 0x74727565; // 0x74727565 = 'true'
};
```

## CJK not rendering

### Common causes specific to CJK

1. **Font format**: OpenType fonts with CFF outlines (`.otf` extension, but sometimes named `.ttf`) are NOT supported. Only TrueType outline fonts work
2. **Vertical writing**: The library does not support vertical writing mode (tate-chu-yoko). CJK text is always horizontal
3. **Subset size**: If only a few CJK characters appear blank, verify they exist in the font at the expected glyph index. Use `python3 -c "from fontTools.ttLib import TTFont; f = TTFont('your-font.ttf'); print(f.getBestCmap())"` to check
4. **Encoding mismatch**: The library uses glyph IDs directly; there is no CMap/encoding translation at the embedder level. Ensure your text characters map to valid glyph IDs in the font

### Debugging CJK font subsetting

```ts
const font = doc.embedTrueTypeFont(cjkFontBytes, { family: "NotoSansCJK" });

// Test a single CJK character
page.text("漢", { font, fontSize: 14 });

const bytes = doc.toUint8Array();

// Inspect: the embedded font stream should contain glyphs for just 漢 and .notdef
// plus any composite glyph dependencies
```

### When CJK still doesn't render

- Try a different CJK font file
- Convert OTF (CFF) to TTF using `fonttools`: `python3 -m fontTools.ttx your-font.otf` and inspect
- Use a known-working font: Noto Sans CJK SC (简体), Noto Sans CJK JP (日本語), or Source Han Sans

## Compliance validation failures

### PDF/UA-1 checklist

If `validateCompliance()` reports errors for `pdfua-1` conformance:

| Error | Fix |
|-------|-----|
| Missing document language | Set `language: "en-US"` (or appropriate BCP 47 tag) in `createDocument()` |
| No structure root | Set `structureRoot: "Document"` in `createDocument()` |
| Text without embedded font | Use `embedTrueTypeFont()` for all visible text (standard 14 fonts are not allowed in PDF/UA-1) |
| Missing alt text on images | Pass `altText` in image options: `page.png(data, { altText: "Description" })` |
| Missing XMP metadata | Provide `xmpMetadata` in `createDocument()` or `renderTemplate()` with at least `title`, `creator`, `createDate`, `modifyDate`, `metadataDate` |
| Uncategorized content | Use `flow()` or `renderTemplate()` — raw `text()` without a tag may produce content outside the structure tree |

```ts
const doc = createDocument({
  conformance: "pdfua-1",
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  info: { title: "Report" },
  xmpMetadata: {
    title: "Report",
    creator: "sempdf",
    createDate: "2026-05-08T00:00:00Z",
    modifyDate: "2026-05-08T00:00:00Z",
    metadataDate: "2026-05-08T00:00:00Z"
  }
});

const font = doc.embedTrueTypeFont(fontData, { family: "AccessibleSans" });
const page = doc.addPage();

page.flow({ font })
  .heading("Report")
  .paragraph("Content.")
  .png(logoData, { altText: "Company logo" });

const issues = doc.validateCompliance();
for (const issue of issues) {
  console.log(`[${issue.severity}] ${issue.message}`);
}
```

## Encryption problems

### "Wrong password" on a document you created

1. Verify the password was not truncated or modified between creation and parsing
2. Check that the same `algorithm` and `revision` are used (the parser auto-detects these from the encryption dictionary)
3. If you changed the password in an editor, re-create the document — editing with `editDocument` preserves the original encryption parameters

### Cannot encrypt with object streams

Object stream mode (`objectStreams: true`) is incompatible with:
- `rc4-40` encryption — use at least `rc4-128`
- `linearized: true` output — these are mutually exclusive

```ts
// ✅ Works
createDocument({ objectStreams: true, encryption: { algorithm: "aes-256", userPassword: "key" } });

// ❌ Fails with INVALID_ENCRYPTION
createDocument({ objectStreams: true, encryption: { algorithm: "rc4-40", userPassword: "key" } });
```

## Large PDFs causing memory issues

### Symptoms

- Node.js process crashes with "JavaScript heap out of memory"
- Browser tab freezes during `toUint8Array()` or `doc.writeTo()`

### Fixes

1. **Use streaming output**: Replace `toUint8Array()` with `NodeStreamSink` or `WebStreamSink`
2. **Run Node.js with more heap**: `node --max-old-space-size=4096 script.js`
3. **Use a worker thread**: Offload generation to a worker to avoid blocking the main thread
4. **Batch large jobs**: Generate pages in batches of 1000, merge with `mergeDocuments()`

## See also

- [Performance Guide](./performance) — streaming, object streams, and memory profiles
- [Encryption and Signatures](./encryption-and-signatures) — password protection API
- [Accessibility and Compliance](./accessibility-and-compliance) — PDF/UA-1 and tagged PDFs
- [Text and Fonts](./text-and-fonts) — font embedding and fallback

## Stream Length Mismatch Warnings

When a stream's declared `/Length` does not match the actual byte count of its content, the parser emits a debug-level warning and proceeds using the actual stream boundaries. This is common with PDFs produced by non-standard generators. The warning is informational and does not block parsing; use `getRepairWarnings()` in edit mode to see which streams were affected.

## Damaged Xref Auto-Recovery

If the cross-reference table is missing or corrupt, `parseDocument()` scans the raw file for `obj` / `endobj` markers to rebuild object locations. The recovery heuristics handle:
- Missing or zeroed `startxref` pointers
- Xref entries pointing to wrong offsets
- Truncated xref sections in incremental updates

Recovered objects are available through the normal `parseDocument()` API. No special flags are needed.

## Deep Page Tree Limits

Page trees nested deeper than 50 levels are rejected with `UNSUPPORTED_PAGE_TREE`. Most validators also enforce this limit. If you encounter this, re-export the PDF from the source application with a flattened page tree structure.
