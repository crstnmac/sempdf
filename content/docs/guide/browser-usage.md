---
title: "Browser Usage"
---

The package works with browser-friendly binary values. You can generate a PDF, wrap it in a `Blob`, and preview or download it.

```ts
import { createDocument } from "@crstnmac/zeropdf";

const doc = createDocument();
const page = doc.addPage();

page.text("Preview me", {
  x: 56,
  y: 760,
  fontSize: 16
});

const blob = doc.toBlob();
const url = URL.createObjectURL(blob);

iframe.src = url;
```

## Streaming to a Response

Use `WebStreamSink` with a `TransformStream` to stream a PDF straight to the browser without buffering the whole document:

```ts
import { WebStreamSink } from "@crstnmac/zeropdf";

const { readable, writable } = new TransformStream<Uint8Array>();
const sink = new WebStreamSink(writable);
void doc.writeTo(sink).then(() => sink.close());

const response = new Response(readable, {
  headers: { "Content-Type": "application/pdf" }
});
```

`BufferSink` also works in the browser when you just need the bytes.

## Browser limitations

The core engine — generation, parsing, editing, fonts, images, tables, templates, annotations, tagged PDF, and password encryption — runs in the browser with no Node dependencies. One area is Node-only:

- **Disk-backed output.** `TempFileSink`, `NodeStreamSink`, and `writeToFile` rely on `node:fs` and are not available in the browser. Use `toBlob()`, `toArrayBuffer()`, `toUint8Array()`, `BufferSink`, or `WebStreamSink` instead.

**Encryption works in the browser.** RC4 and all AES variants (`aes-128`, `aes-256`, `aes-256-r6`) encrypt and decrypt client-side. When `node:crypto` is unavailable the library uses a built-in, zero-dependency AES/SHA-2 implementation whose output matches the Node path byte-for-byte, so a document encrypted in the browser opens with the same password everywhere. It only needs a secure-random source for the IV/key, which it reads from the Web Crypto API (`crypto.getRandomValues`). See [Encryption and Signatures](/guide/encryption-and-signatures#browser-support).

The Node-only sinks load `node:fs` through a lazy dynamic `import()`, so bundlers building for the browser will not pull them into the core path.

## Chrome Extensions

When running inside a Chrome extension, use [`loadExtensionFont()`](/guide/text-and-fonts#chrome-extension-fonts) to load font files bundled with the extension. Fonts bundled as `.ttf`/`.otf` files are fetched via `chrome.runtime.getURL()` and registered in one call.

## Playground

The [docs playground](/playground) is a focused source-and-preview workspace.
Choose a starting document, edit its declarative Document JSON, and render it
through the documentation server. You can download the PDF or copy an equivalent
TypeScript handoff for your application.

For safety, the public playground does not execute arbitrary JavaScript and
does not load remote or filesystem assets. Browser applications can still use
the full TypeScript API directly, including fetching image bytes without
`node:fs`.
