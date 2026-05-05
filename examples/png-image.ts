import { writeFile } from "node:fs/promises";

import { createDocument } from "../src/index.js";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC";

const png = Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));

const doc = createDocument({
  info: {
    title: "PNG Example",
    author: "Codex",
    creationDate: "D:20260413213000Z",
    modificationDate: "D:20260413213000Z"
  }
});

const page = doc.addPage({ size: "Letter" });
page.text("Embedded PNG image", {
  x: 56,
  y: 720,
  fontSize: 18
});
page.png(png, {
  x: 56,
  y: 560,
  width: 120,
  height: 120
});

await writeFile(new URL("./png-image.pdf", import.meta.url), doc.toUint8Array());
