import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDocument, registerBundledFonts } from "../src/index.js";

const FONT_DIR = fileURLToPath(new URL("../fonts/liberation/", import.meta.url));

/** A system TrueType font used as stand-in bytes for the `read` path. */
const SYSTEM_FONT = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
].find((path) => existsSync(path));

test("registerBundledFonts registers sans/serif/mono families via injected bytes", async (t) => {
  if (!SYSTEM_FONT) {
    t.skip("no system TrueType font available for stand-in bytes");
    return;
  }
  const bytes = readFileSync(SYSTEM_FONT);
  const doc = createDocument();
  const fonts = await registerBundledFonts(doc, { read: () => bytes });

  assert.deepEqual(fonts, {
    sans: "Liberation Sans",
    serif: "Liberation Serif",
    mono: "Liberation Mono",
  });

  const page = doc.addPage();
  page.text("Heading", { x: 56, y: 760, font: fonts.sans, bold: true });
  page.text("Body", { x: 56, y: 740, font: fonts.serif });
  assert.match(new TextDecoder().decode(doc.toUint8Array()), /^%PDF-/);
});

test("a browser-style fetch reader resolves file names asynchronously", async (t) => {
  if (!SYSTEM_FONT) {
    t.skip("no system TrueType font available for stand-in bytes");
    return;
  }
  const buf = readFileSync(SYSTEM_FONT);
  const doc = createDocument();
  const seen: string[] = [];
  const fonts = await registerBundledFonts(doc, {
    read: async (file) => {
      seen.push(file);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  });
  assert.equal(fonts.sans, "Liberation Sans");
  // 3 families x 4 faces requested by base name.
  assert.equal(seen.length, 12);
  assert.ok(seen.includes("LiberationSans-Regular.ttf"));
});

test("default disk reader loads the bundled fonts when present", async (t) => {
  if (!existsSync(`${FONT_DIR}LiberationSans-Regular.ttf`)) {
    t.skip("bundled fonts not fetched — run `npm run fetch-fonts`");
    return;
  }
  const doc = createDocument();
  const fonts = await registerBundledFonts(doc);
  const page = doc.addPage();
  page.text("Bundled", { x: 56, y: 760, font: fonts.sans });
  assert.match(new TextDecoder().decode(doc.toUint8Array()), /^%PDF-/);
});
