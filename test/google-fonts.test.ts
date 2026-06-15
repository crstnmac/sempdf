import test from "node:test";
import assert from "node:assert/strict";

import { loadGoogleFont, PdfEngineError, PdfErrorCode } from "../src/index.js";

const TTF_CSS = `@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3Fwr.ttf) format('truetype');
}`;

const WOFF2_CSS = `@font-face {
  font-family: 'Inter';
  src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3Fwr.woff2) format('woff2');
}`;

function recordingFetch(cssBody: string, fontBytes: Uint8Array) {
  const urls: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("fonts.googleapis.com")) {
      return new Response(cssBody, { status: 200 });
    }
    return new Response(fontBytes as unknown as BodyInit, { status: 200 });
  };
  return { fetchImpl, urls };
}

test("loadGoogleFont fetches the CSS then the TTF and returns its bytes", async () => {
  const fontBytes = Uint8Array.from([0x00, 0x01, 0x00, 0x00, 0x42]);
  const { fetchImpl, urls } = recordingFetch(TTF_CSS, fontBytes);

  const result = await loadGoogleFont("Inter", { weight: 700, fetch: fetchImpl });

  assert.deepEqual(result, fontBytes);
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /family=Inter:ital,wght@0,700/);
  assert.equal(urls[1], "https://fonts.gstatic.com/s/inter/v20/UcCO3Fwr.ttf");
});

test("loadGoogleFont encodes italic and subsetting text into the request", async () => {
  const { fetchImpl, urls } = recordingFetch(TTF_CSS, Uint8Array.of(1));

  await loadGoogleFont("Roboto Slab", { weight: 300, italic: true, text: "Hi!", fetch: fetchImpl });

  assert.match(urls[0]!, /family=Roboto%20Slab:ital,wght@1,300/);
  assert.match(urls[0]!, /&text=Hi!/);
});

test("loadGoogleFont follows a woff2 URL and decodes it (rejecting invalid woff2 bytes)", async () => {
  const { fetchImpl, urls } = recordingFetch(WOFF2_CSS, Uint8Array.of(1));

  // The woff2 URL is followed and handed to the decoder; bogus bytes surface
  // as a WOFF2 decode error rather than an "unsupported format" error.
  await assert.rejects(
    () => loadGoogleFont("Inter", { fetch: fetchImpl }),
    (error: unknown) => {
      assert.ok(error instanceof PdfEngineError);
      assert.equal(error.code, PdfErrorCode.INVALID_FONT);
      assert.match(error.message, /Invalid WOFF2 data/);
      return true;
    },
  );
  assert.equal(urls[1], "https://fonts.gstatic.com/s/inter/v20/UcCO3Fwr.woff2");
});

test("loadGoogleFont surfaces a non-OK CSS response", async () => {
  const fetchImpl = (async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(
    () => loadGoogleFont("Nonexistent Family", { fetch: fetchImpl }),
    (error: unknown) => error instanceof PdfEngineError && /404/.test(error.message),
  );
});

test("loadGoogleFont validates family and weight before any request", async () => {
  const fetchImpl = (async () => {
    throw new Error("fetch should not be called");
  }) as unknown as typeof fetch;

  await assert.rejects(() => loadGoogleFont("   ", { fetch: fetchImpl }), PdfEngineError);
  await assert.rejects(() => loadGoogleFont("Inter", { weight: 0, fetch: fetchImpl }), PdfEngineError);
  await assert.rejects(() => loadGoogleFont("Inter", { weight: 1500, fetch: fetchImpl }), PdfEngineError);
});
