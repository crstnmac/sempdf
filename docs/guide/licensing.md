# Licensing and Usage Limits

::: danger Secure by default
Generation is refused with `PdfErrorCode.LICENSE_REQUIRED` unless a license
guard is installed — and only the server-backed auto-guard (a valid
`A11YDOCS_LICENSE_KEY`) produces watermark-free output. Everything else is
visibly stamped: `A11YDOCS_LICENSE_DEV=1` (Node only) allows generation for
local development but marks every page `DEVELOPMENT — not for distribution`,
and any guard installed through the public `setLicenseGuard()` marks every page
`UNLICENSED — evaluation only` (the text is fixed; a guard cannot override it).
In the browser there is no `process.env`, so a guard must be installed
explicitly — its output carries the unlicensed watermark.
:::

Licensing has two parts:

- The **core library** exposes a guard hook at `@barrierbreak/a11ydocs-pdf/license-guard` (`setLicenseGuard`, `isLicenseDevBypass`). It has no network code.
- The **licensing client** that talks to your license server ships separately as the private package `@barrierbreak/a11ydocs-pdf-licensing` (installed from the BarrierBreak registry). It installs a guard via the hook above.

You normally use the **auto-guard** (below) — it is the only path that produces
watermark-free output. A guard you install yourself allows generation but the
output is always stamped `UNLICENSED — evaluation only` (fine for demos and
internal previews):

```ts
import { setLicenseGuard } from "@barrierbreak/a11ydocs-pdf/license-guard";
setLicenseGuard({ consume() {} }); // unlimited generation, watermarked output
```

The licensing client package upgrades itself to the verified path
automatically: on its first successful `checkout()` it authorizes against a
core-issued install challenge and presents the server-signed response as proof
(`getLicenseInstallChallenge()` + `setLicenseGuardWithProof()`), so its output
is clean — or carries the server-mandated trial watermark, which the proof
pins so a permissive guard cannot drop it.

## Zero-config auto-guard (Node only)

When you set `A11YDOCS_LICENSE_KEY` and `A11YDOCS_LICENSE_SERVER` environment
variables, the core library automatically installs a built-in guard the first
time you generate. No imports, no `checkout()`, no `flush()` — just set the env
vars and call an **async output method**.

```sh
export A11YDOCS_LICENSE_KEY=a11y_RoVJ2Ppl9bUbdHKj1NRXMhivW39k_-qS
export A11YDOCS_LICENSE_SERVER=http://localhost:8787
```

```ts
import { createDocument } from "@barrierbreak/a11ydocs-pdf";

// No licensing import — the guard is auto-installed on first generation.
const doc = createDocument({ title: "Hello" });
doc.addPage({ size: "A4" }).text("Hello", { x: 24, y: 700 });
await doc.save("hello.pdf"); // pre-authorizes, generates, and flushes usage
```

### Use an async output method

Authorizing quota is a network round-trip, so it can only run from an `async`
method. These methods pre-authorize the page batch with the server, generate,
then flush usage back — with **zero extra code**:

| Method | Returns |
|--------|---------|
| `await doc.save(path)` / `writeToFile(path)` | writes a file (Node) |
| `await doc.toUint8ArrayAsync()` | `Uint8Array` |
| `await doc.toArrayBufferAsync()` | `ArrayBuffer` |
| `await doc.toBlobAsync()` | `Blob` (browser-friendly) |
| `await doc.writeTo(sink)` | streams to a `ByteSink` |

::: warning Synchronous `toUint8Array()` cannot auto-authorize
The synchronous `toUint8Array()` / `toArrayBuffer()` / `toBlob()` methods cannot
await the authorize round-trip, so on a cold lease they throw
`LICENSE_QUOTA_EXCEEDED`. Either switch to an async method above, or call
`await checkout(pages)` first (see [Model: lease / batch](#model-lease-batch)).
:::

The auto-guard starts with **no lease** (`0`): pages are only generated after the
server authorizes them, so the server's counter is the source of truth and an
over-limit, expired, or inactive license is enforced rather than silently
bypassed. After the first authorize it refills by `100` pages whenever the lease
drops below `5`, and flushes usage on a short debounce (and a background timer)
so usage lands promptly without a network call per PDF.

The async output methods flush before they resolve, so short-lived scripts
record usage even though the background flush timer is `unref()`'d. For a
long-running process you can still shut the guard down explicitly before exit:

```ts
import { shutdownAutoGuard } from "@barrierbreak/a11ydocs-pdf/license-guard";
shutdownAutoGuard(); // stops the flush timer, reports remaining usage
```

Advanced callers can drive the same baked-in steps manually — both are exported
from `@barrierbreak/a11ydocs-pdf/license-guard`:

```ts
import { ensureLicenseAuthorized, flushLicenseUsage } from "@barrierbreak/a11ydocs-pdf/license-guard";

await ensureLicenseAuthorized(doc.pageCount); // pre-authorize the batch
const bytes = doc.toUint8Array();             // now safe: lease is warm
await flushLicenseUsage();                     // report usage and await delivery
```

::: warning Enforcement is a deterrent, not a wall
The library runs in your customers' own Node backend, so a determined party can
patch the check out. The license server is the **billing source of truth**; the
client verifies Ed25519-signed responses so a spoofed "allow" cannot grant quota
silently. Pair it with server-side anomaly detection.
:::

## Model: lease / batch

::: tip
Most callers don't need this. The [async output methods](#use-an-async-output-method)
above already pre-authorize and flush for you. Reach for explicit `checkout()`
only when you want to reserve a large batch up front and then use the
**synchronous** `toUint8Array()` in a tight loop.
:::

Generation can be synchronous, so the client need not call the network per PDF.
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
