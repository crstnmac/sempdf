# Performance Guide

How to choose the right output mode, minimize file size, and avoid memory pressure for PDFs of any scale.

## Decision tree

```
Document size → ┬─ < 1 MB ──────► toUint8Array() (simplest)
                │
                ├─ 1–50 MB ─────► toUint8Array() or BufferSink
                │
                ├─ 50–200 MB ───► NodeStreamSink / WebStreamSink
                │
                └─ > 200 MB ────► Stream + object streams + linearize if web
```

## Streaming vs in-memory

### `toUint8Array()`

Returns the entire PDF as one allocation. Suitable for nearly all generated documents. The serializer writes sequentially to a growing buffer.

```ts
const bytes = doc.toUint8Array();
// bytes occupies ~file_size bytes of memory
```

**Use when:** document fits in memory comfortably, you need a `Uint8Array` for upload, or you're running in a serverless function with low concurrency.

### `NodeStreamSink`

Writes directly to a Node.js writable stream. Only one chunk is buffered at a time.

```ts
import { NodeStreamSink } from "pdf-editing-lib";
import { createWriteStream } from "node:fs";

await doc.writeTo(new NodeStreamSink(createWriteStream("large.pdf")));
```

**Use when:** generating files larger than available memory, serving HTTP responses with `res.writeHead`, or writing to cloud storage.

### `WebStreamSink`

Streams to a browser `ReadableStream` controller.

```ts
import { WebStreamSink } from "pdf-editing-lib";

const response = new Response(
  new ReadableStream({
    async start(controller) {
      await doc.writeTo(new WebStreamSink(controller));
      controller.close();
    }
  }),
  { headers: { "Content-Type": "application/pdf" } }
);
```

**Use when:** browser-side generation for large documents, progressive download.

### `BufferSink`

Collects chunks into a buffer array, then assembles at the end. Avoids a single large allocation during serialization, but the final `collect()` step still creates one contiguous `Uint8Array`.

```ts
const sink = new BufferSink();
await doc.writeTo(sink);
const bytes = sink.collect();
```

**Use when:** you need bytes at the end but want bounded memory during serialization.

## Object streams

Object streams compress multiple indirect objects into a single compressed stream. Enable with:

```ts
const doc = createDocument({ objectStreams: true });
```

### Size impact

Object streams reduce file size by roughly 20–30% for typical documents by consolidating small dictionaries and arrays into a single deflate-compressed block. The margin is larger for documents with many small objects (form fields, annotations, structure elements).

### Trade-offs

| Aspect | Classic xref (default) | Object streams |
|--------|----------------------|----------------|
| PDF version | 1.4 | 1.5 |
| File size | Larger | Smaller (≈20–30%) |
| Encryption compatibility | All modes | rc4-128, aes-128, aes-256 only |
| Detached signatures | Supported | Supported |
| Linearized output | Supported | Not supported |
| Parse/edit compatibility | Broad | Requires xref-stream capable reader |
| Memory during generation | Same | Same (streamed inline) |

### When to enable

Enable object streams for:
- Documents with many small indirect objects (>500 objects)
- Internal archival formats where file size matters
- PDFs targeting PDF 1.5+ viewers

Skip object streams for:
- Documents that must be PDF 1.4 compatible
- Linearized output (`linearize: true`)
- Environments where classic xref compatibility is required

## Font subsetting costs

Every embedded TrueType font is subsetted automatically: only glyphs actually used in the document are included, and unused OpenType tables (GPOS, GSUB, apple, meta) are stripped.

### Storage savings

| Scenario | Full TTF | Subsetted | Savings |
|----------|----------|-----------|---------|
| Latin-only body (Source Sans 3) | 88 KB | 8 KB | 91% |
| Latin + Greek + Cyrillic body | 88 KB | 18 KB | 80% |
| CJK (Noto Sans CJK SC) | 16 MB | 120 KB (used chars) | 99%+ |

### Performance cost

Subsetting runs once per embedded font during serialization (not during page authoring). For a typical Latin font with <100 glyphs used, subsetting takes <2ms. For CJK fonts with thousands of glyphs, it can take 20–50ms.

### Disabling subsetting

Not currently supported. The subsetter always runs for embedded TrueType fonts. If you need the full font embedded (e.g., editable PDFs), this is a limitation to be aware of.

## Encryption overhead

| Algorithm | Encryption cost | File size overhead |
|-----------|----------------|-------------------|
| `rc4-40` | Negligible | ~50 bytes (enc dict) |
| `rc4-128` | Negligible | ~50 bytes |
| `aes-128` | <1ms per page of content | ~50 bytes |
| `aes-256` | <2ms per page of content | ~50 bytes |
| `aes-256-r6` (PDF 2.0) | <2ms per page | ~100 bytes |

Encryption adds per-stream overhead (16 bytes per AES block), but this is trivial compared to stream content.

## Linearized output

Linearized output emits Fast Web View metadata at the start of the file, enabling progressive rendering in compatible viewers:

```ts
const doc = createDocument({ linearize: true });
```

### Trade-offs

