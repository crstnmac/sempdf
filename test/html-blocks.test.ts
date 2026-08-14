import test from "node:test";
import assert from "node:assert/strict";

import {
  createDocument,
  decodeHtmlEntities,
  foldToAscii,
  htmlToBlocks,
  parseDocument,
  PdfEngineError,
  PdfErrorCode,
  renderDocumentJsonSync,
} from "../src/index.js";
import { liberationFixture } from "./font-preset.js";
import type { PdfDocumentJson, TemplateBlock } from "../src/index.js";

function textOf(bytes: Uint8Array): string {
  return parseDocument(bytes)
    .extractText()
    .map((page) => page.text)
    .join("\n");
}

function render(blocks: readonly TemplateBlock[]): Uint8Array {
  const doc = createDocument({ title: "HTML", tagged: true, language: "en" });
  doc.renderTemplate({ blocks });
  return new Uint8Array(doc.toArrayBuffer());
}

test("maps block structure to the matching block types", () => {
  const blocks = htmlToBlocks(
    "<h1>Title</h1><p>Body</p><ul><li>One</li></ul><pre><code>x = 1</code></pre><table><tr><td>c</td></tr></table>",
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["heading", "paragraph", "list", "code", "table"],
  );
  const heading = blocks[0]!;
  assert.equal(heading.type === "heading" && heading.options?.level, 1);
});

test("headingOffset shifts levels and clamps to 1-6", () => {
  const blocks = htmlToBlocks("<h1>a</h1><h6>b</h6>", { headingOffset: 2 });
  const levels = blocks.map((block) => (block.type === "heading" ? block.options?.level : undefined));
  assert.deepEqual(levels, [3, 6]);
});

test("inline elements become rich runs; uniform text stays a plain paragraph", () => {
  const rich = (htmlToBlocks("<p>plain <strong>bold</strong> <em>it</em> <u>u</u> <del>d</del></p>"))[0]!;
  assert.equal(rich.type, "richParagraph");
  assert.deepEqual(
    rich.type === "richParagraph" ? rich.runs.map((run) => [run.text, run.bold, run.italic, run.underline, run.strike]) : [],
    [
      ["plain ", undefined, undefined, undefined, undefined],
      ["bold", true, undefined, undefined, undefined],
      [" ", undefined, undefined, undefined, undefined],
      ["it", undefined, true, undefined, undefined],
      [" ", undefined, undefined, undefined, undefined],
      ["u", undefined, undefined, true, undefined],
      [" ", undefined, undefined, undefined, undefined],
      ["d", undefined, undefined, undefined, true],
    ],
  );

  const plain = (htmlToBlocks("<p>just   text\n  here</p>"))[0]!;
  assert.equal(plain.type, "paragraph");
  assert.equal(plain.type === "paragraph" && plain.text, "just text here");
});

test("nested lists become child items, with labels when the type differs", () => {
  const list = (htmlToBlocks('<ul><li>A<ol start="3"><li>x</li><li>y</li></ol></li><li>B</li></ul>'))[0]!;
  assert.equal(list.type, "list");
  if (list.type !== "list") return;
  assert.equal(list.options?.ordered, false);
  assert.deepEqual(list.items, [
    { body: "A", children: [{ body: "x", label: "3." }, { body: "y", label: "4." }] },
    { body: "B" },
  ]);
});

test("unclosed li and p tags recover without swallowing siblings", () => {
  const blocks = htmlToBlocks("<ul><li>one<li>two<li>three</ul><p>after<p>next");
  const list = (blocks)[0]!;
  assert.equal(list.type === "list" && list.items.length, 3);
  assert.deepEqual(
    blocks.slice(1).map((block) => (block.type === "paragraph" ? block.text : block.type)),
    ["after", "next"],
  );
});

test("tables carry header cells, scope, and spans", () => {
  const table = (htmlToBlocks(
    '<table><thead><tr><th scope="col">H</th><th colspan="2">Wide</th></tr></thead>' +
      '<tbody><tr><td rowspan="2">a</td><td>b</td><td>c</td></tr></tbody></table>',
  ))[0]!;
  assert.equal(table.type, "table");
  if (table.type !== "table") return;
  assert.deepEqual(table.rows[0], [
    { text: "H", header: true, scope: "column" },
    { text: "Wide", header: true, colSpan: 2 },
  ]);
  assert.deepEqual(table.rows[1]?.[0], { text: "a", rowSpan: 2 });
});

