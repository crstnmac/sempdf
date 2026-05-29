# Streaming and Output

PDFs serialize to `Uint8Array` by default. For large documents, write directly to a sink so memory stays bounded.

## In-memory bytes

```ts
const bytes = doc.toUint8Array();
```

## Browser blob

```ts
const blob = doc.toBlob();
const url = URL.createObjectURL(blob);
```

## Node writable streams

```ts
import { NodeStreamSink } from "@criston/sempdf";
import { createWriteStream } from "node:fs";

await doc.writeTo(new NodeStreamSink(createWriteStream("out.pdf")));
```

## Web streams

`WebStreamSink` wraps a `WritableStream`. Pair it with a `TransformStream` to stream straight into a `Response`:

```ts
import { WebStreamSink } from "@criston/sempdf";

const { readable, writable } = new TransformStream<Uint8Array>();
const sink = new WebStreamSink(writable);
void doc.writeTo(sink).then(() => sink.close());

const response = new Response(readable, {
  headers: { "Content-Type": "application/pdf" }
});
```

## Memory sink

`BufferSink` collects chunks for later assembly when you need bytes but not a single large allocation up front:

```ts
import { BufferSink } from "@criston/sempdf";

const sink = new BufferSink();
await doc.writeTo(sink);
const bytes = sink.collect();
```

## BufferSink Size Limits

Guard against memory blowout with `maxSize`:

```ts
const sink = new BufferSink({ maxSize: 50 * 1024 * 1024 }); // 50 MB
await doc.writeTo(sink);
const bytes = sink.collect();
```

Throws if the accumulated data exceeds the limit.

## TempFileSink

Spill large documents to disk automatically with a temporary file sink:

```ts
import { TempFileSink } from "@criston/sempdf";

const sink = new TempFileSink();
await doc.writeTo(sink);
const bytes = await sink.getBytes();
await sink.close(); // deletes the temp file
```

Keeps memory bounded regardless of document size.

## Progressive Page Streaming

Build large documents page-by-page without holding everything in memory:

```ts
const doc = createDocument();

for (const pageData of hugeDataset) {
  const page = doc.addPage();
  page.text(pageData.title);
  // ... fill page ...
  await doc.writeNextPage(sink);
}
await doc.finalize(sink);
```

Each page's objects are serialized and released before the next page begins.

## Async Write Consistency

All `writeTo()` and `writeNextPage()` calls are automatically serialized to prevent concurrent writes from corrupting the output stream.

## Document Finalization

A document becomes immutable after its first serialization. Calling `addPage()`, `textField()`, or other mutating methods after `toUint8Array()` or `writeTo()` will throw.

## Custom sinks

Implement `ByteSink`:

```ts
import type { ByteSink } from "@criston/sempdf";

class CountingSink implements ByteSink {
  bytesWritten = 0;
  async write(chunk: Uint8Array) {
    this.bytesWritten += chunk.length;
  }
  async close() {}
}
```

## Object streams for smaller files

PDF 1.5 object streams compress indirect objects together. Enable on the document:

```ts
const doc = createDocument({ objectStreams: true });
```

The encoder still falls back to classic xref where required (encrypted catalogs, signature dictionaries).

## Linearized output

Linearized output emits the initial Fast Web View metadata at the start of the file:

```ts
const doc = createDocument({ linearize: true });
```

The current linearized writer uses classic xref tables, supports single-page generated documents, and is intentionally separate from object streams, encryption, and detached signatures.

## Deterministic output

Serialization is deterministic when input is deterministic: stable IDs, no timestamps inserted automatically. Provide `info.creationDate` and XMP dates explicitly to keep snapshots reproducible.
