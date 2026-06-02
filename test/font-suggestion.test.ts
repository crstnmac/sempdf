import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, PdfEngineError, PdfErrorCode } from "../src/index.js";

test("suggests the closest standard-14 font for a misspelled Helvetica", () => {
  assert.throws(
    () => createDocument().addPage().text("x", { x: 1, y: 1, font: "Helvetca" }),
    (error: unknown) =>
      error instanceof PdfEngineError
      && error.code === PdfErrorCode.INVALID_FONT
      && /Did you mean "Helvetica"\?/.test(error.message),
  );
});

test("suggests Times-Roman for a transposed typo", () => {
  assert.throws(
    () => createDocument().addPage().text("x", { x: 1, y: 1, font: "Timse-Roman" }),
    (error: unknown) =>
      error instanceof PdfEngineError
      && error.code === PdfErrorCode.INVALID_FONT
      && /Did you mean "Times-Roman"\?/.test(error.message),
  );
});

test("accepts a valid standard-14 font name", () => {
  assert.doesNotThrow(() => {
    createDocument().addPage().text("x", { x: 1, y: 1, font: "Times-Bold" });
  });
});

test("accepts the default font when none is specified", () => {
  assert.doesNotThrow(() => {
    createDocument().addPage().text("x", { x: 1, y: 1 });
  });
});

test("resolves bold/italic flags against a built-in family without throwing", () => {
  assert.doesNotThrow(() => {
    createDocument().addPage().text("x", { x: 1, y: 1, font: "Helvetica", bold: true });
  });
});
