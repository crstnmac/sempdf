import type { PdfDocumentModel } from "../document.js";

export type PdfVersion = "1.4" | "1.5" | "1.6" | "1.7" | "2.0";

const ORDER: readonly PdfVersion[] = ["1.4", "1.5", "1.6", "1.7", "2.0"];

export function compareVersion(a: PdfVersion, b: PdfVersion): -1 | 0 | 1 {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

export function maxVersion(...versions: readonly PdfVersion[]): PdfVersion {
  let result: PdfVersion = "1.4";
  for (const v of versions) {
    if (compareVersion(v, result) > 0) result = v;
  }
  return result;
}

export function formatHeader(version: PdfVersion): string {
  return `%PDF-${version}`;
}

export function parseVersion(value: string | undefined): PdfVersion | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return (ORDER as readonly string[]).includes(trimmed) ? (trimmed as PdfVersion) : undefined;
}

export function detectMinimumVersion(model: PdfDocumentModel): PdfVersion {
  const candidates: PdfVersion[] = ["1.4"];

  if (model.objectStreams === true) candidates.push("1.5");

  const enc = model.encryption;
  if (enc !== undefined) {
    switch (enc.algorithm) {
      case "rc4-40":
      case "rc4-128":
        break;
      case "aes-128":
        candidates.push("1.6");
        break;
      case "aes-256":
        candidates.push((enc.revision as number) === 6 ? "2.0" : "1.7");
        break;
      case "aes-256-r6":
        candidates.push("2.0");
        break;
    }
  }

  if (model.attachments.length > 0) candidates.push("1.7");
  if (model.signature !== undefined) candidates.push("1.7");
  if (model.conformance === "pdfua-1") candidates.push("1.7");
  if (model.conformance === "pdfa-2b") candidates.push("1.7");
  if (model.conformance === "pdfa-3b") candidates.push("1.7");
  if (model.conformance === "pdfa-4") candidates.push("2.0");
  if (model.conformance === "pdfua-2") candidates.push("2.0");
  if (model.conformance === "wtpdf") candidates.push("2.0");

  return maxVersion(...candidates);
}
