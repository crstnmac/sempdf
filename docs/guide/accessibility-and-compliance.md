# Accessibility and Compliance

`pdf-editing-lib` can create tagged PDFs with document language, semantic structure, role maps, alt text, and validation warnings.

```ts
import { createDocument } from "pdf-editing-lib";

const doc = createDocument({
  tagged: true,
  language: "en-US"
});

const page = doc.addPage();

page.text("Quarterly Report", {
  x: 56,
  y: 760,
  tag: "H1"
});

page.png(logoBytes, {
  x: 56,
  y: 700,
  width: 32,
  height: 32,
  altText: "Company logo"
});

const issues = doc.validateCompliance();
```

## Structure containers

Use containers when content has semantic relationships that should be preserved in the structure tree.

```ts
const page = doc.addPage();

page.container("Table", (table) => {
  table.container("TR", (row) => {
    row.text("Criterion", { x: 56, y: 720, tag: "TH" });
    row.text("Result", { x: 180, y: 720, tag: "TH" });
  });
});
```

## Standards validation

`validateCompliance()` is intentionally lightweight. For standards-level PDF/A and PDF/UA checks, install veraPDF and run:

```sh
npm run validate:pdf -- output.pdf
```

You can pass veraPDF flags after `--`:

```sh
npm run validate:pdf -- output.pdf -- --flavour 1b
```
