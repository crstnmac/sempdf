#!/usr/bin/env node
import { accessSync } from "node:fs";
import { spawnSync } from "node:child_process";

function printUsage() {
  console.log([
    "Usage: node scripts/validate-verapdf.mjs [options] <file.pdf> [-- <veraPDF args>]",
    "",
    "Options:",
    "  --format <text|xml|json|html>  Output format passed to veraPDF. Defaults to text.",
    "  --verapdf <path>               Path to the veraPDF executable. Defaults to VERAPDF_BIN or verapdf.",
    "  --help                         Show this help.",
    "",
    "Examples:",
    "  npm run validate:pdf -- output.pdf",
    "  npm run validate:pdf -- output.pdf -- --flavour 1b",
    "  VERAPDF_BIN=/opt/verapdf/verapdf npm run validate:pdf -- output.pdf"
  ].join("\n"));
}

const args = process.argv.slice(2);
const passthroughIndex = args.indexOf("--");
const wrapperArgs = passthroughIndex === -1 ? args : args.slice(0, passthroughIndex);
const passthroughArgs = passthroughIndex === -1 ? [] : args.slice(passthroughIndex + 1);

let format = "text";
let verapdf = process.env.VERAPDF_BIN ?? "verapdf";
let pdfPath;

for (let index = 0; index < wrapperArgs.length; index += 1) {
  const arg = wrapperArgs[index];
  switch (arg) {
    case "--help":
    case "-h":
      printUsage();
      process.exit(0);
      break;
    case "--format":
      format = wrapperArgs[index + 1];
      index += 1;
      break;
    case "--verapdf":
      verapdf = wrapperArgs[index + 1];
      index += 1;
      break;
    default:
      if (arg?.startsWith("-")) {
        console.error(`Unknown option: ${arg}`);
        printUsage();
        process.exit(2);
      }
      if (pdfPath !== undefined) {
        console.error(`Unexpected extra PDF path: ${arg}`);
        printUsage();
        process.exit(2);
      }
      pdfPath = arg;
  }
}

if (!format || !verapdf || !pdfPath) {
  printUsage();
  process.exit(2);
}

try {
  accessSync(pdfPath);
} catch {
  console.error(`PDF file not found: ${pdfPath}`);
  process.exit(2);
}

const result = spawnSync(verapdf, ["--format", format, ...passthroughArgs, pdfPath], {
  stdio: "inherit"
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error(`Unable to find veraPDF executable: ${verapdf}`);
    console.error("Install veraPDF or set VERAPDF_BIN=/path/to/verapdf.");
    process.exit(127);
  }
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
