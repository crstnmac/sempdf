import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, hex, parseDocument, PdfEngineError, PdfErrorCode, renderDocumentJsonSync } from "../src/index.js";
import type { PdfDocumentJson, TemplateBlock } from "../src/index.js";

const HTML_SNIPPET = [
  '<div class="card">',
  '  <img src="hero.png" alt="">',
  "  <p>Hello &amp; welcome</p>",
  "</div>",
].join("\n");

function textOf(bytes: Uint8Array): string[] {
  return parseDocument(bytes)
    .extractText()
    .map((page) => page.text);
}

function runsOf(bytes: Uint8Array) {
  return parseDocument(bytes)
    .extractText()
    .flatMap((page, index) => page.runs.map((run) => ({ ...run, page: index })));
}

test("renders an HTML snippet as a code block preserving indentation", () => {
  const doc = createDocument({ title: "Code" });
  const page = doc.addPage();
  page.flow().render([
    { type: "heading", text: "Markup", options: { level: 2 } },
    { type: "code", code: HTML_SNIPPET, language: "html" },
  ] satisfies TemplateBlock[]);
  const bytes = new Uint8Array(doc.toArrayBuffer());

  const codeRuns = runsOf(bytes).filter((run) => run.text.includes("<"));
  assert.deepEqual(
    codeRuns.map((run) => run.text),
    HTML_SNIPPET.split("\n"),
  );
  // Indentation is kept as real spaces inside the run, so copied text keeps it
  // and every line shares one left edge.
  assert.equal(new Set(codeRuns.map((run) => Math.round(run.x))).size, 1);
  // Lines stack downward, one lineHeight apart.
  const [openDiv, img] = codeRuns;
  assert.ok(openDiv!.y > img!.y);
  assert.ok(Math.abs(openDiv!.y - img!.y - Math.round(9 * 1.35 * 100) / 100) < 0.01);
});

test("tabs expand and \\r\\n normalizes", () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.flow().code("a\r\n\tb\r\n", { tabSize: 2 });
  const texts = runsOf(new Uint8Array(doc.toArrayBuffer())).map((run) => run.text);
  assert.deepEqual(texts, ["a", "  b"]);
});

test("long lines soft-wrap with a hanging indent and can be clipped instead", () => {
  const line = `    <span data-attribute="${"x".repeat(400)}">text</span>`;
  const wrapped = createDocument();
  wrapped.addPage().flow().code(line);
  const wrappedRuns = runsOf(new Uint8Array(wrapped.toArrayBuffer()));
  assert.ok(wrappedRuns.length > 1, "expected the line to wrap onto several lines");
  // Continuation lines repeat the wrapped line's own indentation.
  assert.ok(wrappedRuns[1]!.text.startsWith("    "));
  assert.equal(Math.round(wrappedRuns[1]!.x), Math.round(wrappedRuns[0]!.x));
  const joined = wrappedRuns.map((run) => run.text.trimStart()).join("");
  assert.ok(joined.includes("x".repeat(50)));
  assert.ok(joined.endsWith(">text</span>"));

  const clipped = createDocument();
  clipped.addPage().flow().code(line, { wrap: false });
  assert.equal(runsOf(new Uint8Array(clipped.toArrayBuffer())).length, 1);
});

test("a code block longer than a page splits across pages", () => {
  const source = Array.from({ length: 160 }, (_, i) => `line ${i + 1}`).join("\n");
  const doc = createDocument({ title: "Long code" });
  doc.renderTemplate({
    blocks: [{ type: "code", code: source, options: { lineNumbers: true } }],
  });
  const bytes = new Uint8Array(doc.toArrayBuffer());
  const pages = textOf(bytes);
  assert.ok(pages.length > 1, `expected multiple pages, got ${pages.length}`);
  const joined = pages.join("\n");
  assert.ok(joined.includes("line 1"));
  assert.ok(joined.includes("line 160"));
  // Every source line is rendered exactly once.
  const rendered = runsOf(bytes).filter((run) => run.text.startsWith("line "));
  assert.equal(rendered.length, 160);
  // The gutter numbers the last line too.
  assert.ok(runsOf(bytes).some((run) => run.text === "160"));
});

