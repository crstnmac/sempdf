import { createPrivateKey, createPublicKey, sign as edSign, generateKeyPairSync } from "node:crypto";

import { env } from "../env.js";

/**
 * Loads the Ed25519 signing key from `LICENSE_SIGNING_KEY` (SPKI/PKCS8 PEM). The
 * matching public key (SPKI PEM) is shipped to clients so they can verify that
 * an "allow" response genuinely came from this server.
 */
function loadPrivateKey() {
  const pem = process.env.LICENSE_SIGNING_KEY;
  if (!pem) {
    throw new Error("LICENSE_SIGNING_KEY is not set. Generate one with `npm run keygen`.");
  }
  return createPrivateKey(pem);
}

let cachedKey: ReturnType<typeof createPrivateKey> | undefined;

/** The id (`kid`) of the active signing key, advertised to clients. */
export function signingKid(): string {
  return env.signing.kid;
}

/**
 * Signs the canonical authorize payload, returning a base64 signature.
 *
 * CANONICAL FORM (v3):
 * `kid|key|granted|remaining|resetAt|nonce|watermark|watermarkText`.
 * The leading `kid` supports key rotation: clients read `kid` from the
 * response, look up the matching public key, and verify against the SAME
 * canonical string (which begins with that kid). v3 folds the watermark flag
 * and text into the signed payload so a tampering proxy cannot strip a trial /
 * over-limit watermark from an otherwise valid response. `watermark` is
 * canonicalized as `1`/`0`; `watermarkText` is LAST so embedded `|` characters
 * cannot shift earlier fields. Must stay byte-for-byte identical to
 * `canonicalAuthorizePayload` in the core library and the licensing client.
 */
export function signAuthorize(payload: {
  key: string;
  granted: number;
  remaining: number;
  resetAt: string | null;
  nonce: string;
  watermark: boolean;
  watermarkText: string | null;
}): { signature: string; kid: string } {
  cachedKey ??= loadPrivateKey();
  const kid = signingKid();
  const text =
    `${kid}|${payload.key}|${payload.granted}|${payload.remaining}|${payload.resetAt ?? ""}|${payload.nonce}` +
    `|${payload.watermark ? 1 : 0}|${payload.watermarkText ?? ""}`;
  return { signature: edSign(null, Buffer.from(text, "utf8"), cachedKey).toString("base64"), kid };
}

let cachedPublicPem: string | undefined;

/** SPKI PEM of the primary public key (used internally and as a fallback). */
export function publicKeyPem(): string {
  cachedKey ??= loadPrivateKey();
  // The PEM never changes for a given key — derive + export once, then serve the
  // cached string. /v1/public-key is hit by every client at startup.
  cachedPublicPem ??= createPublicKey(cachedKey).export({ type: "spki", format: "pem" }).toString();
  return cachedPublicPem;
}

/**
 * Parses optional previous keys for rotation from `LICENSE_SIGNING_PUBKEYS_PREV`,
 * a comma-separated list of `kid:base64(spkiPem)` entries. These are
 * verification-only public keys clients may still need during a rollover window
 * (responses signed before rotation carry the old `kid`). Signing always uses the
 * single primary private key; previous keys are never used to sign here.
 */
function previousPublicKeys(): { kid: string; publicKeyPem: string }[] {
  const raw = process.env.LICENSE_SIGNING_PUBKEYS_PREV;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      if (idx < 0) throw new Error(`LICENSE_SIGNING_PUBKEYS_PREV entry missing kid: ${entry}`);
      const kid = entry.slice(0, idx).trim();
      const b64 = entry.slice(idx + 1).trim();
      return { kid, publicKeyPem: Buffer.from(b64, "base64").toString("utf8") };
    });
}

/**
 * The public-key bundle served at /v1/public-key. Clients select the entry whose
 * `kid` matches the `kid` field of an authorize response. `primary` is the key
 * currently used for signing; `keys` lists every key (primary + any previous
 * rotation keys) usable for verification.
 */
export function publicKeyBundle(): {
  kid: string;
  publicKeyPem: string;
  keys: { kid: string; publicKeyPem: string }[];
} {
  const primaryKid = signingKid();
  const primaryPem = publicKeyPem();
  const keys = [{ kid: primaryKid, publicKeyPem: primaryPem }, ...previousPublicKeys()];
  return { kid: primaryKid, publicKeyPem: primaryPem, keys };
}

/** Generates a fresh Ed25519 keypair (used by the keygen script). */
export function generateSigningKeypair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
