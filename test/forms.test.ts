import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { appendPages, BufferSink, cmyk, createDocument, deviceN, editDocument, extractPages, mergeDocuments, PAGE_SIZES, parseDocument, PdfEngineError, PdfErrorCode, rgb, separation, splitDocument } from "../src/index.js";
import { StreamingByteWriter } from "../src/internal/streaming-byte-writer.js";
import { inspectPdf } from "../src/internal/inspect.js";
import { makeKerningPairKey, measureTextWidth } from "../src/internal/text-layout.js";
import type { PdfValue } from "../src/internal/pdf-primitives.js";
import { parseTrueTypeFont } from "../src/internal/truetype.js";

test("serializes AcroForm text fields and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.textField("customerName", {
    x: 36,
    y: 640,
    width: 180,
    height: 24,
    value: "Ada",
    font: "Courier",
    fontSize: 10,
    color: rgb(0.1, 0.2, 0.3),
    required: true
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/AcroForm \d+ 0 R/);
  assert.match(text, /\/NeedAppearances true/);
  assert.match(text, /\/Subtype \/Widget/);
  assert.match(text, /\/FT \/Tx/);
  assert.match(text, /\/T \(customerName\)/);
  assert.match(text, /\/V \(Ada\)/);
  assert.match(text, /\/DA \(\/FormF\d+ 10 Tf 0\.1 0\.2 0\.3 rg\)/);

  const parsed = parseDocument(bytes);
  const field = parsed.listFormFields()[0];

  assert.equal(field?.name, "customerName");
  assert.equal(field?.fieldType, "Tx");
  assert.equal(field?.value, "Ada");
  assert.equal(field?.pageObjectId, parsed.listPages()[0]?.objectId);
  assert.deepEqual(field?.rect, [36, 640, 216, 664]);
  assert.equal(field?.required, true);
});