test("background and border bands are drawn once per fragment", () => {
  const source = Array.from({ length: 120 }, (_, i) => `row ${i}`).join("\n");
  const doc = createDocument();
  doc.renderTemplate({
    blocks: [{ type: "code", code: source, options: { borderWidth: 1 } }],
  });
  const model = doc.toModel();
  const bands = model.pages.flatMap((page) =>
    page.ops.filter((op) => op.type === "path" && op.commands.some((command) => command.type === "rect")),
  );
  assert.equal(bands.length, model.pages.length);
});

test("highlight rules color spans and earlier rules win", () => {
  const doc = createDocument();
  doc.addPage().flow().code('<b class="x">hi</b>', {
    highlight: [
      { pattern: /"[^"]*"/, color: hex("#0a3069") },
      { pattern: /class/, color: hex("#cf222e") },
      { pattern: /<\/?[a-z]+/, color: hex("#116329") },
    ],
  });
  const runs = runsOf(new Uint8Array(doc.toArrayBuffer()));
  const texts = runs.map((run) => run.text);
  assert.ok(texts.includes("class"), `spans were ${JSON.stringify(texts)}`);
  assert.ok(texts.some((text) => text.includes('"x"')));
  assert.ok(texts.includes("<b"));
});

test("code blocks are tagged as Code inside a P", () => {
  const doc = createDocument({ title: "Tagged", tagged: true, language: "en" });
  doc.addPage().flow().code("const a = 1;", {}, "ts");
  const model = doc.toModel();
  const roles = model.pages.flatMap((page) => [...(page.structureNodes?.values() ?? [])].map((node) => node.role));
  assert.ok(roles.includes("Code"), `roles were ${JSON.stringify(roles)}`);
  assert.ok(roles.includes("P"));
  assert.deepEqual(doc.validateCompliance().filter((issue) => issue.severity === "error"), []);
  // The code text must actually be marked content inside that element, and the
  // language recorded as its expansion text.
  const raw = Buffer.from(doc.toArrayBuffer()).toString("latin1");
  assert.match(raw, /\/Code <<\/MCID 0>> BDC/);
  assert.ok(raw.includes("/E (ts)"));
});

test("line-number gutter is emitted as an artifact, not read as code", () => {
  const doc = createDocument({ title: "Gutter", tagged: true, language: "en", compress: false });
  doc.addPage().flow().code("a\nb", { lineNumbers: true });
  const raw = Buffer.from(doc.toArrayBuffer()).toString("latin1");
  const codeMarks = [...raw.matchAll(/\/Code <<\/MCID \d+>> BDC/g)];
  assert.equal(codeMarks.length, 2);
  // Two gutter numbers plus the background band.
  assert.equal([...raw.matchAll(/\/Artifact BMC/g)].length, 3);
});

test("tag: 'Artifact' leaves the code untagged", () => {
  const doc = createDocument({ tagged: true });
  doc.addPage().flow().code("x", { tag: "Artifact" });
  const roles = doc
    .toModel()
    .pages.flatMap((page) => [...(page.structureNodes?.values() ?? [])].map((node) => node.role));
  assert.ok(!roles.includes("Code"));
});

test("renders code blocks from document JSON with string highlight patterns", () => {
  const json: PdfDocumentJson = {
    title: "JSON code",
    blocks: [
      {
        type: "code",
        code: HTML_SNIPPET,
        options: {
          background: "none",
          lineNumbers: true,
          highlight: [{ pattern: "img", color: hex("#cf222e") }],
        },
      },
    ],
  };
  const bytes = renderDocumentJsonSync(json);
  const text = textOf(bytes).join("\n");
  assert.ok(text.includes("hero.png"));
  assert.ok(runsOf(bytes).some((run) => run.text === "img"));
});

test("rejects invalid code block options", () => {
  const flow = createDocument().addPage().flow();
  assert.throws(() => flow.code("x", { fontSize: 0 }), PdfEngineError);
  assert.throws(() => flow.code("x", { padding: -1 }), PdfEngineError);
  assert.throws(() => flow.code("x", { tabSize: 1.5 }), PdfEngineError);
  assert.throws(() => flow.code("x", { lineHeight: 0 }), PdfEngineError);
});