test("pre becomes a code block with entities decoded and indentation kept", () => {
  const code = htmlToBlocks(
    '<pre><code class="language-html">&lt;div&gt;\n  &lt;p&gt;hi&lt;/p&gt;\n&lt;/div&gt;</code></pre>',
  )[0]!;
  assert.equal(code.type, "code");
  if (code.type !== "code") return;
  assert.equal(code.language, "html");
  assert.equal(code.code, "<div>\n  <p>hi</p>\n</div>");
});

test("entities decode, including double-encoded input", () => {
  const paragraph = htmlToBlocks("<p>A&amp;mdash;B &#8212; &#x2014; &hellip;</p>", { normalizeText: "none" })[0]!;
  assert.equal(paragraph.type === "paragraph" && paragraph.text, "A—B — — …");
  assert.equal(decodeHtmlEntities("&amp;amp;lt;b&amp;gt;"), "<b>");
  // Unknown references are left as written rather than mangled.
  assert.equal(decodeHtmlEntities("&nosuchentity;"), "&nosuchentity;");
});

test("normalizeText: 'ascii' folds typography the built-in fonts cannot encode", () => {
  const html = "<p>A&mdash;B&nbsp;C &hellip; &rsquo; &euro;5 &copy; &times; &frac12;</p>";
  const folded = (htmlToBlocks(html))[0]!;
  assert.equal(folded.type === "paragraph" && folded.text, "A-B C ... ' EUR5 (c) x 1/2");
  // The default keeps a base-14 document renderable end to end.
  assert.ok(textOf(render(htmlToBlocks(html))).includes("A-B C"));
  const raw = (htmlToBlocks(html, { normalizeText: "none" }))[0]!;
  assert.equal(raw.type === "paragraph" && raw.text, "A—B C … ’ €5 © × ½");
});

test("br splits a rich paragraph into tightly spaced fragments", () => {
  const blocks = htmlToBlocks("<p><strong>one</strong><br>two</p>");
  assert.deepEqual(blocks.map((block) => block.type), ["richParagraph", "richParagraph"]);
  assert.equal((blocks[0]! as { options?: { marginBottom?: number } }).options?.marginBottom, 0);
  const oneLine = htmlToBlocks("<p>one<br>two</p>")[0]!;
  assert.equal(oneLine.type === "paragraph" && oneLine.text, "one\ntwo");
});

test("links keep safe schemes and drop dangerous ones", () => {
  const safe = (htmlToBlocks('<p><a href="https://example.com">ok</a></p>'))[0]!;
  assert.equal(safe.type === "richParagraph" && safe.runs[0]?.link, "https://example.com");

  const unsafe = (htmlToBlocks('<p><a href="javascript:alert(1)">click</a></p>'))[0]!;
  assert.equal(unsafe.type, "paragraph");
  assert.equal(unsafe.type === "paragraph" && unsafe.text, "click");

  const relative = (htmlToBlocks('<p><a href="/docs">rel</a></p>'))[0]!;
  assert.equal(relative.type === "richParagraph" && relative.runs[0]?.link, "/docs");

  const custom = (htmlToBlocks('<p><a href="ftp://host/f">f</a></p>', { allowedLinkSchemes: ["ftp"] }))[0]!;
  assert.equal(custom.type === "richParagraph" && custom.runs[0]?.link, "ftp://host/f");
});

test("scripts, styles, and form controls are dropped with their content", () => {
  const blocks = htmlToBlocks(
    "<p>keep</p><script>alert('x')</script><style>p{color:red}</style><button>press</button><textarea>t</textarea>",
  );
  assert.deepEqual(blocks.map((block) => (block.type === "paragraph" ? block.text : block.type)), ["keep"]);
});

