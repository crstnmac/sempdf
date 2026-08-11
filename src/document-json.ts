/**
 * Declarative JSON → PDF.
 *
 * {@link renderDocumentJson} turns a single, fully serializable
 * {@link PdfDocumentJson} value into PDF bytes — no callbacks, no in-memory
 * font/image handles. It is a thin, self-contained layer over
 * {@link createDocument} and `renderTemplate` that closes the three parts of
 * the template API that cannot be expressed as JSON:
 *
 * 1. **Fonts** are declared once by source (base64 / file path / URL / Google
 *    Fonts) and referenced from blocks by name string.
 * 2. **Images** carry a `src` (base64 / path / URL) instead of raw bytes.
 * 3. **Headers/footers** are static block arrays with `{{pageNumber}}`,
 *    `{{pageCount}}`/`{{totalPages}}`, `{{title}}`, and `{{author}}` tokens
 *    interpolated per page, instead of callbacks.
 *
 * Everything else (blocks, styles, page, pageNumber, autoOutline) is already
 * JSON and passes straight through.
 */
import { createDocument, type PdfPage } from "./document.js";
import { PdfEngineError, PdfErrorCode } from "./errors.js";
import { loadGoogleFont, type LoadGoogleFontOptions } from "./google-fonts.js";
import type {
  BinaryData,
  DocumentConformanceProfile,
  DocumentEncryptionOptions,
  DocumentInfo,
  DocumentOptions,
  FlowImageOptions,
  ImageOptions,
  PageSize,
  PathStyle,
  ShapeStyle,
  TemplateAutoOutlineOptions,
  TemplateBlock,
  TemplateDocumentOptions,
  TemplateImageBlock,
  TemplatePageNumberOptions,
  TemplatePageOptions,
  TemplateRenderContext,
  TemplateStrictLayoutOptions,
  TemplateStylesheet,
  TextDefaults,
  TextOptions,
  XmpMetadataInput,
} from "./types.js";

/** Image block discriminators that carry binary data (see {@link TemplateImageBlock}). */
const IMAGE_TYPES = new Set(["png", "jpeg", "bmp", "jbig2", "tiff", "jp2", "webp", "gif", "svg"]);

/** A binary asset source. `path` and `url` require Node 18+/a fetch-capable runtime. */
export type JsonBinarySource =
  | { readonly base64: string }
  | { readonly path: string }
  | { readonly url: string };

/** A font face source. Adds Google Fonts loading on top of {@link JsonBinarySource}. */
export type JsonFontSource =
  | JsonBinarySource
  | { readonly google: { readonly family: string; readonly weight?: number; readonly italic?: boolean } };

/** A multi-weight font, each face loaded from its own source. */
export interface JsonFontFaces {
  readonly regular: JsonFontSource;
  readonly bold?: JsonFontSource;
  readonly italic?: JsonFontSource;
  readonly boldItalic?: JsonFontSource;
}

/** Declares a font family, referenced from block options by `name`. */
export interface JsonFontDeclaration {
  /** Family name used in block `options.font` and `defaultFont`. */
  readonly name: string;
  /** A single regular face, or a set of weighted faces. */
  readonly source: JsonFontSource | JsonFontFaces;
}

/** An image block expressed with a `src` instead of in-memory `data`. */
export interface JsonImageBlock {
  readonly type: "png" | "jpeg" | "bmp" | "jbig2" | "tiff" | "jp2" | "webp" | "gif" | "svg";
  readonly src: JsonBinarySource;
  readonly options?: FlowImageOptions;
  readonly class?: string | readonly string[];
  readonly keepWithNext?: boolean;
}

/**
 * Absolute placement for a block. When a block carries a `position`, it is drawn
 * at these PDF-point coordinates instead of flowing. Geometry and page routing
 * live here; the block's own fields carry its content and style.
 */
export interface BlockPosition {
  /** Left edge, in PDF points. */
  readonly x: number;
  /** Baseline/top depending on the block; in PDF points under `origin`. */
  readonly y: number;
  /** Box width in points. Required for `rect` and image blocks. */
  readonly width?: number;
  /** Box height in points. Required for `rect` and image blocks. */
  readonly height?: number;
  /** One-based page to draw on. Defaults to 1; pages are created as needed. */
  readonly page?: number;
  /** Coordinate origin. Defaults to "bottom-left". */
  readonly origin?: "bottom-left" | "top-left";
}

/**
 * A block in `blocks`: a flow template block (image blocks use `src`). Add a
 * {@link BlockPosition} to any positionable block (`paragraph`, an image, `rect`,
 * `textField`, `checkBox`, `signatureField`) to place it at absolute coordinates
 * instead of flowing.
 */
