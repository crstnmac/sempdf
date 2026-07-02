import { PdfEngineError, PdfErrorCode } from "../errors.js";
import { bakedServerUrl, bakedLibVersion, bakedServerPubkeys } from "./license-server.js";

/**
 * A guard consulted immediately before a document is serialized to bytes. It
 * returns the number of units it authorized (normally the requested count) or
 * throws to refuse generation.
 *
 * The licensing client (`@sempdf/sempdf-pdf-licensing`) installs a
 * guard via {@link setLicenseGuard}. The core library has no network code and
 * no dependency on the licensing module.
 *
 * Enforcement is **secure by default**: with no guard installed, generation is
 * refused with {@link PdfErrorCode.LICENSE_REQUIRED}. The only exception is the
 * development bypass — set the `SEMPDF_LICENSE_DEV` environment variable to
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
  /** Whether the document emits tagged (accessible) PDF structure. */
  tagged?: boolean;
  /** BCP-47 language tag of the document, if set. */
  language?: string | undefined;
  /** PDF/A or PDF/UA conformance profile, if any (e.g. "pdfua-1"). */
  conformance?: string | undefined;
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
let activeGuardVerified = false;
/**
 * Watermark the license server required in the install proof (trial keys).
 * Forced over any decision from the proof-verified guard, so a trial key
 * cannot unlock clean output by pairing its valid proof with a permissive
 * guard.
 */
let activeGuardForcedWatermark: string | undefined;
/** Outstanding single-use install challenge (see getLicenseInstallChallenge). */
let installChallenge: string | null = null;

/**
 * Watermark forced onto every page when generation is authorized by an
 * UNVERIFIED guard (anything installed through the public
 * {@link setLicenseGuard}). The text is fixed on purpose: an unverified guard
 * must not be able to blank or soften it, otherwise installing
 * `{ consume() {} }` would be a two-line metering bypass. Clean output requires
 * the verified path (the server-backed auto-guard, or internal callers via
 * {@link setVerifiedLicenseGuard}).
 */
const UNVERIFIED_WATERMARK = "UNLICENSED - EVALUATION ONLY";

/** Watermark stamped when generating under the SEMPDF_LICENSE_DEV bypass. */
const DEV_WATERMARK = "DEVELOPMENT - NOT FOR DISTRIBUTION";

/**
 * Installs (or clears, with `undefined`) the process-wide license guard. Called
 * by the licensing client; not part of the normal generation API.
 *
 * Guards installed through this public entrypoint are **unverified**: they can
 * meter and block, but every document they authorize is stamped with a fixed
 * "unlicensed" watermark. Watermark-free output requires the server-backed
 * auto-guard (`SEMPDF_LICENSE_KEY`).
 */
export function setLicenseGuard(guard: LicenseGuard | undefined): void {
  activeGuard = guard;
  activeGuardVerified = false;
  activeGuardForcedWatermark = undefined;
}

/**
 * INTERNAL — installs a guard on the verified (watermark-free) path. Not
 * re-exported from the public `./license-guard` subpath or the package index,
 * and the package `exports` map blocks deep imports, so external code cannot
 * reach it. Used by the auto-guard (whose authority is the license server) and
 * by the library's own test/tooling preloads.
 */
export function setVerifiedLicenseGuard(guard: LicenseGuard | undefined): void {
  activeGuard = guard;
  activeGuardVerified = guard !== undefined;
  activeGuardForcedWatermark = undefined;
}

/**
 * Issues a single-use nonce for the signed-proof guard install
 * ({@link setLicenseGuardWithProof}). An external licensing client asks the
 * license server to authorize against THIS nonce; because the core generated
 * it fresh, a captured signed response from some earlier session cannot be
 * replayed as an install proof.
 */
export function getLicenseInstallChallenge(): string {
  installChallenge = makeNonce();
  return installChallenge;
}

