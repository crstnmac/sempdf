---
title: "Custom Blocks"
---

The `custom` block type lets you extend `renderTemplate` with arbitrary drawing when built-in block types don't fit your use case.

## The custom block type

Each custom block must provide two callbacks:

- **`estimate()`** — returns the vertical space (in points) the block needs. Called during pagination to determine where page breaks fall.
- **`render(ctx)`** — draws the block onto the page. `ctx` exposes `x`, `y`, `width`, and drawing helpers like `graphics()`.

```ts
{
  type: "custom",
  height: 12,
  estimate() { return this.height; },
  render(ctx) {
    ctx.graphics()
      .moveTo(ctx.x, ctx.y + ctx.height / 2)
      .lineTo(ctx.x + ctx.width, ctx.y + ctx.height / 2)
      .stroke({ color: rgb(0.6, 0.6, 0.6) });
  }
}
```

`height` is the block's declared height; `estimate()` can return a different value if the content doesn't fill the full height.

## Horizontal rule

A common reusable pattern:

```ts
function hr(height = 2, color = rgb(0.7, 0.7, 0.7)) {
  return {
    type: "custom" as const,
    height,
    estimate() { return height; },
    render(ctx) {
      ctx.graphics()
        .rect(ctx.x, ctx.y, ctx.width, height)
        .fill({ color });
    }
  };
}

// Usage
doc.renderTemplate({
  blocks: [
    { type: "heading", text: "Section One" },
    { type: "paragraph", text: "Content..." },
    hr(),
    { type: "heading", text: "Section Two", options: { level: 2 } }
  ]
});
```

## Page break with custom text

Combine a page break with a decorative separator:

```ts
function sectionBreak(label: string) {
  return {
    type: "custom" as const,
    height: 28,
    estimate() { return 28; },
    render(ctx) {
      const midY = ctx.y + ctx.height / 2;
      ctx.graphics()
        .moveTo(ctx.x, midY)
        .lineTo(ctx.x + ctx.width, midY)
        .stroke({ color: rgb(0.5, 0.5, 0.5) });
      // Draw label using the page's current font context
    }
  };
}
```

## Watermark

Draw a watermark behind content on every page using the header callback:

```ts
doc.renderTemplate({
  blocks: [ /* body content */ ],
  header: ({ pageNumber, totalPages }) => [{
    type: "custom",
    height: 0,
    estimate() { return 0; },
    render(ctx) {
      // Only on page 1; render under body by drawing in header pass
    }
  }]
});
```

## Limitations

- **No paging context during `render`.** `pageNumber` and `totalPages` are not available in body-level custom blocks. Use the header/footer callbacks if you need page-aware drawing.
- **No automatic height inference.** You must supply `estimate()` explicitly.
- **No structure tagging.** Custom blocks do not create entries in the tagged structure tree. Use `section` blocks with a `role` if you need semantic structure.
