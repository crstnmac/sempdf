import { PdfEngineError, PdfErrorCode } from "./errors.js";

/**
 * Options for {@link loadGoogleFont}.
 */
export interface LoadGoogleFontOptions {
  /** Font weight to request (1-1000). Defaults to 400. */
  weight?: number;
  /** Whether to request the italic style. Defaults to false. */
  italic?: boolean;
  /**
   * Restrict the downloaded font to the glyphs needed for this text
   * (Google Fonts `&text=` subsetting). Produces a much smaller file.
   */
  text?: string;
  /** Abort signal forwarded to both network requests. */
  signal?: AbortSignal;
  /**
   * Custom `fetch` implementation. Defaults to the global `fetch`. Useful for
   * proxies, caching, or runtimes without a global `fetch`.
   */
  fetch?: typeof fetch;
}

/**
 * Downloads a Google Font and returns its raw TrueType/OpenType bytes, ready to
 * pass to {@link PdfDocument.embedTrueTypeFont} or as a face in
 * {@link PdfDocument.registerFontFamily}.
 *
 * The Google Fonts CSS API serves `woff2` (Brotli-compressed) to clients that
 * advertise woff2 support — such as browsers — which this zero-dependency
 * engine cannot decode. Clients that do not advertise woff2 support, such as
 * Node, receive an embeddable `.ttf`/`.otf` file. Call this from Node; in the
 * browser, fetch a `.ttf`/`.otf` yourself and pass it to `embedTrueTypeFont`.
 *
 * @param family Google Font family name, e.g. `"Inter"` or `"Roboto Slab"`.
 * @param options Weight, style, subsetting, and network options.
 * @returns The font file bytes.
 *
 * @example
 * ```ts
 * const bytes = await loadGoogleFont("Inter", { weight: 700 });
 * const inter = doc.embedTrueTypeFont(bytes, { family: "Inter" });
 * doc.addPage().text("Hello", { font: inter, fontSize: 24 });
 * ```
 */
export async function loadGoogleFont(
  family: string,
  options: LoadGoogleFontOptions = {},
): Promise<Uint8Array> {
  if (typeof family !== "string" || family.trim().length === 0) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      "Google font family must be a non-empty string.",
    );
  }

  const weight = options.weight ?? 400;
  if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      "Google font weight must be an integer between 1 and 1000.",
      { weight },
    );
  }

  const italic = options.italic ?? false;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      "A global fetch() is required to load Google fonts. Provide options.fetch on runtimes without it.",
    );
  }

  const init: RequestInit = options.signal ? { signal: options.signal } : {};
  const axis = `ital,wght@${italic ? 1 : 0},${weight}`;
  let cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axis}`;
  if (options.text !== undefined && options.text.length > 0) {
    cssUrl += `&text=${encodeURIComponent(options.text)}`;
  }

  const cssResponse = await fetchImpl(cssUrl, init);
  if (!cssResponse.ok) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      `Google Fonts returned ${cssResponse.status} for "${family}". Check the family name, weight, and italic style.`,
      { family, weight, italic, status: cssResponse.status },
    );
  }
  const css = await cssResponse.text();

  const match = new RegExp(/url\((https:\/\/[^)]+\.(?:ttf|otf))\)/i).exec(css);
  if (!match) {
    const served = new RegExp(/format\('([^']+)'\)/).exec(css)?.[1];
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      served === "woff2" || served === "woff"
        ? `Google served a ${served} file for "${family}", which this library cannot decode. This typically happens in browsers — fetch a .ttf/.otf yourself and pass it to embedTrueTypeFont(), or call loadGoogleFont() from Node.`
        : `Could not find an embeddable .ttf/.otf URL for "${family}" in the Google Fonts response.`,
      { family, served },
    );
  }

  const fontUrl = match[1]!;
  const fontResponse = await fetchImpl(fontUrl, init);
  if (!fontResponse.ok) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      `Failed to download the font file for "${family}" (${fontResponse.status}).`,
      { family, url: fontUrl, status: fontResponse.status },
    );
  }

  return new Uint8Array(await fontResponse.arrayBuffer());
}
