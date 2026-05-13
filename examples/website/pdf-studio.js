import {
  PAGE_SIZES,
  createDocument,
  editDocument,
  parseDocument,
  rgb
} from "zeropdf";

export function createBrowserPdf(input) {
  const title = input.title?.trim() || "Field Guide / Project Atlas";
  const subtitle = input.subtitle?.trim() || "A browser-built example powered by zeropdf";
  const body = input.body?.trim() || "";
  const pageSize = input.pageSize in PAGE_SIZES ? input.pageSize : "Letter";
  const accent = colorFromHex(input.accentColor || "#dd5f45");
  const accentSoft = blend(accent, { r: 0.98, g: 0.94, b: 0.88 }, 0.58);
  const ink = rgb(0.13, 0.12, 0.1);
  const muted = rgb(0.39, 0.35, 0.31);
  const pageBox = PAGE_SIZES[pageSize];

  const doc = createDocument({
    info: {
      title,
      author: "zeropdf example site",
      subject: "Browser creation demo",
      keywords: ["pdf", "browser", "incremental editing"],
      creator: "examples/website/pdf-studio.js",
      producer: "zeropdf",
      creationDate: new Date().toISOString(),
      modificationDate: new Date().toISOString()
    }
  });

  const cover = doc.addPage({ size: pageSize });
  cover.path(
    [{ type: "rect", x: 0, y: 0, width: pageBox.width, height: pageBox.height }],
    {
      paint: "fill",
      fill: { color: rgb(0.969, 0.945, 0.9) }
    }
  );
  cover.path(
    [{ type: "rect", x: 36, y: 42, width: pageBox.width - 72, height: pageBox.height - 84 }],
    {
      paint: "stroke",
      stroke: { width: 1.2, color: accent }
    }
  );
  cover.path(
    [{ type: "rect", x: 36, y: pageBox.height - 174, width: pageBox.width - 72, height: 132 }],
    {
      paint: "fill",
      fill: { color: accentSoft }
    }
  );
  cover.text("BROWSER PDF STUDIO", {
    x: 56,
    y: 720,
    font: "Helvetica-Bold",
    fontSize: 11,
    characterSpacing: 2.6,
    color: accent
  });
  cover.textBlock(title, {
    x: 56,
    y: 680,
    width: 376,
    font: "Times-Bold",
    fontSize: 28,
    lineHeight: 34,
    color: ink
  });
  cover.textBlock(subtitle, {
    x: 56,
    y: 608,
    width: 360,
    fontSize: 13,
    lineHeight: 18,
    color: muted
  });
  cover.textBlock(body, {
    x: 56,
    y: 532,
    width: 334,
    fontSize: 12,
    lineHeight: 17,
    color: ink
  });
  cover.list(
    [
      "Create a PDF entirely in the browser.",
      "Preview the result instantly with Blob output helpers.",
      "Re-open the same PDF and apply incremental edits.",
      "Update live AcroForm fields by name."
    ],
    {
      x: 56,
      y: 390,
      width: 300,
      fontSize: 11,
      lineHeight: 15,
      bullet: "*",
      color: muted,
      itemSpacing: 6
    }
  );
  cover.note({
    x: 430,
    y: 654,
    contents: "This annotation was created in the browser example."
  });
  cover.highlight({
    x: 54,
    y: 600,
    width: 258,
    height: 16,
    color: rgb(0.98, 0.9, 0.55)
  });
  cover.freeText({
    x: 414,
    y: 518,
    width: 124,
    height: 62,
    text: "Preview.\nEdit.\nDownload.",
    font: "Helvetica-Bold",
    fontSize: 12,
    color: accent,
    borderWidth: 1
  });
  cover.link("https://github.com/", {
    x: 56,
    y: 54,
    width: 220,
    height: 16
  });
  cover.text("https://github.com/", {
    x: 56,
    y: 62,
    fontSize: 10,
    color: accent
  });

  const formPage = doc.addPage({ size: pageSize });
  formPage.text("Interactive sample fields", {
    x: 56,
    y: 728,
    font: "Times-Bold",
    fontSize: 24,
    color: ink
  });
  formPage.textBlock(
    "These fields are intentionally simple so you can upload the generated PDF back into the editor and update them incrementally with the same library.",
    {
      x: 56,
      y: 694,
      width: 420,
      fontSize: 12,
      lineHeight: 17,
      color: muted
    }
  );

  drawFieldLabel(formPage, "Contact name", 56, 618);
  formPage.textField("contactName", {
    x: 56,
    y: 584,
    width: 240,
    height: 28,
    value: "Alex Morgan"
  });

  drawFieldLabel(formPage, "Package", 320, 618);
  formPage.choiceField("package", {
    x: 320,
    y: 584,
    width: 180,
    height: 28,
    options: ["Foundation", "Growth", "Archive"],
    value: "Growth",
    mode: "combo"
  });

  drawFieldLabel(formPage, "Approved", 56, 530);
  formPage.checkBox("approved", {
    x: 56,
    y: 498,
    width: 18,
    height: 18,
    checked: true
  });
  formPage.text("Tick this box, then flatten it during save if you want a static output.", {
    x: 84,
    y: 503,
    fontSize: 11,
    color: muted
  });

  formPage.path(
    [{ type: "rect", x: 44, y: 454, width: 472, height: 1 }],
    {
      paint: "stroke",
      stroke: { width: 1, color: accentSoft }
    }
  );
  formPage.textBlock(
    "Incremental editing mode can update document metadata, overlay text on existing pages, append new pages, and modify supported form fields by field name.",
    {
      x: 56,
      y: 426,
      width: 430,
      fontSize: 13,
      lineHeight: 18,
      color: ink
    }
  );

  return finalizeDoc(doc);
}

