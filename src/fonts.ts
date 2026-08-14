import { PdfDocument } from "./document.js";
import { PdfEngineError, PdfErrorCode } from "./errors.js";
import { loadGoogleFont, type LoadGoogleFontOptions } from "./google-fonts.js";
import type {
  BinaryData,
  FontFamilyFaces,
  PdfEmbeddedFont,
  PdfFont,
} from "./types.js";

/** A font file source understood by the high-level font API. */
export type FontSource =
  | BinaryData
  | { data: BinaryData; ttcIndex?: number | undefined }
  | { path: string; ttcIndex?: number | undefined }
  | { url: string | URL; fetch?: typeof fetch | undefined; signal?: AbortSignal | undefined; ttcIndex?: number | undefined }
  | ({ google: string; ttcIndex?: number | undefined } & LoadGoogleFontOptions);

/** Sources for the regular, bold, italic, and bold-italic faces of a family. */
export interface FontFamilySources {
  regular: FontSource;
  bold?: FontSource | undefined;
  italic?: FontSource | undefined;
  boldItalic?: FontSource | undefined;
}

/** High-level font configuration accepted by {@link PdfDocument.fonts}. */
export interface FontConfiguration {
  /** Additional font families, keyed by the name used in text APIs. */
  families?: Readonly<Record<string, FontFamilySources>> | undefined;
  /** Default proportional font family. Defaults to the first configured family. */
  default?: PdfFont | undefined;
  /** Default monospaced font. Defaults to the proportional font. */
  code?: PdfFont | undefined;
  /** Ordered document-wide fallback families. */
  fallbacks?: readonly PdfFont[] | undefined;
}

export interface ConfiguredFonts {
  /** Resolved default font. */
  default: PdfFont;
  /** Resolved code font. */
  code: PdfFont;
  /** Resolved fallback chain. */
  fallbacks: readonly PdfFont[];
  /** All newly registered families. */
  families: Readonly<Record<string, FontFamilyFaces>>;
}

function isBinary(value: FontSource): value is BinaryData {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

async function bytesFromSource(source: FontSource): Promise<{ bytes: Uint8Array; ttcIndex?: number }> {
  if (isBinary(source)) {
    return { bytes: source instanceof Uint8Array ? source : new Uint8Array(source) };
  }
  if ("data" in source) {
    return {
      bytes: source.data instanceof Uint8Array ? source.data : new Uint8Array(source.data),
      ...(source.ttcIndex === undefined ? {} : { ttcIndex: source.ttcIndex }),
    };
  }
  if ("google" in source) {
    const { google, ttcIndex, ...options } = source;
    return {
      bytes: await loadGoogleFont(google, options),
      ...(ttcIndex === undefined ? {} : { ttcIndex }),
    };
  }
  if ("path" in source) {
    let readFile: ((path: string) => Promise<Uint8Array>) | undefined;
    try {
      ({ readFile } = await import("node:fs/promises"));
    } catch {
      throw new PdfEngineError(PdfErrorCode.INVALID_FONT, "Local font paths are only available in Node.js; use { url } or { data } in a browser.");
    }
    return {
      bytes: await readFile(source.path),
      ...(source.ttcIndex === undefined ? {} : { ttcIndex: source.ttcIndex }),
    };
  }
  const sourceUrl = source.url instanceof URL ? source.url : new URL(source.url, globalThis.location?.href);
  if (sourceUrl.protocol === "file:") {
    try {
      const { readFile } = await import("node:fs/promises");
      return {
        bytes: await readFile(sourceUrl),
        ...(source.ttcIndex === undefined ? {} : { ttcIndex: source.ttcIndex }),
      };
    } catch {
      throw new PdfEngineError(PdfErrorCode.INVALID_FONT, `Cannot read local font URL ${sourceUrl.href} in this runtime.`);
    }
  }
  const fetchImpl = source.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PdfEngineError(PdfErrorCode.INVALID_FONT, "A fetch implementation is required to load a font URL.");
  }
  const response = await fetchImpl(sourceUrl, source.signal ? { signal: source.signal } : {});
  if (!response.ok) {
    throw new PdfEngineError(PdfErrorCode.INVALID_FONT, `Failed to download font (${response.status}) from ${sourceUrl.href}.`, {
      url: sourceUrl.href,
      status: response.status,
    });
  }
  let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
  if (bytes.length >= 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32) {
    const { decodeWoff2 } = await import("./woff2.js");
    bytes = new Uint8Array(await decodeWoff2(bytes));
  }
  return { bytes, ...(source.ttcIndex === undefined ? {} : { ttcIndex: source.ttcIndex }) };
}

async function embedFamily(doc: PdfDocument, name: string, sources: FontFamilySources): Promise<FontFamilyFaces> {
  const embed = async (source: FontSource): Promise<PdfEmbeddedFont> => {
    const loaded = await bytesFromSource(source);
    return doc.embedTrueTypeFont(loaded.bytes, { family: name, ...(loaded.ttcIndex === undefined ? {} : { ttcIndex: loaded.ttcIndex }) });
  };
  const [regular, bold, italic, boldItalic] = await Promise.all([
    embed(sources.regular),
    sources.bold === undefined ? undefined : embed(sources.bold),
    sources.italic === undefined ? undefined : embed(sources.italic),
    sources.boldItalic === undefined ? undefined : embed(sources.boldItalic),
  ]);
  const faces: FontFamilyFaces = {
    regular,
    ...(bold === undefined ? {} : { bold }),
    ...(italic === undefined ? {} : { italic }),
    ...(boldItalic === undefined ? {} : { boldItalic }),
  };
  doc.registerFontFamily(name, faces);
  return faces;
}

/** Loads font sources, registers their families, and applies document-wide defaults. */
export async function configureFonts(doc: PdfDocument, configuration: FontConfiguration): Promise<ConfiguredFonts> {
  const registered: Record<string, FontFamilyFaces> = {};
  for (const [name, sources] of Object.entries(configuration.families ?? {})) {
    registered[name] = await embedFamily(doc, name, sources);
  }
  const defaultFont = configuration.default ?? Object.keys(registered)[0] ?? "Helvetica";
  const codeFont = configuration.code ?? defaultFont;
  const fallbacks = [...(configuration.fallbacks ?? [])];
  doc.setTextDefaults({ font: defaultFont, codeFont, fallbackFonts: fallbacks });
  return { default: defaultFont, code: codeFont, fallbacks, families: registered };
}
