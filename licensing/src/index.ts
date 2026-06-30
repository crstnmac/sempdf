/**
 * Optional licensing client for `@barrierbreak/a11ydocs-pdf`.
 *
 * Import path: `@barrierbreak/a11ydocs-pdf/licensing`. This module is **not**
 * part of the core library and pulls no extra dependencies; it uses the global
 * `fetch` and (for signature verification) `node:crypto`. Intended to run in a
 * Node backend where the customer holds a license key.
 *
 * Model (lease / batch): call {@link LicenseClient.checkout} to reserve a block
 * of generation quota from the license server (the source of truth), then
 * normal synchronous generation (`doc.toUint8Array()`, `toBlob()`, …) draws the
 * lease down locally. When the lease is exhausted, generation throws
 * `LICENSE_QUOTA_EXCEEDED` until the next checkout. Periodically call
 * {@link LicenseClient.flush} to report actual usage back for billing/audit.
 *
 * Enforcement is fail-closed: with no installed client (or an empty lease)
 * generation is refused only if a client is installed. The core library is
 * unrestricted when this module is never imported.
 *
 * Security note: because the customer controls the runtime, a determined party
 * can bypass the client. The server remains the billing source of truth; this
 * client signs-verifies server responses (Ed25519) so a spoofed "allow" cannot
 * silently grant quota.
 */
import { PdfEngineError, PdfErrorCode } from "@barrierbreak/a11ydocs-pdf";
import { setLicenseGuard, type GenerationUsage, type LicenseGuard, type LicenseGuardDecision } from "@barrierbreak/a11ydocs-pdf/license-guard";

export interface LicenseClientOptions {
  /** The license key issued by the server. */
  key: string;
  /** Base URL of the license server, e.g. `https://license.example.com`. */
  serverUrl: string;
  /**
   * What to do when the server is unreachable during a checkout.
   * - `"closed"` (default): refuse new leases (true hard enforcement).
   * - `"open"`: allow a grace lease for {@link graceMs} using the last known
   *   plan size, reconciled on the next successful checkout.
   */
  failMode?: "closed" | "open";
  /** Grace window for `failMode: "open"`, in ms. Default 5 minutes. */
  graceMs?: number;
  /** Size of the grace lease granted during an outage. Default 50. */
  graceUnits?: number;
  /**
   * Ed25519 public key (SPKI PEM) used to verify signed server responses. When
   * provided, responses with a missing/invalid signature are rejected.
   */
  publicKeyPem?: string;
  /** Override the global `fetch` (e.g. for tests). */
  fetch?: typeof fetch;
  /** Request timeout in ms. Default 10000. */
  timeoutMs?: number;
  /**
   * Which dimension the lease/quota is measured in. `"pages"` (default) charges
   * one unit per page; `"pdfs"` charges one unit per document. The other
   * dimension is still tracked and reported on {@link LicenseClient.flush} for
   * billing/analytics (e.g. "200 PDFs, 5200 pages"). Must match the license's
   * `metric` on the server.
   */
  meter?: "pdfs" | "pages";
  /** Optional caller-supplied job id sent to telemetry as `X-Job-Id` equivalent metadata. */
  jobId?: string;
  /** Optional application-level job description sent to telemetry. */
  jobDescription?: string;
}

/** Current local lease snapshot. */
export interface LeaseState {
  /** Units remaining in the local lease (in the configured `meter` dimension). */
  remaining: number;
  /** ISO timestamp when the server quota window resets, if applicable. */
  resetAt?: string | undefined;
  /** Whether the current lease was granted under outage grace. */
  grace: boolean;
  /** Documents serialized since the last successful flush. */
  consumedDocuments: number;
  /** Pages serialized since the last successful flush. */
  consumedPages: number;
  /** Whether the active lease requires visible watermarking. */
  watermark: boolean;
  /** Text currently used for generated PDF watermarks. */
  watermarkText?: string | undefined;
}

interface AuthorizeResponse {
  granted: number;
  remaining: number;
  resetAt?: string;
  nonce: string;
  signature?: string;
  /** Id of the key that signed `signature`; selects the public key to verify against. */
  kid?: string;
  watermark?: boolean;
  watermarkText?: string | null;
  status?: "none" | "trial" | "grace_period" | "hard_blocked";
  hardBlockAt?: string | null;
}

export class LicenseClient {
  private readonly options: Required<Pick<LicenseClientOptions, "key" | "serverUrl" | "failMode" | "graceMs" | "graceUnits" | "timeoutMs" | "meter">> &
    Pick<LicenseClientOptions, "publicKeyPem" | "fetch" | "jobId" | "jobDescription">;
  private lease = 0;
  private consumedDocuments = 0; // since last flush
  private consumedPages = 0; // since last flush
  private resetAt: string | undefined;
  private graceLease = false;
  private watermark = false;
  private watermarkText: string | undefined;
  private lastGoodCheckout = 0;

