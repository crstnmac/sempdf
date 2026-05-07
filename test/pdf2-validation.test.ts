import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, parseDocument, validatePdf2Conformance } from "../src/index.js";

test("validatePdf2Conformance returns no issues for clean library output", () => {
  const doc = createDocument();
  doc.addPage({ size: "A4" }).text("clean", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes);
  const issues = validatePdf2Conformance(parsed);
  assert.equal(issues.length, 0);
});
