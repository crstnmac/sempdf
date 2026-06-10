import { PdfEngineError, PdfErrorCode } from "./errors.js";
import type { PdfDocument } from "./document.js";
import type { FontFamilyInput } from "./types.js";

declare var chrome: {
  runtime?: {
    getURL?: (path: string) => string;
  };
} | undefined;

export interface ExtensionFontPaths {
  regular: string;
  bold?: string | undefined;
  italic?: string | undefined;
  boldItalic?: string | undefined;
}

/** Matches paths that are already absolute URLs and need no getURL resolution. */
const ABSOLUTE_URL = /^(?:chrome-extension|moz-extension|https?):\/\//;

function resolveUrl(path: string): string {
  if (ABSOLUTE_URL.test(path)) {
    return path;
  }
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.getURL) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      "chrome.runtime.getURL is not available. This module must run in a Chrome extension context (service worker, background script, or extension page).",
    );
  }
  // getURL expects a path relative to the extension root; a leading slash is fine,
  // but "./" prefixes produce URLs that fail to fetch.
  return chrome.runtime.getURL(path.replace(/^\.\//, ""));
}

export async function loadExtensionFontBytes(path: string): Promise<Uint8Array> {
  const url = resolveUrl(path);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      `Failed to fetch bundled font "${path}" (resolved to ${url}). ` +
        `Check that the file exists in the extension bundle at exactly this path (paths are relative to the extension root and case-sensitive), ` +
        `and, when calling from a content script, that it is listed in "web_accessible_resources" in manifest.json with a "matches" pattern covering the current page.`,
      { path, url, cause },
    );
  }
  if (!response.ok) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      `Failed to load bundled font "${path}" (${response.status}). Ensure the file is included in web_accessible_resources.`,
      { path, url, status: response.status },
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadExtensionFontFaces(
  paths: ExtensionFontPaths,
): Promise<FontFamilyInput> {
  const [regular, bold, italic, boldItalic] = await Promise.all([
    loadExtensionFontBytes(paths.regular),
    paths.bold !== undefined ? loadExtensionFontBytes(paths.bold) : undefined,
    paths.italic !== undefined ? loadExtensionFontBytes(paths.italic) : undefined,
    paths.boldItalic !== undefined ? loadExtensionFontBytes(paths.boldItalic) : undefined,
  ]);

  const faces: FontFamilyInput = { regular };
  if (bold !== undefined) faces.bold = bold;
  if (italic !== undefined) faces.italic = italic;
  if (boldItalic !== undefined) faces.boldItalic = boldItalic;

  return faces;
}

export async function loadExtensionFont(
  doc: PdfDocument,
  family: string,
  paths: ExtensionFontPaths,
): Promise<string> {
  if (typeof family !== "string" || family.trim().length === 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      "Font family name must be a non-empty string.",
    );
  }

  const faces = await loadExtensionFontFaces(paths);
  return doc.registerFontFamily(family, faces);
}
