# Deployment — OVH Public Cloud

Everything needed to run the license server (API + dashboard) on the OVH stack.
All commands run from `license-server/deploy/` unless noted.

## OVH resource map

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

## Files

- `api.Dockerfile` / `web.Dockerfile` — build from the **workspace root** context
  (the npm lockfile only exists there).
- `nginx.conf.template` — SPA serving + API proxy (envsubst `API_UPSTREAM`).
- `docker-compose.yml` — local full-stack test (bundled Postgres).
- `docker-compose.prod.yml` — per-instance prod stack (external managed PG).
- `.env.example` — every runtime variable, annotated. Copy to `.env` per host.
- `scripts/` — `build.sh`, `push.sh`, `migrate.sh`, `deploy.sh`, `provision-host.sh`.

## Local test

```sh
docker compose up --build          # web+api+pg on http://localhost:8080
docker compose run --rm migrate    # create schema
SUPERADMIN_EMAIL=you@x.com SUPERADMIN_NAME=You SUPERADMIN_PASSWORD=... \
  docker compose run --rm superadmin
```

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

## Operations notes

- **Connections**: DB1-4 caps ~100 connections. `PG_POOL_MAX=15` × 2 instances
  plus one-off jobs stays well under it.
- **SMTP**: OVH blocks outbound :25 — use a submission provider on :587
  (`SMTP_SECURE=false` → STARTTLS).
- **Sweep monitoring**: `/readyz` reports `sweep.stale: true` when the cron has
  not run within `SWEEP_STALE_SECONDS` (default 2 h) — alert on it.
- **Key rotation**: generate a new keypair (`npm run keygen`), set the new
  `LICENSE_SIGNING_KEY`/`LICENSE_SIGNING_KID`, move the old public key into
  `LICENSE_SIGNING_PUBKEYS_PREV`, and ship the client update **before** the
  server flips (signing canonical v2).
- **Observability**: each instance runs an OTel Collector
  (`otel-collector-config.yaml`) shipping the api's Prometheus `/metrics` and
  all container logs to self-hosted SigNoz via OTLP (`SIGNOZ_OTLP_ENDPOINT` in
  `.env`, plus `HOST_TAG` to distinguish instances). `/metrics` is scraped over
  the internal docker network and is never exposed publicly. Suggested SigNoz
  alerts: 5xx rate, `license_sweep_age_seconds` (wedged cron), pg pool
  saturation, and a missing-host (no data from a `host.name`) alert.
- **Backups**: managed PG has automatic backups; optionally `pg_dump` to Object
  Storage for offsite copies.
