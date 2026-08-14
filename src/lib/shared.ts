export const docsRoute = "";
export const repositoryUrl = "https://github.com/crstnmac/zeropdf";

export function encodeMarkdownUrl(slugs: string[]) {
  const segments = [...slugs];
  if (segments.length === 0) segments.push("index.md");
  else segments[segments.length - 1] += ".md";
  return `/${segments.join("/")}`;
}

export function decodeMarkdownUrl(segments: string[]): string[] {
  if (segments.length === 0) return [];
  const out = [...segments];
  const last = out.at(-1);
  if (last) out[out.length - 1] = last.replace(/\.md$/, "");
  if (out.length === 1 && out[0] === "index") out.pop();
  return out;
}
