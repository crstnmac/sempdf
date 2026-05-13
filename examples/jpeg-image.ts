import { writeFile } from "node:fs/promises";
import { createDocument } from "../src/index.js";

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+L6KKK/lM/38P//Z";

const jpeg = Uint8Array.from(Buffer.from(TINY_JPEG_BASE64, "base64"));

const doc = createDocument({
  language: "en-US",
  info: {
    title: "JPEG Example",
    author: "Codex",
    creationDate: "D:20260413213000Z",
    modificationDate: "D:20260413213000Z"
  }
});

doc.setXmpMetadata({
  title: "JPEG Example",
  creator: "Codex",
  creatorTool: "sempdf",
  createDate: "2026-04-13T21:30:00Z",
  modifyDate: "2026-04-13T21:30:00Z",
  metadataDate: "2026-04-13T21:30:00Z"
});

doc.renderTemplate({
  info: { title: "JPEG Example", author: "Codex" },
  page: { size: "Letter" },
  blocks: [
    {
      type: "heading",
      text: "Embedded JPEG Image",
      options: { level: 1 }
    },
    {
      type: "paragraph",
      text: "A JPEG image embedded via the renderTemplate block system. The image flows naturally within the page content.",
      options: { fontSize: 11, marginBottom: 14 }
    },
    {
      type: "jpeg",
      data: jpeg,
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

await writeFile(new URL("./jpeg-image.pdf", import.meta.url), doc.toUint8Array());
