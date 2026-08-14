# @crstnmac/zeropdf-fonts

Optional offline font presets for ZeroPDF. The package keeps font payloads out
of the core PDF engine while exposing bundler-discoverable asset URLs.

```ts
import { createDocument } from "@crstnmac/zeropdf";
import { liberation } from "@crstnmac/zeropdf-fonts/liberation";

const doc = createDocument();
await doc.fonts(liberation);
```

The Liberation Sans, Serif, and Mono files are distributed under the SIL Open
Font License 1.1. See `liberation/LICENSE`.
