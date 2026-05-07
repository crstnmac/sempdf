import { readFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createDocument, BufferSink } from "../dist/src/index.js";
import PDFDocumentKit from "pdfkit";
import { PDFDocument as PdfLibDocument, StandardFonts, rgb as pdfLibRgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const PAGE_COUNT = 120;
const LINES_PER_PAGE = 18;
const ITERATIONS = 5;

const fontPath = [
  "/Users/criston/Library/Fonts/MonaspaceArgonFrozen-Medium.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
].find((path) => existsSync(path));

const fontBytes = fontPath ? readFileSync(fontPath) : undefined;

const PNG_PATH = "examples/tagged-pdf.pdf";
const png16 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC",
  "base64"
);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function fmt(ms) {
  return `${ms.toFixed(2)} ms`;
}

function buildSampleLine(lineIndex) {
  return `Line ${lineIndex + 1}: repeated serialization workload for output paths.`;
}

async function bench(name, fn) {
  const samples = [];
  let bytes = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    const result = await fn();
    samples.push(performance.now() - start);
    bytes = result.byteLength ?? result.length ?? bytes;
  }
  return { name, samples, median: median(samples), bytes };
}

async function runScenario(name, builders) {
  console.log(`\n=== ${name} ===`);
  const results = [];
  for (const [label, fn] of builders) {
    results.push(await bench(label, fn));
  }
  const maxName = Math.max(...results.map((r) => r.name.length));
  const baseline = results[0]?.median ?? 1;
  console.log(`${"Library".padEnd(maxName)}  ${"median".padStart(10)}  ${"min".padStart(10)}  ${"bytes".padStart(10)}  vs ours`);
  console.log("-".repeat(maxName + 50));
  for (const r of results) {
    const ratio = (r.median / baseline).toFixed(2);
    console.log(
      `${r.name.padEnd(maxName)}  ${fmt(r.median).padStart(10)}  ${fmt(Math.min(...r.samples)).padStart(10)}  ${String(r.bytes).padStart(10)}  ${ratio}×`
    );
  }
}

// ============== Scenario 1: text only, built-in fonts ==============
await runScenario("Scenario 1: built-in fonts, text-only", [
  ["ours: toUint8Array (compress)", () => {
    const doc = createDocument({ info: { title: "Performance" }, compress: true });
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Performance page ${p + 1}`, { x: 48, y: 790, fontSize: 16 });
      for (let l = 0; l < LINES_PER_PAGE; l += 1) {
        page.text(buildSampleLine(l), {
          x: 48, y: 748 - (l * 28), fontSize: 10,
          color: l % 2 === 0 ? { kind: "rgb", r: 0.08, g: 0.16, b: 0.28 } : { kind: "rgb", r: 0.38, g: 0.1, b: 0.08 }
        });
      }
    }
    return doc.toUint8Array();
  }],
  ["ours: BufferSink (compress)", async () => {
    const doc = createDocument({ info: { title: "Performance" }, compress: true });
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Performance page ${p + 1}`, { x: 48, y: 790, fontSize: 16 });
      for (let l = 0; l < LINES_PER_PAGE; l += 1) {
        page.text(buildSampleLine(l), {
          x: 48, y: 748 - (l * 28), fontSize: 10,
          color: l % 2 === 0 ? { kind: "rgb", r: 0.08, g: 0.16, b: 0.28 } : { kind: "rgb", r: 0.38, g: 0.1, b: 0.08 }
        });
      }
    }
    const sink = new BufferSink();
    await doc.writeTo(sink);
    return sink.collect();
  }],
  ["pdf-lib", async () => {
    const doc = await PdfLibDocument.create();
    doc.setTitle("Performance");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(`Performance page ${p + 1}`, { x: 48, y: 790, size: 16, font });
      for (let l = 0; l < LINES_PER_PAGE; l += 1) {
        page.drawText(buildSampleLine(l), {
          x: 48, y: 748 - (l * 28), size: 10, font,
          color: l % 2 === 0 ? pdfLibRgb(0.08, 0.16, 0.28) : pdfLibRgb(0.38, 0.1, 0.08)
        });
      }
    }
    return doc.save();
  }],
  ["pdfkit", async () => new Promise((resolve, reject) => {
    const doc = new PDFDocumentKit({ size: "A4", info: { Title: "Performance" }, autoFirstPage: false });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      doc.addPage({ size: "A4" });
      doc.fontSize(16).fillColor("black").text(`Performance page ${p + 1}`, 48, 790 - 16, { lineBreak: false });
      doc.fontSize(10);
      for (let l = 0; l < LINES_PER_PAGE; l += 1) {
        const c = l % 2 === 0 ? "#142948" : "#611a14";
        doc.fillColor(c).text(buildSampleLine(l), 48, 748 - (l * 28), { lineBreak: false });
      }
    }
    doc.end();
  })]
]);

