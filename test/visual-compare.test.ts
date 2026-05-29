import assert from "node:assert/strict";
import { test } from "node:test";

import {
  comparePpmBuffers,
  comparePpmPageSets,
  parsePpm,
} from "../src/internal/visual-compare.js";

function ppm(width: number, height: number, pixels: readonly number[]): Uint8Array {
  return Buffer.concat([
    Buffer.from(`P6\n# fixture\n${width} ${height}\n255\n`, "ascii"),
    Buffer.from(pixels)
  ]);
}

test("parsePpm reads P6 dimensions and raster data", () => {
  const image = parsePpm(ppm(2, 1, [0, 1, 2, 3, 4, 5]));

  assert.equal(image.width, 2);
  assert.equal(image.height, 1);
  assert.deepEqual([...image.data], [0, 1, 2, 3, 4, 5]);
});

test("comparePpmBuffers passes identical and threshold-safe images", () => {
  const expected = ppm(2, 1, [10, 20, 30, 40, 50, 60]);
  const actual = ppm(2, 1, [12, 20, 30, 40, 51, 60]);

  const result = comparePpmBuffers(expected, actual, {
    maxChannelDelta: 2,
    maxDifferingPixelRatio: 1
  });

  assert.equal(result.passed, true);
  assert.equal(result.differingPixels, 2);
  assert.equal(result.maxChannelDelta, 2);
});

test("comparePpmBuffers fails channel and pixel thresholds", () => {
  const expected = ppm(4, 1, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const actual = ppm(4, 1, [3, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]);

  const result = comparePpmBuffers(expected, actual, {
    maxChannelDelta: 2,
    maxDifferingPixelRatio: 0.25
  });

  assert.equal(result.passed, false);
  assert.equal(result.differingPixels, 3);
  assert.equal(result.maxChannelDelta, 3);
});

test("comparePpmPageSets reports missing baselines and page-count mismatches", () => {
  const page = ppm(1, 1, [0, 0, 0]);

  assert.throws(() => comparePpmPageSets([], [page]), /baseline is missing/i);
  assert.throws(() => comparePpmPageSets([page], [page, page]), /page count differs/i);
});
