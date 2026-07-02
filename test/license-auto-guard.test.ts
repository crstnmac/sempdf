import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign } from "node:crypto";

import { createDocument, PdfErrorCode } from "../src/index.js";
import { setLicenseGuard } from "../src/license-guard.js";
import {
  checkout,
  shutdownAutoGuard,
  overrideServerPublicKeys,
} from "../src/internal/license-guard.js";

/**
 * Auto-guard signature verification: with public keys baked (overridden here),
 * only authorize responses provably signed by the license server grant pages.
 */

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

interface MockOptions {
  granted?: number;
  /** Sign the canonical payload correctly (default true). */
  signValid?: boolean;
  /** Omit the signature entirely. */
  omitSignature?: boolean;
}

/** Mock fetch for /v1/authorize + /v1/usage, signing with canonical v2. */
function mockFetch(opts: MockOptions = {}): typeof fetch {
  const granted = opts.granted ?? 100;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith("/v1/usage")) return new Response("{}", { status: 200 });
    assert.ok(href.endsWith("/v1/authorize"), `unexpected fetch: ${href}`);
    const body = JSON.parse(String(init?.body)) as { requested: number; nonce: string };
    const key = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
    const remaining = 1000;
    const resetAt = "";
    const canonical = `v1|${key}|${granted}|${remaining}|${resetAt}|${opts.signValid === false ? "wrong-nonce" : body.nonce}`;
    const payload: Record<string, unknown> = {
      granted,
      remaining,
      resetAt: null,
      nonce: body.nonce,
      kid: "v1",
    };
    if (!opts.omitSignature) {
      payload.signature = edSign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

function withAutoGuard(opts: MockOptions, fn: () => Promise<void>): Promise<void> {
  const realFetch = globalThis.fetch;
  process.env.ZEROPDF_LICENSE_KEY = "test-key";
  globalThis.fetch = mockFetch(opts);
  setLicenseGuard(undefined); // drop the suite's preloaded verified guard
  overrideServerPublicKeys({ v1: publicKeyPem });
  return fn().finally(() => {
    shutdownAutoGuard();
    overrideServerPublicKeys(undefined);
    globalThis.fetch = realFetch;
    delete process.env.ZEROPDF_LICENSE_KEY;
  });
}

function genPdfText(): string {
  const doc = createDocument({ title: "t", compress: false });
  doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  return new TextDecoder("latin1").decode(doc.toUint8Array());
}

test("a correctly signed authorize response grants pages and output is clean", async () => {
  await withAutoGuard({}, async () => {
    const lease = await checkout(5);
    assert.ok(lease >= 5, `expected lease >= 5, got ${lease}`);
    const pdf = genPdfText();
    assert.doesNotMatch(pdf, /UNLICENSED|DEVELOPMENT/);
  });
});

test("a response signed over different data grants nothing (fail closed)", async () => {
  await withAutoGuard({ signValid: false }, async () => {
    const lease = await checkout(5);
    assert.equal(lease, 0);
    assert.throws(genPdfText, (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED);
  });
});

test("an unsigned response grants nothing when public keys are configured", async () => {
  await withAutoGuard({ omitSignature: true }, async () => {
    const lease = await checkout(5);
    assert.equal(lease, 0);
    assert.throws(genPdfText, (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED);
  });
});

test("with no baked keys the auto-guard still works (dev transport trust)", async () => {
  const realFetch = globalThis.fetch;
  process.env.ZEROPDF_LICENSE_KEY = "test-key";
  globalThis.fetch = mockFetch({ omitSignature: true });
  setLicenseGuard(undefined);
  overrideServerPublicKeys({}); // explicit empty = skip verification
  try {
    const lease = await checkout(5);
    assert.ok(lease >= 5);
  } finally {
    shutdownAutoGuard();
    overrideServerPublicKeys(undefined);
    globalThis.fetch = realFetch;
    delete process.env.ZEROPDF_LICENSE_KEY;
  }
});
