# Images

Embed images directly from byte arrays. JPEG and PNG are the primary raster paths, with additional helpers for BMP, GIF, JPEG2000, JBIG2, TIFF, WebP, and SVG. PNG transparency masks and alpha-channel soft masks are preserved.

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
