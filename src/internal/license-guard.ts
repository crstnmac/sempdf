import { PdfEngineError, PdfErrorCode } from "../errors.js";

/**
 * A guard consulted immediately before a document is serialized to bytes. It
 * returns the number of units it authorized (normally the requested count) or
 * throws to refuse generation.
 *
 * The licensing client (`@barrierbreak/a11ydocs-pdf-licensing`) installs a
 * guard via {@link setLicenseGuard}. The core library has no network code and
 * no dependency on the licensing module.
 *
 * Enforcement is **secure by default**: with no guard installed, generation is
 * refused with {@link PdfErrorCode.LICENSE_REQUIRED}. The only exception is the
 * development bypass — set the `A11YDOCS_LICENSE_DEV` environment variable to
 * `1`/`true` (Node only) to allow unlicensed generation for the library's own
 * tests, examples, and local trials.
 */
/**
 * Usage produced by serializing one document, passed to the guard. `documents`
 * is always 1; `pages` is the page count of that document. A guard meters or
 * limits on whichever dimension it cares about (e.g. "200 PDFs" or "5200
 * pages"), and may report both.
 */
export interface GenerationUsage {
  /** Number of documents serialized (always 1 per call). */
  documents: number;
  /** Number of pages in the serialized document. */
  pages: number;
}

export interface LicenseGuard {
  /**
   * Authorizes the generation of one document. Must throw (typically a
   * {@link PdfEngineError} with {@link PdfErrorCode.LICENSE_QUOTA_EXCEEDED}) to
   * block generation. Synchronous by design: serialization is synchronous, so
   * the guard draws down a pre-fetched lease rather than performing I/O here.
   */
  consume(usage: GenerationUsage): void | LicenseGuardDecision;
}

export interface LicenseGuardDecision {
  /**
   * Optional visible watermark text to stamp on each generated page. Licensing
   * clients return this for trial and over-limit grace runs.
   */
  watermarkText?: string | undefined;
}

let activeGuard: LicenseGuard | undefined;

/**
 * Installs (or clears, with `undefined`) the process-wide license guard. Called
 * by the licensing client; not part of the normal generation API.
 */
export function setLicenseGuard(guard: LicenseGuard | undefined): void {
  activeGuard = guard;
}

/** Returns the currently installed guard, if any. */
export function getLicenseGuard(): LicenseGuard | undefined {
  return activeGuard;
}

/**
 * Returns true when the development bypass is enabled via the
 * `A11YDOCS_LICENSE_DEV` environment variable (Node only). In browsers there is
 * no `process.env`, so the bypass is never active there.
 */
export function isLicenseDevBypass(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.A11YDOCS_LICENSE_DEV;
  return value === "1" || value === "true";
}

/**
 * Reports the usage of serializing one document to the active guard, called by
 * generation entrypoints just before serializing. Secure by default: with no
 * guard installed and the dev bypass off, generation is refused.
 *
 * @throws PdfEngineError with {@link PdfErrorCode.LICENSE_REQUIRED} when no
 *   guard is installed (and the dev bypass is not set), or with
 *   {@link PdfErrorCode.LICENSE_QUOTA_EXCEEDED} when an installed guard refuses.
 */
export function consumeLicense(usage: GenerationUsage): LicenseGuardDecision | undefined {
  if (activeGuard !== undefined) {
    return activeGuard.consume(usage) ?? undefined;
  }
  if (isLicenseDevBypass()) return undefined;
  throw new PdfEngineError(
    PdfErrorCode.LICENSE_REQUIRED,
    "PDF generation requires a license. Install a guard via the licensing client " +
      "(@barrierbreak/a11ydocs-pdf-licensing) or setLicenseGuard(), or set " +
      "A11YDOCS_LICENSE_DEV=1 for development.",
  );
}

/** Convenience for guards: the standard refusal error. */
export function licenseQuotaError(message: string, details?: Record<string, unknown>): PdfEngineError {
  return new PdfEngineError(PdfErrorCode.LICENSE_QUOTA_EXCEEDED, message, details);
}
