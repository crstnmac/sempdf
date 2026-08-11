# Accessibility and Compliance

`sempdf` can create tagged PDFs with document language, semantic structure, role maps, alt text, and validation warnings. For output that is intended to validate as PDF/UA-1, enable the PDF/UA profile, embed fonts for all visible text, use semantic flow helpers for meaningful content, mark decorative drawing as artifacts when you use low-level drawing, and write the serialized bytes to your target.

```ts
import { readFile, writeFile } from "node:fs/promises";
import { createDocument } from "@crstnmac/sempdf";

const fontBytes = await readFile("fonts/SourceSans3-Regular.ttf");

const doc = createDocument({
  title: "Quarterly Report",
  conformance: "pdfua-1",
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  info: {
    author: "sempdf"
  },
  xmpMetadata: {
    creator: "sempdf",
    createDate: "2026-05-05T00:00:00Z",
    modifyDate: "2026-05-05T00:00:00Z",
    metadataDate: "2026-05-05T00:00:00Z"
  }
});

const font = doc.embedTrueTypeFont(fontBytes, { family: "SourceSans3" });
const page = doc.addPage({ size: "Letter" });

page.flow({ font })
  .heading("Quarterly Report")
  .paragraph("Revenue, support volume, and accessibility work completed during Q1.")
  .table(
    [
      [
        { text: "Metric", header: true },
        { text: "Result", header: true }
      ],
      [
        { text: "Revenue", header: true, scope: "row" },
        "$2.6M"
      ],
      [
        { text: "Open tickets", header: true, scope: "row" },
        "38"
      ]
    ],
    {
      headerRows: 1,
      headerColumns: 1,
      fontSize: 10
    }
  )
  .png(logoBytes, {
    width: 32,
    altText: "Company logo"
  });

const issues = doc.validateCompliance();
if (issues.some((issue) => issue.severity === "error")) {
  throw new Error(issues.map((issue) => issue.message).join("\n"));
}

await writeFile("quarterly-report.pdf", doc.toUint8Array());
```

`flow()` keeps a cursor, assigns standard tags for headings and paragraphs, lays out tables and images, applies standard report spacing, and infers structure bounding boxes from the generated placement. Use `structure.boundingBox` only when you need to override the inferred box for a specific element.

The default spacing scale is designed around readable PDF reports: body paragraphs have compact after-spacing, headings have stronger before-spacing and tighter after-spacing, tables and figures get object spacing, and headings at the top of a page do not receive unnecessary leading space. For special cases, set `marginTop` or `marginBottom` on a block. For a whole report, set `page.spacing`.

For longer reports, use `renderTemplate()` to render a reusable block tree with automatic page creation:

```ts
doc.renderTemplate({
  title: "Accessibility Audit Report",
  info: {
    author: "sempdf"
  },
  xmpMetadata: {
    creator: "sempdf",
    createDate: "2026-05-05T00:00:00Z",
    modifyDate: "2026-05-05T00:00:00Z",
    metadataDate: "2026-05-05T00:00:00Z"
  },
  page: {
    size: "A4",
    font,
    margin: 56,
    spacing: {
      paragraphAfter: 8,
      headingBefore: { 2: 18, 3: 14 },
      headingAfter: { 1: 14, 2: 10, 3: 8 },
      tableBefore: 6,
      tableAfter: 14
    }
  },
  blocks: [
    { type: "heading", text: "Accessibility Audit Report" },
    { type: "paragraph", text: "Executive summary and scope." },
    {
      type: "table",
      rows: [
        [{ text: "Criterion", header: true }, { text: "Result", header: true }],
        ["Language metadata", "Present"]
      ],
      options: { headerRows: 1 }
    },
    { type: "pageBreak" },
    { type: "heading", text: "References", options: { level: 2 } },
    { type: "link", text: "WCAG 2.2", url: "https://www.w3.org/TR/WCAG22/" }
  ],
  header: ({ title, pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: `${title ?? "Report"} - page ${pageNumber} of ${totalPages}`,
      options: { fontSize: 8, tag: "Artifact" }
    }
  ],
  pageNumber: {
    region: "footer",
    align: "center"
  }
});
```

