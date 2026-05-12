# Vector Graphics

Draw paths, apply transforms, and control the graphics state directly on pages.

## Path commands

Use `page.path()` with an array of path commands and a paint style. Commands execute in order; the current point carries across commands.

```ts
page.path(
  [
    { type: "moveTo", x: 56, y: 750 },
    { type: "lineTo", x: 200, y: 750 },
    { type: "lineTo", x: 200, y: 700 },
    { type: "closePath" }
  ],
  { paint: "stroke", stroke: { width: 2, color: rgb(0.13, 0.2, 0.34) } }
);
```

| Command | Required fields | Description |
|---------|----------------|-------------|
| `moveTo` | `x`, `y` | Move current point without drawing |
| `lineTo` | `x`, `y` | Straight line to point |
| `rect` | `x`, `y`, `width`, `height` | Rectangle as a closed subpath |
| `curveTo` | `x1`, `y1`, `x2`, `y2`, `x3`, `y3` | Cubic Bézier with two control points |
| `closePath` | _(none)_ | Close current subpath with a straight line |

Bézier example:

```ts
page.path(
  [
    { type: "moveTo", x: 56, y: 660 },
    { type: "curveTo", x1: 100, y1: 600, x2: 180, y2: 720, x3: 240, y3: 660 }
  ],
  { paint: "stroke", stroke: { width: 1.5, color: hex("#1565c0") } }
);
```

## Painting

The `paint` option controls how the path is rendered:

```ts
page.path(cmds, { paint: "fill", fill: { color: hex("#e3f2fd") } });
page.path(cmds, { paint: "stroke", stroke: { color: hex("#c62828") } });
page.path(cmds, {
  paint: "fillStroke",
  fill: { color: hex("#bbdefb") },
  stroke: { width: 2, color: hex("#1565c0") }
});
```

## Stroke styles

```ts
page.path(cmds, {
  paint: "stroke",
  stroke: {
    width: 3,
    color: hex("#2e7d32"),
    lineCap: "round",       // "butt" | "round" | "square"
    lineJoin: "bevel",      // "miter" | "round" | "bevel"
    miterLimit: 10,
    dashArray: [6, 3],       // dash-gap pattern
    dashPhase: 0
  }
});
```

## Fill styles

Fill colors accept `rgb()`, `cmyk()`, `hex()`, and `gray()`:

```ts
page.path(cmds, { paint: "fill", fill: { color: cmyk(0.1, 0.2, 0, 0.85) } });
```

## Transforms

Transforms compose cumulatively. Wrap in `saveState()`/`restoreState()` to isolate.

### translate, scale, rotate

```ts
page.saveState();
page.translate(100, 0);
page.path([{ type: "rect", x: 56, y: 630, width: 80, height: 20 }], {
  paint: "fill", fill: { color: hex("#e3f2fd") }
});
page.restoreState();

page.saveState();
page.scale(1.5, 1.5);
page.text("SCALED", { x: 56, y: 400, fontSize: 14 });
page.restoreState();

page.saveState();
page.rotate(15); // degrees, counter-clockwise
page.text("Rotated 15°", { x: 56, y: 530, fontSize: 14, color: hex("#2e7d32") });
page.restoreState();
```

### transform (arbitrary matrix)

Pass `{ a, b, c, d, e, f }` for the affine matrix `[a b c d e f]`:

```ts
page.saveState();
page.transform({ a: 1, b: 0, c: 0.3, d: 1, e: 0, f: 0 });
page.path([{ type: "rect", x: 56, y: 320, width: 120, height: 25 }], {
  paint: "fill", fill: { color: hex("#7b1fa2") }
});
page.restoreState();
```

## Graphics state

Stack transforms and style changes inside `saveState()`/`restoreState()` blocks:

```ts
page.saveState();
page.translate(50, 0);
page.path(cmds, { paint: "stroke", stroke: { color: hex("#1565c0") } });
page.restoreState(); // back to original transform and style
```

### Transparency and blend modes

Use `setExtGState()` for alpha values, blend modes, and soft masks:

```ts
page.saveState();
page.setExtGState({ fillAlpha: 0.3 });
page.path([{ type: "rect", x: 56, y: 460, width: 100, height: 30 }], {
  paint: "fill", fill: { color: hex("#ff5722") }
});
page.restoreState();
```

Blend modes: `"Normal"`, `"Multiply"`, `"Screen"`, `"Overlay"`, `"Darken"`, `"Lighten"`, `"ColorDodge"`, `"ColorBurn"`, `"HardLight"`, `"SoftLight"`, `"Difference"`, `"Exclusion"`, `"Hue"`, `"Saturation"`, `"Color"`, `"Luminosity"`.

### Luminosity soft masks

Create a mask form, then apply via `setExtGState`:

```ts
const mask = doc.createLuminositySoftMask({ width: 200, height: 40 });
mask.path([{ type: "rect", x: 0, y: 0, width: 200, height: 40 }], {
  paint: "fill", fill: { color: gray(0.5) }
});

page.saveState();
page.setExtGState({ softMask: mask });
page.path([{ type: "rect", x: 56, y: 500, width: 200, height: 40 }], {
  paint: "fill", fill: { color: hex("#1565c0") }
});
page.setExtGState({ softMask: null }); // clear mask
page.restoreState();
```

## Tagged paths

For PDF/UA output, mark decorative vector paths as artifacts:

```ts
page.path(cmds, { paint: "fill", fill: { color: hex("#e8e8e8") }, tag: "Artifact" });
```
