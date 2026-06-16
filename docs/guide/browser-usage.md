# Browser Usage

The package works with browser-friendly binary values. You can generate a PDF, wrap it in a `Blob`, and preview or download it.

```ts
import { createDocument } from "@barrierbreak/sempdf-pdf";

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
import { WebStreamSink } from "@barrierbreak/sempdf-pdf";

const { readable, writable } = new TransformStream<Uint8Array>();
const sink = new WebStreamSink(writable);
void doc.writeTo(sink).then(() => sink.close());

const response = new Response(readable, {
  headers: { "Content-Type": "application/pdf" }
});
```

`BufferSink` also works in the browser when you just need the bytes.

## Browser limitations

The core engine — generation, parsing, editing, fonts, images, tables, templates, annotations, and tagged PDF — runs in the browser with no Node dependencies. Two areas are Node-only:

- **Disk-backed output.** `TempFileSink`, `NodeStreamSink`, and `writeToFile` rely on `node:fs` and are not available in the browser. Use `toBlob()`, `toArrayBuffer()`, `toUint8Array()`, `BufferSink`, or `WebStreamSink` instead.
- **AES encryption.** AES-encrypting a document requires Node's `node:crypto`; in the browser it throws `"AES PDF encryption requires Node.js crypto support in this build."` Generate unencrypted PDFs client-side and encrypt server-side if you need protection. (Secure random bytes fall back to the Web Crypto API where available.)

The Node-only sinks load `node:fs` through a lazy dynamic `import()`, so bundlers building for the browser will not pull them into the core path.

## Chrome Extensions

When running inside a Chrome extension, use [`loadExtensionFont()`](./text-and-fonts#chrome-extension-fonts) to load font files bundled with the extension. Fonts bundled as `.ttf`/`.otf` files are fetched via `chrome.runtime.getURL()` and registered in one call.

## Playground

The repo includes a browser playground in `examples/website`: write template code on the left and see the rendered PDF on the right, all in-browser.

```sh
npm run example:web
```

Open `http://localhost:4173/`, edit the code, and press <kbd>Run</kbd> (or <kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd>). Every `sempdf` export is in scope; your code just needs to build a document and `return` it.
