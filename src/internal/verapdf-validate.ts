import type { DocumentConformanceProfile, PdfComplianceIssue } from "../types.js";

/**
 * Options for {@link validateWithVeraPdf}.
 *
 * The adapter is an *optional peer integration*: it shells out to a veraPDF
 * executable when one is available, and otherwise returns the supplied custom
 * checker results. It never bundles veraPDF and pulls no extra dependencies.
 */
export interface VeraPdfValidateOptions {
  /**
   * The intended conformance profile. Used to pick a veraPDF flavour when one
   * is not given explicitly. When omitted, veraPDF auto-detects from the file.
   */
  conformance?: DocumentConformanceProfile | undefined;
  /**
   * Explicit veraPDF flavour string (e.g. `"1b"`, `"2b"`, `"ua1"`). Overrides
   * the value derived from {@link conformance}.
   */
  flavour?: string | undefined;
  /**
   * Path to the veraPDF executable. Defaults to the `VERAPDF_BIN` environment
   * variable, then `"verapdf"` on the `PATH`.
   */
  verapdfBin?: string | undefined;
  /**
   * Issues from the built-in checker (e.g. `doc.validateCompliance()`). Returned
   * as-is when veraPDF is not available so callers always get a useful result.
   */
  fallbackIssues?: readonly PdfComplianceIssue[] | undefined;
  /** Maximum time to wait for veraPDF, in milliseconds. Defaults to 60000. */
  timeoutMs?: number | undefined;
}

/** Result of {@link validateWithVeraPdf}. */
export interface VeraPdfValidateResult {
  /** Which checker produced {@link issues}. */
  readonly source: "verapdf" | "custom";
  /** Whether a veraPDF executable was found and ran successfully. */
  readonly available: boolean;
  /**
   * Whether the document is compliant. `true`/`false` when veraPDF ran;
   * `undefined` for the custom fallback, which cannot prove conformance.
   */
  readonly compliant: boolean | undefined;
  /** The veraPDF flavour that was used, when known. */
  readonly flavour?: string | undefined;
  /** Compliance issues, normalized to {@link PdfComplianceIssue}. */
  readonly issues: readonly PdfComplianceIssue[];
  /** Raw parsed veraPDF JSON report, when veraPDF ran. */
  readonly raw?: unknown;
}

const FLAVOUR_BY_PROFILE: Record<DocumentConformanceProfile, string | undefined> = {
  "pdfa-1b": "1b",
  "pdfa-2b": "2b",
  "pdfa-3b": "3b",
  "pdfa-4": "4",
  "pdfua-1": "ua1",
  "pdfua-2": "ua2",
  // No dedicated veraPDF flavour; let veraPDF auto-detect.
  wtpdf: undefined,
};

function resolveFlavour(options: VeraPdfValidateOptions): string | undefined {
  if (options.flavour !== undefined) return options.flavour;
  if (options.conformance !== undefined) return FLAVOUR_BY_PROFILE[options.conformance];
  return undefined;
}

function customFallback(
  options: VeraPdfValidateOptions,
  available: boolean,
): VeraPdfValidateResult {
  return {
    source: "custom",
    available,
    compliant: undefined,
    ...(resolveFlavour(options) !== undefined ? { flavour: resolveFlavour(options) } : {}),
    issues: options.fallbackIssues ?? [],
  };
}

/**
 * Validates PDF bytes with veraPDF when it is installed, falling back to the
 * supplied custom checker issues otherwise.
 *
 * veraPDF is detected at call time by attempting to spawn its executable. If it
 * is missing (`ENOENT`) the result has `source: "custom"` and
 * `available: false`. This function only runs under Node — it lazily imports
 * `node:*` modules so browser bundles never reach this code.
 *
 * @param bytes The serialized PDF document (e.g. `doc.toUint8Array()`).
 * @param options Flavour selection, executable path, and fallback issues.
 * @returns The validation result, drawn from veraPDF or the custom checker.
 */
