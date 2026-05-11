import { PdfEngineError, PdfErrorCode } from '../errors.js';
import type { PdfDict, PdfValue } from './pdf-primitives.js';

export function isPdfDictValue(
  value: PdfValue | undefined,
): value is PdfDict {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string',
    )
  );
}

export function getPdfDictValue(
  source: PdfDict | undefined,
  key: string,
): PdfValue | undefined {
  return source?.find(([entryKey]) => entryKey === key)?.[1];
}

export function getNumericPdfDictValue(
  source: PdfDict | undefined,
  key: string,
): number | undefined {
  const value = getPdfDictValue(source, key);
  return typeof value === 'number' ? value : undefined;
}

export function asPdfDict(value: PdfValue | undefined, label: string): PdfDict {
  if (isPdfDictValue(value)) {
    return value;
  }

  throw new PdfEngineError(
    PdfErrorCode.INTERNAL_ERROR,
    `${label} object must be a dictionary.`,
  );
}

export function asPdfRef(
  value: PdfValue | undefined,
): { kind: 'ref'; objectId: number; generation: number } | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'ref'
    ? value
    : undefined;
}

export function mergePdfDict(base: PdfDict, overrides: PdfDict): PdfDict {
  return patchPdfDict(base, overrides);
}

export function patchPdfDict(
  base: PdfDict,
  overrides: PdfDict,
  removedKeys: readonly string[] = [],
): PdfDict {
  const overrideMap = new Map(overrides);
  const removed = new Set(removedKeys);
  const result: PdfDict = [];
  const seen = new Set<string>();

  for (const [key, value] of base) {
    if (removed.has(key)) {
      seen.add(key);
      continue;
    }

    if (overrideMap.has(key)) {
      result.push([key, overrideMap.get(key)!]);
      seen.add(key);
      continue;
    }

    result.push([key, value]);
  }

  for (const [key, value] of overrides) {
    if (
      !removed.has(key) &&
      !seen.has(key) &&
      !base.some(([baseKey]) => baseKey === key)
    ) {
      result.push([key, value]);
    }
  }

  return result;
}
