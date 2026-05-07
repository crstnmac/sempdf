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
import { NodeStreamSink } from "pdf-editing-lib";
import { createWriteStream } from "node:fs";

await doc.writeTo(new NodeStreamSink(createWriteStream("out.pdf")));
```

## Web streams

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

## Memory sink

`BufferSink` collects chunks for later assembly when you need bytes but not a single large allocation up front:

```ts
import { BufferSink } from "pdf-editing-lib";

const sink = new BufferSink();
await doc.writeTo(sink);
const bytes = sink.collect();
```

## Custom sinks

Implement `ByteSink`:

```ts
import type { ByteSink } from "pdf-editing-lib";

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