test("rejects invalid text field definitions", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.textField("", { x: 24, y: 24, width: 100, height: 24 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.textField("bad-size", { x: 24, y: 24, width: 0, height: 24 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.textField("bad-value", { x: 24, y: 24, width: 100, height: 24, value: "Hello 🙂" }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.UNSUPPORTED_CHARACTER
  );
});

test("serializes check box widgets and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.checkBox("subscribe", {
    x: 36,
    y: 600,
    width: 16,
    height: 16,
    checked: true,
    required: true
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/FT \/Btn/);
  assert.match(text, /\/V \/Yes/);
  assert.match(text, /\/AS \/Yes/);
  assert.match(text, /\/AP << \/N << \/Off \d+ 0 R \/Yes \d+ 0 R >> >>/);
  assert.match(text, /\/Subtype \/Form/);

  const parsed = parseDocument(bytes);
  const field = parsed.listFormFields()[0];
  assert.equal(field?.name, "subscribe");
  assert.equal(field?.fieldType, "Btn");
  assert.equal(field?.checked, true);
  assert.equal(field?.required, true);
  assert.deepEqual(field?.rect, [36, 600, 52, 616]);
});

test("rejects invalid check box definitions", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.checkBox("", { x: 24, y: 24, width: 16, height: 16 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.checkBox("bad-size", { x: 24, y: 24, width: 0, height: 16 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.checkBox("bad-border", { x: 24, y: 24, width: 16, height: 16, borderWidth: -1 }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );
});

test("serializes choice fields and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.choiceField("department", {
    x: 36,
    y: 560,
    width: 140,
    height: 24,
    options: ["Engineering", "Design", "Sales"],
    value: "Design",
    font: "Courier",
    fontSize: 11,
    color: rgb(0.2, 0.1, 0.4),
    required: true,
    mode: "combo"
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/FT \/Ch/);
  assert.match(text, /\/Opt \[\(Engineering\) \(Design\) \(Sales\)\]/);
  assert.match(text, /\/V \(Design\)/);
  assert.match(text, /\/Ff 131074/);
  assert.match(text, /\/DA \(\/FormF\d+ 11 Tf 0\.2 0\.1 0\.4 rg\)/);

  const parsed = parseDocument(bytes);
  const field = parsed.listFormFields()[0];
  assert.equal(field?.name, "department");
  assert.equal(field?.fieldType, "Ch");
  assert.equal(field?.value, "Design");
  assert.deepEqual(field?.options, ["Engineering", "Design", "Sales"]);
  assert.equal(field?.choiceMode, "combo");
  assert.equal(field?.required, true);
  assert.deepEqual(field?.rect, [36, 560, 176, 584]);
});

test("rejects invalid choice field definitions", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.choiceField("", { x: 24, y: 24, width: 100, height: 24, options: ["One"] }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.choiceField("empty-options", { x: 24, y: 24, width: 100, height: 24, options: [] }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.choiceField("bad-value", { x: 24, y: 24, width: 100, height: 24, options: ["One"], value: "Two" }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );
});

test("serializes radio groups and exposes them through the parser", () => {
  const doc = createDocument();
  const page = doc.addPage({ size: "Letter" });
  page.radioGroup("contactMethod", {
    items: [
      { value: "email", x: 36, y: 520, width: 16, height: 16 },
      { value: "phone", x: 36, y: 492, width: 16, height: 16 }
    ],
    value: "phone",
    required: true
  });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /\/FT \/Btn/);
  assert.match(text, /\/Ff 32770/);
  assert.match(text, /\/Kids \[\d+ 0 R \d+ 0 R\]/);
  assert.match(text, /\/Parent \d+ 0 R/);
  assert.match(text, /\/V \/phone/);
  assert.match(text, /\/AS \/phone/);

  const parsed = parseDocument(bytes);
  const field = parsed.listFormFields()[0];
  assert.equal(field?.name, "contactMethod");
  assert.equal(field?.fieldType, "Btn");
  assert.equal(field?.buttonKind, "radio");
  assert.equal(field?.value, "phone");
  assert.deepEqual(field?.options, ["email", "phone"]);
  assert.equal(field?.required, true);
});

test("rejects invalid radio group definitions", () => {
  const doc = createDocument();
  const page = doc.addPage();

  assert.throws(
    () => page.radioGroup("", { items: [{ value: "email", x: 24, y: 24, width: 16, height: 16 }] }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.radioGroup("contactMethod", { items: [] }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => page.radioGroup("contactMethod", {
      items: [
        { value: "email", x: 24, y: 24, width: 16, height: 16 },
        { value: "email", x: 24, y: 48, width: 16, height: 16 }
      ]
    }),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );
});

test("incrementally updates existing text field values", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.textField("customerName", {
    x: 48,
    y: 620,
    width: 180,
    height: 24,
    value: "Ada"
  });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.setFieldValue("customerName", "Grace");

  const updated = parseDocument(editable.toUint8Array());
  const field = updated.listFormFields()[0];
  assert.equal(field?.name, "customerName");
  assert.equal(field?.value, "Grace");
});

test("incrementally updates existing check box values", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.checkBox("subscribe", {
    x: 48,
    y: 620,
    width: 16,
    height: 16,
    checked: false
  });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.setFieldValue("subscribe", true);

  const updated = parseDocument(editable.toUint8Array());
  const field = updated.listFormFields()[0];
  assert.equal(field?.name, "subscribe");
  assert.equal(field?.checked, true);
  assert.equal(field?.value, "Yes");
});

test("incrementally updates existing choice field values", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.choiceField("department", {
    x: 48,
    y: 620,
    width: 180,
    height: 24,
    options: ["Engineering", "Design", "Sales"],
    value: "Engineering"
  });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.setFieldValue("department", "Sales");

  const updated = parseDocument(editable.toUint8Array());
  const field = updated.listFormFields()[0];
  assert.equal(field?.name, "department");
  assert.equal(field?.fieldType, "Ch");
  assert.equal(field?.value, "Sales");
  assert.deepEqual(field?.options, ["Engineering", "Design", "Sales"]);
});

test("incrementally updates existing radio group values", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.radioGroup("contactMethod", {
    items: [
      { value: "email", x: 48, y: 620, width: 16, height: 16 },
      { value: "phone", x: 48, y: 592, width: 16, height: 16 }
    ],
    value: "email"
  });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.setFieldValue("contactMethod", "phone");

  const updated = parseDocument(editable.toUint8Array());
  const field = updated.listFormFields()[0];
  assert.equal(field?.name, "contactMethod");
  assert.equal(field?.buttonKind, "radio");
  assert.equal(field?.value, "phone");
  assert.deepEqual(field?.options, ["email", "phone"]);
});

