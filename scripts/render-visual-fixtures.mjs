import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

// Fixtures must render watermark-free (the dev bypass now stamps a DEVELOPMENT
// watermark), so install a permissive guard on the verified path. Internal
// import — unreachable for package consumers via the exports map.
const { setVerifiedLicenseGuard } = await import("../dist/src/internal/license-guard.js");
setVerifiedLicenseGuard({ consume() {} });

const DEFAULT_FIXTURE_DIR = "examples/visual-fixtures";
const DEFAULT_OUTPUT_DIR = ".visual-output";
const HOMEBREW_POPPLER_DYLIB = "/usr/local/Cellar/poppler/0.66.0/lib/libpoppler.77.dylib";

export async function renderFixtures({
  fixtureDir = DEFAULT_FIXTURE_DIR,
  outputDir = DEFAULT_OUTPUT_DIR,
  renderer = process.env.PDF_VISUAL_RENDERER ?? findSystemRenderer() ?? findBundledRenderer() ?? "pdftoppm",
  dpi = 144,
} = {}) {
  ensureRenderer(renderer);
  const fixtures = loadFixturePaths(fixtureDir);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const rendered = [];
  for (const fixturePath of fixtures) {
    const fixture = await import(pathToFileURL(resolve(fixturePath)).href);
    const name = sanitizeName(fixture.name ?? basename(fixturePath, ".mjs"));
    if (typeof fixture.render !== "function") {
      throw new Error(`Visual fixture ${fixturePath} must export render().`);
    }

    for (const dataSet of dataSetsForFixture(fixture)) {
      const bytes = await fixture.render(dataSet.data, { dataSet });
      if (!(bytes instanceof Uint8Array)) {
        throw new Error(`Visual fixture ${fixturePath} render() must return Uint8Array.`);
      }

      const outputName = dataSet.id === "default" ? name : `${name}/${dataSet.id}`;
      const workPrefix = dataSet.id === "default" ? name : `${name}-${dataSet.id}`;
      const workDir = mkdtempSync(join(tmpdir(), "zeropdf-visual-"));
      try {
        const pdfPath = join(workDir, `${workPrefix}.pdf`);
        const prefix = join(workDir, workPrefix);
        writeFileSync(pdfPath, bytes);

        const result = spawnSync(renderer, ["-r", String(dpi), pdfPath, prefix], {
          encoding: "utf8",
        });
        if (result.status !== 0) {
          throw new Error(
            `pdftoppm failed for ${outputName}: ${(result.stderr || result.stdout || "").trim()}`,
          );
        }

        const ppmFiles = readdirSync(workDir)
          .filter((file) => file.startsWith(`${workPrefix}-`) && file.endsWith(".ppm"))
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
        if (ppmFiles.length === 0) {
          throw new Error(`pdftoppm did not produce PPM pages for ${outputName}.`);
        }

        const fixtureOutputDir = join(outputDir, outputName);
        mkdirSync(fixtureOutputDir, { recursive: true });
        const pages = [];
        for (const [index, file] of ppmFiles.entries()) {
          const raw = readFileSync(join(workDir, file));
          const outputPath = join(fixtureOutputDir, `page-${index + 1}.ppm.gz`);
          writeFileSync(outputPath, gzipSync(raw));
          pages.push(outputPath);
        }
        rendered.push({ name: outputName, pages });
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    }
  }

  return rendered;
}

function loadFixturePaths(fixtureDir) {
  const resolved = resolve(fixtureDir);
  if (!existsSync(resolved)) {
    throw new Error(`Visual fixture directory does not exist: ${fixtureDir}`);
  }
  return readdirSync(resolved)
    .filter((file) => file.endsWith(".mjs"))
    .sort()
    .map((file) => join(resolved, file));
}

function ensureRenderer(renderer) {
  prepareBundledRenderer(renderer);
  const result = spawnSync(renderer, ["-h"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    throw new Error(
      `Unable to find ${renderer}. Install dev dependencies, install Poppler (macOS: brew install poppler; Debian/Ubuntu: apt-get install poppler-utils), or set PDF_VISUAL_RENDERER.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Unable to run ${renderer}: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
}

function findBundledRenderer() {
  const candidates =
    process.platform === "darwin"
      ? ["node_modules/pdf-poppler/lib/osx/poppler-0.66/bin/pdftoppm"]
      : process.platform === "win32"
        ? ["node_modules/pdf-poppler/lib/win/poppler-0.51/bin/pdftoppm.exe"]
        : [];
  return candidates.map((candidate) => resolve(candidate)).find((candidate) => existsSync(candidate));
}

function findSystemRenderer() {
  const result = spawnSync("pdftoppm", ["-h"], { encoding: "utf8" });
  return result.status === 0 ? "pdftoppm" : undefined;
}

function prepareBundledRenderer(renderer) {
  const resolved = resolve(renderer);
  if (!resolved.includes(`${join("node_modules", "pdf-poppler")}`) || !existsSync(resolved)) return;
  try {
    chmodSync(resolved, 0o755);
  } catch {
    // The later renderer probe will report a clear execution failure.
  }
  if (process.platform !== "darwin") return;
  const bundledDylib = resolve("node_modules/pdf-poppler/lib/osx/poppler-0.66/lib/libpoppler.77.0.0.dylib");
  if (!existsSync(bundledDylib)) return;
  spawnSync("install_name_tool", ["-change", HOMEBREW_POPPLER_DYLIB, bundledDylib, resolved], {
    encoding: "utf8",
  });
}

function sanitizeName(name) {
  return String(name).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "fixture";
}

function dataSetsForFixture(fixture) {
  const sets = Array.isArray(fixture.dataSets) && fixture.dataSets.length > 0
    ? fixture.dataSets
    : [{ id: "default", label: "Default", data: undefined }];
  return sets.map((set, index) => ({
    id: sanitizeName(set.id ?? `data-${index + 1}`),
    label: set.label ?? set.id ?? `Data ${index + 1}`,
    data: set.data,
  }));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") options.fixtureDir = argv[++index];
    else if (arg === "--out") options.outputDir = argv[++index];
    else if (arg === "--renderer") options.renderer = argv[++index];
    else if (arg === "--dpi") options.dpi = Number(argv[++index]);
    else if (arg === "--help") {
      console.log("Usage: node scripts/render-visual-fixtures.mjs [--fixtures DIR] [--out DIR] [--renderer pdftoppm] [--dpi 144]");
      process.exit(0);
    }
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  renderFixtures(parseArgs(process.argv.slice(2)))
    .then((results) => {
      for (const result of results) {
        console.log(`Rendered ${result.name}: ${result.pages.length} page(s)`);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
