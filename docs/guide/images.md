# Images

Embed JPEG and PNG images directly from byte arrays. PNG transparency masks and alpha-channel soft masks are preserved.

## JPEG

```ts
import { readFile } from "node:fs/promises";

const jpegBytes = await readFile("photo.jpg");
page.jpeg(jpegBytes, {
  x: 56,
  y: 500,
  width: 200,
  height: 150
});
```

The encoder reads dimensions from the JPEG SOF marker, so width/height default to the native size when omitted.

## PNG

```ts
const pngBytes = await readFile("logo.png");
page.png(pngBytes, {
  x: 56,
  y: 700,
  width: 64,
  height: 64
});
```

8-bit grayscale, RGB, indexed, and RGBA PNGs are supported. tRNS palette transparency and full alpha channels are written as image soft masks.

## Aspect ratio

Pass only `width` or `height` to scale proportionally:

```ts
page.png(pngBytes, { x: 56, y: 700, width: 64 });
```

## Tagged figures and alt text

For PDF/UA output, supply `altText` so screen readers can announce the image:

```ts
page.flow({ font })
  .png(logoBytes, { width: 32, altText: "Company logo" });
```

Low-level `page.png()` and `page.jpeg()` accept `altText` and `structure.boundingBox` when used inside a tagged document. Decorative images should be marked as artifacts via `structure: { tag: "Artifact" }`.