test("strictLayout accepts a self-paginating code block but still honors maxPages", () => {
  const source = Array.from({ length: 300 }, (_, i) => `l${i}`).join("\n");
  const ok = createDocument();
  ok.renderTemplate({ blocks: [{ type: "code", code: source }], strictLayout: true });
  assert.ok(ok.pageCount > 2);

  const capped = createDocument();
  assert.throws(
    () => capped.renderTemplate({ blocks: [{ type: "code", code: source }], strictLayout: { maxPages: 2 } }),
    PdfEngineError,
  );
});

test("splits across flow columns and repeats the band per column", () => {
  const source = Array.from({ length: 80 }, (_, i) => `col ${i}`).join("\n");
  const doc = createDocument({ title: "Columns" });
  doc.renderTemplate({
    page: { columns: { count: 2 } },
    blocks: [
      { type: "heading", text: "Two-column code", options: { level: 2 } },
      { type: "code", code: source },
    ],
  });
  assert.equal(doc.pageCount, 1);
  const bytes = new Uint8Array(doc.toArrayBuffer());
  const runs = runsOf(bytes).filter((run) => run.text.startsWith("col "));
  assert.equal(runs.length, 80);
  // Two column positions, and the block starts in the first column beside its heading.
  const columns = [...new Set(runs.map((run) => Math.round(run.x)))].sort((a, b) => a - b);
  assert.equal(columns.length, 2);
  assert.equal(Math.round(runs[0]!.x), columns[0]);
  const bands = doc
    .toModel()
    .pages.flatMap((page) => page.ops.filter((op) => op.type === "path"));
  assert.equal(bands.length, 2);
});

test("keeps every line when no further region is available", () => {
  const source = Array.from({ length: 90 }, (_, i) => `l${i}`).join("\n");
  const doc = createDocument();
  // A bare page flow has no overflow handler: the fragment must not be dropped.
  doc.addPage({ size: "A6" }).flow().code(source);
  const runs = runsOf(new Uint8Array(doc.toArrayBuffer()));
  assert.equal(runs.length, 90);
});

test("an empty or whitespace-only source renders nothing", () => {
  for (const code of ["", "   ", "\n\n", "\t"]) {
    const doc = createDocument();
    // A sibling paragraph keeps the page non-empty; the code block itself must
    // contribute no band and no text.
    doc.renderTemplate({ blocks: [{ type: "paragraph", text: "only me" }, { type: "code", code }] });
    const ops = doc.toModel().pages.flatMap((page) => page.ops);
    assert.deepEqual(
      ops.map((op) => op.type),
      ["text"],
      `expected no code ops for ${JSON.stringify(code)}`,
    );
  }
  const flow = createDocument().addPage().flow();
  const before = flow.cursorY;
  flow.code("");
  assert.equal(flow.cursorY, before, "an empty code block must not move the cursor");
});

test("a missing or misnamed code field fails with an actionable error", () => {
  for (const block of [
    { type: "code" },
    { type: "code", text: "x = 1" },
    { type: "code", code: null },
    { type: "code", code: 42 },
  ] as unknown as TemplateBlock[]) {
    const doc = createDocument();
    // The estimate pass runs first, so the guard has to live there too — this
    // used to surface as `TypeError: Cannot read properties of undefined`.
    assert.throws(
      () => doc.renderTemplate({ blocks: [block] }),
      (error: unknown) => {
        assert.ok(error instanceof PdfEngineError, `got ${String(error)}`);
        assert.equal(error.code, PdfErrorCode.INVALID_TEXT);
        assert.match(error.message, /`code` field/);
        return true;
      },
      JSON.stringify(block),
    );
  }
  const flow = createDocument().addPage().flow();
  assert.throws(() => flow.code(undefined as unknown as string), PdfEngineError);
});

