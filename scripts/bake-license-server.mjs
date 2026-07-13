import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Bakes release-time licensing constants into src/internal/license-server.ts:
//   SEMPDF_LICENSE_SERVER   → bakedServerUrl (license server base URL)
//   SEMPDF_LICENSE_PUBKEYS  → bakedServerPubkeys, JSON map {kid: "SPKI PEM"}
//   SEMPDF_LICENSE_PUBKEY   → single-PEM shorthand; kid from
//                               SEMPDF_LICENSE_KID (default "v1")
// Values not provided are preserved from the existing file, so local rebuilds
// never wipe what a release build baked.

const server = process.env.SEMPDF_LICENSE_SERVER;
const pubkeysJson = process.env.SEMPDF_LICENSE_PUBKEYS;
const pubkeyPem = process.env.SEMPDF_LICENSE_PUBKEY;
const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, "../src/internal/license-server.ts");

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
const versionLine = `export const bakedLibVersion = ${JSON.stringify(pkg.version)};\n`;

let existing = "";
try {
  existing = readFileSync(target, "utf8");
} catch { /* file doesn't exist yet */ }

function preserved(name, fallback) {
  const m = existing.match(new RegExp(`export const ${name}(?::[^=]+)?\\s*=\\s*([\\s\\S]+?);\\n`));
  return m?.[1]?.trim() ?? fallback;
}

const serverLine = server
  ? `export const bakedServerUrl = ${JSON.stringify(server)};\n`
  : `export const bakedServerUrl = ${preserved("bakedServerUrl", "undefined")};\n`;

let pubkeys;
if (pubkeysJson) {
  pubkeys = JSON.parse(pubkeysJson); // {kid: pem}
} else if (pubkeyPem) {
  pubkeys = { [process.env.SEMPDF_LICENSE_KID ?? "v1"]: pubkeyPem };
}
const preservedKeys = preserved("bakedServerPubkeys", "{}");
const pubkeysLine = pubkeys
  ? `export const bakedServerPubkeys: Record<string, string> = ${JSON.stringify(pubkeys)};\n`
  : `export const bakedServerPubkeys: Record<string, string> = ${preservedKeys};\n`;

writeFileSync(target, serverLine + versionLine + pubkeysLine);

console.log(`[bake-license-server] server URL: ${server ?? `preserved (${preserved("bakedServerUrl", "none")})`}`);
console.log(`[bake-license-server] pubkeys: ${pubkeys ? Object.keys(pubkeys).join(", ") : preservedKeys === "{}" ? "none" : "preserved"}`);

// A production build with a real server URL but no verification keys silently
// downgrades to transport trust — make that mistake loud.
const finalUrl = server ? JSON.stringify(server) : preserved("bakedServerUrl", "undefined");
const keysEmpty = pubkeys ? Object.keys(pubkeys).length === 0 : preservedKeys === "{}";
if (finalUrl.includes("https://") && keysEmpty) {
  console.warn(
    "[bake-license-server] WARNING: production server URL baked WITHOUT " +
      "SEMPDF_LICENSE_PUBKEYS — authorize responses will NOT be signature-" +
      "verified. Bake the server's Ed25519 public key(s) for release builds.",
  );
}
