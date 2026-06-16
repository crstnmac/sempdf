/**
 * WOFF2 font decoding, exported as `@barrierbreak/sempdf-pdf/woff2`.
 *
 * Browsers (and the Google Fonts CDN when talking to a browser) serve fonts
 * as woff2 — Brotli-compressed sfnt with preprocessed glyph data — which the
 * core engine cannot embed directly. `decodeWoff2()` converts woff2 bytes
 * into standard TTF/OTF bytes ready for `embedTrueTypeFont()` and
 * `registerFontFamily()`.
 *
 * This module embeds the 122 KB Brotli static dictionary, so it ships as a
 * separate subpath to keep the core import lean.
 *
 * @example
 * ```ts
 * import { createDocument } from "@barrierbreak/sempdf-pdf";
 * import { decodeWoff2 } from "@barrierbreak/sempdf-pdf/woff2";
 *
 * const response = await fetch(woff2Url);
 * const ttf = decodeWoff2(new Uint8Array(await response.arrayBuffer()));
 * const doc = createDocument();
 * doc.registerFontFamily("Roboto", { regular: ttf });
 * ```
 */
export { decodeWoff2, isWoff2 } from "./internal/woff2.js";
export { brotliDecompress } from "./internal/brotli.js";
