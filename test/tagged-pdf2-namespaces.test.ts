import test from "node:test";
import assert from "node:assert/strict";

import { createDocument } from "../src/index.js";

test("tagged document at 2.0 emits /Namespaces array", () => {
  // R=6 encryption forces 2.0; tagged adds StructTreeRoot.
  const doc = createDocument({
    tagged: true,
    structureRoot: "Document",
    encryption: {
      algorithm: "aes-256-r6",
      userPassword: "u",
      ownerPassword: "o"
    }
  });
  doc.addPage({ size: "A4" }).text("hello tagged 2.0", { x: 10, y: 10, tag: "H1" });
  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  // Header is 2.0
  assert.match(text.slice(0, 16), /^%PDF-2\.0/);
  // StructTreeRoot includes /Namespaces array referencing two namespace dicts.
  assert.match(text, /\/Type \/StructTreeRoot[\s\S]*\/Namespaces \[/);
  // Two /Type /Namespace objects emitted.
  const nsCount = (text.match(/\/Type \/Namespace\b/g) ?? []).length;
  assert.equal(nsCount, 2);
  // Struct element references the PDF 2.0 namespace via /NS.
  assert.match(text, /\/Type \/StructElem[\s\S]*?\/NS \d+ 0 R/);
});

test("tagged document at 1.4 does NOT emit /Namespaces", () => {
  const doc = createDocument({ tagged: true });
  doc.addPage({ size: "A4" }).text("h", { x: 10, y: 10, tag: "H1" });
  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text.slice(0, 16), /^%PDF-1\.4/);
  assert.equal(text.includes("/Namespaces"), false);
});