  constructor(options: LicenseClientOptions) {
    if (!options.key) throw new PdfEngineError(PdfErrorCode.INVALID_OPERATION, "License key is required.");
    if (!options.serverUrl) throw new PdfEngineError(PdfErrorCode.INVALID_OPERATION, "License server URL is required.");
    this.options = {
      key: options.key,
      serverUrl: options.serverUrl.replace(/\/$/, ""),
      failMode: options.failMode ?? "closed",
      graceMs: options.graceMs ?? 5 * 60 * 1000,
      graceUnits: options.graceUnits ?? 50,
      timeoutMs: options.timeoutMs ?? 10000,
      meter: options.meter ?? "pages",
      ...(options.publicKeyPem !== undefined ? { publicKeyPem: options.publicKeyPem } : {}),
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      ...(options.jobId !== undefined ? { jobId: options.jobId } : {}),
      ...(options.jobDescription !== undefined ? { jobDescription: options.jobDescription } : {}),
    };
  }

  /** Installs this client as the active generation guard. */
  install(): void {
    setLicenseGuard(this.asGuard());
  }

  /** Removes the active guard (any client). */
  static uninstall(): void {
    setLicenseGuard(undefined);
  }

  private asGuard(): LicenseGuard {
    return {
      consume: (usage: GenerationUsage): LicenseGuardDecision | undefined => {
        // Charge the lease in the metered dimension; track both for reporting.
        const units = this.options.meter === "pages" ? usage.pages : usage.documents;
        if (units > 0 && this.lease < units) {
          throw new PdfEngineError(
            PdfErrorCode.LICENSE_QUOTA_EXCEEDED,
            `License lease exhausted: ${this.lease} ${this.options.meter} left, ${units} required. Call checkout() to reserve more quota.`,
            { remaining: this.lease, resetAt: this.resetAt },
          );
        }
        this.lease -= units;
        this.consumedDocuments += usage.documents;
        this.consumedPages += usage.pages;
        if (this.watermark) return { watermarkText: this.watermarkText ?? "Over Limit" };
        return undefined;
      },
    };
  }

  /** Current local lease snapshot. */
  state(): LeaseState {
    return {
      remaining: this.lease,
      resetAt: this.resetAt,
      grace: this.graceLease,
      consumedDocuments: this.consumedDocuments,
      consumedPages: this.consumedPages,
      watermark: this.watermark,
      watermarkText: this.watermarkText,
    };
  }

  /**
   * Reserves `units` of quota from the server and adds them to the local lease.
   * Returns the number of units actually granted (may be less than requested
   * when near the quota limit). Throws `LICENSE_QUOTA_EXCEEDED` when the server
   * grants zero, and (in `failMode: "closed"`) when the server is unreachable.
   */
  async checkout(units: number): Promise<number> {
    if (units <= 0) return 0;
    // Flush prior usage opportunistically so server counters stay accurate.
    await this.flush().catch(() => {});

    let response: AuthorizeResponse | undefined;
    try {
      response = await this.authorize(units);
    } catch (err) {
      return this.handleOutage(units, err);
    }

    this.verifySignature(response);
    if (response.granted <= 0) {
      throw new PdfEngineError(PdfErrorCode.LICENSE_QUOTA_EXCEEDED, "License quota exhausted; the server granted no further units.", {
        remaining: response.remaining,
        resetAt: response.resetAt,
      });
    }
    this.lease += response.granted;
    this.resetAt = response.resetAt;
    this.graceLease = false;
    this.watermark = response.watermark === true;
    this.watermarkText = response.watermarkText ?? (this.watermark ? response.status === "trial" ? "Trial Mode" : "Over Limit" : undefined);
    this.lastGoodCheckout = Date.now();
    return response.granted;
  }

  /** Reports actual consumed documents + pages back to the server and resets the counters. */
  async flush(): Promise<void> {
    const documents = this.consumedDocuments;
    const pages = this.consumedPages;
    if (documents <= 0 && pages <= 0) return;
    this.consumedDocuments = 0;
    this.consumedPages = 0;
    try {
      await this.post("/v1/usage", {
        documents,
        pages,
        status: this.watermark ? "watermarked" : "success",
        ...(this.options.jobId !== undefined ? { jobId: this.options.jobId } : {}),
        ...(this.options.jobDescription !== undefined ? { jobDescription: this.options.jobDescription } : {}),
      });
    } catch (err) {
      // Re-queue on failure so usage is not lost.
      this.consumedDocuments += documents;
      this.consumedPages += pages;
      throw err;
    }
  }

  private handleOutage(units: number, err: unknown): number {
    const withinGrace = Date.now() - this.lastGoodCheckout <= this.options.graceMs;
    if (this.options.failMode === "open" && withinGrace) {
      const grant = Math.min(units, this.options.graceUnits);
      this.lease += grant;
      this.graceLease = true;
      return grant;
    }
    throw new PdfEngineError(
      PdfErrorCode.LICENSE_QUOTA_EXCEEDED,
      `License server unreachable and fail mode is "${this.options.failMode}"; generation is blocked.`,
      { cause: err instanceof Error ? err.message : String(err) },
    );
  }

