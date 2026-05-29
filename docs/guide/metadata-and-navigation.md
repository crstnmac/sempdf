# Metadata and Navigation

Documents can carry Info/XMP metadata, named destinations, outlines, page labels, and embedded file attachments.

## Document Info and XMP

Use `title` when the Info dictionary title and XMP title should match. It writes the classic title, creates structured XMP title metadata, and sets the viewer preference that tells PDF readers to display the document title. Info dictionary entries map directly for the remaining classic metadata fields.

```ts
const doc = createDocument({
  title: "Hello PDF",
  info: {
    author: "sempdf",
    subject: "Demonstration",
    keywords: "pdf,typescript",
    creationDate: "D:20260413210000Z"
  },
  xmpMetadata: {
    creator: "sempdf",
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
import { parseDocument } from "@criston/sempdf";

const parsed = parseDocument(bytes);
console.log(parsed.getMetadata().title);
console.log(parsed.listNamedDestinations());
console.log(parsed.listOutlines());
console.log(parsed.listPageLabels());
console.log(parsed.listAttachments());
```