// ============== Scenario 2: embedded TTF font ==============
if (fontBytes) {
  await runScenario("Scenario 2: embedded TrueType font", [
    ["ours: toUint8Array (compress)", () => {
      const doc = createDocument({ info: { title: "TTF" }, compress: true });
      const font = doc.embedTrueTypeFont(fontBytes, { family: "X" });
      for (let p = 0; p < PAGE_COUNT; p += 1) {
        const page = doc.addPage({ size: "A4" });
        page.text(`Performance page ${p + 1}`, { x: 48, y: 790, fontSize: 16, font });
        for (let l = 0; l < LINES_PER_PAGE; l += 1) {
          page.text(buildSampleLine(l), { x: 48, y: 748 - (l * 28), fontSize: 10, font });
        }
      }
      return doc.toUint8Array();
    }],
    ["pdf-lib", async () => {
      const doc = await PdfLibDocument.create();
      doc.registerFontkit(fontkit);
      doc.setTitle("TTF");
      const font = await doc.embedFont(fontBytes, { subset: true });
      for (let p = 0; p < PAGE_COUNT; p += 1) {
        const page = doc.addPage([595.28, 841.89]);
        page.drawText(`Performance page ${p + 1}`, { x: 48, y: 790, size: 16, font });
        for (let l = 0; l < LINES_PER_PAGE; l += 1) {
          page.drawText(buildSampleLine(l), { x: 48, y: 748 - (l * 28), size: 10, font });
        }
      }
      return doc.save();
    }],
    ["pdfkit", async () => new Promise((resolve, reject) => {
      const doc = new PDFDocumentKit({ size: "A4", info: { Title: "TTF" }, autoFirstPage: false });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.registerFont("X", fontBytes);
      doc.font("X");
      for (let p = 0; p < PAGE_COUNT; p += 1) {
        doc.addPage({ size: "A4" });
        doc.fontSize(16).text(`Performance page ${p + 1}`, 48, 790 - 16, { lineBreak: false });
        doc.fontSize(10);
        for (let l = 0; l < LINES_PER_PAGE; l += 1) {
          doc.text(buildSampleLine(l), 48, 748 - (l * 28), { lineBreak: false });
        }
      }
      doc.end();
    })]
  ]);
} else {
  console.log("\n[skipped Scenario 2: no system TTF found]");
}