  private async authorize(requested: number): Promise<AuthorizeResponse> {
    const nonce = randomNonce();
    const body = await this.post("/v1/authorize", {
      requested,
      nonce,
      ...(this.options.jobId !== undefined ? { jobId: this.options.jobId } : {}),
      ...(this.options.jobDescription !== undefined ? { jobDescription: this.options.jobDescription } : {}),
    });
    const parsed = body as Partial<AuthorizeResponse>;
    if (typeof parsed.granted !== "number" || typeof parsed.remaining !== "number" || parsed.nonce !== nonce) {
      throw new PdfEngineError(PdfErrorCode.INVALID_OPERATION, "Malformed authorize response from license server.");
    }
    return parsed as AuthorizeResponse;
  }

  private verifySignature(response: AuthorizeResponse): void {
    if (this.options.publicKeyPem === undefined) return; // verification opt-in
    if (!response.signature) {
      throw new PdfEngineError(PdfErrorCode.INVALID_OPERATION, "License server response is unsigned but a public key was configured.");
    }
    const payload = canonicalAuthPayload(this.options.key, response);
    const ok = verifyEd25519(this.options.publicKeyPem, payload, response.signature);
    if (!ok) {
      throw new PdfEngineError(PdfErrorCode.INVALID_OPERATION, "License server response signature verification failed.");
    }
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    const f = this.options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new PdfEngineError(PdfErrorCode.INVALID_OPERATION, "No fetch implementation available for the license client.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const res = await f(`${this.options.serverUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The licence key authenticates the request; sent as a Bearer token
          // rather than in the body so it stays out of body logs.
          authorization: `Bearer ${this.options.key}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (res.status === 402 || res.status === 403) {
        const data = (await res.json().catch(() => ({}))) as { remaining?: number; resetAt?: string; hardBlockAt?: string; status?: string; error?: string };
        throw new PdfEngineError(PdfErrorCode.LICENSE_QUOTA_EXCEEDED, data.error ?? "License quota exceeded.", {
          remaining: data.remaining,
          resetAt: data.resetAt,
          hardBlockAt: data.hardBlockAt,
          status: data.status,
        });
      }
      if (!res.ok) {
        throw new PdfEngineError(PdfErrorCode.INVALID_OPERATION, `License server returned ${res.status}.`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Creates and installs a license client. Generation is guarded immediately;
 * call {@link LicenseClient.checkout} to reserve quota before generating.
 */
export async function createLicenseClient(options: LicenseClientOptions): Promise<LicenseClient> {
  const client = new LicenseClient(options);
  client.install();
  return client;
}

/**
 * Canonical bytes the server signs and the client verifies.
 *
 * FORM (v2): `kid|key|granted|remaining|resetAt|nonce`. The leading `kid`
 * (defaulting to "v1" when the server omits it) lets the server rotate signing
 * keys: the client reads `kid` from the response, selects the matching public
 * key, and reconstructs the SAME string that begins with that kid. Must stay
 * byte-for-byte identical to the server's `signAuthorize` canonical form.
 */
export function canonicalAuthPayload(key: string, r: Pick<AuthorizeResponse, "granted" | "remaining" | "resetAt" | "nonce" | "kid">): Uint8Array {
  const kid = r.kid ?? "v1";
  const text = `${kid}|${key}|${r.granted}|${r.remaining}|${r.resetAt ?? ""}|${r.nonce}`;
  return new TextEncoder().encode(text);
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    const getBuiltinModule = (globalThis as { process?: { getBuiltinModule?: (n: string) => unknown } }).process?.getBuiltinModule;
    const nodeCrypto = getBuiltinModule?.("node:crypto") as { webcrypto?: { getRandomValues(a: Uint8Array): void } } | undefined;
    if (!nodeCrypto?.webcrypto) {
      throw new PdfEngineError(PdfErrorCode.INVALID_OPERATION, "No secure random source available for the license client.");
    }
    nodeCrypto.webcrypto.getRandomValues(bytes);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function verifyEd25519(publicKeyPem: string, data: Uint8Array, signatureBase64: string): boolean {
  const getBuiltinModule = (globalThis as { process?: { getBuiltinModule?: (n: string) => unknown } }).process?.getBuiltinModule;
  const crypto = getBuiltinModule?.("node:crypto") as
    | { verify(alg: null, data: Uint8Array, key: unknown, sig: Uint8Array): boolean; createPublicKey(k: string): unknown }
    | undefined;
  if (!crypto) {
    throw new PdfEngineError(PdfErrorCode.INVALID_OPERATION, "Signature verification requires node:crypto.");
  }
  const key = crypto.createPublicKey(publicKeyPem);
  const sig = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));
  return crypto.verify(null, data, key, sig);
}
