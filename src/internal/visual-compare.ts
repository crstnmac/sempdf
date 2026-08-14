export interface PpmImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface PpmComparisonOptions {
  readonly maxChannelDelta?: number | undefined;
  readonly maxDifferingPixelRatio?: number | undefined;
}

export interface PpmComparisonResult {
  readonly passed: boolean;
  readonly width: number;
  readonly height: number;
  readonly totalPixels: number;
  readonly differingPixels: number;
  readonly differingPixelRatio: number;
  readonly maxChannelDelta: number;
}

export interface PpmPageComparisonResult extends PpmComparisonResult {
  readonly pageNumber: number;
}

export interface PpmPageSetComparisonResult {
  readonly passed: boolean;
  readonly pageResults: readonly PpmPageComparisonResult[];
}

const DEFAULT_MAX_CHANNEL_DELTA = 2;
const DEFAULT_MAX_DIFFERING_PIXEL_RATIO = 0.001;

export function parsePpm(data: Uint8Array): PpmImage {
  let offset = 0;

  const readToken = (): string => {
    skipWhitespaceAndComments();
    const start = offset;
    while (offset < data.length && !isWhitespace(data[offset]!)) {
      offset += 1;
    }
    if (start === offset) {
      throw new Error("Invalid PPM: expected header token.");
    }
    return ascii(data.subarray(start, offset));
  };

  const skipWhitespaceAndComments = (): void => {
    while (offset < data.length) {
      const byte = data[offset]!;
      if (isWhitespace(byte)) {
        offset += 1;
        continue;
      }
      if (byte === 0x23) {
        while (offset < data.length && data[offset] !== 0x0a) {
          offset += 1;
        }
        continue;
      }
      break;
    }
  };

  const magic = readToken();
  if (magic !== "P6") {
    throw new Error(`Invalid PPM: expected P6 magic, got ${magic}.`);
  }

  const width = Number(readToken());
  const height = Number(readToken());
  const maxValue = Number(readToken());
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error("Invalid PPM: width must be a positive integer.");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("Invalid PPM: height must be a positive integer.");
  }
  if (maxValue !== 255) {
    throw new Error("Invalid PPM: only max value 255 is supported.");
  }

  if (offset >= data.length || !isWhitespace(data[offset]!)) {
    throw new Error("Invalid PPM: missing raster separator.");
  }
  offset += 1;

  const expectedLength = width * height * 3;
  const raster = data.subarray(offset);
  if (raster.length !== expectedLength) {
    throw new Error("Invalid PPM: raster length does not match dimensions.");
  }

  return { width, height, data: raster };
}

export function comparePpmImages(
  expected: PpmImage,
  actual: PpmImage,
  options: PpmComparisonOptions = {},
): PpmComparisonResult {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `PPM dimensions differ: expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}.`,
    );
  }

  const maxAllowedChannelDelta = options.maxChannelDelta ?? DEFAULT_MAX_CHANNEL_DELTA;
  const maxAllowedDifferingPixelRatio =
    options.maxDifferingPixelRatio ?? DEFAULT_MAX_DIFFERING_PIXEL_RATIO;
  const totalPixels = expected.width * expected.height;
  let differingPixels = 0;
  let maxChannelDelta = 0;

  for (let index = 0; index < expected.data.length; index += 3) {
    const dr = Math.abs(expected.data[index]! - actual.data[index]!);
    const dg = Math.abs(expected.data[index + 1]! - actual.data[index + 1]!);
    const db = Math.abs(expected.data[index + 2]! - actual.data[index + 2]!);
    const pixelMax = Math.max(dr, dg, db);
    if (pixelMax > 0) {
      differingPixels += 1;
    }
    if (pixelMax > maxChannelDelta) {
      maxChannelDelta = pixelMax;
    }
  }

  const differingPixelRatio = differingPixels / totalPixels;
  return {
    passed:
      maxChannelDelta <= maxAllowedChannelDelta &&
      differingPixelRatio <= maxAllowedDifferingPixelRatio,
    width: expected.width,
    height: expected.height,
    totalPixels,
    differingPixels,
    differingPixelRatio,
    maxChannelDelta,
  };
}

export function comparePpmBuffers(
  expected: Uint8Array,
  actual: Uint8Array,
  options: PpmComparisonOptions = {},
): PpmComparisonResult {
  return comparePpmImages(parsePpm(expected), parsePpm(actual), options);
}

export function comparePpmPageSets(
  expectedPages: readonly Uint8Array[],
  actualPages: readonly Uint8Array[],
  options: PpmComparisonOptions = {},
): PpmPageSetComparisonResult {
  if (expectedPages.length === 0) {
    throw new Error("Visual baseline is missing.");
  }
  if (expectedPages.length !== actualPages.length) {
    throw new Error(
      `Visual page count differs: expected ${expectedPages.length}, got ${actualPages.length}.`,
    );
  }

  const pageResults = expectedPages.map((expected, index) => ({
    pageNumber: index + 1,
    ...comparePpmBuffers(expected, actualPages[index]!, options),
  }));
  return {
    passed: pageResults.every((result) => result.passed),
    pageResults,
  };
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0c;
}

function ascii(bytes: Uint8Array): string {
  return String.fromCodePoint(...bytes);
}