export type JsonBlock = (Exclude<TemplateBlock, TemplateImageBlock> | JsonImageBlock) & {
  readonly position?: BlockPosition;
};

/**
 * A complete, JSON-serializable description of a PDF document. Pass it to
 * {@link renderDocumentJson} to produce PDF bytes.
 */
export interface PdfDocumentJson {
  /** Document title (information dictionary, XMP, and display-title preference). */
  readonly title?: string;
  /** Information dictionary values. */
  readonly info?: DocumentInfo;
  /** XMP metadata packet or structured input. */
  readonly xmpMetadata?: XmpMetadataInput;
  /** BCP 47 language tag for the document. */
  readonly language?: string;
  /** Emit a tagged (accessible) structure tree. */
  readonly tagged?: boolean;
  /** Validate and emit a PDF/A or PDF/UA conformance profile. */
  readonly conformance?: DocumentConformanceProfile;
  /** Compress content streams. Defaults to the engine default. */
  readonly compress?: boolean;
  /** Password-encrypt the output. */
  readonly encryption?: DocumentEncryptionOptions;
  /** Default page size for pages that do not specify one. */
  readonly defaultPageSize?: PageSize;
  /** Fonts to load and register before rendering. */
  readonly fonts?: readonly JsonFontDeclaration[];
  /** Name of a declared font (or built-in font) used as the document default. */
  readonly defaultFont?: string;
  /** Document-wide text defaults. */
  readonly defaults?: TextDefaults;
  /** Page geometry and margins. */
  readonly page?: TemplatePageOptions;
  /** Reusable named styles. */
  readonly styles?: TemplateStylesheet;
  /** Automatic page numbering. */
  readonly pageNumber?: TemplatePageNumberOptions;
  /** Auto-generate a bookmarks tree from headings. */
  readonly autoOutline?: boolean | TemplateAutoOutlineOptions;
  /** Strict layout checks for fixed templates. */
  readonly strictLayout?: boolean | TemplateStrictLayoutOptions;
  /** Blocks rendered at the top of every page (page tokens interpolated). */
  readonly header?: readonly JsonBlock[];
  /** Blocks rendered at the bottom of every page (page tokens interpolated). */
  readonly footer?: readonly JsonBlock[];
  /**
   * Body blocks. Required and non-empty. A block flows by default, or is placed
   * at absolute coordinates when it carries an `x`/`x1`/`cx` anchor (see
   * {@link BlockPosition}).
   */
  readonly blocks: readonly JsonBlock[];
}

/* Validation --------------------------------------------------------------- */

