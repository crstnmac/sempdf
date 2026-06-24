import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, parseDocument } from "../src/index.js";

// Simulates a browser by hiding node:crypto from the encryption layer, forcing
// the pure-JS AES/SHA fallbacks. We then decrypt with the normal (Node) path to
// prove the browser-produced ciphertext is interoperable.
function withoutNodeCrypto<T>(fn: () => T): T {
  const proc = (globalThis as { process?: { getBuiltinModule?: unknown } }).process;
  const original = proc?.getBuiltinModule;
  if (proc) proc.getBuiltinModule = undefined;
  try {
    return fn();
  } finally {
    if (proc) proc.getBuiltinModule = original;
  }
}

for (const algorithm of ["aes-128", "aes-256", "aes-256-r6"] as const) {
  test(`${algorithm}: encrypt with browser fallback, decrypt with node`, () => {
    const bytes = withoutNodeCrypto(() => {
      const doc = createDocument({
        info: { title: `Browser ${algorithm}` },
        encryption: { algorithm, userPassword: "reader", ownerPassword: "owner-secret" },
      });
      doc.addPage({ size: "Letter" }).text(`Secret ${algorithm}`, { x: 24, y: 700 });
      return doc.toUint8Array();
    });

    // Decrypt via the standard path (uses node:crypto here).
    const parsed = parseDocument(bytes, { password: "reader" });
    assert.equal(parsed.getMetadata().title, `Browser ${algorithm}`);

    // Wrong password must still fail.
    assert.throws(() => parseDocument(bytes, { password: "nope" }));
  });

  test(`${algorithm}: decrypt also works in the browser fallback`, () => {
    const doc = createDocument({
      info: { title: `Both ${algorithm}` },
      encryption: { algorithm, userPassword: "reader", ownerPassword: "owner-secret" },
    });
    doc.addPage({ size: "Letter" }).text("x", { x: 24, y: 700 });
    const bytes = doc.toUint8Array();

    const title = withoutNodeCrypto(() =>
      parseDocument(bytes, { password: "reader" }).getMetadata().title,
    );
    assert.equal(title, `Both ${algorithm}`);
  });
}
