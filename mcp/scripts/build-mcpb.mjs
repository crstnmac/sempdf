#!/usr/bin/env node
// Assembles and packs the sempdf MCPB bundle.
//
//   build/
//   ├── manifest.json          (version stamped from package.json)
//   └── server/
//       ├── index.js           (esbuild single-file bundle of src/index.ts)
//       ├── package.json       ({ "type": "module" } so node runs it as ESM)
//       └── types.d.ts         (lib type declarations served by the schema resource)
//
// Output: dist-mcpb/sempdf.mcpb
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const serverDir = join(buildDir, "server");
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

console.log("• cleaning build dir");
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });

console.log("• bundling server with esbuild");
run("npx", [
  "esbuild",
  join(root, "src", "index.ts"),
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node22",
  `--outfile=${join(serverDir, "index.js")}`,
]);

console.log("• copying lib type declarations");
// Concatenate the PdfDocumentJson types + referenced template types, shipped
// under a non-".d.ts" name (mcpb pack strips *.d.ts from the bundle).
const libSrc = join(root, "node_modules", "@sempdf", "sempdf-pdf", "dist", "src");
const documentTypes =
  readFileSync(join(libSrc, "document-json.d.ts"), "utf8") +
  "\n\n/* ── Referenced template & option types ───────────────────── */\n\n" +
  readFileSync(join(libSrc, "types.d.ts"), "utf8");
writeFileSync(join(serverDir, "document-types.txt"), documentTypes);

// Mark the bundled entry as ESM so `node index.js` loads it correctly.
writeFileSync(join(serverDir, "package.json"), JSON.stringify({ type: "module" }, null, 2));

console.log("• writing manifest (version " + pkg.version + ")");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(buildDir, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log("• validating + packing");
run("npx", ["@anthropic-ai/mcpb", "validate", join(buildDir, "manifest.json")]);
mkdirSync(join(root, "dist-mcpb"), { recursive: true });
run("npx", ["@anthropic-ai/mcpb", "pack", buildDir, join(root, "dist-mcpb", "sempdf.mcpb")]);

console.log("\n✓ dist-mcpb/sempdf.mcpb");
