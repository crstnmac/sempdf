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

test("registered family resolves in template tables and lists (page-level font)", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }
  const fontBytes = readFileSync(fontPath);
  const doc = createDocument();
  doc.registerFontFamily("Roboto", { regular: new Uint8Array(fontBytes) });
  doc.renderTemplate({
    page: { size: "A4", margin: 70, font: "Roboto" },
    pageNumber: { region: "footer", align: "right" },
    blocks: [
      { type: "heading", text: "Title", options: { level: 1, bold: true } },
      { type: "paragraph", text: "Body" },
      {
        type: "table",
        rows: [
          [{ text: "Results", header: true }, { text: "Level A", header: true }],
          ["Fail", "3"],
        ],
        options: { headerRows: 1 },
      },
      { type: "list", items: ["one", "two"] },
    ],
  });
  assert.ok(doc.toUint8Array().length > 0);
});

test("flow table and list resolve a registered family font", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }
  const fontBytes = readFileSync(fontPath);
  const doc = createDocument();
  doc.registerFontFamily("Roboto", { regular: new Uint8Array(fontBytes) });
  const flow = doc.addPage().flow({ font: "Roboto" });
  flow.table([["a", "b"], ["c", "d"]]);
  flow.list(["one", "two"], {});
  assert.ok(doc.toUint8Array().length > 0);
});

test("table cell bold flag resolves the built-in bold variant", () => {
  const doc = createDocument();
  doc.addPage().table(
    [[{ text: "Results", header: true, bold: true }, "plain"]],
    { x: 56, y: 700, width: 300 },
  );
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Helvetica-Bold/);
});

test("table cell bold flag picks the bold face of a registered family", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }
  const fontBytes = readFileSync(fontPath);
  const doc = createDocument();
  // Bold face registered as a built-in name so the output is assertable.
  doc.registerFontFamily("Roboto", {
    regular: new Uint8Array(fontBytes),
    bold: "Helvetica-Bold",
  });
  const flow = doc.addPage().flow({ font: "Roboto" });
  flow.table([[{ text: "Header", bold: true }, "body"]]);
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Helvetica-Bold/);
  assert.match(text, /\/FontFile2/);
});

test("fallbackFonts resolve registered family names (case-insensitive)", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }
  const fontBytes = readFileSync(fontPath);
  const doc = createDocument();
  const handle = doc.embedTrueTypeFont(new Uint8Array(fontBytes), { family: "Mono" });
  try {
    // Skip when the fixture font itself lacks the probe glyph.
    doc.measureText("Ω", { font: handle });
  } catch {
    return;
  }
  doc.registerFontFamily("Mono", { regular: handle });

  // Helvetica lacks Ω; pre-fix the family-name fallback never matched and threw.
  const viaFamily = doc.measureText("aΩ", { font: "Helvetica", fallbackFonts: ["mono"] });
  const viaHandle = doc.measureText("aΩ", { font: "Helvetica", fallbackFonts: [handle] });
  assert.equal(viaFamily.width, viaHandle.width);

  assert.throws(
    () => doc.measureText("aΩ", { font: "Helvetica" }),
    (error: unknown) => error instanceof PdfEngineError,
  );
});

test("table cells accept font, color, and align overrides", () => {
  const doc = createDocument();
  doc.addPage().table(
    [
      [
        { text: "Mono", font: "Courier" },
        { text: "Red right", color: "red", align: "right" },
        "plain",
      ],
    ],
    { x: 56, y: 700, width: 400 },
  );
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Courier/);
  assert.match(text, /1 0 0 rg/);
});

test("unknown cell font reports a clear error", () => {
  const doc = createDocument();
  assert.throws(
    () =>
      doc.addPage().table([[{ text: "x", font: "Nope" }]], { x: 56, y: 700, width: 200 }),
    (error: unknown) => {
      assert.ok(error instanceof PdfEngineError);
      assert.match(error.message, /Unknown font "Nope"/);
      return true;
    },
  );
});

test("cell font override resolves a registered family with bold flag", () => {
  const fontPath = findTrueTypeFixturePath();
  if (!fontPath) {
    return;
  }
  const doc = createDocument();
  doc.registerFontFamily("Custom", {
    regular: new Uint8Array(readFileSync(fontPath)),
    bold: "Times-Bold",
  });
  doc.addPage().table(
    [[{ text: "head", font: "custom", bold: true }, "body"]],
    { x: 56, y: 700, width: 300 },
  );
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Times-Bold/);
});

test("table draws borders, header background, zebra stripes, and cell background", () => {
  const doc = createDocument();
  doc.addPage().table(
    [
      [{ text: "H1", header: true }, { text: "H2", header: true }],
      ["a", "b"],
      ["c", { text: "d", background: "yellow" }],
      ["e", "f"],
    ],
    {
      x: 56,
      y: 700,
      width: 300,
      headerRows: 1,
      borderColor: "black",
      borderWidth: 1,
      headerBackground: "gray",
      zebra: true,
    },
  );
  const text = new TextDecoder().decode(doc.toUint8Array());
  // fills (header gray, zebra gray, yellow) and stroked grid lines present
  assert.match(text, /re|l\n/);
  assert.match(text, /1 1 0 rg/);
  assert.match(text, /f\n/);
  assert.match(text, /S\n/);
});

test("table without styling options emits no decoration ops", () => {
  const doc = createDocument();
  doc.addPage().table([["a", "b"]], { x: 56, y: 700, width: 200 });
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.doesNotMatch(text, /1 1 0 rg/);
});

test("table cells render inline rich-text runs with mixed styles and links", () => {
  const doc = createDocument();
  doc.addPage().table(
    [
      [
        {
          runs: [
            { text: "Status: ", bold: true },
            { text: "passing", color: "green", underline: true },
            { text: " docs", link: "https://example.com" },
          ],
        },
        "plain",
      ],
    ],
    { x: 56, y: 700, width: 320 },
  );
  const text = new TextDecoder().decode(doc.toUint8Array());
  assert.match(text, /\/Helvetica-Bold/);
  assert.match(text, /\/URI \(https:\/\/example\.com\)/);
  assert.match(text, /0 (0\.50\d+|0\.5) 0 rg/);
});

test("table cell rejects both text and runs", () => {
  const doc = createDocument();
  assert.throws(
    () =>
      doc.addPage().table(
        [[{ text: "x", runs: [{ text: "y" }] }]],
        { x: 56, y: 700, width: 200 },
      ),
    (error: unknown) => {
      assert.ok(error instanceof PdfEngineError);
      assert.match(error.message, /either text or runs/);
      return true;
    },
  );
});

test("flow table with rich cells reserves matching row heights", () => {
  const doc = createDocument();
  const flow = doc.addPage().flow({});
  flow.table([
    [{ runs: [{ text: "Large", fontSize: 30 }] }, "small"],
  ]);
  assert.ok(doc.toUint8Array().length > 0);
});
