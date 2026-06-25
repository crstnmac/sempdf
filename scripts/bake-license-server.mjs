import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const server = process.env.SEMPDF_LICENSE_SERVER;
const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, "../src/internal/license-server.ts");

const content = server
  ? `export const bakedServerUrl = ${JSON.stringify(server)};\n`
  : `export const bakedServerUrl: string | undefined = undefined;\n`;

writeFileSync(target, content);

if (server) {
  console.log(`[bake-license-server] Baked: ${server}`);
} else {
  console.log("[bake-license-server] No SEMPDF_LICENSE_SERVER set — auto-guard will check env var at runtime.");
}
