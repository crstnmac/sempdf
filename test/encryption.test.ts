import test from "node:test";
import assert from "node:assert/strict";

import { BufferSink, createDocument, editDocument, parseDocument, PdfEngineError, PdfErrorCode } from "../src/index.js";

test("serializes password-protected PDFs with permissions and hides plaintext", () => {
  const doc = createDocument({
    info: {
      title: "Protected Title"
    },
    encryption: {
      algorithm: "rc4-40",
      userPassword: "reader",
      ownerPassword: "owner-secret",
      permissions: {
        printing: false,
        modifying: false,
        copying: false,
        annotating: false,
        accessibility: false,
        assemble: false,
        highQualityPrint: false,
        fillForms: false
      }
    }
  });

  const page = doc.addPage({ size: "Letter" });
  page.text("Top Secret", { x: 24, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /\/Encrypt 4 0 R/);
  assert.match(text, /\/Filter \/Standard/);
  assert.match(text, /\/V 1/);
  assert.match(text, /\/R 2/);
  assert.match(text, /\/P -64/);
  assert.match(text, /\/ID \[<[0-9A-F]+> <[0-9A-F]+>\]/);
  assert.equal(text.includes("Top Secret"), false);
  assert.equal(text.includes("Protected Title"), false);

  assert.throws(
    () => parseDocument(bytes),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ENCRYPTION
  );

  assert.throws(
    () => parseDocument(bytes, { password: "wrong-password" }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ENCRYPTION
  );

  const parsed = parseDocument(bytes, { password: "reader" });
  assert.equal(parsed.getMetadata().title, "Protected Title");
  assert.equal(parsed.getPageCount(), 1);

  const ownerParsed = parseDocument(bytes, { password: "owner-secret" });
  assert.equal(ownerParsed.getMetadata().title, "Protected Title");

  assert.throws(
    () => editDocument(bytes),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ENCRYPTION
  );
});

test("defaults password-protected PDFs to rc4-128 protection", () => {
  const doc = createDocument({
    info: {
      title: "Protected 128"
    },
    encryption: {
      userPassword: "reader",
      ownerPassword: "owner-secret"
    }
  });

  doc.addPage({ size: "Letter" }).text("High Security", { x: 24, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /\/Encrypt 4 0 R/);
  assert.match(text, /\/V 2/);
  assert.match(text, /\/R 3/);
  assert.match(text, /\/Length 128/);
  assert.equal(text.includes("High Security"), false);
  assert.equal(parseDocument(bytes, { password: "reader" }).getMetadata().title, "Protected 128");
});

test("serializes and parses AES password-protected PDFs", () => {
  for (const algorithm of ["aes-128", "aes-256"] as const) {
    const doc = createDocument({
      info: { title: `Protected ${algorithm}` },
      encryption: {
        algorithm,
        userPassword: "reader",
        ownerPassword: "owner-secret"
      }
    });

    doc.addPage({ size: "Letter" }).text(`Secret ${algorithm}`, { x: 24, y: 700 });
    const bytes = doc.toUint8Array();
    const text = new TextDecoder().decode(bytes);

    assert.match(text, new RegExp(`/CFM /${algorithm === "aes-256" ? "AESV3" : "AESV2"}`));
    assert.match(text, new RegExp(`/Length ${algorithm === "aes-256" ? "256" : "128"}`));
    assert.equal(text.includes(`Secret ${algorithm}`), false);
    assert.equal(parseDocument(bytes, { password: "reader" }).getMetadata().title, `Protected ${algorithm}`);
    assert.equal(parseDocument(bytes, { password: "owner-secret" }).getPageCount(), 1);
  }
});

test("incrementally edits encrypted PDFs and preserves encryption", () => {
  const base = createDocument({
    info: {
      title: "Encrypted Draft"
    },
    encryption: {
      algorithm: "rc4-128",
      userPassword: "reader",
      ownerPassword: "owner-secret",
      permissions: {
        printing: true,
        modifying: false,
        copying: false,
        annotating: false
      }
    }
  });

  base.addPage({ size: "Letter" }).text("Classified", { x: 36, y: 720 });
  const baseBytes = base.toUint8Array();

  const editable = editDocument(baseBytes, { password: "reader" });
  editable.updateInfo({ title: "Encrypted Revision" });
  editable.addPage({ size: "Letter" }).text("Revision page", { x: 36, y: 720 });

  const updatedBytes = editable.toUint8Array();
  const updatedText = new TextDecoder().decode(updatedBytes);

  assert.match(updatedText, /\/Encrypt 4 0 R/);
  assert.match(updatedText, /\/V 2/);
  assert.match(updatedText, /\/R 3/);
  assert.match(updatedText, /\/Length 128/);
  assert.equal(updatedText.includes("Encrypted Revision"), false);
  assert.equal(updatedText.includes("Revision page"), false);

  const parsed = parseDocument(updatedBytes, { password: "reader" });
  assert.equal(parsed.getMetadata().title, "Encrypted Revision");
  assert.equal(parsed.getPageCount(), 2);

  const ownerParsed = parseDocument(updatedBytes, { password: "owner-secret" });
  assert.equal(ownerParsed.getMetadata().title, "Encrypted Revision");
  assert.equal(ownerParsed.getPageCount(), 2);
});

test("streams encrypted incremental edits with lazy encrypted streams", async () => {
  const base = createDocument({
    info: {
      title: "Encrypted Stream Base"
    },
    encryption: {
      algorithm: "rc4-128",
      userPassword: "reader",
      ownerPassword: "owner-secret"
    }
  });
  base.addPage({ size: "Letter" }).text("Base secret", { x: 36, y: 720 });

  const editable = editDocument(base.toUint8Array(), { password: "reader" });
  editable.updateInfo({ title: "Encrypted Stream Revision" });
  editable.addPage({ size: "Letter" }).text("Streamed revision page", { x: 36, y: 720 });

  const sink = new BufferSink();
  await editable.writeTo(sink);
  const bytes = sink.collect();
  const text = new TextDecoder().decode(bytes);

  assert.match(text, /\/Length \d+ 0 R/);
  assert.equal(text.includes("Encrypted Stream Revision"), false);
  assert.equal(text.includes("Streamed revision page"), false);

  const parsed = parseDocument(bytes, { password: "reader" });
  assert.equal(parsed.getMetadata().title, "Encrypted Stream Revision");
  assert.equal(parsed.getPageCount(), 2);
});

test("rejects invalid encryption definitions", () => {
  assert.throws(
    () => createDocument({ encryption: {} }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_ENCRYPTION
  );
});

test("allows empty user password with non-empty owner password", () => {
  const doc = createDocument({
    encryption: {
      userPassword: "",
      ownerPassword: "owner123",
    },
  });
  const page = doc.addPage();
  page.text("Secret", { x: 72, y: 720 });
  const bytes = doc.toUint8Array();
  // Should generate without error
  assert.ok(bytes.length > 0);
});

test("rejects encryption with both passwords empty", () => {
  assert.throws(
    () =>
      createDocument({
        encryption: { userPassword: "", ownerPassword: "" },
      }),
    (error: unknown) =>
      error instanceof PdfEngineError &&
      error.code === PdfErrorCode.INVALID_ENCRYPTION,
  );
});
