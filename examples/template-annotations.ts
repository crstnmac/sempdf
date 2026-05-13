import { writeFile } from "node:fs/promises";
import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Document Review - Annotations Demo",
    author: "zeropdf",
  },
});

doc.setXmpMetadata({
  title: "Document Review - Annotations Demo",
  creator: "zeropdf",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z",
});

// ── Page 1: Template structure + inline link annotations ──────────────

doc.renderTemplate({
  page: { size: "A4" },
  blocks: [
    {
      type: "heading",
      text: "Document Review",
      options: { level: 1, color: hex("#1c2f6b"), marginBottom: 8 },
    },
    {
      type: "paragraph",
      text: "The quick brown fox jumps over the lazy dog. Inline annotations target specific words in this paragraph by matching the rendered text directly.",
      options: { fontSize: 11, marginBottom: 14 },
      annotations: [
        { type: "highlight", match: "lazy dog", color: hex("#ffeb3b") },
        { type: "highlight", match: "quick brown fox", color: hex("#c8e6c9") },
      ],
    },
    {
      type: "paragraph",
      text: "Accessibility compliance requires all non-text content to have text alternatives. Verify alt text during the audit phase before sign-off.",
      options: { fontSize: 11, marginBottom: 14 },
      annotations: [
        {
          type: "note",
          match: "Accessibility",
          contents: "WCAG 1.1.1: Ensure all images have alt attributes.",
          open: false,
        },
        {
          type: "highlight",
          match: "audit phase",
          color: hex("#ffe0b2"),
        },
      ],
    },
    {
      type: "paragraph",
      text: "See the project documentation for the full conformance checklist and the latest review guidelines.",
      options: { fontSize: 11, marginBottom: 20 },
      annotations: [
        {
          type: "link",
          match: "project documentation",
          url: "https://example.com/docs",
        },
      ],
    },
    {
      type: "heading",
      text: "How It Works",
      options: { level: 2, color: hex("#1565c0"), marginBottom: 8 },
    },
    {
      type: "paragraph",
      text: "Each annotation specifies a substring match. The flow engine locates that text within the laid-out runs and emits the annotation at the exact rendered position. If a match wraps across lines, one rectangle is emitted per line.",
      options: { fontSize: 11 },
    },
  ],
});

// ── Page 2: Low-level API for precise text annotations ─────────────────
// Use the page API when you need pixel-perfect highlight, note, or
// free-text annotations at specific positions within rendered text.

const page = doc.addPage({ size: "A4" });

page.text("Precise Text Annotations", {
  x: 72, y: 780, fontSize: 18, color: hex("#1c2f6b"),
});

// Paragraph 1: highlight a specific word ("lazy")
const p1y = 740;
page.text(
  "The quick brown fox jumps over the lazy dog. This demonstrates how " +
    "to annotate specific text ranges using exact coordinate positioning.",
  { x: 72, y: p1y, fontSize: 12 },
);

// Highlight "lazy" (~chars 34-38, ~325px from left at 12pt)
page.highlight({
  x: 390, y: p1y + 2, width: 42, height: 14,
  color: hex("#ffeb3b"),
});

// Paragraph 2: sticky note on a specific word ("Accessibility")
const p2y = p1y - 36 - 14;
page.text(
  "Accessibility compliance requires all non-text content to have " +
    "text alternatives. Verify during the audit phase.",
  { x: 72, y: p2y, fontSize: 12 },
);

page.note({
  x: 70, y: p2y - 4, width: 24, height: 24,
  contents: "WCAG 1.1.1: Ensure all images have alt attributes.",
  open: false,
});

// Paragraph 3: free-text annotation stamp
const p3y = p2y - 36 - 14;
page.text(
  "All findings must be documented with clear reproduction steps " +
    "and environment details for the development team.",
  { x: 72, y: p3y, fontSize: 12 },
);

page.freeText({
  x: 440, y: p3y - 30,
  width: 130, height: 42,
  text: "Priority: High\nDue: May 15",
  fontSize: 9,
  color: hex("#c62828"),
  borderWidth: 1,
});

// Footer tip
page.text(
  "Tip: Use the low-level API when you need pixel-perfect annotation " +
    "placement. The template system is ideal for document structure; " +
    "precise highlights, notes, and free-text annotations work best " +
    "with explicit coordinates.",
  { x: 72, y: 80, fontSize: 8, color: hex("#666666") },
);

// ── Output ────────────────────────────────────────────────────────────

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues:");
  for (const issue of issues) console.log(`  [${issue.severity}] ${issue.message}`);
}

await writeFile(new URL("./template-annotations.pdf", import.meta.url), doc.toUint8Array());
console.log("Wrote examples/template-annotations.pdf");
console.log("  Page 1: renderTemplate with inline link annotations");
console.log("  Page 2: low-level API with highlight, note, freeText on specific text");
