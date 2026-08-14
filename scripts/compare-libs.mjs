import { readFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createDocument, editDocument, parseDocument, BufferSink, rgb } from "../dist/src/index.js";
import PDFDocumentKit from "pdfkit";
import { PDFDocument as PdfLibDocument, StandardFonts, rgb as pdfLibRgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

// ─── Configuration ────────────────────────────────────────────────────

const PAGE_COUNT = 80;
const LINES_PER_PAGE = 12;
const ITERATIONS = 3;
const WARMUP = 1;

const fontPath = [
  process.env.PDF_EDITING_LIB_EXAMPLE_FONT,
  process.env.PDF_EDITING_LIB_FONT_PATH,
  "/Users/criston/Library/Fonts/MonaspaceArgonFrozen-Medium.ttf",
  "/System/Library/Fonts/SFNS.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
].find((path) => path && existsSync(path));

const fontBytes = fontPath ? readFileSync(fontPath) : undefined;

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADElEQVQIHWNgYPgPAAEDAQCarKlHAAAAAElFTkSuQmCC",
  "base64"
);

// ─── Helpers ──────────────────────────────────────────────────────────

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function fmt(ms) {
  return `${ms.toFixed(2).padStart(8)}`;
}

function fmtBytes(b) {
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)}MB`;
  if (b > 1_000) return `${(b / 1_000).toFixed(1)}KB`;
  return `${b}B`;
}

function sampleLine(i) {
  return `Line ${i + 1}: repeated serialization workload for benchmarking output paths across multiple PDF libraries.`;
}

async function bench(name, fn) {
  for (let i = 0; i < WARMUP; i++) await fn();
  const samples = [];
  let bytes = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const result = await fn();
    samples.push(performance.now() - start);
    bytes = result.byteLength ?? result.length ?? bytes;
  }
  return { name, medianMs: median(samples), minMs: Math.min(...samples), bytes };
}

async function runScenario(title, builders) {
  console.log(`\n╔══ ${title} ══╗`);
  const results = [];
  for (const [label, fn] of builders) {
    results.push(await bench(label, fn));
  }
  const maxName = Math.max(...results.map((r) => r.name.length));
  const baseline = results[0]?.medianMs ?? 1;
  console.log(`${"Library".padEnd(maxName)}  Median     Min        Size       vs ours`);
  console.log("─".repeat(maxName + 55));
  for (const r of results) {
    const ratio = (r.medianMs / baseline).toFixed(2);
    console.log(`${r.name.padEnd(maxName)}  ${fmt(r.medianMs)}  ${fmt(r.minMs)}  ${fmtBytes(r.bytes).padStart(8)}  ${ratio}×`);
  }
}

// ─── Scenario 1: Text-only, built-in fonts ────────────────────────────

await runScenario("1. Text-only (built-in fonts, 80 pages)", [
  ["zeropdf (toArray)", () => {
    const doc = createDocument({ info: { title: "Bench" } });
    for (let p = 0; p < PAGE_COUNT; p++) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 16 });
      for (let l = 0; l < LINES_PER_PAGE; l++) {
        page.text(sampleLine(l), {
          x: 48, y: 748 - l * 28, fontSize: 10,
          color: l % 2 === 0 ? rgb(0.08, 0.16, 0.28) : rgb(0.38, 0.1, 0.08),
        });
      }
    }
    return doc.toUint8Array();
  }],
  ["zeropdf (stream)", async () => {
    const doc = createDocument({ info: { title: "Bench" } });
    for (let p = 0; p < PAGE_COUNT; p++) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 16 });
      for (let l = 0; l < LINES_PER_PAGE; l++) {
        page.text(sampleLine(l), {
          x: 48, y: 748 - l * 28, fontSize: 10,
          color: l % 2 === 0 ? rgb(0.08, 0.16, 0.28) : rgb(0.38, 0.1, 0.08),
        });
      }
    }
    const sink = new BufferSink();
    await doc.writeTo(sink);
    return sink.collect();
  }],
  ["pdf-lib", async () => {
    const doc = await PdfLibDocument.create();
    doc.setTitle("Bench");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let p = 0; p < PAGE_COUNT; p++) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(`Page ${p + 1}`, { x: 48, y: 790, size: 16, font });
      for (let l = 0; l < LINES_PER_PAGE; l++) {
        page.drawText(sampleLine(l), {
          x: 48, y: 748 - l * 28, size: 10, font,
          color: l % 2 === 0 ? pdfLibRgb(0.08, 0.16, 0.28) : pdfLibRgb(0.38, 0.1, 0.08),
        });
      }
    }
    return doc.save();
  }],
  ["pdfkit", () => new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocumentKit({ size: "A4", info: { Title: "Bench" }, autoFirstPage: false });
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let p = 0; p < PAGE_COUNT; p++) {
      doc.addPage({ size: "A4" });
      doc.fontSize(16).fillColor("black").text(`Page ${p + 1}`, 48, 790 - 16, { lineBreak: false });
      doc.fontSize(10);
      for (let l = 0; l < LINES_PER_PAGE; l++) {
        doc.fillColor(l % 2 === 0 ? "#142948" : "#611a14");
        doc.text(sampleLine(l), 48, 748 - l * 28, { lineBreak: false });
      }
    }
    doc.end();
  })],
]);

// ─── Scenario 2: Embedded TrueType font ───────────────────────────────

if (fontBytes) {
  await runScenario("2. Embedded TrueType font (80 pages)", [
    ["zeropdf", () => {
      const doc = createDocument({ info: { title: "TTF" } });
      const font = doc.embedTrueTypeFont(fontBytes, { family: "BenchFont" });
      for (let p = 0; p < PAGE_COUNT; p++) {
        const page = doc.addPage({ size: "A4" });
        page.text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 16, font });
        for (let l = 0; l < LINES_PER_PAGE; l++) {
          page.text(sampleLine(l), { x: 48, y: 748 - l * 28, fontSize: 10, font });
        }
      }
      return doc.toUint8Array();
    }],
    ["pdf-lib", async () => {
      const doc = await PdfLibDocument.create();
      doc.registerFontkit(fontkit);
      doc.setTitle("TTF");
      const font = await doc.embedFont(fontBytes, { subset: true });
      for (let p = 0; p < PAGE_COUNT; p++) {
        const page = doc.addPage([595.28, 841.89]);
        page.drawText(`Page ${p + 1}`, { x: 48, y: 790, size: 16, font });
        for (let l = 0; l < LINES_PER_PAGE; l++) {
          page.drawText(sampleLine(l), { x: 48, y: 748 - l * 28, size: 10, font });
        }
      }
      return doc.save();
    }],
    ["pdfkit", () => new Promise((resolve, reject) => {
      const chunks = [];
      const doc = new PDFDocumentKit({ size: "A4", info: { Title: "TTF" }, autoFirstPage: false });
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.registerFont("BenchFont", fontBytes);
      doc.font("BenchFont");
      for (let p = 0; p < PAGE_COUNT; p++) {
        doc.addPage({ size: "A4" });
        doc.fontSize(16).text(`Page ${p + 1}`, 48, 790 - 16, { lineBreak: false });
        doc.fontSize(10);
        for (let l = 0; l < LINES_PER_PAGE; l++) {
          doc.text(sampleLine(l), 48, 748 - l * 28, { lineBreak: false });
        }
      }
      doc.end();
    })],
  ]);
} else {
  console.log("\n[skip] Scenario 2: no TTF font found");
}

// ─── Scenario 3: Images per page ──────────────────────────────────────

await runScenario("3. Text + PNG image per page (80 pages)", [
  ["zeropdf", () => {
    const doc = createDocument({ info: { title: "Images" } });
    for (let p = 0; p < PAGE_COUNT; p++) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 14 });
      page.png(png1x1, { x: 48, y: 650, width: 48, height: 48, altText: `Image ${p + 1}` });
      for (let l = 0; l < LINES_PER_PAGE / 2; l++) {
        page.text(sampleLine(l), { x: 48, y: 580 - l * 28, fontSize: 10 });
      }
    }
    return doc.toUint8Array();
  }],
  ["pdf-lib", async () => {
    const doc = await PdfLibDocument.create();
    doc.setTitle("Images");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const img = await doc.embedPng(png1x1);
    for (let p = 0; p < PAGE_COUNT; p++) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(`Page ${p + 1}`, { x: 48, y: 790, size: 14, font });
      page.drawImage(img, { x: 48, y: 698, width: 48, height: 48 });
      for (let l = 0; l < LINES_PER_PAGE / 2; l++) {
        page.drawText(sampleLine(l), { x: 48, y: 580 - l * 28, size: 10, font });
      }
    }
    return doc.save();
  }],
  ["pdfkit", () => new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocumentKit({ size: "A4", info: { Title: "Images" }, autoFirstPage: false });
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let p = 0; p < PAGE_COUNT; p++) {
      doc.addPage({ size: "A4" });
      doc.fontSize(14).fillColor("black").text(`Page ${p + 1}`, 48, 790 - 14, { lineBreak: false });
      doc.image(png1x1, 48, 650, { width: 48, height: 48 });
      doc.fontSize(10);
      for (let l = 0; l < LINES_PER_PAGE / 2; l++) {
        doc.text(sampleLine(l), 48, 580 - l * 28, { lineBreak: false });
      }
    }
    doc.end();
  })],
]);

// ─── Scenario 4: Encryption (AES-128) ─────────────────────────────────

await runScenario("4. AES-128 encryption (80 pages)", [
  ["zeropdf", () => {
    const doc = createDocument({
      info: { title: "Encrypted" },
      encryption: { algorithm: "aes-128", userPassword: "user", ownerPassword: "owner" },
    });
    for (let p = 0; p < PAGE_COUNT; p++) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 14 });
      for (let l = 0; l < LINES_PER_PAGE; l++) {
        page.text(sampleLine(l), { x: 48, y: 748 - l * 28, fontSize: 10 });
      }
    }
    return doc.toUint8Array();
  }],
  ["pdfkit", () => new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocumentKit({
      size: "A4", info: { Title: "Encrypted" }, autoFirstPage: false,
      userPassword: "user", ownerPassword: "owner", pdfVersion: "1.7",
    });
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let p = 0; p < PAGE_COUNT; p++) {
      doc.addPage({ size: "A4" });
      doc.fontSize(14).text(`Page ${p + 1}`, 48, 790 - 14, { lineBreak: false });
      doc.fontSize(10);
      for (let l = 0; l < LINES_PER_PAGE; l++) {
        doc.text(sampleLine(l), 48, 748 - l * 28, { lineBreak: false });
      }
    }
    doc.end();
  })],
]);

// ─── Scenario 5: Tagged PDF ───────────────────────────────────────────

await runScenario("5. Tagged accessible PDF (80 pages)", [
  ["zeropdf", () => {
    const doc = createDocument({ tagged: true, language: "en-US", structureRoot: "Document", info: { title: "Tagged" } });
    for (let p = 0; p < PAGE_COUNT; p++) {
      const page = doc.addPage({ size: "A4" });
      page.text(`Heading ${p + 1}`, { x: 48, y: 790, fontSize: 16, tag: "H1" });
      for (let l = 0; l < LINES_PER_PAGE; l++) {
        page.text(sampleLine(l), { x: 48, y: 748 - l * 28, fontSize: 10, tag: "P" });
      }
    }
    return doc.toUint8Array();
  }],
  ["pdf-lib (untagged baseline)", async () => {
    const doc = await PdfLibDocument.create();
    doc.setTitle("Tagged");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let p = 0; p < PAGE_COUNT; p++) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(`Heading ${p + 1}`, { x: 48, y: 790, size: 16, font });
      for (let l = 0; l < LINES_PER_PAGE; l++) {
        page.drawText(sampleLine(l), { x: 48, y: 748 - l * 28, size: 10, font });
      }
    }
    return doc.save();
  }],
]);

// ─── Scenario 6: Template rendering ───────────────────────────────────

await runScenario("6. Template rendering (50 blocks)", [
  ["zeropdf", () => {
    const doc = createDocument({ info: { title: "Template" } });
    const blocks = [];
    for (let i = 0; i < 8; i++) {
      blocks.push(
        { type: "heading", text: `Section ${i + 1}`, options: { level: 2 } },
        { type: "paragraph", text: sampleLine(0) + " " + sampleLine(1) + " " + sampleLine(2) },
      );
      blocks.push({
        type: "table",
        rows: [
          [{ text: "Metric", header: true }, { text: "Value", header: true }],
          [{ text: `Item ${i + 1}`, header: true, scope: "row" }, `$${(i + 1) * 100}`],
        ],
      });
      if (i < 7) blocks.push({ type: "pageBreak" });
    }
    doc.renderTemplate({ page: { size: "A4", font: "Helvetica" }, blocks });
    return doc.toUint8Array();
  }],
  ["pdfkit (manual)", () => new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocumentKit({ size: "A4", info: { Title: "Template" }, autoFirstPage: false });
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let i = 0; i < 8; i++) {
      doc.addPage({ size: "A4" });
      doc.fontSize(18).text(`Section ${i + 1}`, 72, 750);
      doc.fontSize(11).text(sampleLine(0) + " " + sampleLine(1) + " " + sampleLine(2), 72, 710, { width: 450 });
      doc.fontSize(10);
      doc.text("Metric              Value", 72, 640);
      doc.text(`Item ${i + 1}               $${(i + 1) * 100}`, 72, 625);
    }
    doc.end();
  })],
]);

// ─── Scenario 7: Parsing round-trip ───────────────────────────────────

console.log("\n╔══ 7. Parsing round-trip (80 pages) ══╗");
const fixture = (() => {
  const doc = createDocument({ info: { title: "ParseFixture" } });
  for (let p = 0; p < PAGE_COUNT; p++) {
    const page = doc.addPage({ size: "A4" });
    page.text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 14 });
    for (let l = 0; l < LINES_PER_PAGE; l++) {
      page.text(sampleLine(l), { x: 48, y: 748 - l * 28, fontSize: 10 });
    }
  }
  return doc.toUint8Array();
})();

const parseResult = await bench("zeropdf (parse)", () => {
  parseDocument(fixture);
  return fixture;
});
console.log(`Parse ${fmtBytes(fixture.length)} doc: ${fmt(parseResult.medianMs)} median, ${fmt(parseResult.minMs)} min`);

const editResult = await bench("zeropdf (edit + save)", () => {
  const edit = editDocument(fixture);
  edit.updateInfo({ title: "Edited" });
  return edit.toUint8Array();
});
console.log(`Edit + save:             ${fmt(editResult.medianMs)} median, ${fmt(editResult.minMs)} min  (${fmtBytes(editResult.bytes)})`);

// ─── Scenario 8: Forward-looking (ours only) ──────────────────────────

console.log("\n╔══ 8. Forward-looking features (zeropdf only) ══╗");

const aes256r6 = await bench("AES-256-R6 encryption", () => {
  const doc = createDocument({
    info: { title: "R6" },
    encryption: { algorithm: "aes-256-r6", userPassword: "user", ownerPassword: "owner" },
  });
  for (let p = 0; p < PAGE_COUNT; p++) {
    const page = doc.addPage({ size: "A4" });
    page.text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 14 });
    for (let l = 0; l < LINES_PER_PAGE; l++) {
      page.text(sampleLine(l), { x: 48, y: 748 - l * 28, fontSize: 10 });
    }
  }
  return doc.toUint8Array();
});
console.log(`  ${aes256r6.name.padEnd(30)} ${fmt(aes256r6.medianMs)}  ${fmtBytes(aes256r6.bytes)}`);

const objStream = await bench("Object streams enabled", () => {
  const doc = createDocument({ info: { title: "ObjStream" }, objectStreams: true });
  for (let p = 0; p < PAGE_COUNT; p++) {
    const page = doc.addPage({ size: "A4" });
    page.text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 14 });
    for (let l = 0; l < LINES_PER_PAGE; l++) {
      page.text(sampleLine(l), { x: 48, y: 748 - l * 28, fontSize: 10 });
    }
  }
  return doc.toUint8Array();
});
console.log(`  ${objStream.name.padEnd(30)} ${fmt(objStream.medianMs)}  ${fmtBytes(objStream.bytes)}`);

const certEncrypt = await bench("Certificate-based encryption", () => {
  const doc = createDocument({ info: { title: "Cert" } });
  try { doc.encryptForRecipients([]); } catch {}
  for (let p = 0; p < PAGE_COUNT; p++) {
    const page = doc.addPage({ size: "A4" });
    page.text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 14 });
    for (let l = 0; l < LINES_PER_PAGE; l++) {
      page.text(sampleLine(l), { x: 48, y: 748 - l * 28, fontSize: 10 });
    }
  }
  return doc.toUint8Array();
});
console.log(`  ${certEncrypt.name.padEnd(30)} ${fmt(certEncrypt.medianMs)}  ${fmtBytes(certEncrypt.bytes)}`);

const clone = await bench("Document clone", () => {
  const doc = createDocument({ info: { title: "Clone" } });
  for (let p = 0; p < PAGE_COUNT; p++) {
    doc.addPage({ size: "A4" }).text(`Page ${p + 1}`, { x: 48, y: 790, fontSize: 14 });
  }
  doc.clone();
  return doc.toUint8Array();
});
console.log(`  ${clone.name.padEnd(30)} ${fmt(clone.medianMs)}  ${fmtBytes(clone.bytes)}`);

const encryptUpgrade = await bench("Incremental encrypt upgrade (RC4→AES)", () => {
  const doc = createDocument({
    info: { title: "Upgrade" },
    encryption: { algorithm: "rc4-128", userPassword: "u", ownerPassword: "o" },
  });
  doc.addPage({ size: "A4" }).text("Test", { x: 48, y: 790, fontSize: 14 });
  const bytes = doc.toUint8Array();
  const edit = editDocument(bytes, { password: "u" });
  edit.setEncryption({ algorithm: "aes-256", userPassword: "u", ownerPassword: "o" });
  return edit.toUint8Array();
});
console.log(`  ${encryptUpgrade.name.padEnd(30)} ${fmt(encryptUpgrade.medianMs)}  ${fmtBytes(encryptUpgrade.bytes)}`);

console.log();
