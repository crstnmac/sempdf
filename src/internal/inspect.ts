import { PdfEngineError, PdfErrorCode } from "../errors.js";

export interface PdfInspection {
  readonly startXref: number;
  readonly xrefOffsets: ReadonlyMap<number, number>;
  readonly objects: ReadonlyMap<number, string>;
}

export function inspectPdf(bytes: Uint8Array): PdfInspection {
  const text = new TextDecoder().decode(bytes);
  const startXrefMatch = /startxref\s+(\d+)\s*%%EOF/.exec(text);
  if (!startXrefMatch) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Missing startxref section.");
  }

  const startXref = Number(startXrefMatch[1]);
  if (startXref < 0 || startXref >= bytes.length) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      "startxref offset is out of file bounds.",
    );
  }

  const xrefOffsets = parseXrefOffsets(text.slice(startXref));
  const objects = new Map<number, string>();

  const objectPattern = /(\d+)\s+0\s+obj\s+([\s\S]*?)\s+endobj/g;
  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(text)) !== null) {
    const objectId = match[1];
    const body = match[2];
    if (objectId !== undefined && body !== undefined) {
      objects.set(Number(objectId), body);
    }
  }

  return {
    startXref,
    xrefOffsets,
    objects
  };
}

function parseXrefOffsets(text: string): Map<number, number> {
  const lines = text.split("\n");
  if (lines[0] !== "xref") {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "xref table not found at startxref offset.");
  }

  const subsection = lines[1]?.trim().split(/\s+/);
  if (!subsection || subsection.length !== 2) {
    throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Invalid xref subsection header.");
  }

  const startObject = Number(subsection[0]);
  const count = Number(subsection[1]);
  const offsets = new Map<number, number>();

  for (let index = 1; index < count; index += 1) {
    const line = lines[index + 2]?.trim();
    if (!line) {
      throw new PdfEngineError(PdfErrorCode.INVALID_PDF, "Invalid xref entry.");
    }

    const [offset] = line.split(/\s+/);
    offsets.set(startObject + index, Number(offset));
  }

  return offsets;
}