/**
 * A signed authorize response presented as proof that the installing client
 * holds a license the server accepts. `nonce` must be the outstanding
 * {@link getLicenseInstallChallenge} value and the signature must verify
 * against the baked server public keys (canonical v3).
 */
export interface LicenseInstallProof {
  /** License key the response was signed for. */
  key: string;
  granted: number;
  remaining: number;
  resetAt?: string | null | undefined;
  nonce: string;
  watermark?: boolean | undefined;
  watermarkText?: string | null | undefined;
  signature?: string | undefined;
  kid?: string | undefined;
}

/**
 * Installs a guard on the verified path using a server-signed proof. The
 * challenge is consumed whether or not verification succeeds (single use).
 * When the proof carries the server's watermark requirement (trial keys), that
 * watermark is forced onto every document the guard authorizes — a trial proof
 * cannot unlock clean output.
 *
 * @throws PdfEngineError(INVALID_OPERATION) when no challenge is outstanding,
 *   the proof's nonce does not match it, or the signature does not verify.
 */
export async function setLicenseGuardWithProof(guard: LicenseGuard, proof: LicenseInstallProof): Promise<void> {
  const challenge = installChallenge;
  installChallenge = null; // single use, consumed even on failure
  if (!challenge || proof.nonce !== challenge) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OPERATION,
      "License install proof rejected: missing or mismatched install challenge. " +
        "Request a fresh challenge via getLicenseInstallChallenge() and authorize against it.",
    );
  }
  if (!(await verifyAuthorizeResponse(proof.key, challenge, proof))) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OPERATION,
      "License install proof rejected: server signature verification failed.",
    );
  }
  activeGuard = guard;
  activeGuardVerified = true;
  activeGuardForcedWatermark = proof.watermark ? proof.watermarkText ?? "Trial Mode" : undefined;
}

/**
 * Applies the unverified-guard policy to a guard decision: decisions from the
 * verified path pass through untouched (the license server dictates trial /
 * over-limit watermarks); decisions from unverified guards are forced to the
 * fixed unlicensed watermark regardless of what the guard returned.
 */
function finalizeDecision(decision: LicenseGuardDecision | undefined): LicenseGuardDecision | undefined {
  if (activeGuardVerified) {
    if (activeGuardForcedWatermark !== undefined) {
      return { ...decision, watermarkText: activeGuardForcedWatermark };
    }
    return decision;
  }
  return { ...decision, watermarkText: UNVERIFIED_WATERMARK };
}

/** Returns the currently installed guard, if any. */
export function getLicenseGuard(): LicenseGuard | undefined {
  return activeGuard;
}

/**
 * Application-level job context forwarded to usage telemetry, so operators can
 * slice usage by job (e.g. "August bank statements, 200k pages"). Set it via
 * `setJobContext(...)` before generating, or via the `SEMPDF_JOB_ID` /
 * `SEMPDF_JOB_DESCRIPTION` environment variables.
 */
export interface JobContext {
  id?: string | undefined;
  description?: string | undefined;
}

let jobContextOverride: JobContext = {};

/** Sets (or clears, with `undefined`) the job context sent with telemetry. */
export function setJobContext(context: JobContext | undefined): void {
  jobContextOverride = context ?? {};
}

function currentJobContext(): JobContext {
  return {
    id: jobContextOverride.id ?? getEnvVar(ENV_JOB_ID),
    description: jobContextOverride.description ?? getEnvVar(ENV_JOB_DESCRIPTION),
  };
}

/**
 * Returns true when the development bypass is enabled via the
 * `SEMPDF_LICENSE_DEV` environment variable (Node only). In browsers there is
 * no `process.env`, so the bypass is never active there.
 */
export function isLicenseDevBypass(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.SEMPDF_LICENSE_DEV;
  return value === "1" || value === "true";
}