export function editBrowserPdf(sourceBytes, input) {
  const editable = editDocument(sourceBytes);
  editable.updateInfo({
    title: input.title?.trim() || "Revised Browser Draft",
    modificationDate: new Date().toISOString(),
    creator: "examples/website/pdf-studio.js incremental editor"
  });

  const firstPage = editable.editPage(0);
  firstPage.path(
    [{ type: "rect", x: 42, y: 748, width: 188, height: 26 }],
    {
      paint: "fillStroke",
      fill: { color: rgb(0.16, 0.16, 0.14) },
      stroke: { width: 1, color: rgb(0.86, 0.4, 0.28) }
    }
  );
  firstPage.text(input.overlayText?.trim() || "REVIEWED IN BROWSER", {
    x: 54,
    y: 756,
    font: "Helvetica-Bold",
    fontSize: 12,
    color: rgb(0.99, 0.97, 0.93),
    characterSpacing: 1.4
  });

  for (const [name, value] of Object.entries(input.fieldValues ?? {})) {
    editable.setFieldValue(name, value);
  }

  if (input.appendNote?.trim()) {
    const page = editable.addPage();
    page.text("Incremental update log", {
      x: 56,
      y: 724,
      font: "Times-Bold",
      fontSize: 24
    });
    page.textBlock(input.appendNote.trim(), {
      x: 56,
      y: 684,
      width: 420,
      fontSize: 13,
      lineHeight: 19
    });
    page.list(
      [
        "Metadata updated",
        "Overlay added to page one",
        "Supported form fields reapplied from the editor"
      ],
      {
        x: 56,
        y: 566,
        width: 340,
        fontSize: 12,
        lineHeight: 17,
        bullet: "->",
        itemSpacing: 6
      }
    );
  }

  if (input.flattenForms) {
    editable.flattenForms();
  }

  return finalizeDoc(editable);
}

export function inspectPdf(bytes) {
  return parseDocument(bytes);
}

function finalizeDoc(doc) {
  const bytes = doc.toUint8Array();
  return {
    bytes,
    blob: doc.toBlob(),
    parsed: parseDocument(bytes)
  };
}

function drawFieldLabel(page, text, x, y) {
  page.text(text, {
    x,
    y,
    font: "Helvetica-Bold",
    fontSize: 10,
    color: rgb(0.39, 0.35, 0.31),
    characterSpacing: 1.1
  });
}

function colorFromHex(hex) {
  const normalized = hex.replace("#", "");
  const safe = normalized.length === 6 ? normalized : "dd5f45";
  return rgb(
    Number.parseInt(safe.slice(0, 2), 16) / 255,
    Number.parseInt(safe.slice(2, 4), 16) / 255,
    Number.parseInt(safe.slice(4, 6), 16) / 255
  );
}

function blend(left, right, amount) {
  const mix = (start, end) => start * (1 - amount) + end * amount;
  return rgb(mix(left.r, right.r), mix(left.g, right.g), mix(left.b, right.b));
}
