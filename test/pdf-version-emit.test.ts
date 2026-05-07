import test from "node:test";
import assert from "node:assert/strict";

import { createDocument } from "../src/index.js";

function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.slice(0, 16));
}

test("default doc emits %PDF-1.4 header", () => {
  const doc = createDocument();
  doc.addPage({ size: "A4" }).text("x", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  assert.match(header(bytes), /^%PDF-1\.4/);
});

test("aes-128 doc emits %PDF-1.6 header", () => {
  const doc = createDocument({
    encryption: {
      algorithm: "aes-128",
      userPassword: "u",
      ownerPassword: "o"
    }
  });
  doc.addPage({ size: "A4" }).text("x", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  assert.match(header(bytes), /^%PDF-1\.6/);
});

test("aes-256 (R=5) doc emits %PDF-1.7 header", () => {
  const doc = createDocument({
    encryption: {
      algorithm: "aes-256",
      userPassword: "u",
      ownerPassword: "o"
    }
  });
  doc.addPage({ size: "A4" }).text("x", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  assert.match(header(bytes), /^%PDF-1\.7/);
});

test("rc4 doc keeps %PDF-1.4 header", () => {
  const doc = createDocument({
    encryption: {
      algorithm: "rc4-128",
      userPassword: "u",
      ownerPassword: "o"
    }
  });
  doc.addPage({ size: "A4" }).text("x", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  assert.match(header(bytes), /^%PDF-1\.4/);
});

test("objectStreams doc emits at least %PDF-1.5 header", () => {
  const doc = createDocument({ objectStreams: true });
  doc.addPage({ size: "A4" }).text("x", { x: 10, y: 10 });
  const bytes = doc.toUint8Array();
  assert.match(header(bytes), /^%PDF-1\.5/);
});