test("every text-bearing block names its field when the value is missing", () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ type: "paragraph", code: "x" }, /Paragraph text .*`text` field/],
    [{ type: "heading", options: { level: 3 } }, /Heading text .*`text` field/],
    [{ type: "richParagraph" }, /Rich paragraph runs .*`runs` field/],
    [{ type: "list" }, /List items .*`items` field/],
    [{ type: "table" }, /Table rows .*`rows` field/],
  ];
  for (const [block, expected] of cases) {
    const doc = createDocument();
    assert.throws(
      () => doc.renderTemplate({ blocks: [block] as unknown as TemplateBlock[] }),
      (error: unknown) => {
        assert.ok(error instanceof PdfEngineError, `${JSON.stringify(block)} threw ${String(error)}`);
        assert.equal(error.code, PdfErrorCode.INVALID_TEXT);
        assert.match(error.message, expected);
        return true;
      },
      JSON.stringify(block),
    );
  }
});

test("continuation notes mark where a split listing resumes and carries on", () => {
  const source = Array.from({ length: 130 }, (_, i) => `line ${i + 1}`).join("\n");
  const doc = createDocument({ title: "Continuity" });
  doc.renderTemplate({
    blocks: [
      {
        type: "code",
        code: source,
        options: {
          lineNumbers: true,
          continuedLabel: ({ firstLineNumber, fragmentIndex }) => `from ${firstLineNumber} part ${fragmentIndex + 1}`,
          continuesLabel: ({ lastLineNumber, totalLines }) => `more after ${lastLineNumber} of ${totalLines}`,
        },
      },
    ],
  });
  const bytes = new Uint8Array(doc.toArrayBuffer());
  const pages = parseDocument(bytes).extractText();
  assert.ok(pages.length >= 3, `expected 3+ pages, got ${pages.length}`);

  // Every source line renders exactly once despite the notes taking space.
  const rendered = runsOf(bytes).filter((run) => /^line \d+$/.test(run.text));
  assert.equal(rendered.length, 130);

  // First fragment: a "continues" note, no "continued from".
  assert.ok(!pages[0]!.text.includes("part 1"), "the opening fragment is not a continuation");
  assert.match(pages[0]!.text, /more after \d+ of 130/);
  // Middle fragment: both notes.
  assert.match(pages[1]!.text, /from \d+ part 2/);
  assert.match(pages[1]!.text, /more after \d+ of 130/);
  // Last fragment: resumed, but nothing follows.
  const last = pages[pages.length - 1]!.text;
  assert.match(last, /from \d+ part \d+/);
  assert.ok(!/more after/.test(last), "the final fragment must not claim to continue");

  // The numbers line up with the code: "from N" names the fragment's first line.
  const resumeLine = /from (\d+) part 2/.exec(pages[1]!.text)?.[1];
  assert.ok(resumeLine !== undefined && pages[1]!.text.includes(`line ${resumeLine}`), resumeLine);
});

test("a fixed string works as a continuation note, and notes are artifacts", () => {
  const source = Array.from({ length: 120 }, (_, i) => `l${i}`).join("\n");
  const doc = createDocument({ title: "Notes", tagged: true, language: "en", compress: false });
  doc.renderTemplate({
    blocks: [{ type: "code", code: source, options: { continuedLabel: "(continued)" } }],
  });
  const bytes = new Uint8Array(doc.toArrayBuffer());
  assert.ok(textOf(bytes).join("\n").includes("(continued)"));
  // The note must not land inside the Code element's marked content.
  const raw = Buffer.from(bytes).toString("latin1");
  const codeMarks = raw.split("/Code <</MCID");
  assert.ok(codeMarks.length > 1);
  assert.ok(!/\/Code <<\/MCID \d+>> BDC[^E]*\(continued\)/.test(raw), "note must be an artifact");
  assert.deepEqual(doc.validateCompliance().filter((issue) => issue.severity === "error"), []);
});

