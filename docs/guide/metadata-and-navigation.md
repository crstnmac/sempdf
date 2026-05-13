# Metadata and Navigation

Documents can carry Info/XMP metadata, named destinations, outlines, page labels, and embedded file attachments.

## Document Info and XMP

Info dictionary entries map directly. XMP metadata is generated from a structured input.

```ts
const doc = createDocument({
  info: {
    title: "Hello PDF",
    author: "zeropdf",
    subject: "Demonstration",
    keywords: "pdf,typescript",
    creationDate: "D:20260413210000Z"
  },
  xmpMetadata: {
    title: "Hello PDF",
    creator: "zeropdf",
    createDate: "2026-04-13T21:00:00Z",
    modifyDate: "2026-04-13T21:00:00Z",
    metadataDate: "2026-04-13T21:00:00Z"
  }
});
```

Update existing PDFs incrementally:

```ts
const editable = editDocument(bytes);
editable.updateInfo({ title: "Revised", modificationDate: "D:20260414091500Z" });
editable.setXmpMetadata({ title: "Revised", metadataDate: "2026-04-14T09:15:00Z" });
```

## Named destinations and outlines

```ts
const intro = doc.addPage();
doc.addNamedDestination("intro", intro);
doc.addOutline("Introduction", "intro");

const chapter = doc.addOutline("Chapter 1");
chapter.addChild("Section 1.1", "intro");
```

Outlines accept a destination name or a `PdfPage` reference.

## Page labels

```ts
doc.setPageLabel(intro, { style: "decimal", prefix: "Intro-" });
doc.setPageLabel(chapter, { style: "upper-roman", start: 1 });
```

Styles: `"decimal" | "upper-roman" | "lower-roman" | "upper-letter" | "lower-letter"`.

## File attachments

```ts
doc.attachFile("notes.txt", new TextEncoder().encode("hello"), {
  description: "Build notes",
  mimeType: "text/plain"
});
```

The attachment is exposed under the document's `/Names → /EmbeddedFiles` tree and listed in PDF readers' attachments panel.

## Inspecting parsed metadata

```ts
import { parseDocument } from "zeropdf";

const parsed = parseDocument(bytes);
console.log(parsed.metadata.title);
console.log(parsed.namedDestinations);
console.log(parsed.outline);
console.log(parsed.pageLabels);
console.log(parsed.attachments);
```
