# Pixel-Perfect Invoices

Designer invoice templates need two layers of protection:

1. strict layout checks while generating the PDF
2. optional visual regression checks during development

The published `zeropdf` package stays dependency-free. Visual regression uses Node built-ins plus a dev-only Poppler renderer when you choose to run the visual scripts. Library consumers do not install Poppler or any rendering dependency.

## Strict layout mode

Use `strictLayout` when a template has fixed designer-approved bounds:

```ts
doc.renderTemplate({
  strictLayout: {
    maxPages: 1
  },
  page: {
    size: "A4",
    margin: 48,
    font: "Helvetica",
    fontSize: 10,
    lineHeight: 13
  },
  blocks: [
    { type: "heading", text: "INVOICE" },
    {
      type: "table",
      rows: invoiceRows,
      options: {
        width: 499.28,
        columnWidths: [259.28, 50, 95, 95],
        headerRows: 1,
        cellPadding: 6,
        rowGap: 2
      }
    }
  ]
});
```

When strict layout is enabled, `renderTemplate()` throws `PdfEngineError` with `code === PdfErrorCode.LAYOUT_OVERFLOW` if content cannot fit in a fresh page or column. Error details include the block index, block type, page number, available height, and estimated height. Oversized table-row errors also include `rowIndex`.

Set `strictLayout: { oversizedContent: "allow" }` only when you want `maxPages` enforcement without oversized-content failures.

## Template discipline

For stable invoice output:

- use fixed page size and margins
- use explicit fonts and font sizes
- set deterministic `info` dates and XMP dates
- provide explicit table `width` and `columnWidths`
- keep tax, rounding, discounts, and currency formatting outside the PDF layer
- fixture-test edge cases such as long customer names, long line items, zero tax, discounts, missing optional fields, and multi-page invoices

## Visual regression

The optional scripts render PDFs to PPM images through Poppler and compare them against approved baselines.

The repository includes `pdf-poppler` as a dev dependency for contributors, and the scripts also use a working system `pdftoppm` when one is available. On macOS, a current Homebrew Poppler install is the most reliable renderer:

```sh
brew install poppler
# or
sudo apt-get install poppler-utils
```

Create or update baselines:

```sh
npm run visual:update
```

Compare current output against baselines:

```sh
npm run visual:compare
```

The default comparison renders at 144 DPI and fails when more than 0.1% of pixels differ or any color channel differs by more than 2.

Preview templates locally:

```sh
npm run visual:preview
```

The preview app lives in `examples/visual-preview`. It lets developers and designers choose a fixture, choose fixture data, regenerate the PDF, inspect actual and baseline renders side by side, and switch to a diff overlay.

## Fixtures

Visual fixtures live in `examples/visual-fixtures`. Each fixture exports a stable name and a render function:

```js
export const name = "invoice";

export function render() {
  const doc = createDocument({ /* deterministic metadata */ });
  doc.renderTemplate({ strictLayout: { maxPages: 1 }, blocks });
  return doc.toUint8Array();
}
```

The scripts write actual renders to `.visual-output` and approved baselines to `test/visual-baselines`.
