# @barrierbreak/a11ydocs-pdf-licensing

Private licensing / usage-metering client for
[`@barrierbreak/a11ydocs-pdf`](https://npm.barrierbreak.net). Reserves a *lease*
of page quota from a license server and lets synchronous PDF generation draw it
down. Trial and over-limit grace leases return a visible watermark instruction
that the core library stamps into generated PDFs.

> Separate package within this monorepo (the `licensing/` directory). It is
> published to the **private** BarrierBreak registry, not public npm, and so is
> kept out of the public core package. It depends on the core library's
> `@barrierbreak/a11ydocs-pdf/license-guard` hook (core ≥ 1.10.0); for local dev
> the core is linked via a `file:..` dependency, so `npm install` here just
> works.

## Install

```bash
npm install @barrierbreak/a11ydocs-pdf-licensing
# peer: @barrierbreak/a11ydocs-pdf >= 1.10.0
```

## Use

```ts
import { createDocument } from "@barrierbreak/a11ydocs-pdf";
import { createLicenseClient } from "@barrierbreak/a11ydocs-pdf-licensing";

const license = await createLicenseClient({
  key: process.env.A11YDOCS_LICENSE_KEY!,
  serverUrl: "https://license.example.com",
  publicKeyPem: process.env.A11YDOCS_LICENSE_PUBKEY!, // verify signed responses
  failMode: "closed",
});

await license.checkout(50);          // reserve 50 pages
const doc = createDocument();
// ...build...
doc.toUint8Array();                  // draws the page lease down; may watermark
await license.flush();               // report actual usage
```

When the lease is exhausted, `toUint8Array()` (and the other generation exits)
throw `PdfErrorCode.LICENSE_QUOTA_EXCEEDED`; call `checkout()` again. If the
server hard-blocks the account after grace expires, checkout throws the same
error family with the server's `hardBlockAt`/`status` details.

See the core library's **Licensing and Usage Limits** guide and the
`license-server/` reference implementation for the full protocol and options.

## How it binds to the core

`createLicenseClient(...)` installs a guard through the core's public hook:

```ts
import { setLicenseGuard } from "@barrierbreak/a11ydocs-pdf/license-guard";
```

The core calls `guard.consume(...)` once per finalized document. The guard may
return `{ watermarkText }`, which the core stamps on every page before
serialization.

## Develop

```bash
npm install
npm run build   # tsc -> dist
npm test        # builds tests + runs node:test
```
