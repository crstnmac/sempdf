import ts from "typescript";
import * as zeropdf from "../index.js";
import * as zeropdfFonts from "@crstnmac/zeropdf-fonts";

interface RenderRequest { mode: "html" | "typescript" | "json"; source: string }
type RenderResponse = { ok: true; bytes: ArrayBuffer; durationMs: number } | { ok: false; error: string };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const startedAt = performance.now();
  try {
    if (new TextEncoder().encode(event.data.source).byteLength > 64 * 1024) {
      throw new Error("Playground source is limited to 64 KB.");
    }
    const transpiled = ts.transpileModule(event.data.source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      reportDiagnostics: true,
    });
    const syntaxError = transpiled.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    if (syntaxError) throw new Error(ts.flattenDiagnosticMessageText(syntaxError.messageText, "\n"));

    const requireModule = (name: unknown) => {
      if (name === "@crstnmac/zeropdf") return zeropdf;
      if (name === "@crstnmac/zeropdf-fonts") return zeropdfFonts;
      throw new Error(`Module ${String(name)} is not available in the playground.`);
    };
    const module = { exports: {} as Record<string, unknown> };
    const execute = new AsyncFunction("exports", "require", "module", `${transpiled.outputText}\nreturn typeof bytes === "undefined" ? undefined : bytes;`);
    const output = await execute(module.exports, requireModule, module);
    if (!(output instanceof Uint8Array)) throw new Error("TypeScript mode must assign the generated Uint8Array to `bytes`.");
    if (output.byteLength > 5 * 1024 * 1024) throw new Error("Rendered PDFs are limited to 5 MB.");
    const bytes = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    const response: RenderResponse = { ok: true, bytes, durationMs: Math.round(performance.now() - startedAt) };
    self.postMessage(response, { transfer: [bytes] });
  } catch (error) {
    const response: RenderResponse = { ok: false, error: error instanceof Error ? error.message : "TypeScript execution failed." };
    self.postMessage(response);
  }
};
