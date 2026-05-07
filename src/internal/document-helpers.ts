import type { BinaryData } from "../types.js";

export function sumNumbers(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

export function decrementRowSpanOccupancy(occupancy: Map<number, number>): void {
  for (const [columnIndex, remaining] of occupancy.entries()) {
    if (remaining <= 1) {
      occupancy.delete(columnIndex);
    } else {
      occupancy.set(columnIndex, remaining - 1);
    }
  }
}

export function arrayEquals(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || left.length !== right?.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function normalizeEditableAltText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isPdfDictEntries(value: unknown): value is Array<[string, unknown]> {
  return (
    Array.isArray(value)
    && value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string")
  );
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled document branch: ${JSON.stringify(value)}`);
}

export function toBytes(data: BinaryData): Uint8Array {
  return data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
}
