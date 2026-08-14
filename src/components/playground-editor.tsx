import Editor, { type BeforeMount } from "@monaco-editor/react";
import { playgroundDiagnostics, playgroundJsonSchema } from "@/lib/playground-schema";

interface PlaygroundEditorProps {
  mode: "html" | "typescript" | "json";
  value: string;
  onChange: (value: string) => void;
}

const typeDeclarations = `declare module "@crstnmac/zeropdf" {
  export interface PageOptions { size?: PageSize; width?: number; height?: number; }
  export interface PositionedTextOptions extends TextOptions { x: number; y: number; }
  export class PdfPage {
    text(value: string, options: PositionedTextOptions): this;
    textBlock(value: string, options: PositionedTextOptions & { width: number; height?: number }): this;
    line(x1: number, y1: number, x2: number, y2: number, options?: Record<string, unknown>): this;
    rect(x: number, y: number, width: number, height: number, options?: Record<string, unknown>): this;
    circle(cx: number, cy: number, radius: number, options?: Record<string, unknown>): this;
  }
  export class PdfDocument {
    addPage(options?: PageOptions): PdfPage;
    renderTemplate(options: { page?: Record<string, unknown>; blocks: readonly DocumentBlock[]; styles?: Record<string, TextOptions>; autoOutline?: boolean | Record<string, unknown> }): void;
    addOutline(title: string, page: PdfPage): { addChild(title: string, page: PdfPage): unknown };
    toUint8Array(): Uint8Array;
  }
  export function createDocument(options?: { language?: string; tagged?: boolean; compress?: boolean; defaultPageSize?: PageSize; info?: Record<string, unknown> }): PdfDocument;
  export function htmlToBlocks(html: string, options?: Record<string, unknown>): DocumentBlock[];
  export function renderDocumentJson(document: PdfDocumentJson, options?: { fonts?: unknown }): Promise<Uint8Array>;
  export function hex(value: string): string;
  export function rgb(red: number, green: number, blue: number): unknown;
  export function gray(value: number): unknown;
  export function cmyk(cyan: number, magenta: number, yellow: number, black: number): unknown;
  export type PageSize = "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "Letter" | "Legal" | "Tabloid" | { width: number; height: number };
  export interface TextOptions { font?: string; fontSize?: number; color?: string; align?: "left" | "center" | "right" | "justify"; lineHeight?: number; bold?: boolean; italic?: boolean; underline?: boolean; marginTop?: number; marginRight?: number; marginBottom?: number; marginLeft?: number; tag?: string; }
  export type DocumentBlock =
    | { type: "heading"; text: string; options?: TextOptions & { level?: 1 | 2 | 3 | 4 | 5 | 6 }; class?: string | readonly string[]; keepWithNext?: boolean }
    | { type: "paragraph"; text: string; options?: TextOptions; class?: string | readonly string[]; keepWithNext?: boolean }
    | { type: "richParagraph"; runs: readonly { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; font?: string; fontSize?: number; url?: string }[]; options?: TextOptions }
    | { type: "code"; code: string; language?: string; options?: TextOptions }
    | { type: "html"; html: string; options?: Record<string, unknown> }
    | { type: "list"; items: readonly (string | Record<string, unknown>)[]; options?: TextOptions & { ordered?: boolean; bullet?: string; indent?: number } }
    | { type: "table"; rows: readonly (readonly (string | { text: string; header?: boolean; colSpan?: number; rowSpan?: number })[])[]; options?: Record<string, unknown> }
    | { type: "link"; text: string; url: string; options?: TextOptions }
    | { type: "section"; role?: string; blocks: readonly DocumentBlock[] }
    | { type: "pageBreak" }
    | { type: "toc"; options?: { maxLevel?: 1 | 2 | 3 | 4 | 5 | 6; numbering?: boolean; link?: boolean; pageNumbers?: boolean; leader?: "dots" | "line" | "none" } }
    | { type: "crossRef"; to: string; text?: string }
    | { type: "rect"; width: number; height: number; style: Record<string, unknown> }
    | { type: "png" | "jpeg" | "bmp" | "jbig2" | "tiff" | "jp2" | "webp" | "gif" | "svg"; src: { base64: string }; options?: Record<string, unknown> };
  export interface PdfDocumentJson { title?: string; info?: { author?: string; subject?: string; keywords?: readonly string[]; creator?: string; producer?: string }; language?: string; tagged?: boolean; conformance?: "pdfa-1b" | "pdfa-2b" | "pdfa-3b" | "pdfa-4" | "pdfua-1" | "pdfua-2" | "wtpdf"; compress?: boolean; defaultPageSize?: PageSize; defaultFont?: string; defaults?: TextOptions; page?: { size?: PageSize; margin?: number | Record<string, number>; orientation?: "portrait" | "landscape"; headerHeight?: number; footerHeight?: number; columns?: number; columnGap?: number }; styles?: Record<string, TextOptions>; autoOutline?: boolean | { maxLevel?: number; open?: boolean }; header?: readonly DocumentBlock[]; footer?: readonly DocumentBlock[]; blocks: readonly DocumentBlock[]; }
}
declare module "@crstnmac/zeropdf-fonts" {
  export const liberation: unknown;
}`;

const configureLanguages: BeforeMount = (instance) => {
  instance.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    enableSchemaRequest: false,
    schemas: [{ uri: playgroundJsonSchema.$id, fileMatch: ["inmemory://model/document.json"], schema: playgroundJsonSchema }],
  });
  instance.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: instance.languages.typescript.ScriptTarget.ES2022,
    module: instance.languages.typescript.ModuleKind.ESNext,
    moduleResolution: instance.languages.typescript.ModuleResolutionKind.NodeJs,
    strict: true,
    noEmit: true,
  });
  instance.languages.typescript.typescriptDefaults.addExtraLib(typeDeclarations, "inmemory://model/zeropdf.d.ts");
};

export default function PlaygroundEditor({ mode, value, onChange }: PlaygroundEditorProps) {
  return (
    <Editor
      beforeMount={configureLanguages}
      language="typescript"
      path={`inmemory://model/${mode === "html" ? "html-to-pdf" : mode === "json" ? "json-to-pdf" : "document"}.ts`}
      value={value}
      onChange={(next) => onChange(next ?? "")}
      options={playgroundDiagnostics}
      theme="vs-dark"
      loading={<div className="playground-editor-loading">Loading editor…</div>}
    />
  );
}
