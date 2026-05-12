import { writeFile } from "node:fs/promises";
import { createDocument } from "../src/index.js";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC";

const png = Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));

const doc = createDocument({
  language: "en-US",
  info: {
    title: "PNG Example",
    author: "Codex",
    creationDate: "D:20260413213000Z",
    modificationDate: "D:20260413213000Z"
  }
});

doc.setXmpMetadata({
  title: "PNG Example",
  creator: "Codex",
  creatorTool: "pdf-editing-lib",
  createDate: "2026-04-13T21:30:00Z",
  modifyDate: "2026-04-13T21:30:00Z",
  metadataDate: "2026-04-13T21:30:00Z"
});

doc.renderTemplate({
  info: { title: "PNG Example", author: "Codex" },
  page: { size: "Letter" },
  blocks: [
    {
      type: "heading",
      text: "Embedded PNG Image",
      options: { level: 1 }
    },
    {
      type: "paragraph",
      text: "A PNG image embedded via the renderTemplate block system. The image flows naturally within the page content.",
      options: { fontSize: 11, marginBottom: 14 }
    },
    {
      type: "png",
      data: png,
      options: { maxWidth: 120, align: "left" }
    }
  ]
});

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
}

await writeFile(new URL("./png-image.pdf", import.meta.url), doc.toUint8Array());