export async function validateWithVeraPdf(
  bytes: Uint8Array,
  options: VeraPdfValidateOptions = {},
): Promise<VeraPdfValidateResult> {
  // Lazy, Node-only imports keep this module browser-safe.
  const [{ spawn }, { mkdtemp, writeFile, rm }, { tmpdir }, { join }] = await Promise.all([
    import("node:child_process"),
    import("node:fs/promises"),
    import("node:os"),
    import("node:path"),
  ]);

  const bin =
    options.verapdfBin ??
    (typeof process !== "undefined" ? process.env?.VERAPDF_BIN : undefined) ??
    "verapdf";
  const flavour = resolveFlavour(options);
  const timeoutMs = options.timeoutMs ?? 60000;

  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "verapdf-"));
    const pdfPath = join(dir, "input.pdf");
    await writeFile(pdfPath, bytes);

    const args = ["--format", "json"];
    if (flavour !== undefined) args.push("--flavour", flavour);
    args.push(pdfPath);

    const report = await runVeraPdf(spawn, bin, args, timeoutMs);
    if (report === undefined) {
      // Executable missing — fall back to the custom checker.
      return customFallback(options, false);
    }

    const { compliant, issues } = parseVeraPdfReport(report);
    return {
      source: "verapdf",
      available: true,
      compliant,
      ...(flavour !== undefined ? { flavour } : {}),
      issues,
      raw: report,
    };
  } finally {
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

type SpawnFn = typeof import("node:child_process").spawn;

/**
 * Runs veraPDF and returns the parsed JSON report, or `undefined` when the
 * executable cannot be found. Non-zero exit codes are expected (veraPDF exits
 * non-zero on validation failure) and still yield a report.
 */
async function runVeraPdf(
  spawn: SpawnFn,
  bin: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args as string[], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`veraPDF timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        resolve(undefined);
        return;
      }
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const text = stdout.trim();
      if (text === "") {
        reject(new Error(`veraPDF produced no output. stderr: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error(`Unable to parse veraPDF JSON output. stderr: ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Extracts the compliant flag and failed-rule issues from a veraPDF JSON
 * report. Parsing is defensive: veraPDF's schema has shifted across releases,
 * so every level is accessed optionally and unknown shapes degrade gracefully.
 */
export function parseVeraPdfReport(report: unknown): {
  compliant: boolean | undefined;
  issues: PdfComplianceIssue[];
} {
  const issues: PdfComplianceIssue[] = [];
  const validationResults = findValidationResults(report);

  if (validationResults.length === 0) {
    return { compliant: undefined, issues };
  }

  let compliant = true;
  for (const result of validationResults) {
    const r = result as Record<string, unknown>;
    if (r.compliant === false) compliant = false;

    const details = r.details as Record<string, unknown> | undefined;
    const ruleSummaries = Array.isArray(details?.ruleSummaries) ? details.ruleSummaries : [];
    for (const summary of ruleSummaries) {
      const s = summary as Record<string, unknown>;
      if (s.ruleStatus !== undefined && s.ruleStatus !== "FAILED") continue;
      const clause = typeof s.clause === "string" ? s.clause : "?";
      const testNumber =
        typeof s.testNumber === "string" || typeof s.testNumber === "number"
          ? `-${s.testNumber}`
          : "";
      let description = "veraPDF rule failed.";
      if (typeof s.description === "string" && s.description !== "") {
        description = s.description;
      } else if (typeof s.message === "string") {
        description = s.message;
      }
      issues.push({
        code: `VERAPDF_${clause}${testNumber}`.replaceAll(/\W/g, "_"),
        severity: "error",
        message: description,
      });
    }
  }

  return { compliant, issues };
}

/** Walks the veraPDF report tree to collect every `validationResult` entry. */
function findValidationResults(report: unknown): unknown[] {
  const root = report as Record<string, unknown> | undefined;
  const jobs =
    (root?.report as Record<string, unknown> | undefined)?.jobs ??
    (root?.jobs as unknown);
  if (!Array.isArray(jobs)) return [];

  const results: unknown[] = [];
  for (const job of jobs) {
    const vr = (job as Record<string, unknown>)?.validationResult;
    if (Array.isArray(vr)) results.push(...vr);
    else if (vr !== undefined) results.push(vr);
  }
  return results;
}
