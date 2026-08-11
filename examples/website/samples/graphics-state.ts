import { createDocument, hex } from "@crstnmac/zeropdf";

const doc = createDocument({
  info: {
    title: "Graphics State Demo",
    author: "zeropdf"
  }
});

doc.renderTemplate({
  page: { size: "A4", margin: 72 },
  blocks: [
    {
      type: "heading",
      text: "Graphics State",
      options: { level: 1, color: hex("#1a1a2e") }
    },
    {
      type: "paragraph",
      text: "The document shell is rendered as a template. The following page uses the low-level graphics-state API because transforms and blend modes operate directly on a page canvas."
    }
  ]
});

const page = doc.addPage({ size: "A4" });
page.text("Graphics State: Transforms, Alpha & Blend Modes", {
  x: 72, y: 800, fontSize: 16
});

// Save / restore state
page.text("saveState / restoreState", { x: 72, y: 770, fontSize: 12 });
page.saveState();
page.text("Blue text inside saved state", {
  x: 72, y: 740, fontSize: 14, color: hex("#1565c0")
});
page.path(
  [{ type: "rect", x: 72, y: 718, width: 200, height: 16 }],
  { paint: "stroke", stroke: { width: 1, color: hex("#1565c0") } }
);
page.restoreState();
page.text("Back to default graphics state", {
  x: 72, y: 690, fontSize: 11
});

// Translate
page.text("translate(100, 0) - two rectangles side by side", { x: 72, y: 660, fontSize: 12 });
page.saveState();
page.translate(100, 0);
page.path(
  [{ type: "rect", x: 72, y: 630, width: 80, height: 20 }],
  { paint: "fill", fill: { color: hex("#e3f2fd") } }
);
page.restoreState();

page.saveState();
page.translate(188, 0);
page.path(
  [{ type: "rect", x: 72, y: 630, width: 80, height: 20 }],
  { paint: "fill", fill: { color: hex("#bbdefb") } }
);
page.restoreState();

// Scale
page.text("scale(1.5, 1.5)", { x: 72, y: 600, fontSize: 12 });
page.saveState();
page.scale(1.5, 1.5);
page.text("SCALED TEXT", { x: 72, y: 380, fontSize: 16, color: hex("#c62828") });
page.restoreState();

// Rotate
page.text("rotate(15 degrees)", { x: 72, y: 570, fontSize: 12 });
page.saveState();
page.rotate(15);
page.text("Rotated text at 15 degrees", { x: 72, y: 530, fontSize: 14, color: hex("#2e7d32") });
page.restoreState();

// Alpha transparency with setExtGState
page.text("Transparency (fillAlpha = 0.3)", { x: 72, y: 500, fontSize: 12 });
page.saveState();
page.setExtGState({ fillAlpha: 0.3 });
page.path(
  [{ type: "rect", x: 72, y: 460, width: 100, height: 30 }],
  { paint: "fill", fill: { color: hex("#ff5722") } }
);
page.text("Semi-transparent overlay", { x: 66, y: 472, fontSize: 10, color: hex("#ffffff") });
page.restoreState();

// Blend modes
page.text("Blend mode: 'Multiply' on overlapping rects", { x: 72, y: 440, fontSize: 12 });
page.saveState();
page.setExtGState({ blendMode: "Multiply" });
page.path(
  [{ type: "rect", x: 72, y: 390, width: 60, height: 30 }],
  { paint: "fill", fill: { color: hex("#ff0000") } }
);
page.path(
  [{ type: "rect", x: 86, y: 380, width: 60, height: 30 }],
  { paint: "fill", fill: { color: hex("#0000ff") } }
);
page.restoreState();

// Transform (skew)
page.text("transform() - skewed parallelogram", { x: 72, y: 360, fontSize: 12 });
page.saveState();
page.transform({ a: 1, b: 0, c: 0.3, d: 1, e: 0, f: 0 });
page.path(
  [{ type: "rect", x: 72, y: 320, width: 120, height: 25 }],
  { paint: "fill", fill: { color: hex("#7b1fa2") } }
);
page.restoreState();

export default doc;