/**
 * Reports the usage of serializing one document to the active guard, called by
 * generation entrypoints just before serializing. Secure by default: with no
 * guard installed and the dev bypass off, generation is refused.
 *
 * When no guard is installed but `SEMPDF_LICENSE_KEY` and
 * `SEMPDF_LICENSE_SERVER` env vars are both set, an auto-guard is installed
 * on the first call so the author of a PDF does not need to manually install
 * the licensing client.
 *
 * @throws PdfEngineError with {@link PdfErrorCode.LICENSE_REQUIRED} when no
 *   guard is installed (and the dev bypass is not set), or with
 *   {@link PdfErrorCode.LICENSE_QUOTA_EXCEEDED} when an installed guard refuses.
 */
export function consumeLicense(usage: GenerationUsage): LicenseGuardDecision | undefined {
  if (activeGuard !== undefined) {
    return finalizeDecision(activeGuard.consume(usage) ?? undefined);
  }
  if (tryAutoInstallGuard()) {
    return finalizeDecision(activeGuard!.consume(usage) ?? undefined);
  }
  if (isLicenseDevBypass()) return { watermarkText: DEV_WATERMARK };
  throw new PdfEngineError(
    PdfErrorCode.LICENSE_REQUIRED,
    "PDF generation requires a license. Install a guard via the licensing client " +
      "(@sempdf/sempdf-pdf-licensing) or setLicenseGuard(), or set " +
      "SEMPDF_LICENSE_DEV=1 for development.",
  );
}

/** Convenience for guards: the standard refusal error. */
export function licenseQuotaError(message: string, details?: Record<string, unknown>): PdfEngineError {
  return new PdfEngineError(PdfErrorCode.LICENSE_QUOTA_EXCEEDED, message, details);
}

// ---------------------------------------------------------------------------
// Auto-guard — baked-in licensing with zero user-code setup
// ---------------------------------------------------------------------------

const ENV_LICENSE_KEY = "SEMPDF_LICENSE_KEY";
const ENV_LICENSE_SERVER = "SEMPDF_LICENSE_SERVER";
const ENV_JOB_ID = "SEMPDF_JOB_ID";
const ENV_JOB_DESCRIPTION = "SEMPDF_JOB_DESCRIPTION";
// No optimistic lease: pages are only generated after the server authorizes
// them, so the server's counter is the source of truth and an over-limit /
// expired / inactive license is enforced rather than silently bypassed.
const INITIAL_LEASE = 0;
const REFILL_AT = 5;
const REFILL_AMOUNT = 100;
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_DEBOUNCE_MS = 3_000;

interface AutoGuardState {
  lease: number;
  replenishing: boolean;
  consumedPages: number;
  consumedDocs: number;
  flushTimer: ReturnType<typeof setInterval> | null;
  key: string;
  serverUrl: string;
  /** Accessibility shape of the most recently serialized document. */
  lastTagged?: boolean | undefined;
  lastLanguage?: string | undefined;
  lastConformance?: string | undefined;
  lastFlushAt: number;
  /** Set once the server rejects an authorize; further generation is refused. */
  blocked: { reason: string } | null;
  /** Watermark text the server requires on output ("Trial Mode"/"Over Limit"). */
  watermarkText: string | undefined;
}

/**
 * Host/server metadata, captured once per process (Node only). Best-effort: in
 * the browser, or if `node:os` is unavailable, stays `undefined` and is omitted
 * from telemetry. Loaded lazily so the browser bundle never imports `node:os`.
 */
interface HostMeta {
  hostname?: string | undefined;
  osType?: string | undefined;
  osRelease?: string | undefined;
  cpuCount?: number | undefined;
  totalMemBytes?: number | undefined;
  /** Cloud/orchestrator hints derived from env, when present. */
  cloud?: string | undefined;
  region?: string | undefined;
}

let hostMeta: HostMeta | undefined;
let hostMetaReady: Promise<void> | undefined;

/**
 * Begins capturing host metadata (Node only) and returns a promise that
 * resolves once `hostMeta` is populated (or determined unavailable). Idempotent:
 * repeated calls return the same in-flight/settled promise. Async output paths
 * await this before building telemetry so the very first authorize carries host
 * data rather than filling in only on a later round-trip.
 */
