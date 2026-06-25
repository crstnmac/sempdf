import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const server = process.env.ZEROPDF_LICENSE_SERVER;
const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, "../src/internal/license-server.ts");

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
const versionLine = `export const bakedLibVersion = ${JSON.stringify(pkg.version)};\n`;

// Preserve previously baked server URL when env var is not set.
let currentUrl = "undefined";
if (!server) {
  try {
    const src = readFileSync(target, "utf8");
    const m = src.match(/export const bakedServerUrl\s*=\s*(.+);/);
    if (m && m[1]) currentUrl = m[1];
  } catch { /* file doesn't exist or can't be read */ }
}

const serverLine = server
  ? `export const bakedServerUrl = ${JSON.stringify(server)};\n`
  : `export const bakedServerUrl = ${currentUrl};\n`;

writeFileSync(target, serverLine + versionLine);

if (server) {
  console.log(`[bake-license-server] Baked server URL: ${server}`);
} else {
  console.log(`[bake-license-server] Preserved existing server URL (${currentUrl === "undefined" ? "none" : currentUrl})`);
}
