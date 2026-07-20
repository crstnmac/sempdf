import { createHash, randomBytes } from "node:crypto";

/** Non-secret prefix on every licence key (helps identify keys in logs/UI). */
const KEY_PREFIX = "a11y_";
/** Characters kept for display, e.g. "a11y_x7Kf3Qa9". */
const PREFIX_DISPLAY_LEN = KEY_PREFIX.length + 8;

/** Generates a new random licence key (the only time the plaintext exists). */
export function generateKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

/** SHA-256 hex of a key — what we store and look up by. */
export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** First few non-secret characters of a key, for display/identification. */
export function keyPrefix(key: string): string {
  return key.slice(0, PREFIX_DISPLAY_LEN);
}

/**
 * Normalizes a browser origin to `scheme://host[:port]` (lowercased, no path).
 * Returns null when the value is not a valid origin. Extension schemes
 * (chrome-extension://, moz-extension://) are supported — `URL.origin` yields
 * "null" for them in Node, so they are rebuilt from protocol + host.
 */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!url.host) return null;
  if (url.username || url.password) return null;
  if (url.origin && url.origin !== "null") return url.origin.toLowerCase();
  // Non-special schemes (extension pages): URL.origin is the literal "null".
  return `${url.protocol}//${url.host}`.toLowerCase();
}

/**
 * Applies a key's origin allowlist to a request Origin header. An empty/null
 * list means the key is unrestricted. A non-empty list rejects requests with
 * NO Origin header by design: pinned keys are browser/extension-only, and
 * omitting the header is the trivial bypass (non-browser callers should use an
 * unpinned key). Entries are assumed already normalized at write time; the
 * request origin is normalized before comparing.
 */
export function originAllowed(allowed: string[] | null | undefined, origin: string | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowed.includes(normalized);
}
