import { PdfEngineError, PdfErrorCode } from "../errors.js";
import { bakedServerUrl } from "./license-server.js";

/**
 * A guard consulted immediately before a document is serialized to bytes. It
 * returns the number of units it authorized (normally the requested count) or
 * throws to refuse generation.
 *
 * The licensing client (`@zeropdf/zeropdf-pdf-licensing`) installs a
 * guard via {@link setLicenseGuard}. The core library has no network code and
 * no dependency on the licensing module.
 *
 * Enforcement is **secure by default**: with no guard installed, generation is
 * refused with {@link PdfErrorCode.LICENSE_REQUIRED}. The only exception is the
 * development bypass — set the `ZEROPDF_LICENSE_DEV` environment variable to
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
 * `ZEROPDF_LICENSE_DEV` environment variable (Node only). In browsers there is
 * no `process.env`, so the bypass is never active there.
 */
export function isLicenseDevBypass(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.ZEROPDF_LICENSE_DEV;
  return value === "1" || value === "true";
}

/**
 * Reports the usage of serializing one document to the active guard, called by
 * generation entrypoints just before serializing. Secure by default: with no
 * guard installed and the dev bypass off, generation is refused.
 *
 * When no guard is installed but `ZEROPDF_LICENSE_KEY` and
 * `ZEROPDF_LICENSE_SERVER` env vars are both set, an auto-guard is installed
 * on the first call so the author of a PDF does not need to manually install
 * the licensing client.
 *
 * @throws PdfEngineError with {@link PdfErrorCode.LICENSE_REQUIRED} when no
 *   guard is installed (and the dev bypass is not set), or with
 *   {@link PdfErrorCode.LICENSE_QUOTA_EXCEEDED} when an installed guard refuses.
 */
export function consumeLicense(usage: GenerationUsage): LicenseGuardDecision | undefined {
  if (activeGuard !== undefined) {
    return activeGuard.consume(usage) ?? undefined;
  }
  if (tryAutoInstallGuard()) {
    return activeGuard!.consume(usage) ?? undefined;
  }
  if (isLicenseDevBypass()) return undefined;
  throw new PdfEngineError(
    PdfErrorCode.LICENSE_REQUIRED,
    "PDF generation requires a license. Install a guard via the licensing client " +
      "(@zeropdf/zeropdf-pdf-licensing) or setLicenseGuard(), or set " +
      "ZEROPDF_LICENSE_DEV=1 for development.",
  );
}

/** Convenience for guards: the standard refusal error. */
export function licenseQuotaError(message: string, details?: Record<string, unknown>): PdfEngineError {
  return new PdfEngineError(PdfErrorCode.LICENSE_QUOTA_EXCEEDED, message, details);
}

// ---------------------------------------------------------------------------
// Auto-guard — baked-in licensing with zero user-code setup
// ---------------------------------------------------------------------------

const ENV_LICENSE_KEY = "ZEROPDF_LICENSE_KEY";
const ENV_LICENSE_SERVER = "ZEROPDF_LICENSE_SERVER";
const INITIAL_LEASE = 10;
const REFILL_AT = 5;
const REFILL_AMOUNT = 100;
const FLUSH_INTERVAL_MS = 30_000;

interface AutoGuardState {
  lease: number;
  replenishing: boolean;
  consumedPages: number;
  consumedDocs: number;
  flushTimer: ReturnType<typeof setInterval> | null;
  key: string;
  serverUrl: string;
}

let autoGuardState: AutoGuardState | null = null;
let autoInstallAttempted = false;

function getEnvVar(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

function tryAutoInstallGuard(): boolean {
  if (autoInstallAttempted) return activeGuard !== undefined;
  autoInstallAttempted = true;

  if (activeGuard !== undefined) return true;

  const key = getEnvVar(ENV_LICENSE_KEY);
  const serverUrl = bakedServerUrl ?? getEnvVar(ENV_LICENSE_SERVER);
  if (!key || !serverUrl) return false;

  const f = globalThis.fetch as typeof fetch | undefined;
  if (typeof f !== "function") return false;

  const state: AutoGuardState = {
    lease: INITIAL_LEASE,
    replenishing: false,
    consumedPages: 0,
    consumedDocs: 0,
    flushTimer: null,
    key,
    serverUrl: serverUrl.replace(/\/$/, ""),
  };

  autoGuardState = state;

  state.flushTimer = setInterval(() => {
    flushAutoGuard(state).catch(() => {});
  }, FLUSH_INTERVAL_MS);
  if (state.flushTimer && typeof state.flushTimer === "object" && "unref" in state.flushTimer) {
    (state.flushTimer as NodeJS.Timeout).unref();
  }

  const guard: LicenseGuard = {
    consume(usage: GenerationUsage): LicenseGuardDecision | undefined {
      const units = usage.pages;
      if (units > state.lease) {
        throw licenseQuotaError(
          `License quota exhausted: ${state.lease} pages left, ${units} required. ` +
            "The auto-guard refills asynchronously — wait a moment and retry, or call checkout() manually.",
          { remaining: state.lease },
        );
      }
      state.lease -= units;
      state.consumedPages += usage.pages;
      state.consumedDocs += usage.documents;

      if (state.lease < REFILL_AT && !state.replenishing) {
        state.replenishing = true;
        replenishAutoGuard(state).finally(() => { state.replenishing = false; });
      }

      return undefined;
    },
  };

  setLicenseGuard(guard);
  return true;
}

async function replenishAutoGuard(state: AutoGuardState): Promise<void> {
  const nonce = makeNonce();
  try {
    const res = await fetch(`${state.serverUrl}/v1/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${state.key}`,
      },
      body: JSON.stringify({ requested: REFILL_AMOUNT, nonce }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { granted?: number };
    if (typeof data.granted === "number" && data.granted > 0) {
      state.lease += data.granted;
    }
  } catch {
    // server unreachable — retry on next consumption trigger
  }
}

async function flushAutoGuard(state: AutoGuardState): Promise<void> {
  const pages = state.consumedPages;
  const docs = state.consumedDocs;
  if (pages <= 0 && docs <= 0) return;
  state.consumedPages = 0;
  state.consumedDocs = 0;
  try {
    await fetch(`${state.serverUrl}/v1/usage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${state.key}`,
      },
      body: JSON.stringify({ documents: docs, pages, status: "success" }),
    });
  } catch {
    state.consumedPages += pages;
    state.consumedDocs += docs;
  }
}

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Tears down the auto-guard, clears the interval timer, and flushes remaining
 * usage. Safe to call even when the auto-guard was never installed. After this
 * call generation requires a new guard (manual install, auto-reinstall, or dev
 * bypass).
 */
export function shutdownAutoGuard(): void {
  if (autoGuardState?.flushTimer !== null && autoGuardState?.flushTimer !== undefined) {
    clearInterval(autoGuardState.flushTimer);
  }
  if (autoGuardState) {
    flushAutoGuard(autoGuardState).catch(() => {});
  }
  autoGuardState = null;
  autoInstallAttempted = false;
  setLicenseGuard(undefined);
}
