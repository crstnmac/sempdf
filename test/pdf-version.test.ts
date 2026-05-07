import test from "node:test";
import assert from "node:assert/strict";

import { compareVersion, detectMinimumVersion, formatHeader, maxVersion, parseVersion } from "../src/internal/pdf-version.js";
import type { PdfDocumentModel } from "../src/document.js";

function baseModel(): PdfDocumentModel {
  return {
    info: { producer: "test" },
    tagged: false,
    embeddedFonts: [],
    namedDestinations: [],
    pageLabels: [],
    attachments: [],
    outlines: [],
    pages: []
  };
}

test("formatHeader emits %PDF-x.y", () => {
  assert.equal(formatHeader("1.4"), "%PDF-1.4");
  assert.equal(formatHeader("2.0"), "%PDF-2.0");
});

test("maxVersion picks highest", () => {
  assert.equal(maxVersion("1.4", "1.7", "1.5"), "1.7");
  assert.equal(maxVersion("2.0", "1.7"), "2.0");
});

test("compareVersion orders correctly", () => {
  assert.equal(compareVersion("1.4", "1.5"), -1);
  assert.equal(compareVersion("2.0", "1.7"), 1);
  assert.equal(compareVersion("1.6", "1.6"), 0);
});

test("parseVersion accepts known + rejects unknown", () => {
  assert.equal(parseVersion("1.7"), "1.7");
  assert.equal(parseVersion("9.9"), undefined);
  assert.equal(parseVersion(undefined), undefined);
});

test("detectMinimumVersion default 1.4", () => {
  assert.equal(detectMinimumVersion(baseModel()), "1.4");
});

test("detectMinimumVersion: objectStreams → 1.5", () => {
  assert.equal(detectMinimumVersion({ ...baseModel(), objectStreams: true }), "1.5");
});

test("detectMinimumVersion: aes-128 → 1.6", () => {
  const model = {
    ...baseModel(),
    encryption: { algorithm: "aes-128", version: 4, revision: 4, keyLengthBytes: 16 } as unknown as PdfDocumentModel["encryption"]
  };
  assert.equal(detectMinimumVersion(model), "1.6");
});

test("detectMinimumVersion: aes-256 R=5 → 1.7", () => {
  const model = {
    ...baseModel(),
    encryption: { algorithm: "aes-256", version: 5, revision: 5, keyLengthBytes: 32 } as unknown as PdfDocumentModel["encryption"]
  };
  assert.equal(detectMinimumVersion(model), "1.7");
});

test("detectMinimumVersion: aes-256 R=6 → 2.0", () => {
  const model = {
    ...baseModel(),
    encryption: { algorithm: "aes-256", version: 5, revision: 6, keyLengthBytes: 32 } as unknown as PdfDocumentModel["encryption"]
  };
  assert.equal(detectMinimumVersion(model), "2.0");
});

test("detectMinimumVersion: rc4 stays 1.4", () => {
  const model = {
    ...baseModel(),
    encryption: { algorithm: "rc4-128", version: 2, revision: 3, keyLengthBytes: 16 } as unknown as PdfDocumentModel["encryption"]
  };
  assert.equal(detectMinimumVersion(model), "1.4");
});

test("detectMinimumVersion: attachments → 1.7", () => {
  const model = {
    ...baseModel(),
    attachments: [{ name: "a.txt" }] as unknown as PdfDocumentModel["attachments"]
  };
  assert.equal(detectMinimumVersion(model), "1.7");
});

test("detectMinimumVersion: signature → 1.7", () => {
  const model = {
    ...baseModel(),
    signature: {} as unknown as PdfDocumentModel["signature"]
  };
  assert.equal(detectMinimumVersion(model), "1.7");
});

test("detectMinimumVersion: max of multiple features", () => {
  const model: PdfDocumentModel = {
    ...baseModel(),
    objectStreams: true,
    encryption: { algorithm: "aes-256", version: 5, revision: 6, keyLengthBytes: 32 } as unknown as PdfDocumentModel["encryption"]
  };
  assert.equal(detectMinimumVersion(model), "2.0");
});
