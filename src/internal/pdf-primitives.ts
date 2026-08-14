import { PdfEngineError, PdfErrorCode } from "../errors.js";

export interface PdfName {
  kind: "name";
  value: string;
}

export interface PdfLiteralString {
  kind: "string";
  value: string;
}

export interface PdfHexString {
  kind: "hex";
  bytes: Uint8Array;
}

export interface PdfRef {
  kind: "ref";
  objectId: number;
  generation: number;
}

export interface PdfStream {
  kind: "stream";
  dict: PdfDict;
  bytes: Uint8Array;
}

export interface PdfLazyStream {
  kind: "lazyStream";
  dict: PdfDict;
  lengthObjectId: number;
  data: () => AsyncIterable<Uint8Array>;
}

export type PdfValue =
  | null
  | boolean
  | number
  | PdfName
  | PdfLiteralString
  | PdfHexString
  | PdfRef
  | PdfStream
  | PdfLazyStream
  | PdfArray
  | PdfDict;

export type PdfArray = PdfValue[];
export type PdfDict = Array<[string, PdfValue]>;

export interface PdfIndirectObject {
  id: number;
  value: Exclude<PdfValue, PdfRef>;
}

export function name(value: string): PdfName {
  return { kind: "name", value };
}

export function literalString(value: string): PdfLiteralString {
  return { kind: "string", value };
}

export function hexString(bytes: Uint8Array): PdfHexString {
  return { kind: "hex", bytes };
}

export function ref(objectId: number): PdfRef {
  return { kind: "ref", objectId, generation: 0 };
}

export function dict(entries: Array<[string, PdfValue | undefined]>): PdfDict {
  return entries.filter((entry): entry is [string, PdfValue] => entry[1] !== undefined);
}

export function array(values: PdfValue[]): PdfArray {
  return values;
}

export function stream(dictEntries: PdfDict, bytes: Uint8Array): PdfStream {
  return { kind: "stream", dict: dictEntries, bytes };
}

export function lazyStream(
  dictEntries: PdfDict,
  lengthObjectId: number,
  data: () => AsyncIterable<Uint8Array>
): PdfLazyStream {
  return { kind: "lazyStream", dict: dictEntries, lengthObjectId, data };
}

export function formatPdfNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new PdfEngineError(PdfErrorCode.INVALID_NUMBER, "PDF numbers must be finite.", { value });
  }

  if (Object.is(value, -0)) {
    return "0";
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  const normalized = value.toFixed(6).replace(/(?:\.0+|(\.\d+?)0+)$/, "$1");
  return normalized === "-0" ? "0" : normalized;
}

export function serializePdfValue(value: Exclude<PdfValue, PdfStream | PdfLazyStream>): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return formatPdfNumber(value);
  }

  if (Array.isArray(value)) {
    if (isPdfDict(value)) {
      const entries = value.map(([key, entryValue]) => `/${escapeName(key)} ${serializePdfValue(entryValue as Exclude<PdfValue, PdfStream | PdfLazyStream>)}`);
      return `<< ${entries.join(" ")} >>`;
    }

    const items = value.map((entry) => serializePdfValue(entry as Exclude<PdfValue, PdfStream | PdfLazyStream>));
    return `[${items.join(" ")}]`;
  }

  switch (value.kind) {
    case "name":
      return `/${escapeName(value.value)}`;
    case "string":
      return `(${escapeString(value.value)})`;
    case "hex":
      return `<${[...value.bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("")}>`;
    case "ref":
      return `${value.objectId} ${value.generation} R`;
    default:
      return assertNever(value);
  }
}

export function isPdfStream(value: PdfValue): value is PdfStream {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "stream";
}

export function isPdfLazyStream(value: PdfValue): value is PdfLazyStream {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "lazyStream";
}

function isPdfDict(value: PdfArray | PdfDict): value is PdfDict {
  return value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string");
}

function escapeName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9!#$%&'*+\-.^_`|~]/g, (character) =>
    `#${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );
}

function escapeString(value: string): string {
  return value
    .replaceAll(/\\/g, "\\\\")
    .replaceAll(/\(/g, "\\(")
    .replaceAll(/\)/g, "\\)")
    .replaceAll(/\r/g, "\\r")
    .replaceAll(/\n/g, "\\n")
    .replaceAll(/\t/g, "\\t")
    .replaceAll(/\f/g, "\\f")
    .replaceAll(/\u0008/g, "\\b");
}

function assertNever(value: never): never {
  throw new PdfEngineError(PdfErrorCode.INTERNAL_ERROR, `Unhandled PDF value: ${JSON.stringify(value)}`);
}