| Aspect | Standard output | Linearized |
|--------|----------------|------------|
| Byte-for-byte changes | Rearranged object order | Document catalog + hint table at front |
| Compatible with object streams | — | No |
| Compatible with encryption | — | No |
| Compatible with detached signatures | — | No |
| Page count | Any | Single-page (current limitation) |

**Use when:** single-page generated PDFs served over HTTP where progressive rendering is desired.

## Memory profile by page count

Estimated memory for a document with 24 lines of text per page, one embedded Latin TTF (subsetted to 8 KB), no images:

| Pages | In-memory (toUint8Array) | Streaming (NodeStreamSink) |
|-------|--------------------------|---------------------------|
| 1 | ~14 KB | ~2 KB peak |
| 100 | ~1.1 MB | ~2 KB peak |
| 10,000 | ~110 MB | ~2 KB peak |
| 100,000 | ~1.1 GB | ~2 KB peak |

These are estimates; actual numbers depend on content density. Images and embedded fonts increase memory proportionally.

## Parallel execution

The serializer is synchronous. For bulk generation, run multiple `createDocument`/`toUint8Array` calls in parallel using `Promise.all` or worker threads:

```ts
const documents = await Promise.all(
  records.map((record) => {
    const doc = createDocument({ /* ... */ });
    doc.addPage().text(record.summary, { x: 56, y: 760 });
    return doc.toUint8Array();
  })
);
```

Each document is independent and does not share mutable state.

## Spill-to-Disk Strategy

When a document exceeds available RAM, use `TempFileSink` to spill serialized data directly to a temporary file. This avoids holding the entire PDF in memory:

```ts
import { TempFileSink } from "pdf-editing-lib";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = await mkdtemp(join(tmpdir(), "pdf-"));
const sink = new TempFileSink(join(dir, "output.pdf"));
await doc.writeTo(sink);
// File written to disk; no large in-memory buffer
```

### writeToFile convenience

For the common case, the `writeToFile` shorthand writes directly to a path:

```ts
await doc.writeToFile("/tmp/report.pdf");
```

Internally, this uses a `TempFileSink` under the hood for documents over a threshold size, and a `BufferSink` for small documents.

## Progressive Page Generation

For documents with thousands of pages, use `writeNextPage()` to generate and flush pages one at a time. This avoids holding all page objects in the serializer's working set simultaneously:

```ts
const doc = createDocument({ objectStreams: true });
const sink = new NodeStreamSink(createWriteStream("report.pdf"));

for (let i = 0; i < 5000; i++) {
  const page = doc.addPage();
  page.text(`Page ${i + 1}`, { x: 56, y: 760 });
  await doc.writeNextPage(sink);
}
await doc.finish(sink);
```

- `writeNextPage()` serializes the most recently added page and releases its resources
- After the loop, `finish()` writes the cross-reference table and trailer
- Compatible with streaming sinks (`NodeStreamSink`, `WebStreamSink`, `TempFileSink`)

## Lazy Object Loading

When parsing an existing PDF, stream content (page descriptions, images, embedded fonts) is not decompressed until first access. This defers CPU and memory costs to the point of use:

```ts
const srcDoc = await parseDocument(inputBytes);
const page = srcDoc.getPage(0);
// Page stream decompressed lazily on first text/image extraction
const text = await page.extractText();
```

Objects that are never accessed during the editing session are never decompressed, reducing parse-time overhead for large documents where only a subset of pages is modified.

## Document Clone

`clone()` creates a deep copy of a document without re-rendering, ideal for template-based generation where many variations share the same base content:

```ts
const template = createDocument({ objectStreams: true });
template.addPage().text("Header", { x: 56, y: 760 });

for (const record of records) {
  const doc = template.clone();
  doc.getPage(0).text(record.body, { x: 56, y: 720 });
  await doc.writeToFile(`output/${record.id}.pdf`);
}
```

- Clone copies all objects, fonts, and cross-reference tables
- Font data is shared by reference where possible (no re-subsetting)
- Cloned documents are independent—mutating one does not affect the original or other clones

## Cross-Document Caching

When generating multiple documents that share fonts or images, the library automatically caches and reuses resources across documents:

```ts
const fontBytes = await readFile("fonts/SourceSans3-Regular.ttf");
const imageBytes = await readFile("logo.png");

for (const record of records) {
  const doc = createDocument();
  // Font subsetted once, reused on subsequent embeds
  const font = doc.embedTrueTypeFont(fontBytes, { family: "SS3" });
  const page = doc.addPage();
  page.png(imageBytes, { x: 56, y: 700, width: 64 }); // Image data reused
  page.text(record.caption, { x: 56, y: 680, font });
  await doc.writeToFile(`out/${record.id}.pdf`);
}
```

- Font byte arrays with identical content share a single parsed font representation
- Image byte arrays with identical content are encoded once and referenced by subsequent embeds
- Cache keys are content-hash based, not reference based—two identical byte arrays from different sources benefit from caching

## See also

- [Streaming and Output](./streaming-and-output) — sink API reference
- [Text and Fonts](./text-and-fonts) — font embedding
- [Encryption and Signatures](./encryption-and-signatures) — password protection
