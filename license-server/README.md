# sempdf License Server

License + usage-metering server for `@sempdf/sempdf-pdf`. Customers run
the library in their own Node backend; before generating they reserve a block of
quota (a *lease*) from this server, which is the **billing source of truth**.

- **Stack:** Hono · Drizzle ORM · better-auth · Postgres · TanStack Router/Vite · shadcn/ui
- **Enforcement model:** page-metered jobs, fail-closed, Ed25519-signed responses,
  trial/overage watermarking, grace-period hard block

## How it works

1. The client calls `POST /v1/authorize { requested, nonce, jobId?, jobDescription?, isExistingJob? }`.
   The server does an atomic, row-locked page check and records telemetry.
   If the request starts under limit, the full run is allowed even if it pushes
   the account over. Future runs are watermarked during grace.
2. The client verifies the Ed25519 `signature` (so a spoofed "allow" is
   rejected), adds `granted` pages to its local lease, and applies the returned
   `watermark`/`watermarkText` decision to generated PDFs.
3. The client periodically calls `POST /v1/usage { documents, pages, status?, jobId?, jobDescription? }`
   to reconcile actual usage for audit and telemetry.

Because the customer controls their runtime, the client can be bypassed — so the
server meters authoritatively and the signature stops silent quota grants. Treat
client enforcement as a deterrent plus an accurate billing feed, backed by
server-side anomaly detection.

## Project structure

```
apps/
  api/                Hono API, Better Auth, Drizzle schema, policy tests
    src/
      index.ts        starts the HTTP server
      app.ts          assembles health, auth, machine, and admin routes
      db/             Drizzle client + app tables
      domain/         licensing policy, signing, key generation
      routes/         /v1 machine and /v1/admin operator endpoints
  web/                TanStack Router Vite dashboard with shadcn/ui
packages/             reserved for shared contracts as the API/UI boundary grows
```

## Setup

```bash
cp apps/api/.env.example apps/api/.env
npm install
npm run keygen                # prints LICENSE_SIGNING_KEY + public key
```

Put the printed **private** PEM in `LICENSE_SIGNING_KEY`. Give the **public** PEM
to clients (also served at `GET /v1/public-key`).

### Migrations

App tables (Drizzle) and better-auth tables live in the same database:

```bash
npm run db:push        # licenses + usage_events (Drizzle)
npm run auth:generate  # user/session/organization/admin tables (better-auth)
```

### Run

```bash
npm run dev:api        # API on http://localhost:8787
npm run dev:web        # dashboard on http://localhost:3000, proxies /v1 + /api/auth
npm run build          # builds workspaces
```

## API

### Machine endpoints (authenticated by the licence key)

The licence key is sent as `Authorization: Bearer <key>` (a `key` body field is
also accepted for compatibility). Keys are stored **hashed** (SHA-256) — the
plaintext is shown only once, when the licence is created or rotated.

| Method | Path | Auth + Body | Result |
|--------|------|------|--------|
| `POST` | `/v1/authorize` | Bearer key · `{ requested, nonce, jobId?, jobDescription?, isExistingJob? }` | `{ granted, remaining, resetAt, nonce, signature, watermark, watermarkText, status, hardBlockAt }` · `403` hard-blocked |
| `POST` | `/v1/usage` | Bearer key · `{ documents, pages, status?, jobId?, jobDescription? }` | `{ ok: true }` — records both dimensions for reporting |
| `GET`  | `/v1/license` | Bearer key | licence status (never returns the key) |
| `GET`  | `/v1/public-key` | — | Ed25519 public key (PEM) |

### Auth + admin (better-auth)

- `/(*)` under `/api/auth/**` is handled by better-auth (sign-in, sessions,
  organizations, admin).
- Admin endpoints require a better-auth session with the `admin` role:

| Method | Path | Body | Result |
|--------|------|------|--------|
| `POST` | `/v1/admin/licenses` | `{ accountId, limit, window?, trialDays?, trialEndsAt?, gracePeriodDays?, failMode?, expiresAt? }` | trial licence + `key` (**shown once**) |
| `POST` | `/v1/admin/licenses/:id/rotate` | — | new `key` (**shown once**); old key stops working |
| `POST` | `/v1/admin/licenses/:id/revoke` | — | `{ ok: true }` |
| `POST` | `/v1/admin/licenses/:id/extend-trial` | `{ trialEndsAt }` or `{ days }` | updates trial expiry and clears overage |
| `GET` | `/v1/admin/dashboard` | — | aggregate tenant usage, telemetry, notification settings |
| `GET` | `/v1/admin/licenses/:id/usage` | — | real-time usage, trial/overage status, recent telemetry |
| `GET/PUT` | `/v1/admin/accounts/:accountId/notification-settings` | email/webhook/frequency/toggles | notification preferences |
| `POST` | `/v1/admin/notifications/sweep` | — | queues usage summaries and 24h hard-block warnings |
| `GET` | `/v1/admin/notification-events` | — | notification outbox |

`accountId` is a better-auth **organization** id (a customer). `window` is
`day` \| `month` \| `lifetime`; `failMode` is `closed` \| `open`. Admin routes
use the licence `id` (a UUID), not the secret key.

## Key security

- Keys are stored as a **SHA-256 hash** plus a non-secret prefix; the plaintext
  is shown only at creation/rotation. A database leak does not expose usable keys.
- Keys travel as a **Bearer token** over HTTPS, keeping them out of body logs.
- **Rotation** issues a new key and invalidates the old one immediately;
  **revoke** disables a licence without deleting its history.

## Page credits, trials, and overage

A license is page-metered. New sign-ups start in trial mode (`trialEndsAt`),
and every trial PDF is visibly watermarked. When a trial expires it follows the
same grace flow as an over-limit account: future jobs are watermarked, then new
jobs are hard-blocked after `gracePeriodDays`.

- **Pages per month:** `metric: "pages"`, `window: "month"`, `limit: 200000`
- **Lifetime total:** `window: "lifetime"`, `limit: 50000`
- **Per-day cap:** `window: "day"`, `limit: 500`
- **Subscription:** any `limit` plus `expiresAt`; expiry blocks regardless of count

Both documents and pages are recorded on every `/v1/usage` call, so reports can
show e.g. "200 PDFs, 5200 pages", but enforcement uses pages only.

## Client integration

```ts
import { createDocument } from "@sempdf/sempdf-pdf";
import { createLicenseClient } from "@sempdf/sempdf-pdf-licensing";

const license = await createLicenseClient({
  key: process.env.SEMPDF_LICENSE_KEY!,
  serverUrl: "https://license.example.com",
  publicKeyPem: process.env.SEMPDF_LICENSE_PUBKEY!, // verify signed responses
  failMode: "closed",
});

await license.checkout(50);          // reserve 50 pages
for (const data of batch) {
  const doc = createDocument();
  // ...build...
  doc.toUint8Array();                // draws the lease down; throws when empty
}
await license.flush();               // report actual usage
```

## Dashboard

`apps/web` was created with the official TanStack CLI in router-only Vite mode.
It reads live data from `GET /v1/admin/dashboard`; there is no seeded placeholder
tenant data in the UI. The shadcn CLI is configured via `components.json`, and
`src/components/ui/button.tsx` is generated by `shadcn add button`.

## Deploy (Dokploy)

Build `apps/api/Dockerfile` with `apps/api` as the build context. Set
`DATABASE_URL`, `LICENSE_SIGNING_KEY`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
`PORT`. Run `db:push` + `auth:generate` once against the production database
(a deploy/setup step), then start the container. For true fail-closed
enforcement, run the server HA so customer generation is not blocked by a
single-instance outage.
