import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createDocument, PdfEngineError, PdfErrorCode } from "../src/index.js";
import {
  loadExtensionFont,
  loadExtensionFontBytes,
  loadExtensionFontFaces,
} from "../src/chrome-extension-fonts.js";

function findTrueTypeFixturePath(): string | undefined {
  const candidates = [
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Geneva.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ];
  return candidates.find((path) => existsSync(path));
}

type MutableGlobal = {
  chrome?: { runtime?: { getURL?: (path: string) => string } } | undefined;
  fetch: typeof fetch;
};

const globals = globalThis as unknown as MutableGlobal;

function withExtensionEnv(
  fetchImpl: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  const originalChrome = globals.chrome;
  const originalFetch = globals.fetch;
  globals.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://abcdefgh/${path.replace(/^\//, "")}` },
  };
  globals.fetch = fetchImpl;
  return run().finally(() => {
    globals.chrome = originalChrome;
    globals.fetch = originalFetch;
  });
}

test("loadExtensionFontBytes resolves via chrome.runtime.getURL and returns bytes", async () => {
  const payload = new Uint8Array([1, 2, 3, 4]);
  let fetchedUrl: string | undefined;
  await withExtensionEnv(
    (async (input: RequestInfo | URL) => {
      fetchedUrl = String(input);
      return new Response(payload.slice());
    }) as typeof fetch,
    async () => {
      const bytes = await loadExtensionFontBytes("fonts/Roboto-Regular.ttf");
      assert.equal(fetchedUrl, "chrome-extension://abcdefgh/fonts/Roboto-Regular.ttf");
      assert.deepEqual(bytes, payload);
    },
  );
});

test("loadExtensionFontBytes strips ./ prefixes before resolving", async () => {
  let fetchedUrl: string | undefined;
  await withExtensionEnv(
    (async (input: RequestInfo | URL) => {
      fetchedUrl = String(input);
      return new Response(new Uint8Array([1]));
    }) as typeof fetch,
    async () => {
      await loadExtensionFontBytes("./fonts/Roboto-Regular.ttf");
      assert.equal(fetchedUrl, "chrome-extension://abcdefgh/fonts/Roboto-Regular.ttf");
    },
  );
});

test("loadExtensionFontBytes passes absolute URLs through unchanged", async () => {
  const originalFetch = globals.fetch;
  let fetchedUrl: string | undefined;
  globals.fetch = (async (input: RequestInfo | URL) => {
    fetchedUrl = String(input);
    return new Response(new Uint8Array([1]));
  }) as typeof fetch;
  try {
    // No chrome global needed: the URL is already absolute.
    await loadExtensionFontBytes("chrome-extension://abcdefgh/fonts/X.ttf");
    assert.equal(fetchedUrl, "chrome-extension://abcdefgh/fonts/X.ttf");
  } finally {
    globals.fetch = originalFetch;
  }
});

test("loadExtensionFontBytes wraps network failures with web_accessible_resources guidance", async () => {
  await withExtensionEnv(
    (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch,
    async () => {
      await assert.rejects(
        loadExtensionFontBytes("fonts/Roboto-Regular.ttf"),
        (error: unknown) => {
          assert.ok(error instanceof PdfEngineError);
          assert.equal(error.code, PdfErrorCode.INVALID_FONT);
          assert.match(error.message, /web_accessible_resources/);
          assert.match(error.message, /fonts\/Roboto-Regular\.ttf/);
          assert.ok(error.details?.cause instanceof TypeError);
          return true;
        },
      );
    },
  );
});

test("loadExtensionFontBytes reports non-ok HTTP status", async () => {
  await withExtensionEnv(
    (async () => new Response(null, { status: 404 })) as typeof fetch,
    async () => {
      await assert.rejects(
        loadExtensionFontBytes("fonts/Missing.ttf"),
        (error: unknown) => {
          assert.ok(error instanceof PdfEngineError);
          assert.match(error.message, /404/);
          return true;
        },
      );
    },
  );
});

test("loadExtensionFontBytes throws outside an extension context", async () => {
  const originalChrome = globals.chrome;
  globals.chrome = undefined;
  try {
    await assert.rejects(
      loadExtensionFontBytes("fonts/Roboto-Regular.ttf"),
      (error: unknown) => {
        assert.ok(error instanceof PdfEngineError);
        assert.match(error.message, /chrome\.runtime\.getURL/);
        return true;
      },
    );
  } finally {
    globals.chrome = originalChrome;
  }
});

test("loadExtensionFont registers a usable family, matched case-insensitively", async () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }
  const fontBytes = readFileSync(fontPath);
  await withExtensionEnv(
    (async () => new Response(new Uint8Array(fontBytes))) as typeof fetch,
    async () => {
      const doc = createDocument();
      const family = await loadExtensionFont(doc, "Roboto", {
        regular: "fonts/Roboto-Regular.ttf",
        bold: "fonts/Roboto-Bold.ttf",
      });
      assert.equal(family, "Roboto");
      const page = doc.addPage();
      page.text("exact", { x: 56, y: 760, font: "Roboto", fontSize: 12 });
      page.text("lowercase", { x: 56, y: 740, font: "roboto", fontSize: 12 });
      page.text("bold", { x: 56, y: 720, font: "ROBOTO", fontSize: 12, bold: true });
      assert.ok(doc.toUint8Array().length > 0);
    },
  );
});

test("loadExtensionFontFaces fetches only the provided faces", async () => {
  const fetched: string[] = [];
  await withExtensionEnv(
    (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return new Response(new Uint8Array([1]));
    }) as typeof fetch,
    async () => {
      const faces = await loadExtensionFontFaces({
        regular: "fonts/R.ttf",
        italic: "fonts/I.ttf",
      });
      assert.equal(fetched.length, 2);
      assert.ok(faces.regular instanceof Uint8Array);
      assert.ok(faces.italic instanceof Uint8Array);
      assert.equal(faces.bold, undefined);
      assert.equal(faces.boldItalic, undefined);
    },
  );
});
