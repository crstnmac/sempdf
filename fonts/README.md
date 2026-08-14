# @crstnmac/sempdf-fonts

Optional offline font presets for SemPDF. The package keeps font payloads out
of the core PDF engine while exposing bundler-discoverable asset URLs.

```ts
import { createDocument } from "@crstnmac/sempdf";
import { liberation } from "@crstnmac/sempdf-fonts/liberation";

const doc = createDocument();
await doc.fonts(liberation);
```

The Liberation Sans, Serif, and Mono files are distributed under the SIL Open
Font License 1.1. See `liberation/LICENSE`.
