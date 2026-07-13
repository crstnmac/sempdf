/**
 * Shared helpers for the license-enforcement demos. Each demo builds a small
 * accessible PDF with the core library (`@sempdf/sempdf-pdf`) and shows
 * a different facet of how the licensing guard governs generation.
 */
import { mkdir, writeFile } from "node:fs/promises";

import { createDocument, hex } from "../../src/index.js";

/** Builds a small multi-page accessible PDF with `pages` pages. */
export function buildSampleDoc(title: string, pages = 3) {
  const doc = createDocument({
    language: "en-US",
    info: { title, author: "sempdf license demo" },
  });
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage({ size: "A4" });
    page.text(title, { x: 56, y: 770, fontSize: 18, color: hex("1c2f6b") });
    page.text(`Page ${i} of ${pages}`, { x: 56, y: 744, fontSize: 12 });
    page.text("Generated with @sempdf/sempdf-pdf - licensing baked in.", {
      x: 56,
      y: 720,
      fontSize: 11,
      color: hex("555555"),
    });
  }
  return doc;
}

/** Writes a PDF into examples/out and logs the path. */
export async function save(name: string, bytes: Uint8Array) {
  const dir = new URL("./out/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const path = new URL(name, dir);
  await writeFile(path, bytes);
  console.log(`  -> wrote ${name} (${bytes.length} bytes)`);
}

/** Pretty header for each demo's console output. */
export function banner(text: string) {
  console.log(`\n=== ${text} ===`);
}