Use `{ type: "pageBreak" }` when the next block should start on a fresh page. A page break before any body content on the current page is ignored, so templates can include defensive breaks without creating empty pages.

Headers and footers are rendered after the body pages are known, so callbacks receive `title`, `author`, `pageNumber`, and `totalPages`. Use `pageNumber` for standard running page labels without hand-authoring a footer; set `region` to `"header"` or `"footer"` and `align` to `"left"`, `"center"`, or `"right"`.

`conformance: "pdfua-1"` makes serialization fail when required PDF/UA inputs are missing, such as document language, tags, alt text for figures, or embedded fonts for visible text. `validateCompliance()` is still useful before writing because it returns all current warnings and errors instead of throwing on the first blocking issue.

You can also stream the same tagged document to a sink:

```ts
import { NodeStreamSink } from "@crstnmac/sempdf";
import { createWriteStream } from "node:fs";

await doc.writeTo(new NodeStreamSink(createWriteStream("quarterly-report.pdf")));
```

## Structure containers

Use containers when content has semantic relationships that should be preserved in the structure tree.

`section` blocks in `renderTemplate` also create proper tagged structure boundaries when `role` or `structure` is specified:

```ts
{ type: "section", role: "Sect", blocks: [
  { type: "heading", text: "Audit details", options: { level: 2 } },
  { type: "paragraph", text: "Grouped content stays nested under the section." }
] }
```

```ts
const page = doc.addPage();

page.container("Sect", (section) => {
  section.flow()
    .heading("Audit details", { level: 2 })
    .paragraph("Grouped content remains nested under the section element.")
    .table(
      [
        [
          { text: "Criterion", header: true },
          { text: "Result", header: true }
        ],
        ["Language metadata", "Present"]
      ],
      {
        headerRows: 1
      }
    );
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

## Artifact Types

When marking content as decorative (non-semantic), use the `artifactType` option to classify it for assistive technology:

- `"Pagination"` — running headers, footers, page numbers
- `"Layout"` — ornamental borders, rules, background decorations
- `"Page"` — watermarks or page background images

```ts
page.flow().paragraph("Page 1 of 10", {
  tag: "Artifact",
  artifactType: "Pagination"
});
```

## Associated Files

Structure elements can carry an `/AF` (Associated Files) array linking to embedded files:

```ts
const fileRef = doc.embedFile(dataBytes, {
  filename: "source-data.csv",
  mimeType: "text/csv"
});

page.setAssociatedFile(fileRef, "DataSources");
```

This annotates the structure tree so processors can locate supporting files by relationship.

## Phonetic Attributes

For pronunciation guidance and abbreviation expansion, attach `/Phoneme` or `/E` dictionaries to structure elements:

- `/Phoneme` — phonetic transcription (e.g. IPA) for screen reader pronunciation
- `/E` — the expanded form of an acronym or abbreviation

```ts
doc.setPhoneticExpansion(tag, "National Aeronautics and Space Administration");
doc.setPhoneme(tag, "næʃənəl eɪrənɔtɪks");
```

## Table Summary

Tables accept a `summary` option that provides a screen-reader–friendly description of the table's purpose:

```ts
page.flow().table(rows, {
  headerRows: 1,
  summary: "Quarterly revenue by product line and region"
});
```

## New Conformance Profiles

Additional profiles beyond `pdfua-1` are available. See [PDF Versions and Conformance](/guide/pdf-versions-and-conformance) for full details:

- `pdfa-2b` and `pdfa-3b` — PDF/A archival standards (levels 2 and 3, basic conformance)
- `pdfa-4` — PDF/A-4 (ISO 19005-4), the latest archival standard
- `pdfua-2` — PDF/UA-2, the next-generation universal accessibility standard
- `wtpdf` — Well-Tagged PDF (WTPDF) readability profile
