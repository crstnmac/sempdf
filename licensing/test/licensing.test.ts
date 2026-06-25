import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { createDocument, PdfErrorCode } from "@sempdf/sempdf-pdf";
import { LicenseClient, createLicenseClient, canonicalAuthPayload } from "../src/index.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function genOnePdf(): void {
  const doc = createDocument({ title: "t" });
  doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  doc.toUint8Array();
}

/** A mock license server backed by an in-memory quota counter. */
function mockServer(opts: {
  quota: number;
  sign?: boolean;
  watermark?: boolean;
  watermarkText?: string;
  usageLog?: Array<{ documents: number; pages: number; status?: string | undefined; jobDescription?: string | undefined }>;
}): typeof fetch {
  let used = 0;
  return (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init?.body));
    const key = String((init?.headers as Record<string, string>)?.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (path === "/v1/authorize") {
      const remaining = Math.max(0, opts.quota - used);
      const granted = Math.min(body.requested, remaining);
      used += granted;
      if (granted === 0) {
        return new Response(JSON.stringify({ remaining: 0 }), { status: 402 });
      }
      const resp: Record<string, unknown> = {
        granted,
        remaining: opts.quota - used,
        nonce: body.nonce,
        watermark: opts.watermark ?? false,
        watermarkText: opts.watermarkText ?? null,
        status: opts.watermark ? "grace_period" : "none",
      };
      if (opts.sign !== false) {
        const payload = canonicalAuthPayload(key, resp as never);
        resp.signature = nodeSign(null, payload, privateKey).toString("base64");
      }
      return new Response(JSON.stringify(resp), { status: 200 });
    }
    if (path === "/v1/usage") {
      opts.usageLog?.push({
        documents: Number(body.documents),
        pages: Number(body.pages),
        status: body.status === undefined ? undefined : String(body.status),
        jobDescription: body.jobDescription === undefined ? undefined : String(body.jobDescription),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

function genPdf(pages: number): void {
  const doc = createDocument({ title: "t" });
  for (let i = 0; i < pages; i += 1) doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  doc.toUint8Array();
}

test.afterEach(() => LicenseClient.uninstall());

test("no client installed: generation is refused (secure by default)", () => {
  assert.throws(genOnePdf, (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_REQUIRED);
});

test("checkout grants a lease that generation draws down", async () => {
  const client = await createLicenseClient({
    key: "k", serverUrl: "https://lic.test", fetch: mockServer({ quota: 100 }), publicKeyPem,
  });
  assert.equal(await client.checkout(3), 3);
  assert.equal(client.state().remaining, 3);
  genOnePdf();
  genOnePdf();
  assert.equal(client.state().remaining, 1);
});

test("exhausted lease blocks generation with LICENSE_QUOTA_EXCEEDED", async () => {
  const client = await createLicenseClient({
    key: "k", serverUrl: "https://lic.test", fetch: mockServer({ quota: 100 }), publicKeyPem,
  });
  await client.checkout(1);
  genOnePdf();
  assert.throws(genOnePdf, (e: unknown) => e instanceof Error && (e as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED);
});

test("server quota limit caps the granted lease", async () => {
  const client = await createLicenseClient({
    key: "k", serverUrl: "https://lic.test", fetch: mockServer({ quota: 2 }), publicKeyPem,
  });
  assert.equal(await client.checkout(10), 2); // server only has 2 left
  await assert.rejects(() => client.checkout(10), (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED);
});

test("invalid signature is rejected", async () => {
  // Server signs with a DIFFERENT key than the client trusts.
  const other = generateKeyPairSync("ed25519");
  const otherPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();
  const client = await createLicenseClient({
    key: "k", serverUrl: "https://lic.test", fetch: mockServer({ quota: 100 }), publicKeyPem: otherPem,
  });
  await assert.rejects(() => client.checkout(1), /signature verification failed/);
});

test("fail-closed: unreachable server blocks checkout", async () => {
  const failing = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const client = await createLicenseClient({
    key: "k", serverUrl: "https://lic.test", fetch: failing, failMode: "closed",
  });
  await assert.rejects(() => client.checkout(1), (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED);
});

test("fail-open: grace lease after a prior good checkout", async () => {
  let calls = 0;
  const flaky = (async (url: string | URL, init?: RequestInit) => {
    calls += 1;
    if (calls > 1 && new URL(url).pathname === "/v1/authorize") throw new Error("ECONNREFUSED");
    return mockServer({ quota: 100 })(url as never, init);
  }) as unknown as typeof fetch;
  const client = await createLicenseClient({
    key: "k", serverUrl: "https://lic.test", fetch: flaky, failMode: "open", graceUnits: 5, publicKeyPem,
  });
  await client.checkout(1);          // good checkout primes grace window
  const grace = await client.checkout(10); // server down -> grace lease
  assert.equal(grace, 5);
  assert.equal(client.state().grace, true);
});

test("default meter (pages): lease counts pages, flush reports both dimensions", async () => {
  const usageLog: Array<{ documents: number; pages: number; status?: string | undefined; jobDescription?: string | undefined }> = [];
  const client = await createLicenseClient({
    key: "k", serverUrl: "https://lic.test", fetch: mockServer({ quota: 100, usageLog }), publicKeyPem,
  });
  await client.checkout(5);
  genPdf(3);  // 1 doc, 3 pages
  genPdf(2);  // 1 doc, 2 pages
  assert.equal(client.state().remaining, 0);          // 5 - 5 pages
  assert.equal(client.state().consumedDocuments, 2);
  assert.equal(client.state().consumedPages, 5);
  await client.flush();
  assert.deepEqual(usageLog, [{ documents: 2, pages: 5, status: "success", jobDescription: undefined }]); // "2 PDFs, 5 pages"
});

test("meter 'pages': lease counts pages and blocks when short", async () => {
  const client = await createLicenseClient({
    key: "k", serverUrl: "https://lic.test", fetch: mockServer({ quota: 100 }), publicKeyPem, meter: "pages",
  });
  await client.checkout(10);
  genPdf(4); // consumes 4 pages
  assert.equal(client.state().remaining, 6);
  assert.throws(() => genPdf(7), (e: unknown) => (e as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED);
  assert.equal(client.state().remaining, 6); // unchanged; blocked before serialize
});

test("watermarked authorization stamps generated PDFs and reports watermarked usage", async () => {
  const usageLog: Array<{ documents: number; pages: number; status?: string | undefined; jobDescription?: string | undefined }> = [];
  const client = await createLicenseClient({
    key: "k",
    serverUrl: "https://lic.test",
    fetch: mockServer({ quota: 100, usageLog, watermark: true, watermarkText: "Trial Mode" }),
    publicKeyPem,
    jobDescription: "August bank statement, 200000 pages",
  });
  await client.checkout(3);
  const doc = createDocument({ title: "t", compress: false });
  doc.addPage({ size: "A4" }).text("x", { x: 24, y: 700 });
  const pdf = new TextDecoder("latin1").decode(doc.toUint8Array());
  assert.match(pdf, /Trial Mode/);
  await client.flush();
  assert.deepEqual(usageLog, [{
    documents: 1,
    pages: 1,
    status: "watermarked",
    jobDescription: "August bank statement, 200000 pages",
  }]);
});