test("rejects invalid incremental field updates", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage({ size: "Letter" });
  page.textField("email", {
    x: 48,
    y: 620,
    width: 180,
    height: 24,
    value: "ada@example.com"
  });
  page.checkBox("subscribe", {
    x: 48,
    y: 580,
    width: 16,
    height: 16
  });
  page.choiceField("department", {
    x: 48,
    y: 540,
    width: 180,
    height: 24,
    options: ["Engineering", "Design"]
  });
  page.radioGroup("contactMethod", {
    items: [
      { value: "email", x: 48, y: 500, width: 16, height: 16 },
      { value: "phone", x: 48, y: 472, width: 16, height: 16 }
    ]
  });

  const editable = editDocument(baseDoc.toUint8Array());

  assert.throws(
    () => editable.setFieldValue("missing", "value"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("email", true),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("subscribe", "yes"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("department", true),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("department", "Support"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("contactMethod", true),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );

  assert.throws(
    () => editable.setFieldValue("contactMethod", "mail"),
    (error: unknown) => error instanceof PdfEngineError && error.code === PdfErrorCode.INVALID_FORM_FIELD
  );
});

test("serializes push buttons and signature fields through AcroForm", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text("Controls", { x: 36, y: 700 });
  page.pushButton("submit", { x: 36, y: 640, width: 96, height: 24, label: "Submit" });
  page.signatureField("sign-here", { x: 36, y: 600, width: 180, height: 36 });

  const parsed = parseDocument(doc.toUint8Array());
  const fields = parsed.listFormFields();
  const pushButton = fields.find((field) => field.name === "submit");
  const signatureField = fields.find((field) => field.name === "sign-here");

  assert.equal(pushButton?.buttonKind, "pushButton");
  assert.equal(signatureField?.fieldType, "Sig");
});

test("applies detached digital signatures with patched byte ranges", () => {
  let signedInput: Uint8Array | undefined;
  const cms = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
  const doc = createDocument({
    signature: {
      fieldName: "approval",
      reason: "Reviewed",
      placeholderBytes: 256,
      sign(bytes) {
        signedInput = bytes.slice();
        return cms;
      }
    }
  });
  doc.addPage().text("Signed payload", { x: 36, y: 700 });

  const bytes = doc.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const byteRange = /\/ByteRange \[0\s+(\d+)\s+(\d+)\s+(\d+)\]/.exec(text);

  assert.ok(byteRange);
  assert.ok(signedInput);
  assert.match(text, /\/FT \/Sig/);
  assert.match(text, /\/SubFilter \/adbe\.pkcs7\.detached/);
  assert.match(text, /\/Reason \(Reviewed\)/);
  assert.match(text, /\/Contents <DEADBEEF0+/);
  assert.equal(Number(byteRange[1]) + Number(byteRange[3]), signedInput!.length);
});

test("applies detached digital signatures as incremental updates", () => {
  const base = createDocument();
  base.addPage().text("Base signed payload", { x: 36, y: 700 });

  let signedInput: Uint8Array | undefined;
  const editable = editDocument(base.toUint8Array());
  editable.sign({
    fieldName: "incremental-approval",
    placeholderBytes: 128,
    sign(bytes) {
      signedInput = bytes.slice();
      return Uint8Array.from([0xca, 0xfe]);
    }
  });

  const bytes = editable.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  const parsed = parseDocument(bytes);

  assert.ok(signedInput);
  assert.match(text, /\/Prev \d+/);
  assert.match(text, /\/Contents <CAFE0+/);
  assert.equal(parsed.listFormFields().some((field) => field.name === "incremental-approval" && field.fieldType === "Sig"), true);
});

test("flattens existing AcroForm widgets into static page content", () => {
  const baseDoc = createDocument();
  const page = baseDoc.addPage();
  page.textField("name", { x: 36, y: 640, width: 160, height: 24, value: "Ada" });
  page.checkBox("agree", { x: 36, y: 600, width: 18, height: 18, checked: true });

  const editable = editDocument(baseDoc.toUint8Array());
  editable.flattenForms();

  const flattened = parseDocument(editable.toUint8Array());
  assert.equal(flattened.listFormFields().length, 0);
});