// ============== Scenario 3: text + 1 PNG image per page ==============
await runScenario("Scenario 3: text + PNG image per page", [
  ["ours: toUint8Array (compress)", () => {
    const doc = createDocument({ info: { title: "Image" }, compress: true });
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Performance page ${p + 1}`, { x: 48, y: 790, fontSize: 16 });
      page.png(png16, { x: 48, y: 600, width: 64, height: 64 });
      for (let l = 0; l < LINES_PER_PAGE / 2; l += 1) {
        page.text(buildSampleLine(l), { x: 48, y: 540 - (l * 28), fontSize: 10 });
      }
    }
    return doc.toUint8Array();
  }],
  ["pdf-lib", async () => {
    const doc = await PdfLibDocument.create();
    doc.setTitle("Image");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const img = await doc.embedPng(png16);
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(`Performance page ${p + 1}`, { x: 48, y: 790, size: 16, font });
      page.drawImage(img, { x: 48, y: 600, width: 64, height: 64 });
      for (let l = 0; l < LINES_PER_PAGE / 2; l += 1) {
        page.drawText(buildSampleLine(l), { x: 48, y: 540 - (l * 28), size: 10, font });
      }
    }
    return doc.save();
  }],
  ["pdfkit", async () => new Promise((resolve, reject) => {
    const doc = new PDFDocumentKit({ size: "A4", info: { Title: "Image" }, autoFirstPage: false });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      doc.addPage({ size: "A4" });
      doc.fontSize(16).text(`Performance page ${p + 1}`, 48, 790 - 16, { lineBreak: false });
      doc.image(png16, 48, 200, { width: 64, height: 64 });
      doc.fontSize(10);
      for (let l = 0; l < LINES_PER_PAGE / 2; l += 1) {
        doc.text(buildSampleLine(l), 48, 540 - (l * 28), { lineBreak: false });
      }
    }
    doc.end();
  })]
]);

// ============== Scenario 4: AES-128 password encryption ==============
// pdf-lib has no native password encryption; pdfkit supports up to AES-128.
await runScenario("Scenario 4: AES-128 password encryption (ours vs pdfkit)", [
  ["ours: aes-128 toUint8Array", () => {
    const doc = createDocument({
      info: { title: "Encrypted" },
      compress: true,
      encryption: { algorithm: "aes-128", userPassword: "user", ownerPassword: "owner" }
    });
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Encrypted page ${p + 1}`, { x: 48, y: 790, fontSize: 16 });
      for (let l = 0; l < LINES_PER_PAGE; l += 1) {
        page.text(buildSampleLine(l), { x: 48, y: 748 - (l * 28), fontSize: 10 });
      }
    }
    return doc.toUint8Array();
  }],
  ["pdfkit: aes-128", async () => new Promise((resolve, reject) => {
    const doc = new PDFDocumentKit({
      size: "A4",
      info: { Title: "Encrypted" },
      autoFirstPage: false,
      userPassword: "user",
      ownerPassword: "owner",
      pdfVersion: "1.7"
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      doc.addPage({ size: "A4" });
      doc.fontSize(16).text(`Encrypted page ${p + 1}`, 48, 790 - 16, { lineBreak: false });
      doc.fontSize(10);
      for (let l = 0; l < LINES_PER_PAGE; l += 1) {
        doc.text(buildSampleLine(l), 48, 748 - (l * 28), { lineBreak: false });
      }
    }
    doc.end();
  })]
]);

// ============== Scenario 5: PDF 2.0 AES-256 R=6 (ours only) ==============
// No competitor library currently emits ISO 32000-2 R=6 encryption.
console.log("\n=== Scenario 5: PDF 2.0 AES-256 R=6 (ours only — no competitor support) ===");
const r6Result = await bench("ours: aes-256-r6 toUint8Array", () => {
  const doc = createDocument({
    info: { title: "PDF 2.0" },
    compress: true,
    encryption: { algorithm: "aes-256-r6", userPassword: "user", ownerPassword: "owner" }
  });
  for (let p = 0; p < PAGE_COUNT; p += 1) {
    const page = doc.addPage({ size: "A4" });
    page.text(`PDF 2.0 page ${p + 1}`, { x: 48, y: 790, fontSize: 16 });
    for (let l = 0; l < LINES_PER_PAGE; l += 1) {
      page.text(buildSampleLine(l), { x: 48, y: 748 - (l * 28), fontSize: 10 });
    }
  }
  return doc.toUint8Array();
});
console.log(`${r6Result.name}  median: ${fmt(r6Result.median)}  bytes: ${r6Result.bytes}`);

// ============== Scenario 6: tagged accessible PDF (ours vs pdf-lib) ==============
// pdfkit has limited tagging support; pdf-lib supports basic tagged PDF via low-level API but no high-level helper.
await runScenario("Scenario 6: tagged accessible PDF", [
  ["ours: tagged toUint8Array", () => {
    const doc = createDocument({
      info: { title: "Tagged" },
      tagged: true,
      language: "en-US",
      structureRoot: "Document",
      compress: true
    });
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Heading ${p + 1}`, { x: 48, y: 790, fontSize: 16, tag: "H1" });
      for (let l = 0; l < LINES_PER_PAGE; l += 1) {
        page.text(buildSampleLine(l), { x: 48, y: 748 - (l * 28), fontSize: 10, tag: "P" });
      }
    }
    return doc.toUint8Array();
  }],
  ["pdf-lib: untagged baseline", async () => {
    // pdf-lib has no high-level tagging API; this baseline shows the cost of producing equivalent visible output.
    const doc = await PdfLibDocument.create();
    doc.setTitle("Tagged");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let p = 0; p < PAGE_COUNT; p += 1) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(`Heading ${p + 1}`, { x: 48, y: 790, size: 16, font });
      for (let l = 0; l < LINES_PER_PAGE; l += 1) {
        page.drawText(buildSampleLine(l), { x: 48, y: 748 - (l * 28), size: 10, font });
      }
    }
    return doc.save();
  }]
]);

console.log();
