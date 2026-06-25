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

The core engine — generation, parsing, editing, fonts, images, tables, templates, annotations, tagged PDF, and password encryption — runs in the browser with no Node dependencies. One area is Node-only:

- **Disk-backed output.** `TempFileSink`, `NodeStreamSink`, and `writeToFile` rely on `node:fs` and are not available in the browser. Use `toBlob()`, `toArrayBuffer()`, `toUint8Array()`, `BufferSink`, or `WebStreamSink` instead.

**Encryption works in the browser.** RC4 and all AES variants (`aes-128`, `aes-256`, `aes-256-r6`) encrypt and decrypt client-side. When `node:crypto` is unavailable the library uses a built-in, zero-dependency AES/SHA-2 implementation whose output matches the Node path byte-for-byte, so a document encrypted in the browser opens with the same password everywhere. It only needs a secure-random source for the IV/key, which it reads from the Web Crypto API (`crypto.getRandomValues`). See [Encryption and Signatures](./encryption-and-signatures.md#browser-support).

The Node-only sinks load `node:fs` through a lazy dynamic `import()`, so bundlers building for the browser will not pull them into the core path.

**Generation requires a license guard (secure by default).** The library refuses to serialize unless a guard is installed, and the `SEMPDF_LICENSE_DEV` env bypass does not exist in the browser. Install a guard before generating — either the licensing client, or a permissive one for unrestricted use:

```ts
import { setLicenseGuard } from "@barrierbreak/sempdf-pdf/license-guard";
setLicenseGuard({ consume() {} });
```

See [Licensing and Usage Limits](./licensing.md).

## Chrome Extensions

When running inside a Chrome extension, use [`loadExtensionFont()`](./text-and-fonts#chrome-extension-fonts) to load font files bundled with the extension. Fonts bundled as `.ttf`/`.otf` files are fetched via `chrome.runtime.getURL()` and registered in one call.

## Playground

The repo includes a browser playground in `examples/website`: write template code on the left and see the rendered PDF on the right, all in-browser.

```sh
npm run example:web
```

Open `http://localhost:4173/`, edit the code, and press <kbd>Run</kbd> (or <kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd>). Every `sempdf` export is in scope; your code just needs to build a document and `return` it.