test("images resolve through the callback, else fall back to alt text", () => {
  const bmp = Buffer.alloc(58);
  bmp.write("BM", 0, "ascii");
  bmp.writeUInt32LE(58, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(1, 18);
  bmp.writeInt32LE(1, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(4, 34);

  const image = (htmlToBlocks('<img src="a.bmp" alt="A chart" width="120">', {
    images: (src) => (src === "a.bmp" ? { type: "bmp", data: new Uint8Array(bmp) } : undefined),
  }))[0]!;
  assert.equal(image.type, "bmp");
  assert.equal(image.type === "bmp" && image.options?.altText, "A chart");
  assert.equal(image.type === "bmp" && image.options?.width, 120);

  const fallback = (htmlToBlocks('<img src="missing.png" alt="Sales chart">'))[0]!;
  assert.equal(fallback.type === "paragraph" && fallback.text, "Sales chart");
  // alt="" marks a decorative image: nothing is emitted.
  assert.deepEqual(htmlToBlocks('<img src="d.png" alt="">'), []);
  assert.deepEqual(htmlToBlocks('<img src="m.png" alt="x">', { imageFallback: "drop" }), []);
});

test("blockquote indents its paragraphs and tags them as quotes", () => {
  const quote = (htmlToBlocks("<blockquote><p>cited</p></blockquote>", { blockquoteIndent: 24 }))[0]!;
  assert.equal(quote.type, "paragraph");
  assert.equal(quote.type === "paragraph" && quote.options?.marginLeft, 24);
  assert.equal(quote.type === "paragraph" && quote.options?.tag, "Quote");
});

test("an html template block renders and feeds the TOC and outline", () => {
  const doc = createDocument({ title: "Report", tagged: true, language: "en" });
  doc.renderTemplate({
    blocks: [
      { type: "heading", text: "Contents", options: { level: 1 } },
      { type: "toc" },
      { type: "html", html: "<h1>Alpha</h1><p>a</p><h1>Beta</h1><p>b</p>" },
    ],
    autoOutline: true,
  });
  const bytes = new Uint8Array(doc.toArrayBuffer());
  const text = textOf(bytes);
  assert.ok(text.includes("Contents"));
  // Headings created from HTML appear in the TOC, not just in the body.
  assert.ok(text.indexOf("Alpha") < text.lastIndexOf("Alpha"));
  assert.ok(Buffer.from(bytes).toString("latin1").includes("/Outlines"));
});

test("html blocks pass pagination controls to the blocks they generate", () => {
  const doc = createDocument();
  doc.renderTemplate({
    blocks: [
      { type: "paragraph", text: "first" },
      { type: "html", html: "<p>x</p><p>y</p>", breakBefore: true },
    ],
  });
  assert.equal(doc.pageCount, 2);
  const pages = parseDocument(new Uint8Array(doc.toArrayBuffer())).extractText();
  assert.ok(pages[0]!.text.includes("first"));
  assert.ok(pages[1]!.text.includes("x"));
});

test("html blocks work inside sections and from document JSON", () => {
  const json: PdfDocumentJson = {
    title: "JSON HTML",
    blocks: [
      {
        type: "section",
        role: "Sect",
        blocks: [{ type: "html", html: "<h2>Section heading</h2><ul><li>bullet</li></ul>" }],
      },
    ],
  };
  const text = textOf(renderDocumentJsonSync(json));
  assert.ok(text.includes("Section heading"));
  assert.ok(text.includes("bullet"));
});

test("flow.html renders converted blocks at the cursor", () => {
  const doc = createDocument();
  doc.addPage().flow().html("<h2>Head</h2><p>Body <strong>bold</strong></p>");
  const text = textOf(new Uint8Array(doc.toArrayBuffer()));
  assert.ok(text.includes("Head"));
  assert.ok(text.includes("bold"));
});

test("mark renders a highlight fill behind the run", () => {
  const doc = createDocument();
  doc.addPage().flow().html("<p>plain <mark>lit</mark></p>");
  const ops = doc.toModel().pages[0]!.ops;
  assert.ok(ops.some((op) => op.type === "path"), "expected a highlight fill op");
});

test("hr draws a full-width rule", () => {
  const doc = createDocument();
  doc.addPage().flow().html("<p>a</p><hr><p>b</p>");
  const rules = doc
    .toModel()
    .pages[0]!.ops.filter((op) => op.type === "path" && op.commands.some((command) => command.type === "rect"));
  assert.equal(rules.length, 1);
});

test("empty, whitespace, and non-string input yield no blocks", () => {
  assert.deepEqual(htmlToBlocks(""), []);
  assert.deepEqual(htmlToBlocks("   \n "), []);
  assert.deepEqual(htmlToBlocks("<p></p><div>  </div>"), []);
  // A non-string source is a wiring mistake, not empty content.
  assert.throws(() => htmlToBlocks(undefined as unknown as string), PdfEngineError);
});

test("malformed markup does not throw and keeps its text", () => {
  for (const html of [
    "<p>unclosed",
    "</p>stray close",
    "<p>a < b</p>",
    "<div><span>deep<div>mixed</span></div>",
    '<a href="">no href</a>',
    "<!-- comment only -->",
    "<p>tail<!-- unterminated",
    "<table><tr><td>lone cell",
  ]) {
    assert.doesNotThrow(() => htmlToBlocks(html), html);
  }
  const paragraph = (htmlToBlocks("<p>a < b</p>"))[0]!;
  assert.equal(paragraph.type === "paragraph" && paragraph.text, "a < b");
});

test("converted HTML renders as a tagged, compliant document", () => {
  const blocks = htmlToBlocks(
    "<h1>T</h1><p>p <a href='https://e.com'>link</a></p><ul><li>i</li></ul><table><tr><th>h</th></tr><tr><td>d</td></tr></table>",
  );
  const doc = createDocument({ title: "Tagged HTML", tagged: true, language: "en" });
  doc.renderTemplate({ blocks });
  assert.deepEqual(doc.validateCompliance().filter((issue) => issue.severity === "error"), []);
});

test("accents fold so base-14 fonts can render European text", () => {
  const paragraph = htmlToBlocks("<p>Caf&eacute; Mu&ntilde;oz &uuml;ber</p>")[0]!;
  assert.equal(paragraph.type === "paragraph" && paragraph.text, "Cafe Munoz uber");
  // Letters with no combining-mark decomposition are mapped explicitly.
  assert.equal(foldToAscii("Æøß Đ Þ ıŁ ŋ"), "AEoss D TH iL ng");
  // Rendering the folded text end to end must not throw with built-in fonts.
  assert.doesNotThrow(() => render(htmlToBlocks("<p>Muñoz café Ærø</p>")).byteLength);
});

test("characters with no ASCII form survive 'ascii' and are dropped by 'ascii-only'", () => {
  const kept = htmlToBlocks("<p>Report नमस्ते done</p>")[0]!;
  assert.equal(kept.type, "paragraph");
  assert.ok(
    kept.type === "paragraph" && kept.text.includes("नमस्ते"),
    "content must not vanish silently",
  );

  const stripped = htmlToBlocks("<p>Report नमस्ते ✅ 日本語 done</p>", { normalizeText: "ascii-only" })[0]!;
  assert.equal(stripped.type === "paragraph" && stripped.text, "Report done");
  // "ascii-only" is the never-fail path for pipelines with no embedded font.
  assert.doesNotThrow(() =>
    render(htmlToBlocks("<p>नमस्ते ✅ 日本語 ok</p>", { normalizeText: "ascii-only" })),
  );
  assert.equal(foldToAscii("Café 日本 ✅", true), "Cafe  ");
});

test("an unencodable character reports what it is, where, and how to fix it", () => {
  assert.throws(
    () => render(htmlToBlocks("<p>Hi 日本語 there</p>")),
    (error: unknown) => {
      assert.ok(error instanceof PdfEngineError);
      assert.equal(error.code, PdfErrorCode.UNSUPPORTED_CHARACTER);
      assert.match(error.message, /U\+65E5/);
      assert.match(error.message, /embed a font/i);
      const details = error.details as { character: string; codePoint: number; font: string; excerpt: string };
      assert.equal(details.character, "日");
      assert.equal(details.codePoint, 0x65e5);
      assert.equal(details.font, "Helvetica");
      // The excerpt locates the text in the caller's data.
      assert.ok(details.excerpt.includes("日本語"), details.excerpt);
      return true;
    },
  );
});

test("an embedded font renders the original characters with normalizeText: none", async () => {
  const doc = createDocument({ title: "Unicode" });
  await doc.fonts(liberationFixture);
  doc.renderTemplate({
    page: { font: "Liberation Sans" },
    blocks: htmlToBlocks("<p>Café Muñoz — Привет</p>", {
      normalizeText: "none",
      paragraph: { font: "Liberation Sans" },
    }),
  });
  const text = textOf(new Uint8Array(doc.toArrayBuffer()));
  assert.ok(text.includes("Café"), text);
  assert.ok(text.includes("Привет"), text);
});

test("an html block given the wrong field fails instead of rendering nothing", () => {
  const doc = createDocument();
  assert.throws(
    () => doc.renderTemplate({ blocks: [{ type: "html", text: "<p>hi</p>" }] as unknown as TemplateBlock[] }),
    (error: unknown) => {
      assert.ok(error instanceof PdfEngineError);
      assert.equal(error.code, PdfErrorCode.INVALID_TEXT);
      assert.match(error.message, /`html` field/);
      return true;
    },
  );
});