function captureHostMeta(): Promise<void> {
  if (hostMetaReady) return hostMetaReady;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!proc) {
    hostMetaReady = Promise.resolve(); // browser — leave undefined
    return hostMetaReady;
  }
  // Node-only; loaded lazily and guarded so the browser bundle stays clean.
  hostMetaReady = import("node:os")
    .then((os) => {
      const env = proc.env ?? {};
      const cloud = env.K_SERVICE
        ? "cloudrun"
        : env.AWS_LAMBDA_FUNCTION_NAME
          ? "lambda"
          : env.KUBERNETES_SERVICE_HOST
            ? "k8s"
            : env.VERCEL
              ? "vercel"
              : undefined;
      // On serverless platforms the hostname is a random per-invocation
      // container id — high cardinality, no operational meaning. Drop it and
      // rely on cloud/region for "where this ran"; keep it elsewhere (bare
      // metal, VMs, k8s pods) where it's a stable, meaningful identifier.
      const ephemeralHost = cloud === "lambda" || cloud === "cloudrun" || cloud === "vercel";
      hostMeta = {
        hostname: ephemeralHost ? undefined : os.hostname(),
        osType: os.type(),
        osRelease: os.release(),
        cpuCount: os.cpus().length,
        totalMemBytes: os.totalmem(),
        cloud,
        region: env.AWS_REGION ?? env.VERCEL_REGION ?? env.GOOGLE_CLOUD_REGION,
      };
    })
    .catch(() => {});
  return hostMetaReady;
}

/** Runtime + host + job metadata sent alongside authorize/usage for telemetry. */
function buildClientMeta(state: AutoGuardState): Record<string, unknown> {
  const proc = (globalThis as { process?: { version?: string; platform?: string; arch?: string } }).process;
  const job = currentJobContext();
  return {
    libVersion: bakedLibVersion,
    nodeVersion: proc?.version,
    platform: proc ? `${proc.platform ?? ""}/${proc.arch ?? ""}` : undefined,
    host: hostMeta,
    jobId: job.id,
    jobDescription: job.description,
    tagged: state.lastTagged,
    language: state.lastLanguage,
    conformance: state.lastConformance,
  };
}

let autoGuardState: AutoGuardState | null = null;
let autoInstallAttempted = false;
// When the app drives authorization explicitly via checkout(), the guard stops
// auto-leasing ahead in consume() so each batch is a single deterministic
// server round-trip (no background authorize racing the checkout).
let checkoutMode = false;

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
    lastFlushAt: 0,
    blocked: null,
    watermarkText: undefined,
  };

  autoGuardState = state;
  void captureHostMeta(); // warm host metadata; awaited again before first round-trip

  state.flushTimer = setInterval(() => {
    flushAutoGuard(state).catch(() => {});
  }, FLUSH_INTERVAL_MS);
  if (state.flushTimer && typeof state.flushTimer === "object" && "unref" in state.flushTimer) {
    (state.flushTimer as NodeJS.Timeout).unref();
  }

  const guard: LicenseGuard = {
    consume(usage: GenerationUsage): LicenseGuardDecision | undefined {
      // Hard block: once the server has rejected this license, refuse every
      // subsequent run rather than retrying — the limit is reached/expired.
      if (state.blocked) {
        throw licenseQuotaError(
          `Generation blocked by the license server: ${state.blocked.reason}.`,
          { blocked: true, reason: state.blocked.reason },
        );
      }

      const units = usage.pages;
      if (units > state.lease) {
        // Not authorized yet. In streaming (no-checkout) mode, kick off an async
        // authorize so a retry succeeds; in checkout mode the app pre-authorizes,
        // so just report the shortfall. We never generate unauthorized pages.
        if (!checkoutMode && !state.replenishing) {
          state.replenishing = true;
          replenishAutoGuard(state).finally(() => { state.replenishing = false; });
        }
        throw licenseQuotaError(
          `License not yet authorized for ${units} page(s) (lease: ${state.lease}). ` +
            "Use an async output method (`await doc.save(path)`, `toUint8ArrayAsync()`, " +
            "`toArrayBufferAsync()`, `toBlobAsync()`, or `writeTo(sink)`) which pre-authorizes " +
            "automatically, or call `await checkout(pages)` before the synchronous `toUint8Array()`.",
          { remaining: state.lease },
        );
      }
      state.lease -= units;
      state.consumedPages += usage.pages;
      state.consumedDocs += usage.documents;
      state.lastTagged = usage.tagged;
      state.lastLanguage = usage.language;
      state.lastConformance = usage.conformance;

      if (Date.now() - state.lastFlushAt > FLUSH_DEBOUNCE_MS) {
        state.lastFlushAt = Date.now();
        flushAutoGuard(state).catch(() => {});
      }

      if (!checkoutMode && state.lease < REFILL_AT && !state.replenishing) {
        state.replenishing = true;
        replenishAutoGuard(state).finally(() => { state.replenishing = false; });
      }

      // Stamp the watermark the server requires (trial / over-limit), if any.
      return state.watermarkText ? { watermarkText: state.watermarkText } : undefined;
    },
  };

  // The auto-guard's authority is the license server itself (authorize/usage
  // round-trips), so it installs on the verified path: the server decides
  // trial/over-limit watermarks, and fully licensed output is clean.
  setVerifiedLicenseGuard(guard);
  return true;
}

