// Downloads the Liberation fonts (SIL Open Font License 1.1) into
// fonts/liberation/ for bundling. Liberation Sans/Serif/Mono are metric-
// compatible with Arial/Times New Roman/Courier New (and therefore the PDF
// Standard-14 Helvetica/Times/Courier), so embedding them produces PDF/A- and
// PDF/UA-compliant output with no reflow vs. the built-in fonts.
//
// Run once: `node scripts/fetch-fonts.mjs`. The fonts are OFL-licensed and
// redistributable, so the downloaded files are meant to be committed.
//
// Uses system `curl` + `tar` (dev-time only; not a runtime dependency).

import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const VERSION = "2.1.5";
// Liberation release tarballs are attached to the release *body* (a /files/ URL),
// not as a /releases/download/ asset, so resolve the real URL from the GitHub
// API and fall back to the known 2.1.5 attachment if that lookup fails.
const RELEASE_API = `https://api.github.com/repos/liberationfonts/liberation-fonts/releases/tags/${VERSION}`;
const FALLBACK_TARBALL = `https://github.com/liberationfonts/liberation-fonts/files/7261481/liberation-fonts-ttf-${VERSION}.tar.gz`;
const TARBALL_RE = /https:\/\/github\.com\/[^\s)"']+liberation-fonts-ttf-[\d.]+\.tar\.gz/;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "fonts", "liberation");
const tmpDir = join(root, ".liberation-tmp");
const tarPath = join(tmpDir, "liberation.tar.gz");

const WANTED = [
  "LiberationSans-Regular.ttf",
  "LiberationSans-Bold.ttf",
  "LiberationSans-Italic.ttf",
  "LiberationSans-BoldItalic.ttf",
  "LiberationSerif-Regular.ttf",
  "LiberationSerif-Bold.ttf",
  "LiberationSerif-Italic.ttf",
  "LiberationSerif-BoldItalic.ttf",
  "LiberationMono-Regular.ttf",
  "LiberationMono-Bold.ttf",
  "LiberationMono-Italic.ttf",
  "LiberationMono-BoldItalic.ttf",
];

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${result.status}). Is ${cmd} installed?`);
  }
}

/** Resolves the release tarball download URL via the GitHub API, with fallback. */
async function resolveTarballUrl() {
  try {
    const res = await fetch(RELEASE_API, {
      headers: { "User-Agent": "sempdf-fetch-fonts", Accept: "application/vnd.github+json" },
    });
    if (res.ok) {
      const release = await res.json();
      const asset = (release.assets ?? []).find((a) => /ttf-[\d.]+\.tar\.gz$/.test(a.name ?? ""));
      if (asset?.browser_download_url) return asset.browser_download_url;
      const fromBody = typeof release.body === "string" ? release.body.match(TARBALL_RE)?.[0] : undefined;
      if (fromBody) return fromBody;
    }
  } catch {
    // fall through to the known attachment URL
  }
  return FALLBACK_TARBALL;
}

/** Downloads a URL to a file using fetch (follows redirects, clear errors). */
async function download(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": "sempdf-fetch-fonts" }, redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${url} → HTTP ${res.status}`);
  writeFileSync(dest, new Uint8Array(await res.arrayBuffer()));
}

/** Recursively find a file by basename under a directory. */
function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
}

mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

try {
  console.log(`[fetch-fonts] Resolving Liberation ${VERSION} download URL…`);
  const tarballUrl = await resolveTarballUrl();
  console.log(`[fetch-fonts] Downloading ${tarballUrl}`);
  await download(tarballUrl, tarPath);
  console.log("[fetch-fonts] Extracting…");
  run("tar", ["xzf", tarPath, "-C", tmpDir]);

  for (const name of WANTED) {
    const src = findFile(tmpDir, name);
    if (!src) throw new Error(`Expected font ${name} not found in the archive.`);
    copyFileSync(src, join(outDir, name));
  }
  const license = findFile(tmpDir, "LICENSE") ?? findFile(tmpDir, "OFL.txt");
  if (license) copyFileSync(license, join(outDir, "LICENSE"));

  console.log(`[fetch-fonts] Wrote ${WANTED.length} fonts + license to fonts/liberation/.`);
  console.log("[fetch-fonts] Commit these files — they are OFL-licensed and redistributable.");
} finally {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
}
