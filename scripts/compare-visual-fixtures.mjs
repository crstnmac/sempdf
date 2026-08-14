import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { comparePpmPageSets } from "../dist/src/internal/visual-compare.js";
import { renderFixtures } from "./render-visual-fixtures.mjs";

const DEFAULT_BASELINE_DIR = "test/visual-baselines";
const DEFAULT_OUTPUT_DIR = ".visual-output";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rendered = await renderFixtures({
    fixtureDir: options.fixtureDir,
    outputDir: options.outputDir,
    renderer: options.renderer,
    dpi: options.dpi,
  });

  if (options.update) {
    rmSync(options.baselineDir, { recursive: true, force: true });
    mkdirSync(options.baselineDir, { recursive: true });
    for (const fixture of rendered) {
      const targetDir = join(options.baselineDir, fixture.name);
      mkdirSync(targetDir, { recursive: true });
      for (const [index, pagePath] of fixture.pages.entries()) {
        copyFileSync(pagePath, join(targetDir, `page-${index + 1}.ppm.gz`));
      }
      console.log(`Updated baseline ${fixture.name}: ${fixture.pages.length} page(s)`);
    }
    return;
  }

  let failed = false;
  for (const fixture of rendered) {
    const baselineDir = join(options.baselineDir, fixture.name);
    const expected = loadPages(baselineDir);
    const actual = fixture.pages.map((page) => gunzipSync(readFileSync(page)));
    try {
      const result = comparePpmPageSets(expected, actual, {
        maxChannelDelta: options.maxChannelDelta,
        maxDifferingPixelRatio: options.maxDifferingPixelRatio,
      });
      for (const page of result.pageResults) {
        const pct = (page.differingPixelRatio * 100).toFixed(4);
        console.log(
          `${fixture.name} page ${page.pageNumber}: ${page.passed ? "ok" : "diff"} (${page.differingPixels}/${page.totalPixels}, ${pct}%, max delta ${page.maxChannelDelta})`,
        );
      }
      if (!result.passed) failed = true;
    } catch (error) {
      failed = true;
      console.error(`${fixture.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed) {
    console.error("Visual comparison failed. Run npm run visual:update to approve intentional changes.");
    process.exit(1);
  }
}

function loadPages(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".ppm.gz"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((file) => gunzipSync(readFileSync(join(dir, file))));
}

function parseArgs(argv) {
  const options = {
    fixtureDir: "examples/visual-fixtures",
    outputDir: DEFAULT_OUTPUT_DIR,
    baselineDir: DEFAULT_BASELINE_DIR,
    update: false,
    maxChannelDelta: 2,
    maxDifferingPixelRatio: 0.001,
    dpi: 144,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") options.fixtureDir = argv[++index];
    else if (arg === "--out") options.outputDir = argv[++index];
    else if (arg === "--baseline") options.baselineDir = argv[++index];
    else if (arg === "--renderer") options.renderer = argv[++index];
    else if (arg === "--dpi") options.dpi = Number(argv[++index]);
    else if (arg === "--max-channel-delta") options.maxChannelDelta = Number(argv[++index]);
    else if (arg === "--max-diff-ratio") options.maxDifferingPixelRatio = Number(argv[++index]);
    else if (arg === "--update") options.update = true;
    else if (arg === "--help") {
      console.log("Usage: node scripts/compare-visual-fixtures.mjs [--update] [--fixtures DIR] [--baseline DIR] [--renderer pdftoppm] [--dpi 144]");
      process.exit(0);
    }
  }
  return options;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