function fail(message: string): never {
  throw new PdfEngineError(PdfErrorCode.INVALID_DOCUMENT_JSON, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function binarySourceKind(source: unknown): "base64" | "path" | "url" | undefined {
  if (!isObject(source)) return undefined;
  if (typeof source.base64 === "string") return "base64";
  if (typeof source.path === "string") return "path";
  if (typeof source.url === "string") return "url";
  return undefined;
}

function validate(json: unknown): asserts json is PdfDocumentJson {
  if (!isObject(json)) fail("Document JSON must be an object.");
  if (!Array.isArray(json.blocks) || json.blocks.length === 0) {
    fail("Document JSON requires a non-empty `blocks` array.");
  }
  for (const part of ["header", "footer"] as const) {
    if (json[part] !== undefined && !Array.isArray(json[part])) {
      fail(`\`${part}\` must be an array of blocks.`);
    }
  }
  if (json.fonts !== undefined) {
    if (!Array.isArray(json.fonts)) fail("`fonts` must be an array.");
    json.fonts.forEach((font, i) => {
      if (!isObject(font) || typeof font.name !== "string" || font.name.length === 0) {
        fail(`fonts[${i}] requires a non-empty \`name\`.`);
      }
      const source = font.source;
      const faces = isObject(source) && "regular" in source ? source : { regular: source };
      for (const [face, value] of Object.entries(faces)) {
        if (value === undefined) continue;
        if (!(isObject(value) && ("google" in value || binarySourceKind(value)))) {
          fail(`fonts[${i}].source.${face} must be a base64/path/url/google source.`);
        }
      }
    });
  }
}

/* Asset loading ------------------------------------------------------------ */

function decodeBase64(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(base64, "base64"));
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readPath(path: string): Promise<Uint8Array> {
  // Lazy import keeps the browser bundle free of node:fs unless a path is used.
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(path));
}

async function fetchUrl(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) fail(`Fetching ${url} failed with HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadBinarySourceAsync(source: JsonBinarySource): Promise<Uint8Array> {
  if ("base64" in source) return decodeBase64(source.base64);
  if ("path" in source) return readPath(source.path);
  return fetchUrl(source.url);
}

function loadBinarySourceSync(source: JsonBinarySource): Uint8Array {
  if ("base64" in source) return decodeBase64(source.base64);
  fail("renderDocumentJsonSync only supports inline `base64` sources; use renderDocumentJson for path/url.");
}

async function loadFontSourceAsync(source: JsonFontSource): Promise<Uint8Array> {
  if ("google" in source) {
    const options: LoadGoogleFontOptions = {};
    if (source.google.weight !== undefined) options.weight = source.google.weight;
    if (source.google.italic !== undefined) options.italic = source.google.italic;
    return loadGoogleFont(source.google.family, options);
  }
  return loadBinarySourceAsync(source);
}

function loadFontSourceSync(source: JsonFontSource): Uint8Array {
  if ("google" in source) {
    fail("renderDocumentJsonSync cannot load Google fonts; use renderDocumentJson.");
  }
  return loadBinarySourceSync(source);
}

/* Family registration ------------------------------------------------------ */

type FaceBytes = { regular: BinaryData; bold?: BinaryData; italic?: BinaryData; boldItalic?: BinaryData };

function asFaces(source: JsonFontSource | JsonFontFaces): JsonFontFaces {
  return isObject(source) && "regular" in source ? (source as JsonFontFaces) : { regular: source as JsonFontSource };
}

async function loadFacesAsync(faces: JsonFontFaces): Promise<FaceBytes> {
  const out: FaceBytes = { regular: await loadFontSourceAsync(faces.regular) };
  if (faces.bold) out.bold = await loadFontSourceAsync(faces.bold);
  if (faces.italic) out.italic = await loadFontSourceAsync(faces.italic);
  if (faces.boldItalic) out.boldItalic = await loadFontSourceAsync(faces.boldItalic);
  return out;
}

function loadFacesSync(faces: JsonFontFaces): FaceBytes {
  const out: FaceBytes = { regular: loadFontSourceSync(faces.regular) };
  if (faces.bold) out.bold = loadFontSourceSync(faces.bold);
  if (faces.italic) out.italic = loadFontSourceSync(faces.italic);
  if (faces.boldItalic) out.boldItalic = loadFontSourceSync(faces.boldItalic);
  return out;
}

/* Image resolution: walk the tree, replace `src` with loaded `data` --------- */

function isImageNode(node: Record<string, unknown>): boolean {
  return typeof node.type === "string" && IMAGE_TYPES.has(node.type) && node.src !== undefined && node.data === undefined;
}

async function resolveImagesAsync(node: unknown): Promise<void> {
  if (Array.isArray(node)) {
    for (const child of node) await resolveImagesAsync(child);
    return;
  }
  if (!isObject(node)) return;
  if (isImageNode(node)) {
    const kind = binarySourceKind(node.src);
    if (!kind) fail("Image `src` must be a base64/path/url source.");
    node.data = await loadBinarySourceAsync(node.src as JsonBinarySource);
    delete node.src;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "data" || ArrayBuffer.isView(value)) continue;
    await resolveImagesAsync(value);
  }
}

function resolveImagesSync(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) resolveImagesSync(child);
    return;
  }
  if (!isObject(node)) return;
  if (isImageNode(node)) {
    const kind = binarySourceKind(node.src);
    if (!kind) fail("Image `src` must be a base64/path/url source.");
    node.data = loadBinarySourceSync(node.src as JsonBinarySource);
    delete node.src;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "data" || ArrayBuffer.isView(value)) continue;
    resolveImagesSync(value);
  }
}

/* Header/footer token interpolation ---------------------------------------- */

function interpolate(blocks: readonly unknown[], ctx: TemplateRenderContext): readonly TemplateBlock[] {
  const tokens: Record<string, string> = {
    "{{pageNumber}}": String(ctx.pageNumber),
    "{{totalPages}}": String(ctx.totalPages),
    "{{pageCount}}": String(ctx.totalPages),
    "{{title}}": ctx.title ?? "",
    "{{author}}": ctx.author ?? "",
  };
  const apply = (text: string): string => {
    let out = text;
    for (const [token, value] of Object.entries(tokens)) out = out.split(token).join(value);
    return out;
  };
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isObject(node)) return;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === "string") node[key] = apply(value);
      else walk(value);
    }
  };
  const clone = structuredClone(blocks) as unknown[];
  walk(clone);
  return clone as readonly TemplateBlock[];
}

/* Positioned blocks: absolute coordinate placement ------------------------- */

type PdfDoc = ReturnType<typeof createDocument>;
type PositionedBlock = JsonBlock & { position: BlockPosition };

/** Maps a flow-block PathStyle onto the flat ShapeStyle that page.rect expects. */
function toShapeStyle(style: PathStyle | undefined): ShapeStyle | undefined {
  if (style === undefined) return undefined;
  const shape: ShapeStyle = {};
  if (style.fill?.color !== undefined) shape.fill = style.fill.color;
  if (style.stroke?.color !== undefined) shape.stroke = style.stroke.color;
  if (style.stroke?.width !== undefined) shape.lineWidth = style.stroke.width;
  if (style.stroke?.lineCap !== undefined) shape.lineCap = style.stroke.lineCap;
  if (style.stroke?.lineJoin !== undefined) shape.lineJoin = style.stroke.lineJoin;
  return shape;
}

/** A block is positioned when it carries a `position`. */
function isPositioned(block: JsonBlock): block is PositionedBlock {
  return isObject((block as { position?: unknown }).position);
}

/** Draws one positioned block at its absolute coordinates. Image bytes are pre-resolved. */
function drawPositionedBlock(page: PdfPage, block: PositionedBlock, imageBytes?: Uint8Array): void {
  const b = block as unknown as Record<string, unknown>;
  const pos = block.position;
  const type = b.type as string;
  const base = (b.options as Record<string, unknown> | undefined) ?? {};
  const withGeometry = (): Record<string, unknown> => {
    const o: Record<string, unknown> = { ...base, x: pos.x, y: pos.y };
    if (pos.width !== undefined) o.width = pos.width;
    if (pos.height !== undefined) o.height = pos.height;
    return o;
  };

  if (type === "paragraph") {
    // page.text is single-line; width/height in position are ignored.
    page.text(b.text as string, { ...base, x: pos.x, y: pos.y } as unknown as TextOptions);
    return;
  }
  if (IMAGE_TYPES.has(type)) {
    page.image(imageBytes as Uint8Array, withGeometry() as unknown as ImageOptions);
    return;
  }
  if (type === "rect") {
    // The flow rect block uses PathStyle; page.rect takes ShapeStyle.
    page.rect(pos.x, pos.y, b.width as number, b.height as number, toShapeStyle(b.style as PathStyle | undefined));
    return;
  }
  if (type === "textField" || type === "checkBox" || type === "signatureField") {
    const methods = page as unknown as Record<string, (name: string, options: unknown) => void>;
    methods[type]!.call(page, b.name as string, withGeometry());
    return;
  }
  fail(`Blocks of type "${type}" cannot be positioned; remove \`position\` or use a flow block.`);
}

