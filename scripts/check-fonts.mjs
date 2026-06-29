// Publish guard: verifies the bundled Liberation fonts are present before the
// package is published. Without this, an empty fonts/liberation/ would publish
// and registerBundledFonts() would fail for end users (who cannot fetch them).
// Run automatically by prepublishOnly; run manually with `node scripts/check-fonts.mjs`.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, "fonts", "liberation");

const REQUIRED = [
  "LICENSE",
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

const missing = REQUIRED.filter((name) => !existsSync(join(dir, name)));

if (missing.length > 0) {
  console.error(
    `[check-fonts] Missing bundled fonts (run \`npm run fetch-fonts\` before publishing):\n  ${missing.join("\n  ")}`,
  );
  process.exit(1);
}

console.log(`[check-fonts] All ${REQUIRED.length} bundled font files present.`);
