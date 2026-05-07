import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, editDocument } from "../src/index.js";

test("incremental update on 2.0 base emits /Namespaces and per-element /NS", () => {
  const base = createDocument({
    tagged: true,
    encryption: {
      algorithm: "aes-256-r6",
      userPassword: "u",
      ownerPassword: "o"
    }
  });
  base.addPage({ size: "A4" }).text("base", { x: 10, y: 10, tag: "H1" });
  const baseBytes = base.toUint8Array();

  const editable = editDocument(baseBytes, { password: "u" });
  editable.addPage({ size: "A4" }).text("appended", { x: 10, y: 10, tag: "P" });
  const out = editable.toUint8Array();
  const text = new TextDecoder().decode(out);

  // Two new namespace dicts emitted in the incremental segment.
  const nsCount = (text.match(/\/Type \/Namespace\b/g) ?? []).length;
  assert.equal(nsCount >= 2, true);
  // New struct element references namespace via /NS.
  assert.match(text, /\/Type \/StructElem[\s\S]*?\/NS \d+ 0 R/);
});
