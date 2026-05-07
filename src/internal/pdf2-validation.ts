import type { ParsedPdfDocument } from "../parser.js";
import type { PdfDict, PdfValue, PdfRef } from "./pdf-primitives.js";

/**
 * PDF 2.0 conformance issue found while inspecting an existing document.
 */
export interface Pdf2ComplianceIssue {
  /** Stable machine-readable issue or error code. */
  readonly code: string;
  /** Human-readable diagnostic message. */
  readonly message: string;
}

const DEPRECATED_CATALOG_KEYS: readonly string[] = ["XFA"];
const DEPRECATED_ACROFORM_KEYS: readonly string[] = ["XFA"];
const DEPRECATED_ANNOTATION_SUBTYPES: readonly string[] = [
  "Movie",
  "Sound",
  "TrapNet",
  "PrinterMark",
];

function isDict(value: PdfValue | undefined): value is PdfDict {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string",
    )
  );
}

function isRef(value: PdfValue | undefined): value is PdfRef {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    (
      value as {
        kind: string;
      }
    ).kind === "ref"
  );
}

function dictGet(dict: PdfDict | undefined, key: string): PdfValue | undefined {
  if (!dict) return undefined;
  for (const [k, v] of dict) {
    if (k === key) return v;
  }
  return undefined;
}

function nameValue(value: PdfValue | undefined): string | undefined {
  if (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    (
      value as {
        kind: string;
      }
    ).kind === "name"
  ) {
    return (
      value as {
        value: string;
      }
    ).value;
  }
  return undefined;
}

/**
 * Validates a parsed document for PDF 2.0 features that this library can detect as deprecated or removed.
 *
 * @param document The parsed PDF document to inspect.
 *
 * @returns The PDF 2.0 conformance issues found in the document.
 */
export function validatePdf2Conformance(
  document: ParsedPdfDocument,
): readonly Pdf2ComplianceIssue[] {
  const issues: Pdf2ComplianceIssue[] = [];
  const rootObj = document.getObject(document.getRootObjectId());
  const catalog = isDict(rootObj?.value) ? rootObj.value : undefined;
  if (!catalog) return issues;

  for (const key of DEPRECATED_CATALOG_KEYS) {
    if (dictGet(catalog, key) !== undefined) {
      issues.push({
        code: "DEPRECATED_CATALOG_KEY",
        message: `Catalog contains deprecated key /${key} (removed in PDF 2.0).`,
      });
    }
  }

  const acroFormValue = dictGet(catalog, "AcroForm");
  let acroFormDict: PdfDict | undefined;
  if (isRef(acroFormValue)) {
    const v = document.getObject(acroFormValue.objectId)?.value;
    acroFormDict = isDict(v) ? v : undefined;
  } else if (isDict(acroFormValue)) {
    acroFormDict = acroFormValue;
  }
  if (acroFormDict) {
    for (const key of DEPRECATED_ACROFORM_KEYS) {
      if (dictGet(acroFormDict, key) !== undefined) {
        issues.push({
          code: "DEPRECATED_ACROFORM_KEY",
          message: `AcroForm contains deprecated key /${key} (removed in PDF 2.0).`,
        });
      }
    }
  }

  for (const id of document.getObjectIds()) {
    const obj = document.getObject(id);
    if (!isDict(obj?.value)) continue;
    const dict = obj.value;
    if (nameValue(dictGet(dict, "Type")) !== "Annot") continue;
    const subtype = nameValue(dictGet(dict, "Subtype"));
    if (subtype && DEPRECATED_ANNOTATION_SUBTYPES.includes(subtype)) {
      issues.push({
        code: "DEPRECATED_ANNOTATION",
        message: `Annotation object ${id} uses deprecated subtype /${subtype} (removed in PDF 2.0).`,
      });
    }
  }

  return issues;
}
