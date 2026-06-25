# Licensing and Usage Limits

::: danger Secure by default
Generation is refused with `PdfErrorCode.LICENSE_REQUIRED` unless a license
guard is installed. For the library's own tests, examples, and local trials, set
`A11YDOCS_LICENSE_DEV=1` (Node only) to allow unlicensed generation. In the
browser there is no `process.env`, so you must install a guard explicitly.
:::

Licensing has two parts:

- The **core library** exposes a guard hook at `@barrierbreak/a11ydocs-pdf/license-guard` (`setLicenseGuard`, `isLicenseDevBypass`). It has no network code.
- The **licensing client** that talks to your license server ships separately as the private package `@barrierbreak/a11ydocs-pdf-licensing` (installed from the BarrierBreak registry). It installs a guard via the hook above.

You normally just use the client; it wires the guard for you. To allow generation
without the client (e.g. an internal tool), install a permissive guard yourself:

```ts
import { setLicenseGuard } from "@barrierbreak/a11ydocs-pdf/license-guard";
setLicenseGuard({ consume() {} }); // allow unlimited generation
```

## Zero-config auto-guard (Node only)

When you set `A11YDOCS_LICENSE_KEY` and `A11YDOCS_LICENSE_SERVER` environment
variables, the core library automatically installs a built-in guard on the first
call to `toUint8Array()` / `toBlob()`. No imports, no `checkout()`, no `flush()` —
just set the env vars and generate.

```sh
export A11YDOCS_LICENSE_KEY=a11y_RoVJ2Ppl9bUbdHKj1NRXMhivW39k_-qS
export A11YDOCS_LICENSE_SERVER=http://localhost:8787
```

```ts
import { createDocument } from "@barrierbreak/a11ydocs-pdf";

// No licensing import — the guard is auto-installed on first generation.
const doc = createDocument({ title: "Hello" });
doc.addPage({ size: "A4" }).text("Hello", { x: 24, y: 700 });
await doc.toUint8Array(); // auto-guard handles checkout + flush
```

The auto-guard starts with a 10-page initial lease, refills asynchronously when
the lease drops below 5, and reports usage every 30 seconds. If the lease runs
out before a refill completes, generation throws `LICENSE_QUOTA_EXCEEDED` — wait
a moment and retry.

To shut down the auto-guard (e.g. before process exit), call:

```ts
import { shutdownAutoGuard } from "@barrierbreak/a11ydocs-pdf/license-guard";
shutdownAutoGuard(); // stops the flush timer, reports remaining usage
```

::: warning Enforcement is a deterrent, not a wall
The library runs in your customers' own Node backend, so a determined party can
patch the check out. The license server is the **billing source of truth**; the
client verifies Ed25519-signed responses so a spoofed "allow" cannot grant quota
silently. Pair it with server-side anomaly detection.
:::

## Model: lease / batch

Generation is synchronous, so the client does not call the network per PDF.
Instead it reserves a **lease** of quota, and synchronous generation draws it
down locally:

1. `await license.checkout(n)` reserves `n` units from the server (an atomic,
   row-locked check-and-increment).
2. Each `doc.toUint8Array()` / `toBlob()` / `toArrayBuffer()` / `save()` consumes
   one unit. When the lease is empty, generation throws
   `PdfErrorCode.LICENSE_QUOTA_EXCEEDED`.
3. `await license.flush()` reports actual usage back for audit.

```ts
import { createDocument } from "@barrierbreak/a11ydocs-pdf";
import { createLicenseClient } from "@barrierbreak/a11ydocs-pdf-licensing";

const license = await createLicenseClient({
  key: process.env.A11YDOCS_LICENSE_KEY!,
  serverUrl: "https://license.example.com",
  publicKeyPem: process.env.A11YDOCS_LICENSE_PUBKEY!, // verifies signed responses
  failMode: "closed",
});

await license.checkout(50);
for (const record of batch) {
  const doc = createDocument();
  // ...build the document...
  doc.toUint8Array();              // draws the lease down
}
await license.flush();
```

When the lease runs out mid-batch, catch the error and check out more:

```ts
import { PdfErrorCode } from "@barrierbreak/a11ydocs-pdf";

try {
  doc.toUint8Array();
} catch (err) {
  if ((err as { code?: string }).code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED) {
    await license.checkout(50);
    doc.toUint8Array();
  } else {
    throw err;
  }
}
```

## Options

| Option | Default | Meaning |
|--------|---------|---------|
| `key` | — | License key issued by the server. |
| `serverUrl` | — | Base URL of the license server. |
| `publicKeyPem` | — | Ed25519 SPKI PEM; when set, unsigned/invalid responses are rejected. |
| `failMode` | `"closed"` | `"closed"` blocks generation if the server is unreachable; `"open"` grants a short grace lease. |
| `graceMs` | `300000` | Grace window for `failMode: "open"`. |
| `graceUnits` | `50` | Size of a grace lease during an outage. |
| `timeoutMs` | `10000` | Per-request timeout. |
| `meter` | `"pages"` | Which dimension the local lease is measured in. Hosted licensing enforces pages; `"pdfs"` remains only for legacy/private deployments. |
| `jobId` | — | Optional application-level job id sent to telemetry. |
| `jobDescription` | — | Optional application-level description, e.g. `"August bank statement, 200000 pages"`. |

## What's metered: documents and pages

Both dimensions are always tracked, but hosted licensing enforces **pages**.
`flush()` reports both counts to the server, so a monthly run of 200 bank
statements at 26 pages each records **"200 PDFs, 5200 pages"** while page
credits are the billing source of truth.

```ts
license.state();
// { remaining, resetAt, grace, watermark, consumedDocuments: 200, consumedPages: 5200 }
```

## Fail modes

- **`closed` (recommended):** if a checkout cannot reach the server, it throws —
  true hard enforcement. Run the server highly available so an outage does not
  block your customers.
- **`open`:** after a prior successful checkout, an outage within `graceMs`
  yields a grace lease of up to `graceUnits`, reconciled on the next successful
  checkout. Better availability, small leakage risk.

## Trials, watermarking, and overage

New hosted customers start in date-bound trial mode. Trial PDFs are always
watermarked. If a customer exceeds page credits during an active run, that run
is allowed to finish without a surprise watermark; future runs are watermarked
during grace. After the configured grace period, checkout is hard-blocked until
the account is updated.
