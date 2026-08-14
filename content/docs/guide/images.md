---
title: "Images"
---

Embed images directly from byte arrays. JPEG and PNG are the primary raster paths, with additional helpers for BMP, GIF, JPEG2000, JBIG2, TIFF, WebP, and SVG. PNG transparency masks and alpha-channel soft masks are preserved.

## Auto-detecting the format

`page.image()` sniffs the raster format from the data's magic bytes (PNG, JPEG, GIF, BMP, TIFF, WebP, JPEG 2000) and dispatches to the right decoder — handy when the format isn't known ahead of time:

```ts
import { readFile } from "node:fs/promises";

page.image(await readFile("logo"), { x: 56, y: 600, width: 120, height: 60, altText: "Logo" });
```

It throws `UNSUPPORTED_IMAGE_FORMAT` if the bytes match no known raster format. For SVG (text, not raster) use `page.svg()`. Use the format-specific methods below when you want a specific decoder or format-only options.

## Loading an image in the browser

The browser and the live playground do not provide `node:fs`. Fetch the image,
convert the response to an `ArrayBuffer`, and pass those bytes to `page.image()`:

```ts
import { createDocument } from "@crstnmac/sempdf";

const response = await fetch("/images/logo.png");
if (!response.ok) {
  throw new Error(`Could not load image: ${response.status} ${response.statusText}`);
}
const imageBytes = await response.arrayBuffer();

const doc = createDocument({ language: "en-US" });
const page = doc.addPage({ size: "A4" });

page.image(imageBytes, {
  x: 56,
  y: 640,
  width: 360,
  height: 81,
  altText: "Company logo"
});
```

The image URL must be reachable from the page and, for cross-origin URLs, the
server must allow the request with CORS headers. See the complete
[browser playground example](/guide/examples#import-image-browser).

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

## Fit, position, and clipping

By default an image stretches to fill its `width`×`height` box (`fit: "fill"`). Use `fit` to preserve the image's aspect ratio within the box, and `position` to align the result:

```ts
// Scale to fit inside the box, letterboxed, anchored to the top:
page.png(pngBytes, { x: 56, y: 600, width: 200, height: 120, fit: "contain", position: "top" });

// Scale to cover the box, cropping the overflow:
page.png(pngBytes, { x: 56, y: 600, width: 200, height: 120, fit: "cover" });
```

| `fit` | Result |
|-------|--------|
| `"fill"` (default) | Stretch to the box, ignoring aspect ratio |
| `"contain"` | Scale to fit inside the box, preserving aspect (letterboxed) |
| `"cover"` | Scale to cover the box, preserving aspect (overflow cropped to the box) |

`position` (for `contain`/`cover`) accepts `"center"` (default), `"top"`, `"bottom"`, `"left"`, `"right"`, and the four corners (`"top-left"`, …).

`clip` masks the image to a shape inscribed in its box — `"ellipse"` fills the box, `"circle"` uses the smaller dimension (centered). Combine with `fit: "cover"` for a filled circular avatar:

```ts
page.jpeg(photoBytes, { x: 56, y: 560, width: 96, height: 96, fit: "cover", clip: "circle" });
```

These options apply to all raster formats (JPEG, PNG, BMP, TIFF, JP2, WebP, GIF, JBIG2) and to flow/template `image` blocks.

## Additional Image Formats

Beyond JPEG and PNG, the library supports several other image formats through dedicated methods:

- **BMP** (24-bit and 32-bit) — Windows bitmap format. 32-bit masks are written as image soft masks.
- **JPEG2000** (JPXDecode) — Available via `page.jpeg2000()`. Decoder reads the JP2 header for dimensions.
- **JBIG2** — Bi-level (black-and-white) compression ideal for scanned documents. Use `page.jbig2()` with monochrome data.
- **TIFF** (LZW) — Baseline TIFF with LZW compression. Multi-page TIFFs extract the first page only.
- **WebP** (VP8L lossless) — Lossless WebP via `page.webp()`. **WebP lossy is not supported; use lossless only.**
- **GIF** — First frame only, with transparency preserved when a transparent color index is present.
- **SVG** — Vector conversion via `page.svg()`. Rasterized to a page-relative coordinate space; text elements may be outlined.

### CMYK JPEG

JPEG images in the CMYK color space are written with a `DeviceCMYK` color space instead of `DeviceRGB`:

```ts
page.jpeg(cmykJpegBytes, { x: 56, y: 500, width: 200 });
// Written as /ColorSpace /DeviceCMYK, /Decode [0 1 0 1 0 1 0 1]
```

### Indexed PNG palette expansion

Indexed (palette-based) PNGs are automatically expanded to direct-color RGB before embedding. The palette entries are written inline in the PDF, and no transparency from the palette table is lost—`tRNS` chunks expand into a full alpha soft mask.

### EXIF orientation

JPEG and PNG images with EXIF orientation metadata are automatically rotated to the correct display orientation before embedding. The encoder reads the `Orientation` tag (TIFF/EXIF IFD0) and applies the corresponding transform, so the image appears upright without manual rotation.

## Tagged figures and alt text

For PDF/UA output, supply `altText` so screen readers can announce the image:

```ts
page.flow({ font })
  .png(logoBytes, { width: 32, altText: "Company logo" });
```

Low-level `page.png()` and `page.jpeg()` accept `altText` and `structure.boundingBox` when used inside a tagged document. Decorative images should be marked as artifacts via `structure: { tag: "Artifact" }`.