/** Adds blank pages until the document has enough for every positioned block. */
function ensurePagesFor(pdf: PdfDoc, positioned: readonly PositionedBlock[], doc: PdfDocumentJson): void {
  const needed = positioned.reduce((max, block) => Math.max(max, block.position.page ?? 1), 0);
  while (pdf.pageCount < needed) {
    pdf.addPage(doc.page?.size !== undefined ? { size: doc.page.size } : {});
  }
}

async function placeBlocksAsync(pdf: PdfDoc, positioned: readonly PositionedBlock[], doc: PdfDocumentJson): Promise<void> {
  if (positioned.length === 0) return;
  ensurePagesFor(pdf, positioned, doc);
  for (const block of positioned) {
    const pos = block.position;
    const page = pdf.getPage((pos.page ?? 1) - 1, pos.origin ?? "bottom-left");
    const b = block as unknown as Record<string, unknown>;
    const bytes = IMAGE_TYPES.has(b.type as string)
      ? await loadBinarySourceAsync(b.src as JsonBinarySource)
      : undefined;
    drawPositionedBlock(page, block, bytes);
  }
}

function placeBlocksSync(pdf: PdfDoc, positioned: readonly PositionedBlock[], doc: PdfDocumentJson): void {
  if (positioned.length === 0) return;
  ensurePagesFor(pdf, positioned, doc);
  for (const block of positioned) {
    const pos = block.position;
    const page = pdf.getPage((pos.page ?? 1) - 1, pos.origin ?? "bottom-left");
    const b = block as unknown as Record<string, unknown>;
    const bytes = IMAGE_TYPES.has(b.type as string) ? loadBinarySourceSync(b.src as JsonBinarySource) : undefined;
    drawPositionedBlock(page, block, bytes);
  }
}

/* Assembly ----------------------------------------------------------------- */

