import test from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "../src/index.js";

/** Serializes a document with compression disabled and decodes operators as latin1. */
function operators(build: (doc: ReturnType<typeof createDocument>) => void): string {
  const doc = createDocument({ compress: false });
  build(doc);
  return new TextDecoder("latin1").decode(doc.toUint8Array());
}

/** Counts non-overlapping occurrences of a substring. */
function count(haystack: string, needle: string): number {
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

test("underlined text renders a valid PDF", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("x", { x: 56, y: 700, underline: true });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /^%PDF-/);
});

test("underline adds a stroked line path beyond the plain text", () => {
  // The decoration emits a stroked line path tagged as an Artifact:
  //   <... m> <... l> S   (see page-helpers.ts decorationOp + serializer).
  // Plain text emits no stroke operator, so the underlined document carries
  // strictly more stroke (`S`) and line (`l`) operators.
  const plain = operators((doc) => {
    doc.addPage().text("Underlined sample", { x: 56, y: 700 });
  });
  const underlined = operators((doc) => {
    doc.addPage().text("Underlined sample", { x: 56, y: 700, underline: true });
  });

  assert.equal(count(plain, "\nS\n"), 0);
  assert.ok(count(underlined, "\nS\n") > count(plain, "\nS\n"));
  assert.ok(count(underlined, " l\n") > count(plain, " l\n"));
  assert.match(underlined, /\/Artifact/);
  assert.ok(underlined.length > plain.length);
});

test("strike-through adds a stroked line path beyond the plain text", () => {
  const plain = operators((doc) => {
    doc.addPage().text("Struck sample", { x: 56, y: 700 });
  });
  const struck = operators((doc) => {
    doc.addPage().text("Struck sample", { x: 56, y: 700, strike: true });
  });

  assert.equal(count(plain, "\nS\n"), 0);
  assert.ok(count(struck, "\nS\n") > count(plain, "\nS\n"));
  assert.ok(count(struck, " l\n") > count(plain, " l\n"));
  assert.match(struck, /\/Artifact/);
});

test("per-run decoration in richText renders a valid PDF", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.richText([{ text: "a " }, { text: "b", underline: true }], {
    x: 56,
    y: 660,
    width: 200
  });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /^%PDF-/);
});

test("per-run richText underline adds a stroked line path", () => {
  const plain = operators((doc) => {
    doc
      .addPage()
      .richText([{ text: "a " }, { text: "b" }], { x: 56, y: 660, width: 200 });
  });
  const decorated = operators((doc) => {
    doc
      .addPage()
      .richText([{ text: "a " }, { text: "b", underline: true }], {
        x: 56,
        y: 660,
        width: 200
      });
  });

  assert.equal(count(plain, "\nS\n"), 0);
  assert.ok(count(decorated, "\nS\n") > count(plain, "\nS\n"));
  assert.match(decorated, /\/Artifact/);
});
