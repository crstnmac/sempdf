import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, parseDocument } from "../src/index.js";

test("aes-256-r6 round-trip with user password", () => {
  const doc = createDocument({
    encryption: {
      algorithm: "aes-256-r6",
      userPassword: "user-secret",
      ownerPassword: "owner-secret"
    }
  });
  doc.addPage({ size: "A4" }).text("R6 hello", { x: 48, y: 780 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.match(text.slice(0, 16), /^%PDF-2\.0/);
  assert.match(text, /\/V 5/);
  assert.match(text, /\/R 6/);
  assert.match(text, /\/CFM \/AESV3/);
  assert.match(text, /\/UE </);
  assert.match(text, /\/OE </);
  assert.match(text, /\/Perms </);
  assert.equal(text.includes("R6 hello"), false);

  const parsed = parseDocument(bytes, { password: "user-secret" });
  assert.equal(parsed.getPageCount(), 1);
});

test("aes-256-r6 round-trip with owner password", () => {
  const doc = createDocument({
    encryption: {
      algorithm: "aes-256-r6",
      userPassword: "user-pass",
      ownerPassword: "owner-pass"
    }
  });
  doc.addPage({ size: "A4" }).text("Owner unlock", { x: 48, y: 780 });

  const bytes = doc.toUint8Array();
  const parsed = parseDocument(bytes, { password: "owner-pass" });
  assert.equal(parsed.getPageCount(), 1);
});

test("aes-256-r6 rejects wrong password", () => {
  const doc = createDocument({
    encryption: {
      algorithm: "aes-256-r6",
      userPassword: "right",
      ownerPassword: "owner"
    }
  });
  doc.addPage({ size: "A4" }).text("hi", { x: 10, y: 10 });

  const bytes = doc.toUint8Array();
  assert.throws(() => parseDocument(bytes, { password: "wrong" }));
});

test("aes-256-r6 SASLprep: NFKC-equivalent passwords interchange", () => {
  // U+FB01 (LATIN SMALL LIGATURE FI) NFKC → "fi"
  const doc = createDocument({
    encryption: {
      algorithm: "aes-256-r6",
      userPassword: "of\u{FB01}ce",
      ownerPassword: "owner"
    }
  });
  doc.addPage({ size: "A4" }).text("h", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  // Different Unicode form, same NFKC-normalized output.
  const parsed = parseDocument(bytes, { password: "office" });
  assert.equal(parsed.getPageCount(), 1);
});

test("aes-256-r6 detects tampered Perms block", () => {
  const doc = createDocument({
    encryption: {
      algorithm: "aes-256-r6",
      userPassword: "u",
      ownerPassword: "o"
    }
  });
  doc.addPage({ size: "A4" }).text("h", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  // Flip /P from -4 (0xFFFFFFFC) to -1 (0xFFFFFFFF) in the encryption dict.
  const text = new TextDecoder().decode(bytes);
  const flipped = new TextEncoder().encode(text.replace(/\/P -\d+/, "/P -1"));
  assert.throws(() => parseDocument(flipped, { password: "u" }));
});

test("aes-256-r6 emits %PDF-2.0 header", () => {
  const doc = createDocument({
    encryption: {
      algorithm: "aes-256-r6",
      userPassword: "u",
      ownerPassword: "o"
    }
  });
  doc.addPage({ size: "A4" }).text("h", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  const header = new TextDecoder().decode(bytes.slice(0, 16));
  assert.match(header, /^%PDF-2\.0/);
});
