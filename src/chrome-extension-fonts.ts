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

function resolveUrl(path: string): string {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.getURL) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      "chrome.runtime.getURL is not available. This module must run in a Chrome extension context (service worker, background script, or extension page).",
    );
  }
  return chrome.runtime.getURL(path);
}

export async function loadExtensionFontBytes(path: string): Promise<Uint8Array> {
  const url = resolveUrl(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      `Failed to load bundled font "${path}" (${response.status}). Ensure the file is included in web_accessible_resources.`,
      { path, url, status: response.status },
    );
  }
  return new Uint8Array(await response.arrayBuffer());
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

  return doc.registerFontFamily(family, faces);
}
