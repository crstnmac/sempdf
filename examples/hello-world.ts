import { writeFile } from "node:fs/promises";

import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  info: {
    title: "Hello World",
    author: "Codex",
    creationDate: "D:20260413213000Z",
    modificationDate: "D:20260413213000Z"
  }
});

const page = doc.addPage({ size: "A4" });
page.text("Hello from pdf-editing-lib", {
  x: 72,
  y: 780,
  fontSize: 20,
  color: hex("1c2f6b")
});
page.path(
  [{ type: "rect", x: 72, y: 740, width: 220, height: 36 }],
  {
    paint: "stroke",
    stroke: {
      width: 1.5,
      color: hex("1c2f6b")
    }
  }
);

await writeFile(new URL("./hello-world.pdf", import.meta.url), doc.toUint8Array());
