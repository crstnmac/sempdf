import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createDocument, hex } from "../src/index.js";

const png = readFileSync("examples/assets/sempdf-logo.png");

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAwICAwQCAwQFBQUFBQYGBgYGBggICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+L6KKK/lM/38P//Z";

const jpeg = Uint8Array.from(Buffer.from(TINY_JPEG_BASE64, "base64"));

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Flow Images Demo",
    author: "sempdf"
  }
});

doc.setXmpMetadata({
  title: "Flow Images Demo",
  creator: "sempdf",
  creatorTool: "sempdf",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "Flow Images Demo", author: "sempdf" },
  page: { size: "A4", fontSize: 12 },
  autoOutline: { maxLevel: 2 },
  blocks: [
    {
      type: "heading",
      text: "renderTemplate with Images",
      options: { level: 1, color: hex("#1a1a2e") }
    },
    {
      type: "paragraph",
      text: "The renderTemplate API allows images to be laid out inline with text. Images flow naturally within the page content, wrapping to the next line when necessary. You can also control alignment and sizing.",
      options: { fontSize: 12 }
    },
    {
      type: "heading",
      text: "PNG Image",
      options: { level: 2 }
    },
    {
      type: "paragraph",
      text: "Below is a PNG image embedded via a renderTemplate png block:",
      options: { marginBottom: 8 }
    },
    {
      type: "png",
      data: png,
      options: { maxWidth: 200, align: "center" }
    },
    {
      type: "heading",
      text: "JPEG Image",
      options: { level: 2 }
    },
    {
      type: "paragraph",
      text: "Below is a JPEG image embedded via a renderTemplate jpeg block:",
      options: { marginBottom: 8 }
    },
    {
      type: "jpeg",
      data: jpeg,
      options: { maxWidth: 120, align: "left" }
    },
    {
      type: "heading",
      text: "Aligned Images",
      options: { level: 2 }
    },
    {
      type: "paragraph",
      text: "Left-aligned PNG:"
    },
    {
      type: "png",
      data: png,
      options: { maxWidth: 100, align: "left" }
    },
    {
      type: "paragraph",
      text: "Center-aligned PNG:"
    },
    {
      type: "png",
      data: png,
      options: { maxWidth: 100, align: "center" }
    },
    {
      type: "paragraph",
      text: "Right-aligned PNG:"
    },
    {
      type: "png",
      data: png,
      options: { maxWidth: 100, align: "right" }
    }
  ],
  header: ({ title, pageNumber, totalPages }) => [
    {
      type: "paragraph",
      text: `${title ?? "Flow Images"} -- Page ${pageNumber} of ${totalPages}`,
      options: { fontSize: 8, color: hex("#9a9aae"), tag: "Artifact" }
    }
  ],
  pageNumber: { region: "footer", align: "center" }
});

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
}

await writeFile("examples/flow-images.pdf", doc.toUint8Array());
console.log("Wrote examples/flow-images.pdf");
console.log("  Blocks: png, jpeg, heading, paragraph with alignment");
