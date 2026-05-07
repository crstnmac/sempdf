import { writeFile } from "node:fs/promises";

import { createDocument, mergeDocuments } from "../src/index.js";

// The library auto-detects the minimum required PDF version from features used:
//   baseline               -> 1.4
//   objectStreams: true    -> 1.5
//   AES-128 encryption     -> 1.6
//   AES-256 R=5 encryption -> 1.7
//   AES-256 R=6 encryption -> 2.0
//   attachments / signature / pdfua-1 -> 1.7
// page-transfer (extract / merge / append) carries the max source version forward.

function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.slice(0, 16)).split("\n")[0] ?? "";
}

function makeDoc(opts: Parameters<typeof createDocument>[0]): Uint8Array {
  const doc = createDocument(opts);
  doc.addPage({ size: "A4" }).text("hi", { x: 10, y: 10 });
  return doc.toUint8Array();
}

const baseline = makeDoc({});
console.log(`baseline:        ${header(baseline)}`);

const compressed = makeDoc({ objectStreams: true });
console.log(`objectStreams:   ${header(compressed)}`);

const aes128 = makeDoc({ encryption: { algorithm: "aes-128", userPassword: "u", ownerPassword: "o" } });
console.log(`aes-128:         ${header(aes128)}`);

const aes256 = makeDoc({ encryption: { algorithm: "aes-256", userPassword: "u", ownerPassword: "o" } });
console.log(`aes-256 (R=5):   ${header(aes256)}`);

const aes256r6 = makeDoc({ encryption: { algorithm: "aes-256-r6", userPassword: "u", ownerPassword: "o" } });
console.log(`aes-256-r6:      ${header(aes256r6)}`);

// Merging a 1.4 doc with a 1.5 doc yields 1.5 output.
const merged = mergeDocuments([baseline, compressed]);
console.log(`merge(1.4, 1.5): ${header(merged)}`);

await writeFile(new URL("./pdf-version-autodetect.pdf", import.meta.url), aes256r6);
