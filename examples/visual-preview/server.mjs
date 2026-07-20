import { createServer } from "node:http";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { deflateSync, gunzipSync, gzipSync } from "node:zlib";
import { comparePpmBuffers, parsePpm } from "../../dist/src/internal/visual-compare.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "../..");
const FIXTURE_DIR = resolve(ROOT, "examples/visual-fixtures");
const BASELINE_DIR = resolve(ROOT, "test/visual-baselines");
const OUTPUT_DIR = resolve(ROOT, ".visual-output/preview");
const STATIC_DIR = resolve(__dirname, "static");
const DEFAULT_DPI = 144;
const MAX_CHANNEL_DELTA = 2;
const MAX_DIFF_RATIO = 0.001;
const HOMEBREW_POPPLER_DYLIB = "/usr/local/Cellar/poppler/0.66.0/lib/libpoppler.77.dylib";
const TRUSTED_BIN_DIRS = ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin", "/usr/sbin", "/sbin"];
const SAFE_SPAWN_ENV = { ...process.env, PATH: TRUSTED_BIN_DIRS.join(":") };

const renderer = process.env.PDF_VISUAL_RENDERER ?? findSystemRenderer() ?? findBundledRenderer() ?? "pdftoppm";
const port = Number(process.env.PORT ?? readArg("--port") ?? 4174);
const shouldOpen = process.argv.includes("--open");

