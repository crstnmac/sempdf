import type { PdfDocument } from "./document.js";

/**
 * Family names registered by {@link registerBundledFonts}, ready to pass as the
 * `font` option. Each resolves bold/italic/boldItalic by flag.
 */
export interface BundledFonts {
  /** Liberation Sans — metric-compatible with Helvetica / Arial. */
  sans: string;
  /** Liberation Serif — metric-compatible with Times / Times New Roman. */
  serif: string;
  /** Liberation Mono — metric-compatible with Courier / Courier New. */
  mono: string;
}

/** A reader that returns the bytes for a bundled font file by base name. */
export type FontByteReader = (file: string) => Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>;

export interface RegisterBundledFontsOptions {
  /**
   * Custom byte source for the font files (keyed by the `.ttf` base names under
   * `fonts/liberation/`). Supply this in the browser, where the default
   * filesystem reader is unavailable. Defaults to reading the bundled files
   * from disk via `node:fs`.
   */
  read?: FontByteReader | undefined;
}

const FAMILIES = {
  sans: {
    name: "Liberation Sans",
    regular: "LiberationSans-Regular.ttf",
    bold: "LiberationSans-Bold.ttf",
    italic: "LiberationSans-Italic.ttf",
    boldItalic: "LiberationSans-BoldItalic.ttf",
  },
  serif: {
    name: "Liberation Serif",
    regular: "LiberationSerif-Regular.ttf",
    bold: "LiberationSerif-Bold.ttf",
    italic: "LiberationSerif-Italic.ttf",
    boldItalic: "LiberationSerif-BoldItalic.ttf",
  },
  mono: {
    name: "Liberation Mono",
    regular: "LiberationMono-Regular.ttf",
    bold: "LiberationMono-Bold.ttf",
    italic: "LiberationMono-Italic.ttf",
    boldItalic: "LiberationMono-BoldItalic.ttf",
  },
} as const;

/** Default Node reader: loads bundled `.ttf` files from `fonts/liberation/`. */
async function defaultReader(): Promise<FontByteReader> {
  let readFile: (path: URL) => Promise<Uint8Array>;
  try {
    ({ readFile } = await import("node:fs/promises"));
  } catch {
    throw new Error(
      "registerBundledFonts: no filesystem available. In the browser, pass `read` to supply the font bytes (e.g. via fetch).",
    );
  }
  // dist/src/bundled-fonts.js → package root → fonts/liberation/
  const dir = new URL("../../fonts/liberation/", import.meta.url);
  return async (file: string) => {
    try {
      return await readFile(new URL(file, dir));
    } catch {
      throw new Error(
        `registerBundledFonts: bundled font "${file}" was not found. If you installed this package from npm, this is a packaging defect — please report it. In a source checkout, run \`npm run fetch-fonts\` to download the Liberation fonts.`,
      );
    }
  };
}

/**
 * Registers the bundled Liberation font families (Sans/Serif/Mono) on `doc` and
 * returns their names. These OFL fonts are metric-compatible with the PDF
 * Standard-14 fonts, so embedding them yields PDF/A- and PDF/UA-compliant output
 * (which forbids the non-embedded built-ins) without changing layout.
 *
 * @example
 * ```ts
 * const fonts = await registerBundledFonts(doc);
 * page.text("Accessible heading", { x: 56, y: 760, font: fonts.sans, bold: true });
 * ```
 *
 * In the browser, supply `read` to provide the bytes (the on-disk default needs
 * `node:fs`):
 * ```ts
 * await registerBundledFonts(doc, {
 *   read: (file) => fetch(`/fonts/${file}`).then((r) => r.arrayBuffer()),
 * });
 * ```
 */
export async function registerBundledFonts(
  doc: PdfDocument,
  options: RegisterBundledFontsOptions = {},
): Promise<BundledFonts> {
  const read = options.read ?? (await defaultReader());
  const load = async (file: string) => {
    const bytes = await read(file);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  };

  const result = {} as BundledFonts;
  for (const key of ["sans", "serif", "mono"] as const) {
    const family = FAMILIES[key];
    const [regular, bold, italic, boldItalic] = await Promise.all([
      load(family.regular),
      load(family.bold),
      load(family.italic),
      load(family.boldItalic),
    ]);
    doc.registerFontFamily(family.name, { regular, bold, italic, boldItalic });
    result[key] = family.name;
  }
  return result;
}
