import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

const contentRoot = join(process.cwd(), "content", "docs");
const changelogSource = join(process.cwd(), "CHANGELOG.md");
const changelogPage = join(contentRoot, "changelog.md");

function titleFromFilename(file) {
  return basename(file, extname(file))
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function quoteYaml(value) {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}

/**
 * Markdown links are resolved by browsers against the current route. Because
 * the docs routes intentionally omit trailing slashes, a source link such as
 * `../interfaces/Foo` on `/api/functions/bar` otherwise becomes
 * `/api/functions/../interfaces/Foo` inconsistently during prerender crawling.
 * Convert source-relative content links to their canonical site routes.
 */
function canonicalizeInternalLinks(content, file) {
  return content.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (match, prefix, href, suffix) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return match;

    const hashAt = href.indexOf("#");
    const target = hashAt === -1 ? href : href.slice(0, hashAt);
    const hash = hashAt === -1 ? "" : href.slice(hashAt);
    if (target.length === 0) return match;

    const absoluteTarget = resolve(dirname(file), target.replace(/\.mdx?$/i, ""));
    let route = relative(contentRoot, absoluteTarget).split(sep).join("/");
    if (route === ".." || route.startsWith("../")) return match;
    route = route.replace(/(?:^|\/)index$/, "");
    return `${prefix}/${route}${hash}${suffix}`;
  });
}

async function prepareDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await prepareDirectory(file);
      continue;
    }
    if (!entry.isFile() || ![".md", ".mdx"].includes(extname(entry.name))) continue;

    const content = await readFile(file, "utf8");
    const heading = content.match(/^#\s+(.+)$/m)?.[1]
      ?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_]/g, "");
    const withoutTopHeading = canonicalizeInternalLinks(content
      .replace(/^#\s+.+\n+(?=\S)/m, "")
      .replace(/(\]\([^\s)]+)\.md(?=[#)])/g, "$1"), file);

    if (content.startsWith("---\n")) {
      if (withoutTopHeading !== content) await writeFile(file, withoutTopHeading);
      continue;
    }

    const title = heading || titleFromFilename(entry.name);
    await writeFile(file, `---\ntitle: ${quoteYaml(title)}\n---\n\n${withoutTopHeading}`);
  }
}

const changelog = await readFile(changelogSource, "utf8");
const changelogBody = changelog.replace(/^#\s+Changelog\s*\n+/i, "");
await writeFile(
  changelogPage,
  `---\ntitle: "Changelog"\ndescription: "Release history for @crstnmac/zeropdf."\n---\n\n${changelogBody}`,
);

await prepareDirectory(contentRoot);
