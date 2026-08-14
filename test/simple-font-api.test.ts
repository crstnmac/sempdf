import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createDocument } from "../src/index.js";
import { configureFonts } from "../src/fonts.js";

const regularPath = `${process.cwd()}/fonts/liberation/LiberationSans-Regular.ttf`;
const regularBytes = readFileSync(regularPath);

test("doc.fonts renders Unicode punctuation with the optional preset", async () => {
  const { liberation } = await import(pathToFileURL(`${process.cwd()}/fonts/index.js`).href);
  const doc = createDocument();
  await doc.fonts(liberation);
  doc.addPage().text("one · two — café", { x: 36, y: 700 });
  assert.match(new TextDecoder().decode(doc.toUint8Array()), /\/Subtype \/Type0/);
});

test("configureFonts loads data and path sources and applies defaults to existing pages", async () => {
  const doc = createDocument();
  const pageCreatedBeforeLoading = doc.addPage();
  const result = await configureFonts(doc, {
    families: {
      Body: { regular: { data: regularBytes } },
      Code: { regular: { path: regularPath } },
    },
    default: "Body",
    code: "Code",
    fallbacks: ["Body"],
  });
  assert.equal(result.default, "Body");
  pageCreatedBeforeLoading.text("middle · dot", { x: 36, y: 700 });
  assert.match(new TextDecoder().decode(doc.toUint8Array()), /\/FontFile2/);
});

test("doc.fonts accepts custom families", async () => {
  const doc = createDocument();
  const configured = await doc.fonts({
    families: { Body: { regular: regularBytes } },
    default: "Body",
  });
  assert.equal(configured.default, "Body");
  doc.addPage().text("simple · API", { x: 36, y: 700 });
});

test("configureFonts loads URL sources through an injected fetch", async () => {
  const doc = createDocument();
  const seen: string[] = [];
  await configureFonts(doc, {
    families: {
      Remote: {
        regular: {
          url: "https://fonts.example/remote.ttf",
          fetch: async (input) => {
            seen.push(String(input));
            return new Response(regularBytes);
          },
        },
      },
    },
    default: "Remote",
  });
  doc.addPage().text("remote · font", { x: 36, y: 700 });
  assert.deepEqual(seen, ["https://fonts.example/remote.ttf"]);
});
