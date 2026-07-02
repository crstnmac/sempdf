# License Server — Deployment & Operations

Everything needed to develop, deploy, and operate the license server (API +
dashboard). Production targets the OVH Public Cloud stack; local development
runs against Docker. All commands run from `license-server/deploy/` unless
noted.

## Contents

1. [Architecture & OVH resource map](#architecture--ovh-resource-map)
2. [Files in this folder](#files-in-this-folder)
3. [Local development](#local-development)
4. [Secrets — generation reference](#secrets--generation-reference)
5. [First production deploy](#first-production-deploy)
6. [Routine release](#routine-release)
7. [Releasing the client library](#releasing-the-client-library-after-this-server-is-live)
8. [Signing-key rotation](#signing-key-rotation)
9. [Observability](#observability)
10. [Backups & restore](#backups--restore)
11. [Rollback](#rollback)
12. [Troubleshooting](#troubleshooting)

## Architecture & OVH resource map

| Resource | Role |
| --- | --- |
| 2× `b3-8` | Docker hosts, each runs the `api` + `web` containers (`docker-compose.prod.yml`) |
| Load Balancer S | TLS termination (Let's Encrypt), forwards :443 → instance :80. Health check: `GET /readyz` |
| Gateway S | Egress for the private-only instances (registry pulls, SMTP :587, apt) |
| Floating IPv4 | Attached to the LB; DNS A record for `APP_URL` points here |
| Private network / vRack | Instances, LB backend, and Postgres all attach here; instances have **no public IP** |
| PostgreSQL Business DB1-4 (2 nodes) | `DATABASE_URL` (TLS enforced → `sslmode=require`); restrict authorised IPs to the private subnet |
| Managed Private Registry S | Hosts `license-api` / `license-web` images (`scripts/push.sh`) |
| Object Storage (optional) | Offsite `pg_dump` backups |
| Secret Manager (optional, recommended) | `LICENSE_SIGNING_KEY`, `BETTER_AUTH_SECRET`, `SMTP_PASS`, `DATABASE_URL` — render into `/opt/a11ydocs/.env` at deploy time |

```text
Internet → Floating IP → LB S (TLS) ──► b3-8 #1 / #2 :80 (nginx `web`)
                                          web proxies /v1 + /api/auth → api:8787
                                          hosts → Gateway S (egress)
                                          hosts → Postgres DB1-4 (private, TLS)
```

The `web` container's nginx proxies API paths to the `api` container, so the LB
needs only **one** backend farm (port 80) — no path-based routing on the LB.
`/readyz` is proxied for the LB health check; it drains an instance whose DB
connection is dead and reports notification-sweep staleness.

## Files in this folder

- `api.Dockerfile` / `web.Dockerfile` — build from the **workspace root** context
  (the npm lockfile only exists there).
- `nginx.conf.template` — SPA serving + API proxy (envsubst `API_UPSTREAM`).
- `docker-compose.yml` — local full-stack test (bundled Postgres).
- `docker-compose.prod.yml` — per-instance prod stack (external managed PG) +
  OTel collector.
- `otel-collector-config.yaml` — metrics + log shipping to SigNoz.
- `.env.example` — every runtime variable, annotated. Copy to `.env` per host.
- `scripts/` — `build.sh`, `push.sh`, `migrate.sh`, `deploy.sh`, `provision-host.sh`.

## Local development

Two ways to run locally:

### A. Full stack in Docker (closest to prod)

```sh
docker compose up --build          # web+api+pg on http://localhost:8080
docker compose run --rm migrate    # create schema
SUPERADMIN_EMAIL=you@x.com SUPERADMIN_NAME=You SUPERADMIN_PASSWORD=... \
  docker compose run --rm superadmin
```

### B. Hot-reload dev servers (day-to-day work)

The api (`tsx watch`) and dashboard (`vite dev`) run on the host; only Postgres
runs in Docker.

**1. Dev database** — on port **5433**, because macOS dev machines often have a
native Postgres already occupying 5432 (see [Troubleshooting](#troubleshooting)):

```sh
docker run -d --name a11ydocs-dev-db \
  -e POSTGRES_USER=a11ydocs -e POSTGRES_PASSWORD=a11ydocs \
  -e POSTGRES_DB=a11ydocs_license \
  -p 5433:5432 -v a11ydocs-dev-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

**2. Environment** — create `license-server/apps/api/.env` from
`.env.example`. Generate the secrets with openssl (see
[Secrets](#secrets--generation-reference)); point `DATABASE_URL` at the dev
container:

```sh
DATABASE_URL=postgres://a11ydocs:a11ydocs@localhost:5433/a11ydocs_license
```

`.env` is gitignored — never commit it.

**3. Schema + superadmin** (from `license-server/apps/api/`):

```sh
# drizzle-kit does NOT read .env — export the URL explicitly:
export DATABASE_URL=postgres://a11ydocs:a11ydocs@localhost:5433/a11ydocs_license
npx drizzle-kit push
npm run create-superadmin        # reads SUPERADMIN_* from .env
```

**4. Run** (from `license-server/`):

```sh
npm run dev        # api :8787 + dashboard :3000, concurrently
```

Sign in at `http://localhost:3000` with `SUPERADMIN_EMAIL` /
`SUPERADMIN_PASSWORD` from `.env`. Health: `curl localhost:8787/readyz`.
Public signing key: `curl localhost:8787/v1/public-key`.

**5. Email (optional)** — run smtp4dev so lifecycle emails land in a local
inbox instead of being logged:

```sh
docker run -d -p 2525:25 -p 5693:80 rnwood/smtp4dev
# .env: SMTP_HOST=localhost, SMTP_PORT=2525 — inbox at http://localhost:5693
```

## Secrets — generation reference

All secrets generate with openssl; none have safe defaults (the api fails fast
at boot when missing).

```sh
# Ed25519 signing keypair (private → LICENSE_SIGNING_KEY, PKCS8 PEM)
openssl genpkey -algorithm ed25519 > signing-key.pem
openssl pkey -in signing-key.pem -pubout > signing-public-key.pem
# (equivalently: npm run keygen from apps/api prints both)

# better-auth session secret
openssl rand -base64 48

# one-off passwords (superadmin bootstrap, etc.)
openssl rand -base64 18 | tr -d '/+='
```

Rules:

- **Dev and prod secrets are never shared.** Generate fresh values for each
  environment; prod values live in the OVH Secret Manager and are rendered into
  `/opt/a11ydocs/.env` at deploy time.
- The **private** signing key exists only on the license server. The **public**
  key is distributed: baked into the core library at release build
  (`A11YDOCS_LICENSE_PUBKEYS`) and served at `/v1/public-key`.
- The superadmin password is a bootstrap credential — change it from the
  dashboard after first login on prod.

## First production deploy

1. **OVH console**: create vRack/private network, attach both instances (no
   public IP), LB, Gateway; attach Floating IP to LB; create the Postgres
   cluster and registry. LB: HTTPS :443 front (Let's Encrypt cert), backend
   farm = both instances :80, health check `GET /readyz`.
2. **Each instance**: `sudo bash provision-host.sh` (installs docker; pass
   `INSTALL_CRON=yes` on **one** host only — it runs the hourly notification
   sweep and daily telemetry prune). Then `docker login <registry>` with a
   Harbor robot account and place the filled-in `.env` at `/opt/a11ydocs/.env`.
3. **Build & push** (from your machine): `scripts/build.sh && REGISTRY=... scripts/push.sh`.
4. **Schema**: from a host that can reach the managed PG (inside the vRack):
   `DATABASE_URL='postgres://...sslmode=require' scripts/migrate.sh`.
5. **Superadmin** (once): on an instance,
   `docker compose -f docker-compose.prod.yml --env-file .env run --rm api node apps/api/dist/scripts/create-superadmin.js`.
6. **Deploy**: `HOSTS="10.0.0.11 10.0.0.12" scripts/deploy.sh <tag>` — rolls one
   host at a time, waiting on `/readyz` between hosts.

## Routine release

```sh
scripts/build.sh                      # tag = git short SHA
REGISTRY=... scripts/push.sh
HOSTS="10.0.0.11 10.0.0.12" scripts/deploy.sh $(git rev-parse --short HEAD)
```

Schema changes: run `scripts/migrate.sh` against prod **before** deploying the
image that needs them (drizzle-kit push is additive-safe; review the plan).

## Releasing the client library (after this server is live)

The core library bakes licensing constants at build time
(`scripts/bake-license-server.mjs`, runs on `prebuild`). A production npm
release MUST be built with:

```sh
A11YDOCS_LICENSE_SERVER=https://<public-domain> \
A11YDOCS_LICENSE_PUBKEYS='{"v1":"-----BEGIN PUBLIC KEY-----\n..."}' \
npm publish   # prepublishOnly runs the bake + build + tests
```

The pubkeys map is kid-keyed (get the PEM from the server's `/v1/public-key`;
keep old kids during signing-key rotation). Without baked keys the auto-guard
skips signature verification of authorize responses (the bake script warns);
without the URL it points at localhost. Both are release blockers.

Note: the licensing companion package must be published as **0.2.1 or later**
(0.2.0 exists deprecated on the registry from a rolled-back release).

## Signing-key rotation

Client-before-server, using the `kid` in every signed response:

1. Generate a new keypair; assign the next kid (e.g. `v2`).
2. **Ship the client first**: release the core library with BOTH keys baked —
   `A11YDOCS_LICENSE_PUBKEYS='{"v1":"...","v2":"..."}'`. Wait until customers
   that matter are on it.
3. Flip the server: set the new private key in `LICENSE_SIGNING_KEY`,
   `LICENSE_SIGNING_KID=v2`, and move the old public key into
   `LICENSE_SIGNING_PUBKEYS_PREV=v1:<base64(spkiPem)>` so `/v1/public-key`
   still advertises it during the window.
4. After the window: drop `v1` from the next client release and from
   `LICENSE_SIGNING_PUBKEYS_PREV`.

Never rotate server-first: clients verifying with only the old key would
fail-closed against valid `v2` responses.

## Observability

Each instance runs an OTel Collector (`otel-collector-config.yaml`) shipping
the api's Prometheus `/metrics` and all container logs to self-hosted SigNoz
via OTLP (`SIGNOZ_OTLP_ENDPOINT` in `.env`, plus `HOST_TAG` to tell the two
instances apart). `/metrics` is scraped over the internal docker network and is
never exposed publicly.

Suggested SigNoz alerts:

- 5xx rate over threshold (`license_requests_total` by status class).
- `license_sweep_age_seconds` > 7200 — the notification cron is wedged
  (`/readyz` also surfaces `sweep.stale`).
- pg pool saturation (pool gauges vs `PG_POOL_MAX`).
- Missing host: no data from a `host.name` for N minutes → instance or
  collector down.

Plus an external uptime check on `https://<domain>/readyz` (UptimeRobot or
similar) — the collectors can't tell you the LB itself is down.

## Backups & restore

- Managed Postgres has automatic daily backups + PITR — configure retention in
  the OVH console.
- Optional offsite copy: `pg_dump` from a vRack host to Object Storage
  (`pg_dump "$DATABASE_URL" | gzip | openstack object create ...` via cron).
- Restore drill: managed PG restores to a **new** cluster/endpoint — after a
  restore, update `DATABASE_URL` on both hosts' `.env` and
  `docker compose up -d`.
- The Ed25519 **private signing key is not in the database** — it lives only in
  the Secret Manager / host `.env`. Losing it means rotating clients to a new
  key (see rotation above), so back the secret store up accordingly.

## Rollback

Images are tagged by git SHA and kept in the registry:

```sh
HOSTS="10.0.0.11 10.0.0.12" scripts/deploy.sh <previous-sha>
```

Schema is the caveat: drizzle pushes are additive in normal operation, so old
code runs against new schema. If a release included a destructive migration,
restore the DB to the pre-migration point first (PITR), then roll the image
back.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `npm ci` in Docker fails with `E401 Unable to authenticate` | A lockfile entry resolves to the private registry (`npm.barrierbreak.net`). Public packages should resolve from npmjs — rewrite the `resolved` URLs or authenticate the build. |
| `COPY apps/web` fails with `cannot replace ... node_modules` | Host `node_modules` entered the build context. `license-server/.dockerignore` must exclude `**/node_modules` and `**/dist`. |
| `drizzle-kit push` hangs at "Pulling schema" / connects nowhere | drizzle-kit does **not** read `.env` — `export DATABASE_URL=...` before running it. |
| Dev DB: `role "a11ydocs" does not exist` but the container looks fine | Another Postgres owns `localhost:5432` (macOS: Postgres.app/homebrew service). The dev container maps **5433** for exactly this reason — check `lsof -nP -iTCP:5432 -sTCP:LISTEN`. |
| API exits at boot: `Missing required secret(s)` | `DATABASE_URL`, `LICENSE_SIGNING_KEY`, or `BETTER_AUTH_SECRET` unset — the server fails fast by design. Generate via the [secrets reference](#secrets--generation-reference). |
| `/readyz` shows `sweep: { stale: true }` | The hourly sweep cron hasn't completed within `SWEEP_STALE_SECONDS`. Check `/etc/cron.d/a11ydocs` on the cron host and `docker exec a11ydocs-api node apps/api/dist/scripts/sweep.js` manually. |
| Emails not arriving | `SMTP_HOST` empty → emails are logged, not sent (intentional dev mode). Prod: OVH blocks outbound :25 — use a submission provider on :587 (`SMTP_SECURE=false` = STARTTLS). Diagnose with `GET /v1/admin/email/health` (superadmin). |
| Instance drained by the LB | `/readyz` returns 503 when the DB is unreachable — check `PG_*` settings, the managed PG's authorized-IP list, and vRack attachment. |

## Operations notes

- **Connections**: DB1-4 caps ~100 connections. `PG_POOL_MAX=15` × 2 instances
  plus one-off jobs stays well under it.
- **SMTP**: OVH blocks outbound :25 — use a submission provider on :587
  (`SMTP_SECURE=false` → STARTTLS).
- **Key hygiene**: never promote dev secrets to prod; the bake-time public keys
  must match the prod `LICENSE_SIGNING_KEY`, or every client fails closed.
