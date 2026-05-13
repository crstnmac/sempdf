# Browser Usage

The package works with browser-friendly binary values. You can generate a PDF, wrap it in a `Blob`, and preview or download it.

```ts
import { createDocument } from "zeropdf";

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

## Website example

The repo includes a browser demo in `examples/website`.

```sh
npm run example:web
```

Open `http://localhost:4173/` to preview generated PDFs, create new documents from form input, and edit uploaded PDFs.
