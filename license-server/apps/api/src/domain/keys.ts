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