function toDocumentOptions(json: PdfDocumentJson): DocumentOptions {
  const options: DocumentOptions = {};
  if (json.title !== undefined) options.title = json.title;
  if (json.info !== undefined) options.info = json.info;
  if (json.xmpMetadata !== undefined) options.xmpMetadata = json.xmpMetadata;
  if (json.language !== undefined) options.language = json.language;
  if (json.tagged !== undefined) options.tagged = json.tagged;
  if (json.conformance !== undefined) options.conformance = json.conformance;
  if (json.compress !== undefined) options.compress = json.compress;
  if (json.encryption !== undefined) options.encryption = json.encryption;
  if (json.defaultPageSize !== undefined) options.defaultPageSize = json.defaultPageSize;
  const defaults: TextDefaults = { ...(json.defaults ?? {}) };
  if (json.defaultFont !== undefined) defaults.font = json.defaultFont;
  if (Object.keys(defaults).length > 0) options.defaults = defaults;
  return options;
}

function toTemplateOptions(
  json: PdfDocumentJson,
  blocks: readonly TemplateBlock[],
  header: readonly unknown[] | undefined,
  footer: readonly unknown[] | undefined,
): TemplateDocumentOptions {
  const template: { -readonly [K in keyof TemplateDocumentOptions]: TemplateDocumentOptions[K] } = { blocks };
  if (json.page !== undefined) template.page = json.page;
  if (json.styles !== undefined) template.styles = json.styles;
  if (json.pageNumber !== undefined) template.pageNumber = json.pageNumber;
  if (json.autoOutline !== undefined) template.autoOutline = json.autoOutline;
  if (json.strictLayout !== undefined) template.strictLayout = json.strictLayout;
  if (header !== undefined) template.header = (ctx) => interpolate(header, ctx);
  if (footer !== undefined) template.footer = (ctx) => interpolate(footer, ctx);
  return template;
}

/* Public API --------------------------------------------------------------- */

/**
 * Renders a {@link PdfDocumentJson} to PDF bytes. Asynchronous because fonts and
 * images may be loaded from the filesystem, a URL, or Google Fonts.
 *
 * @param json The declarative document description.
 *
 * @returns The serialized PDF as a `Uint8Array`.
 */
export async function renderDocumentJson(json: PdfDocumentJson): Promise<Uint8Array> {
  validate(json);
  // Clone so the caller's input is never mutated by asset resolution.
  const doc = structuredClone(json) as PdfDocumentJson;

  const pdf = createDocument(toDocumentOptions(doc));
  for (const font of doc.fonts ?? []) {
    pdf.registerFontFamily(font.name, await loadFacesAsync(asFaces(font.source)));
  }

  const flowBlocks = doc.blocks.filter((block) => !isPositioned(block));
  const positioned = doc.blocks.filter(isPositioned);
  if (flowBlocks.length > 0) {
    await resolveImagesAsync(flowBlocks);
    if (doc.header) await resolveImagesAsync(doc.header);
    if (doc.footer) await resolveImagesAsync(doc.footer);
    const blocks = flowBlocks as unknown as readonly TemplateBlock[];
    pdf.renderTemplate(toTemplateOptions(doc, blocks, doc.header, doc.footer));
  }

  await placeBlocksAsync(pdf, positioned, doc);
  return pdf.toUint8Array();
}

/**
 * Synchronous variant of {@link renderDocumentJson}. Only inline `base64` font
 * and image sources are supported — `path`, `url`, and `google` sources throw,
 * because they require asynchronous loading.
 *
 * @param json The declarative document description (inline assets only).
 *
 * @returns The serialized PDF as a `Uint8Array`.
 */
export function renderDocumentJsonSync(json: PdfDocumentJson): Uint8Array {
  validate(json);
  const doc = structuredClone(json) as PdfDocumentJson;

  const pdf = createDocument(toDocumentOptions(doc));
  for (const font of doc.fonts ?? []) {
    pdf.registerFontFamily(font.name, loadFacesSync(asFaces(font.source)));
  }

  const flowBlocks = doc.blocks.filter((block) => !isPositioned(block));
  const positioned = doc.blocks.filter(isPositioned);
  if (flowBlocks.length > 0) {
    resolveImagesSync(flowBlocks);
    if (doc.header) resolveImagesSync(doc.header);
    if (doc.footer) resolveImagesSync(doc.footer);
    const blocks = flowBlocks as unknown as readonly TemplateBlock[];
    pdf.renderTemplate(toTemplateOptions(doc, blocks, doc.header, doc.footer));
  }

  placeBlocksSync(pdf, positioned, doc);
  return pdf.toUint8Array();
}
