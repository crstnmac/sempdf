import type { editor } from "monaco-editor";

const color = {
  description: "A named PDF color, hex color, or supported color value.",
  type: "string",
  examples: ["black", "teal", "#2563eb"],
} as const;

const textOptions = {
  type: "object",
  additionalProperties: true,
  properties: {
    font: { type: "string", description: "Registered or built-in font name." },
    fontSize: { type: "number", minimum: 0, description: "Font size in PDF points." },
    color,
    align: { enum: ["left", "center", "right", "justify"] },
    lineHeight: { type: "number", minimum: 0 },
    bold: { type: "boolean" },
    italic: { type: "boolean" },
    underline: { type: "boolean" },
    tag: { type: "string", description: "Tagged-PDF structure role, or Artifact." },
    marginTop: { type: "number" },
    marginRight: { type: "number" },
    marginBottom: { type: "number" },
    marginLeft: { type: "number" },
  },
} as const;

const commonBlockProperties = {
  class: {
    oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    description: "One or more names from the document stylesheet.",
  },
  keepWithNext: { type: "boolean", description: "Try to keep this block with the following block." },
  position: {
    type: "object",
    required: ["x", "y"],
    properties: {
      x: { type: "number" }, y: { type: "number" }, width: { type: "number", minimum: 0 },
      height: { type: "number", minimum: 0 }, page: { type: "integer", minimum: 1 },
      origin: { enum: ["bottom-left", "top-left"] },
    },
  },
} as const;

function block(type: string, properties: Record<string, unknown> = {}, required: string[] = []) {
  return {
    type: "object",
    required: ["type", ...required],
    additionalProperties: true,
    properties: {
      type: { const: type },
      ...commonBlockProperties,
      ...properties,
    },
  };
}

const blockSchema = {
  oneOf: [
    block("heading", { text: { type: "string" }, options: { ...textOptions, properties: { ...textOptions.properties, level: { type: "integer", minimum: 1, maximum: 6 } } } }, ["text"]),
    block("paragraph", { text: { type: "string" }, options: textOptions }, ["text"]),
    block("richParagraph", {
      runs: { type: "array", items: { type: "object", required: ["text"], properties: { text: { type: "string" }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, color, font: { type: "string" }, fontSize: { type: "number" }, url: { type: "string" } } } },
      options: textOptions,
    }, ["runs"]),
    block("code", { code: { type: "string" }, language: { type: "string" }, options: textOptions }, ["code"]),
    block("html", { html: { type: "string" }, options: { type: "object" } }, ["html"]),
    block("list", { items: { type: "array", items: { oneOf: [{ type: "string" }, { type: "object" }] } }, options: { type: "object", additionalProperties: true, properties: { ordered: { type: "boolean" }, bullet: { type: "string" }, indent: { type: "number" }, ...textOptions.properties } } }, ["items"]),
    block("table", {
      rows: {
        type: "array",
        items: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              { type: "object", properties: { text: { type: "string" }, header: { type: "boolean" }, colSpan: { type: "integer", minimum: 1 }, rowSpan: { type: "integer", minimum: 1 } } },
            ],
          },
        },
      },
      options: { type: "object", additionalProperties: true, properties: { headerRows: { type: "integer", minimum: 0 }, widths: { type: "array", items: { type: "number" } }, borderWidth: { type: "number" }, borderColor: color, padding: { type: "number" } } },
    }, ["rows"]),
    ...["png", "jpeg", "bmp", "jbig2", "tiff", "jp2", "webp", "gif", "svg"].map((type) => block(type, { src: { type: "object", properties: { base64: { type: "string" } } }, options: { type: "object", additionalProperties: true, properties: { width: { type: "number" }, height: { type: "number" }, fit: { enum: ["contain", "cover", "fill"] }, align: { enum: ["left", "center", "right"] }, alt: { type: "string" } } } }, ["src"])),
    block("link", { text: { type: "string" }, url: { type: "string" }, options: textOptions }, ["text", "url"]),
    block("section", { role: { type: "string" }, blocks: { type: "array", items: { $ref: "#/definitions/block" } } }, ["blocks"]),
    block("pageBreak"),
    block("toc", { options: { type: "object", properties: { maxLevel: { type: "integer", minimum: 1, maximum: 6 }, numbering: { type: "boolean" }, link: { type: "boolean" }, pageNumbers: { type: "boolean" }, leader: { enum: ["dots", "line", "none"] } } } }),
    block("crossRef", { to: { type: "string" }, text: { type: "string" } }, ["to"]),
    block("rect", { width: { type: "number" }, height: { type: "number" }, style: { type: "object", additionalProperties: true, properties: { paint: { enum: ["fill", "stroke", "fillStroke"] }, fill: { type: "object", properties: { color } }, stroke: { type: "object", properties: { color, width: { type: "number" } } } } } }, ["width", "height", "style"]),
    ...["textField", "checkBox", "choiceField", "radioGroup", "pushButton", "signatureField"].map((type) => block(type, { name: { type: "string" }, options: { type: "object", additionalProperties: true } }, ["name"])),
  ],
} as const;

