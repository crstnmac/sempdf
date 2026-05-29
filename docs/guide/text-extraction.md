# Text Extraction

Extract text and positioned glyph runs from parsed PDF pages. The extraction engine decodes content streams, tracks the text-state machine, and resolves glyph codes via per-font `ToUnicode` CMaps.

## extractText()

Call `extractText()` on a `ParsedPdfDocument` to get per-page extraction results:

```ts
import { parseDocument } from "@criston/zeropdf";

const pdf = await parseDocument(bytes);
const extractions = pdf.extractText();

for (const page of extractions) {
  console.log(`Page ${page.pageIndex}: ${page.text}`);
}
```

### Reading order

The `readingOrder` option controls run ordering:

| Value | Behavior |
|-------|----------|
| `"stream"` (default) | Runs appear in content-stream operator order |
| `"structure"` | Runs reordered to match structure tree traversal via MCID markers; runs without MCID appended at the end |

```ts
// Stream order (default) — resembles PDF "copy-paste" text
const streamText = pdf.extractText({ readingOrder: "stream" });

// Structure order — follows tagged logical reading order
const structuredText = pdf.extractText({ readingOrder: "structure" });
```

## PageTextExtraction

Each element in the return array has the shape:

```ts
interface PageTextExtraction {
  /** Zero-based page index. */
  readonly pageIndex: number;
  /** Concatenated text in stream order. */
  readonly text: string;
  /** Positioned runs in stream order. */
  readonly runs: readonly PositionedTextRun[];
}
```

## PositionedTextRun

Individual text runs carry geometry and markup metadata:

```ts
interface PositionedTextRun {
  /** Decoded Unicode text. */
  readonly text: string;
  /** Origin x in user space (PDF points). */
  readonly x: number;
  /** Origin y in user space (PDF points). */
  readonly y: number;
  /** Width of the run in user-space points (sum of glyph advances). */
  readonly width: number;
  /** Active font size at the time of emission. */
  readonly fontSize: number;
  /** Active font resource name (e.g. "F1"); undefined when no font is set. */
  readonly fontName?: string | undefined;
  /** Marked-content MCID covering this run, if any. */
  readonly mcid?: number | undefined;
  /** Marked-content tag (e.g. "P", "Span", "Artifact") covering this run. */
  readonly mcTag?: string | undefined;
}
```

Use runs to locate text on the page, group content by structure tag, or correlate with layout:

```ts
for (const run of page.runs) {
  if (run.mcTag === "H1") {
    console.log(`Heading at (${run.x}, ${run.y}): ${run.text}`);
  }
}
```

## MCID tracking through BDC / EMC markers

Tagged PDFs wrap marked content with `BDC` / `EMC` operator pairs that carry an `MCID` (marked-content identifier). The extraction engine tracks the current BDC/EMC nesting level and associates each subsequent text run with the most recent MCID and tag.

| Marker | Meaning |
|--------|---------|
| `/Tag << /MCID 0 >> BDC` | Begin marked content with MCID 0 |
| `EMC` | End marked content |

The `mcid` and `mcTag` fields on `PositionedTextRun` reflect the innermost BDC/EMC block active when the text was emitted. Runs without any surrounding BDC/EMC have `mcid` and `mcTag` as `undefined`.

## Tagged vs untagged PDFs

### Tagged PDFs

Tagged documents contain a structure tree (`StructTreeRoot`) with BDC/EMC markers throughout the content stream. Use `readingOrder: "structure"` to reorder runs by the structure tree's logical traversal order. This produces the same reading order that a screen reader would follow.

```ts
const pdf = parseDocument(taggedBytes);
const pages = pdf.extractText({ readingOrder: "structure" });

for (const page of pages) {
  for (const run of page.runs) {
    console.log(`[${run.mcTag}] ${run.text.trim()}`);
  }
  // [H1] Quarterly Report
  // [P] Revenue, support volume, and accessibility work completed during Q1.
  // [P] Deliverables
}
```

### Untagged PDFs

Untagged PDFs have no structure tree or BDC/EMC markers. All runs have `mcid` and `mcTag` as `undefined`. `readingOrder: "structure"` falls back to stream order for untagged content.

```ts
const pdf = parseDocument(untaggedBytes);
const pages = pdf.extractText(); // defaults to "stream"

for (const page of pages) {
  for (const run of page.runs) {
    console.log(`(${run.fontSize}pt) ${run.text.trim()} at (${run.x}, ${run.y})`);
  }
  // (12pt) Hello from TypeScript at (56, 780)
  // (12pt) Wrapped copy with predictable line breaks at (56, 740)
}
```