interface AuthorizeOutcome {
  granted: number;
  watermarkText: string | undefined;
  blocked: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Authorize-response signature verification (Ed25519, canonical v2)
// ---------------------------------------------------------------------------

let serverPubkeysOverride: Record<string, string> | undefined;

/**
 * INTERNAL — overrides the baked server public keys (tests only). Like
 * {@link setVerifiedLicenseGuard}, unreachable for package consumers via the
 * exports map.
 */
export function overrideServerPublicKeys(keys: Record<string, string> | undefined): void {
  serverPubkeysOverride = keys;
}

function serverPubkeys(): Record<string, string> {
  return serverPubkeysOverride ?? bakedServerPubkeys;
}

/**
 * Canonical bytes the server signs (must stay byte-for-byte identical to the
 * server's `signAuthorize` and the licensing client's `canonicalAuthPayload`).
 * FORM (v3): `kid|key|granted|remaining|resetAt|nonce|watermark|watermarkText`
 * — the watermark flag/text are inside the signature so a tampering proxy
 * cannot strip a trial watermark; the text is last so embedded `|` cannot
 * shift earlier fields. The nonce is the one THIS client generated for the
 * request, so a captured "allow" cannot be replayed.
 */
function canonicalAuthorizePayload(
  kid: string,
  key: string,
  r: {
    granted: number;
    remaining: number;
    resetAt?: string | null | undefined;
    watermark?: boolean | undefined;
    watermarkText?: string | null | undefined;
  },
  nonce: string,
): Uint8Array {
  return new TextEncoder().encode(
    `${kid}|${key}|${r.granted}|${r.remaining}|${r.resetAt ?? ""}|${nonce}|${r.watermark ? 1 : 0}|${r.watermarkText ?? ""}`,
  );
}

function pemToSpkiDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Verifies an Ed25519 signature. Uses node:crypto when available (Node),
 * otherwise WebCrypto (browser). Returns false — never throws — so callers
 * fail closed on any verification problem, including a runtime with no crypto.
 */
async function verifyEd25519(publicKeyPem: string, data: Uint8Array, signatureBase64: string): Promise<boolean> {
  let sig: Uint8Array;
  try {
    sig = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  try {
    const getBuiltinModule = (globalThis as { process?: { getBuiltinModule?: (n: string) => unknown } }).process
      ?.getBuiltinModule;
    const nodeCrypto = getBuiltinModule?.("node:crypto") as
      | { verify(alg: null, data: Uint8Array, key: unknown, sig: Uint8Array): boolean; createPublicKey(k: string): unknown }
      | undefined;
    if (nodeCrypto?.verify) {
      return nodeCrypto.verify(null, data, nodeCrypto.createPublicKey(publicKeyPem), sig);
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return false;
    const key = await subtle.importKey("spki", pemToSpkiDer(publicKeyPem) as unknown as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await subtle.verify({ name: "Ed25519" }, key, sig as unknown as BufferSource, data as unknown as BufferSource);
  } catch {
    return false;
  }
}

/**
 * Validates a signed authorize response against the baked public keys. When no
 * keys are baked (dev builds) verification is skipped. With keys baked, a
 * missing signature, unknown kid, or bad signature all fail — the caller
 * treats the response as granting nothing (fail closed), never as a hard block
 * (a transient MITM/misconfig should not poison the license state).
 */
async function verifyAuthorizeResponse(
  key: string,
  nonce: string,
  data: {
    granted?: number | undefined;
    remaining?: number | undefined;
    resetAt?: string | null | undefined;
    watermark?: boolean | undefined;
    watermarkText?: string | null | undefined;
    signature?: string | undefined;
    kid?: string | undefined;
  },
): Promise<boolean> {
  const keys = serverPubkeys();
  if (Object.keys(keys).length === 0) return true; // no baked keys — transport trust (dev)
  if (!data.signature) return false;
  const kid = data.kid ?? "v1";
  const pem = keys[kid];
  if (!pem) return false;
  const payload = canonicalAuthorizePayload(
    kid,
    key,
    {
      granted: data.granted ?? 0,
      remaining: data.remaining ?? 0,
      resetAt: data.resetAt,
      watermark: data.watermark,
      watermarkText: data.watermarkText,
    },
    nonce,
  );
  return verifyEd25519(pem, payload, data.signature);
}

/** Single authorize round-trip to the server. Never throws — reports outcome. */
async function authorizeRequest(state: AutoGuardState, requested: number): Promise<AuthorizeOutcome> {
  await captureHostMeta(); // ensure host telemetry is ready for the first round-trip
  const nonce = makeNonce();
  const res = await fetch(`${state.serverUrl}/v1/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${state.key}`,
    },
    body: JSON.stringify({ requested, nonce, meta: buildClientMeta(state) }),
  });
  if (res.status === 403) {
    // Hard block: over limit, expired, or inactive.
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { granted: 0, watermarkText: undefined, blocked: true, reason: data.error ?? "hard_blocked" };
  }
  if (!res.ok) return { granted: 0, watermarkText: undefined, blocked: false, reason: "unavailable" };
  const data = (await res.json()) as {
    granted?: number;
    remaining?: number;
    resetAt?: string | null;
    watermark?: boolean;
    watermarkText?: string | null;
    signature?: string;
    kid?: string;
  };
  // With public keys baked in, only a response provably signed by the license
  // server grants pages. A spoofed server (DNS/proxy tampering) fails here and
  // the lease stays empty — generation is refused rather than un-metered.
  if (!(await verifyAuthorizeResponse(state.key, nonce, data))) {
    return { granted: 0, watermarkText: undefined, blocked: false, reason: "bad_signature" };
  }
  return {
    granted: typeof data.granted === "number" ? data.granted : 0,
    watermarkText: data.watermark ? data.watermarkText ?? "Over Limit" : undefined,
    blocked: false,
    reason: "",
  };
}

async function replenishAutoGuard(state: AutoGuardState): Promise<void> {
  try {
    const outcome = await authorizeRequest(state, REFILL_AMOUNT);
    if (outcome.blocked) {
      state.blocked = { reason: outcome.reason };
      state.lease = 0;
      return;
    }
    if (outcome.granted > 0) state.lease += outcome.granted;
    state.watermarkText = outcome.watermarkText;
  } catch {
    // server unreachable — retry on next consumption trigger
  }
}

/**
 * Pre-authorizes `requested` pages with the license server, awaiting the
 * response so enforcement (limit, trial watermark, hard block) is reflected at
 * the synchronous point of generation. Call this before generating a known
 * batch. Auto-installs the guard from environment variables if needed.
 *
 * @throws PdfEngineError(LICENSE_REQUIRED) when no key/server URL is configured.
 * @throws PdfEngineError(LICENSE_QUOTA_EXCEEDED, {blocked:true}) when the server
 *   refuses the request (limit reached, license expired/inactive).
 * @returns the page lease remaining after the checkout.
 */
export async function checkout(requested: number = REFILL_AMOUNT): Promise<number> {
  if (!autoGuardState && !tryAutoInstallGuard()) {
    throw new PdfEngineError(
      PdfErrorCode.LICENSE_REQUIRED,
      "checkout() requires the licensing auto-guard: set SEMPDF_LICENSE_KEY " +
        "(and a baked or SEMPDF_LICENSE_SERVER URL).",
    );
  }
  checkoutMode = true;
  const state = autoGuardState!;
  if (state.blocked) {
    throw licenseQuotaError(`Generation blocked by the license server: ${state.blocked.reason}.`, {
      blocked: true,
      reason: state.blocked.reason,
    });
  }
  const want = Math.max(1, Math.floor(requested));
  const shortfall = want - state.lease;
  if (shortfall > 0) {
    const outcome = await authorizeRequest(state, shortfall);
    if (outcome.blocked) {
      state.blocked = { reason: outcome.reason };
      state.lease = 0;
      throw licenseQuotaError(`License server blocked generation: ${outcome.reason}.`, {
        blocked: true,
        reason: outcome.reason,
      });
    }
    state.lease += outcome.granted;
    state.watermarkText = outcome.watermarkText;
  }
  return state.lease;
}

/**
 * Ensures the license server has authorized enough pages for the synchronous
 * serialize that is about to run. This is the async counterpart the library
 * calls from its own async output methods (`save`/`writeTo`/`toUint8ArrayAsync`)
 * so zero-config callers never have to invoke {@link checkout} themselves — the
 * lease-0 "not yet authorized" throw only happens on the purely synchronous
 * {@link PdfDocument.toUint8Array} path, which cannot await a network call.
 *
 * No-op when: a manual guard is installed (its own `consume` governs), the dev
 * bypass is on with no auto-guard, or no `SEMPDF_LICENSE_KEY` is configured
 * (the subsequent synchronous consume reports the standard licensing error).
 * Propagates blocked/expired/over-limit errors from {@link checkout}.
 */
export async function ensureLicenseAuthorized(pages: number): Promise<void> {
  if (autoGuardState === null) {
    if (activeGuard !== undefined) return; // a manual guard governs enforcement
    if (isLicenseDevBypass()) return; // development bypass, nothing to authorize
    if (!tryAutoInstallGuard()) return; // no key configured — let sync consume error
  }
  if (autoGuardState === null) return;
  await checkout(Math.max(1, Math.floor(pages)));
}

/**
 * Flushes any buffered usage to the license server and awaits delivery. The
 * library calls this from its async output methods so a short-lived process
 * (the unref'd flush timer never fires) still records usage before it exits.
 * No-op when no auto-guard is installed.
 */
export async function flushLicenseUsage(): Promise<void> {
  if (autoGuardState !== null) await flushAutoGuard(autoGuardState);
}

async function flushAutoGuard(state: AutoGuardState): Promise<void> {
  const pages = state.consumedPages;
  const docs = state.consumedDocs;
  if (pages <= 0 && docs <= 0) return;
  await captureHostMeta(); // ensure host telemetry is ready for the usage flush
  state.consumedPages = 0;
  state.consumedDocs = 0;
  try {
    await fetch(`${state.serverUrl}/v1/usage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${state.key}`,
      },
      body: JSON.stringify({ documents: docs, pages, status: "success", meta: buildClientMeta(state) }),
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
  checkoutMode = false;
  setLicenseGuard(undefined);
}