test("a bordered block opens its border where it was split", () => {
  const source = Array.from({ length: 120 }, (_, i) => `l${i}`).join("\n");

  /** Horizontal rules in a border path: the top and bottom edges of the band. */
  const horizontalEdges = (doc: ReturnType<typeof createDocument>): number[] =>
    doc.toModel().pages.map((page) => {
      const border = page.ops.filter((op) => op.type === "path").at(-1)!;
      if (border.type !== "path") return -1;
      if (border.commands.every((command) => command.type === "rect")) return 2; // closed box
      let horizontals = 0;
      for (let i = 1; i < border.commands.length; i += 1) {
        const from = border.commands[i - 1]!;
        const to = border.commands[i]!;
        if (from.type === "moveTo" && to.type === "lineTo" && Math.abs(from.y - to.y) < 0.001) {
          horizontals += 1;
        }
      }
      return horizontals;
    });

  const split = createDocument();
  split.renderTemplate({ blocks: [{ type: "code", code: source, options: { borderWidth: 1 } }] });
  const edges = horizontalEdges(split);
  assert.ok(edges.length >= 3, `expected 3+ fragments, got ${edges.length}`);
  // Opening fragment keeps its top rule, drops the bottom one; middles have
  // neither; the closing fragment keeps only its bottom rule.
  assert.equal(edges[0], 1);
  assert.equal(edges[1], 0);
  assert.equal(edges[edges.length - 1], 1);

  // An unsplit block is a plain closed box.
  const whole = createDocument();
  whole.renderTemplate({ blocks: [{ type: "code", code: "one\ntwo", options: { borderWidth: 1 } }] });
  assert.deepEqual(horizontalEdges(whole), [2]);

  // openSplitEdges: false keeps every fragment a full box.
  const boxed = createDocument();
  boxed.renderTemplate({
    blocks: [{ type: "code", code: source, options: { borderWidth: 1, openSplitEdges: false } }],
  });
  assert.deepEqual(new Set(horizontalEdges(boxed)), new Set([2]));
});

test("fragments on one page share a single Code element", () => {
  const source = Array.from({ length: 80 }, (_, i) => `c${i}`).join("\n");
  const doc = createDocument({ title: "Columns", tagged: true, language: "en", compress: false });
  doc.renderTemplate({
    page: { columns: { count: 2 } },
    blocks: [{ type: "code", code: source }],
  });
  assert.equal(doc.pageCount, 1);
  const raw = Buffer.from(doc.toArrayBuffer()).toString("latin1");
  // Two column fragments, one page: one Code element, not two.
  assert.equal([...raw.matchAll(/\/S \/Code/g)].length, 1);
});

test("code blocks fall back to the document code font before built-in Courier", () => {
  const codeFontOf = (defaults: Record<string, unknown>, options?: Record<string, unknown>): string[] => {
    const doc = createDocument({
      conformance: "pdfua-1",
      tagged: true,
      language: "en-US",
      defaults,
    } as never);
    doc.addPage().flow().code("const answer = 42;", options as never);
    const issue = doc
      .validateCompliance()
      .find((candidate) => candidate.code === "PDFUA_EMBEDDED_FONTS_REQUIRED");
    return [...new Set((issue?.locations ?? []).map((location) => location.font ?? ""))];
  };

  assert.deepEqual(codeFontOf({}), ["Courier"]);
  assert.deepEqual(codeFontOf({ font: "Times-Roman" }), ["Times-Roman"]);
  assert.deepEqual(codeFontOf({ font: "Times-Roman", codeFont: "Courier-Bold" }), ["Courier-Bold"]);
  assert.deepEqual(
    codeFontOf({ font: "Times-Roman", codeFont: "Courier-Bold" }, { font: "Helvetica" }),
    ["Helvetica"],
  );
});

test("inline HTML code runs use the document code font", () => {
  const doc = createDocument({
    conformance: "pdfua-1",
    tagged: true,
    language: "en-US",
    defaults: { font: "Times-Roman", codeFont: "Courier-Bold" },
  } as never);
  doc.renderTemplate({
    blocks: [{ type: "html", html: "<p>Call <code>render()</code> first.</p>" }],
  });
  const issue = doc
    .validateCompliance()
    .find((candidate) => candidate.code === "PDFUA_EMBEDDED_FONTS_REQUIRED");
  const fonts = [...new Set((issue?.locations ?? []).map((location) => location.font))];
  assert.deepEqual(fonts.sort(), ["Courier-Bold", "Times-Roman"]);
});