export const playgroundDiagnostics: editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: 12.6,
  lineHeight: 22,
  minimap: { enabled: false },
  padding: { top: 18, bottom: 80 },
  scrollBeyondLastLine: false,
  tabSize: 2,
  insertSpaces: true,
  formatOnPaste: true,
  quickSuggestions: { other: true, comments: false, strings: true },
  suggestOnTriggerCharacters: true,
  wordBasedSuggestions: "off",
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  folding: true,
  renderValidationDecorations: "on",
  ariaLabel: "Document JSON source editor",
};

export interface PlaygroundJsonSchema extends Record<string, unknown> {
  readonly $id: string;
}

export const playgroundJsonSchema: PlaygroundJsonSchema = {
  $id: "https://sempdf.dev/schemas/playground-document.json",
  type: "object",
  required: ["blocks"],
  additionalProperties: false,
  definitions: { block: blockSchema },
  properties: {
    title: { type: "string", description: "Document title used in metadata and display preferences." },
    info: { type: "object", additionalProperties: true, properties: { author: { type: "string" }, subject: { type: "string" }, keywords: { type: "array", items: { type: "string" } }, creator: { type: "string" }, producer: { type: "string" } } },
    xmpMetadata: { oneOf: [{ type: "string" }, { type: "object" }] },
    language: { type: "string", description: "BCP 47 document language, for example en-US." },
    tagged: { type: "boolean", description: "Emit an accessible tagged-PDF structure tree." },
    conformance: { type: "string", enum: ["pdfa-1b", "pdfa-2b", "pdfa-3b", "pdfa-4", "pdfua-1", "pdfua-2", "wtpdf"] },
    compress: { type: "boolean" },
    encryption: { type: "object", required: ["ownerPassword"], properties: { algorithm: { enum: ["rc4-40", "rc4-128", "aes-128", "aes-256", "aes-256-r6"] }, ownerPassword: { type: "string" }, userPassword: { type: "string" }, permissions: { type: "object", additionalProperties: { type: "boolean" } } } },
    defaultPageSize: { oneOf: [{ enum: ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "B0", "B1", "B2", "B3", "B4", "B5", "B6", "C4", "C5", "C6", "Letter", "Legal", "Tabloid", "Ledger", "Executive", "Statement", "Folio", "Quarto", "Envelope10", "EnvelopeDL", "EnvelopeC5", "EnvelopeC6", "EnvelopeMonarch"] }, { type: "object", required: ["width", "height"], properties: { width: { type: "number" }, height: { type: "number" } } }] },
    defaultFont: { type: "string" },
    defaults: textOptions,
    page: { type: "object", additionalProperties: true, properties: { size: { oneOf: [{ type: "string" }, { type: "object", properties: { width: { type: "number" }, height: { type: "number" } } }] }, margin: { oneOf: [{ type: "number" }, { type: "object" }] }, orientation: { enum: ["portrait", "landscape"] }, headerHeight: { type: "number" }, footerHeight: { type: "number" }, columns: { type: "integer", minimum: 1 }, columnGap: { type: "number" } } },
    styles: { type: "object", additionalProperties: textOptions },
    pageNumber: { type: "object", properties: { position: { enum: ["header", "footer"] }, align: { enum: ["left", "center", "right"] }, format: { type: "string" }, start: { type: "integer" } } },
    autoOutline: { oneOf: [{ type: "boolean" }, { type: "object", properties: { maxLevel: { type: "integer", minimum: 1, maximum: 6 }, open: { type: "boolean" } } }] },
    strictLayout: { oneOf: [{ type: "boolean" }, { type: "object" }] },
    fonts: { type: "array", items: { type: "object", required: ["name", "source"], properties: { name: { type: "string" }, source: { type: "object", properties: { base64: { type: "string" } } } } } },
    header: { type: "array", items: { $ref: "#/definitions/block" } },
    footer: { type: "array", items: { $ref: "#/definitions/block" } },
    blocks: { type: "array", minItems: 1, items: { $ref: "#/definitions/block" } },
  },
};
