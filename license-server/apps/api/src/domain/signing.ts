import { createPrivateKey, createPublicKey, sign as edSign, generateKeyPairSync } from "node:crypto";

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

/** Signs the canonical authorize payload, returning a base64 signature. */
export function signAuthorize(payload: {
  key: string;
  granted: number;
  remaining: number;
  resetAt: string | null;
  nonce: string;
}): string {
  cachedKey ??= loadPrivateKey();
  // Must match the client's canonicalAuthPayload exactly.
  const text = `${payload.key}|${payload.granted}|${payload.remaining}|${payload.resetAt ?? ""}|${payload.nonce}`;
  return edSign(null, Buffer.from(text, "utf8"), cachedKey).toString("base64");
}

/** Returns the SPKI PEM public key for clients to configure as `publicKeyPem`. */
export function publicKeyPem(): string {
  cachedKey ??= loadPrivateKey();
  return createPublicKey(cachedKey).export({ type: "spki", format: "pem" }).toString();
}

/** Generates a fresh Ed25519 keypair (used by the keygen script). */
export function generateSigningKeypair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