ensureRenderer();
mkdirSync(OUTPUT_DIR, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    await routeRequest(request, response, url);
  } catch (error) {
    sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function routeRequest(request, response, url) {
  if (request.method === "GET") {
    const handled = await routeGet(request, response, url);
    if (handled) return;
  }
  if (request.method === "POST") {
    const handled = await routePost(request, response, url);
    if (handled) return;
  }
  response.writeHead(404);
  response.end("Not found");
}

async function routeGet(request, response, url) {
  if (url.pathname === "/") {
    sendFile(response, join(STATIC_DIR, "index.html"));
    return true;
  }
  if (url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return true;
  }
  if (url.pathname.startsWith("/static/")) {
    sendSafeFile(response, STATIC_DIR, url.pathname.slice("/static/".length));
    return true;
  }
  if (url.pathname.startsWith("/artifacts/")) {
    sendSafeFile(response, OUTPUT_DIR, url.pathname.slice("/artifacts/".length));
    return true;
  }
  if (url.pathname === "/api/fixtures") {
    sendJson(response, await listFixtures());
    return true;
  }
  return false;
}

async function routePost(request, response, url) {
  if (url.pathname === "/api/render") {
    sendJson(response, await renderSelection(await readJson(request)));
    return true;
  }
  if (url.pathname === "/api/update-baseline") {
    sendJson(response, await updateBaseline(await readJson(request)));
    return true;
  }
  return false;
}

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Visual preview running at ${url}`);
  if (shouldOpen) spawn("open", [url], { stdio: "ignore", detached: true, env: SAFE_SPAWN_ENV }).unref();
});

async function listFixtures() {
  const fixtures = [];
  for (const fixturePath of fixturePaths()) {
    const fixture = await loadFixture(fixturePath);
    const fixtureName = sanitizeName(fixture.name ?? basename(fixturePath, ".mjs"));
    fixtures.push({
      id: fixtureName,
      label: fixture.label ?? fixtureName,
      dataSets: dataSetsForFixture(fixture).map((dataSet) => ({
        id: dataSet.id,
        label: dataSet.label,
      })),
    });
  }
  return { fixtures };
}

async function renderSelection(input) {
  const fixtureEntry = await findFixture(input.fixture);
  const dataSet = dataSetById(fixtureEntry.fixture, input.dataSet);
  const fixtureName = fixtureEntry.name;
  const dataSetId = dataSet.id;
  const dpi = Number(input.dpi ?? DEFAULT_DPI);
  const outputDir = join(OUTPUT_DIR, fixtureName, dataSetId);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const pdfBytes = await fixtureEntry.fixture.render(dataSet.data, { dataSet });
  if (!(pdfBytes instanceof Uint8Array)) {
    throw new TypeError(`Fixture ${fixtureName} render() must return Uint8Array.`);
  }

  const actual = renderPdfPages(pdfBytes, outputDir, "actual", dpi);
  const pages = actual.ppm.map((actualPpmPath, index) => {
    const pageNumber = index + 1;
    const actualPpm = readFileSync(actualPpmPath);
    const baselinePpm = readBaselinePpm(fixtureName, dataSetId, pageNumber);
    const actualPng = artifactUrl(actual.png[index]);
    const page = {
      pageNumber,
      actualPng,
      actualPdf: artifactUrl(actual.pdf),
      baselinePng: null,
      diffPng: null,
      passed: false,
      status: "missing-baseline",
      differingPixels: null,
      totalPixels: null,
      differingPixelRatio: null,
      maxChannelDelta: null,
    };

    if (!baselinePpm) return page;

    const baselineImage = parsePpm(baselinePpm);
    const baselinePngPath = join(outputDir, `baseline-page-${pageNumber}.png`);
    writeFileSync(baselinePngPath, encodePngRgb(baselineImage.width, baselineImage.height, baselineImage.data));

    const diffPngPath = join(outputDir, `diff-page-${pageNumber}.png`);
    writeFileSync(diffPngPath, createDiffPng(baselinePpm, actualPpm));

    const result = comparePpmBuffers(baselinePpm, actualPpm, {
      maxChannelDelta: MAX_CHANNEL_DELTA,
      maxDifferingPixelRatio: MAX_DIFF_RATIO,
    });

    return {
      ...page,
      baselinePng: artifactUrl(baselinePngPath),
      diffPng: artifactUrl(diffPngPath),
      passed: result.passed,
      status: result.passed ? "passed" : "diff",
      differingPixels: result.differingPixels,
      totalPixels: result.totalPixels,
      differingPixelRatio: result.differingPixelRatio,
      maxChannelDelta: result.maxChannelDelta,
    };
  });

  return {
    fixture: fixtureName,
    dataSet: dataSetId,
    thresholds: {
      dpi,
      maxChannelDelta: MAX_CHANNEL_DELTA,
      maxDifferingPixelRatio: MAX_DIFF_RATIO,
    },
    pages,
  };
}

async function updateBaseline(input) {
  const result = await renderSelection(input);
  const targetDir = baselineDirFor(result.fixture, result.dataSet);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  const actualDir = join(OUTPUT_DIR, result.fixture, result.dataSet);
  const ppmFiles = readdirSync(actualDir)
    .filter((file) => /^actual-\d+\.ppm$/.test(file))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  for (const [index, file] of ppmFiles.entries()) {
    writeFileSync(join(targetDir, `page-${index + 1}.ppm.gz`), gzipSync(readFileSync(join(actualDir, file))));
  }

  return { ...result, updatedBaseline: true };
}

function renderPdfPages(pdfBytes, outputDir, prefix, dpi) {
  const workDir = mkdtempSync(join(tmpdir(), "sempdf-preview-"));
  const pdfPath = join(outputDir, `${prefix}.pdf`);
  writeFileSync(pdfPath, pdfBytes);
  try {
    const workPdf = join(workDir, `${prefix}.pdf`);
    writeFileSync(workPdf, pdfBytes);
    runRenderer(["-r", String(dpi), workPdf, join(workDir, prefix)]);
    runRenderer(["-r", String(dpi), "-png", workPdf, join(workDir, prefix)]);

    const ppm = copyRenderedPages(workDir, outputDir, prefix, ".ppm");
    const png = copyRenderedPages(workDir, outputDir, prefix, ".png");
    if (ppm.length === 0 || png.length === 0) {
      throw new Error("Renderer did not produce preview pages.");
    }
    return { pdf: pdfPath, ppm, png };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function copyRenderedPages(fromDir, toDir, prefix, extension) {
  return readdirSync(fromDir)
    .filter((file) => file.startsWith(`${prefix}-`) && file.endsWith(extension))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((file, index) => {
      const target = join(toDir, `${prefix}-${index + 1}${extension}`);
      copyFileSync(join(fromDir, file), target);
      return target;
    });
}

function readBaselinePpm(fixtureName, dataSetId, pageNumber) {
  const nested = join(BASELINE_DIR, fixtureName, dataSetId, `page-${pageNumber}.ppm.gz`);
  const legacy = join(BASELINE_DIR, fixtureName, `page-${pageNumber}.ppm.gz`);
  let path;
  if (existsSync(nested)) {
    path = nested;
  } else if (dataSetId === "default" && existsSync(legacy)) {
    path = legacy;
  }
  return path ? gunzipSync(readFileSync(path)) : undefined;
}

function baselineDirFor(fixtureName, dataSetId) {
  return dataSetId === "default" ? join(BASELINE_DIR, fixtureName) : join(BASELINE_DIR, fixtureName, dataSetId);
}

function createDiffPng(expectedPpm, actualPpm) {
  const expected = parsePpm(expectedPpm);
  const actual = parsePpm(actualPpm);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error("Cannot create diff overlay for pages with different dimensions.");
  }
  const rgba = Buffer.alloc(expected.width * expected.height * 4);
  for (let source = 0, target = 0; source < expected.data.length; source += 3, target += 4) {
    const dr = Math.abs(expected.data[source] - actual.data[source]);
    const dg = Math.abs(expected.data[source + 1] - actual.data[source + 1]);
    const db = Math.abs(expected.data[source + 2] - actual.data[source + 2]);
    const delta = Math.max(dr, dg, db);
    if (delta === 0) continue;
    const severe = delta > MAX_CHANNEL_DELTA;
    rgba[target] = severe ? 238 : 245;
    rgba[target + 1] = severe ? 60 : 158;
    rgba[target + 2] = severe ? 67 : 11;
    rgba[target + 3] = severe ? 176 : 150;
  }
  return encodePngRgba(expected.width, expected.height, rgba);
}

async function findFixture(id) {
  for (const fixturePath of fixturePaths()) {
    const fixture = await loadFixture(fixturePath);
    const name = sanitizeName(fixture.name ?? basename(fixturePath, ".mjs"));
    if (name === id) return { name, fixture };
  }
  throw new Error(`Unknown fixture: ${id}`);
}

function fixturePaths() {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".mjs"))
    .sort()
    .map((file) => join(FIXTURE_DIR, file));
}

async function loadFixture(fixturePath) {
  const mtime = statSync(fixturePath).mtimeMs;
  return import(`${pathToFileURL(fixturePath).href}?mtime=${mtime}`);
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

function dataSetById(fixture, id = "default") {
  const dataSet = dataSetsForFixture(fixture).find((set) => set.id === id);
  if (!dataSet) throw new Error(`Unknown data set: ${id}`);
  return dataSet;
}

function ensureRenderer() {
  prepareBundledRenderer(renderer);
  const result = spawnSync(renderer, ["-h"], { encoding: "utf8", env: SAFE_SPAWN_ENV });
  if (result.error?.code === "ENOENT") {
    throw new Error("pdftoppm is required. Install Poppler or set PDF_VISUAL_RENDERER.");
  }
  if (result.status !== 0) {
    throw new Error(`Unable to run ${renderer}: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

function findSystemRenderer() {
  const result = spawnSync("pdftoppm", ["-h"], { encoding: "utf8", env: SAFE_SPAWN_ENV });
  return result.status === 0 ? "pdftoppm" : undefined;
}

function findBundledRenderer() {
  let relativePath;
  if (process.platform === "darwin") {
    relativePath = "node_modules/pdf-poppler/lib/osx/poppler-0.66/bin/pdftoppm";
  } else if (process.platform === "win32") {
    relativePath = "node_modules/pdf-poppler/lib/win/poppler-0.51/bin/pdftoppm.exe";
  } else {
    return undefined;
  }
  const candidate = resolve(ROOT, relativePath);
  return existsSync(candidate) ? candidate : undefined;
}

function prepareBundledRenderer(rendererPath) {
  const resolved = resolve(rendererPath);
  if (!resolved.includes(`${join("node_modules", "pdf-poppler")}`) || !existsSync(resolved)) return;
  try {
    chmodSync(resolved, 0o755);
  } catch {
    return;
  }
  if (process.platform !== "darwin") return;
  const bundledDylib = resolve(ROOT, "node_modules/pdf-poppler/lib/osx/poppler-0.66/lib/libpoppler.77.0.0.dylib");
  if (!existsSync(bundledDylib)) return;
  spawnSync("install_name_tool", ["-change", HOMEBREW_POPPLER_DYLIB, bundledDylib, resolved], {
    encoding: "utf8",
    env: SAFE_SPAWN_ENV,
  });
}

function runRenderer(args) {
  const result = spawnSync(renderer, args, { encoding: "utf8", env: SAFE_SPAWN_ENV });
  if (result.status !== 0) {
    throw new Error(`pdftoppm failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

function encodePngRgb(width, height, rgb) {
  return encodePng(width, height, 2, 3, rgb);
}

function encodePngRgba(width, height, rgba) {
  return encodePng(width, height, 6, 4, rgba);
}

function encodePng(width, height, colorType, channels, pixels) {
  const rowLength = width * channels;
  const raw = Buffer.alloc((rowLength + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (rowLength + 1);
    raw[rawOffset] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + row * rowLength, rowLength).copy(raw, rawOffset + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, colorType, 0, 0, 0]),
    ])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  return Buffer.concat([uint32(data.length), typeBytes, data, uint32(crc32(Buffer.concat([typeBytes, data])))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sendSafeFile(response, root, relativePath) {
  const segments = relativePath.split(/[/\\]/);
  const hasTraversal = segments.some((segment) => segment === "..");
  if (hasTraversal) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const target = resolve(root, normalize(relativePath));
  const withinRoot = target === root || target.startsWith(root + "/");
  if (!withinRoot || !existsSync(target) || !statSync(target).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  sendFile(response, target);
}

function sendFile(response, path) {
  const type = contentType(path);
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(readFileSync(path));
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function contentType(path) {
  const extension = extname(path);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function artifactUrl(path) {
  return `/artifacts/${normalize(path).slice(OUTPUT_DIR.length + 1).replaceAll("\\", "/")}`;
}

function sanitizeName(name) {
  const cleaned = String(name).trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  const trimmed = cleaned.replace(/^-+/, "").replace(/-+$/, "");
  return trimmed || "fixture";
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
