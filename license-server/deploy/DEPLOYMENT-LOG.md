# OVH Production Deployment — Complete Steps

The full, concrete sequence for deploying the license server to OVHcloud US
(`US-EAST-VA-1`), with the real values of this deployment. `README.md` is the
generic runbook; this is the as-built guide — every step below was executed
and verified on 2026-07-17; the server is LIVE at
**`https://zeropdf.zeropdf.net`** (HTTP/2 + HSTS, Let's Encrypt,
`/readyz` green through the LB, both hosts serving, sweep cron running).

**As-built values used throughout:**

| Thing | Value |
| --- | --- |
| Region | `US-EAST-VA-1` |
| Private network | `OVH-BB-ZeroPDF`, subnet `10.0.0.0/24` |
| lic-1 (cron host) | `10.0.0.4` |
| lic-2 | `10.0.0.8` |
| Floating IP #1 | `40.160.68.111` → Load Balancer VIP (public entry) |
| Floating IP #2 | lic-1 SSH access (jump host) |
| Postgres | `postgresql-34450c45-o6e17b183.database.cloud.ovh.us:16875`, PG 18, Essential DB1-4, database `licensedb` |
| DB user | `avnadmin` for now (see ownership debt in launch blockers — the `zeropdf` role was accidentally deleted mid-setup) |
| Images | no registry — `docker save | ssh docker load`, `REGISTRY=local` |
| TLS to Postgres | OVH private CA at `/opt/zeropdf/ovh-ca.pem` on each host, mounted into the api container via `NODE_EXTRA_CA_CERTS` (compose does this) |
| TLS public | LIVE — Let's Encrypt on LB :443 (TERMINATED_HTTPS via Barbican; renewal ~2026-10-15, runbook in launch-blockers section) |

---

## Phase 1 — OVH console (infrastructure)

### 1.1 Private network + Gateway

Public Cloud → Network → Private networks → Create:

- Region `US-EAST-VA-1`, subnet `10.0.0.0/24`, DHCP on, default-route off.
- IP plan: fixed assignments from `.2–.99`, DHCP pool `.100–.200`
  (`.0`/`.255` unusable, `.1` = gateway).

Network → Gateway → Create → size **S** → attach to the subnet. This is the
instances' only outbound path (registry pulls, SMTP :587, apt) — they get no
public IPs.

### 1.2 Quota (if console shows less)

File one request: 4 instances / 8 vCPU / 32 GB RAM / 2 floating IPs / 2 LBs,
region US-EAST-VA-1, use case: 2 production hosts + provisioning/blue-green
headroom. Quota is a cap, not spend.

### 1.3 Instances

2× **b3-8** (flexible), image Ubuntu/Debian, attach **only the private
network**, SSH key uploaded. Note the private IPs (here: `.4` and `.8`).

### 1.4 Load Balancer + Floating IPs

- **LB S** on the private network. Listener HTTP :80 (HTTPS comes later).
  Backend pool: `10.0.0.4:80` + `10.0.0.8:80`, round-robin, health monitor
  HTTP `GET /readyz` (temporarily `GET /` until the stack is deployed —
  otherwise all members show DOWN and the LB serves nothing).
- **Floating IP #1** → associate with the **LB VIP** (not an instance).
- **Floating IP #2** → lic-1, for SSH. Lock its security group to :22 from
  known addresses only.

Browser gotcha while HTTP-only: Chrome/Safari silently try `https://` first
and fail; test with an explicit `http://` URL (Firefox falls back on its own).

### 1.5 Managed PostgreSQL

Databases → Create: **PostgreSQL 18**, plan **Essential** DB1-4 (cost call —
see blockers: upgrade to **Business** 2-node HA before first customer; the
client library is fail-closed, so DB downtime stops customers' generation),
region `US-EAST-VA-1`, **private network** attachment.

After provisioning:

1. Authorized IPs → `10.0.0.0/24` (one entry, whole subnet).
2. Databases → create `licensedb` (don't use `defaultdb`).
3. Users → create the app user — password shown once, store in a password
   manager. Never paste credentials into chats/tickets; if leaked, reset.
   The app user needs `GRANT CREATE ON DATABASE licensedb` (run as
   `avnadmin`) before migrations can create drizzle's bookkeeping schema.
4. Copy endpoint host + port from Overview.
5. **Download the CA certificate** (service page → "CA certificate"; arrives
   as `.txt` — it's PEM, extension irrelevant) and place it on both hosts as
   `/opt/zeropdf/ovh-ca.pem`. The prod compose mounts it into the api
   container with `NODE_EXTRA_CA_CERTS`. Without it the api fails with
   `self-signed certificate in certificate chain`.

Connectivity check (from lic-1, once SSH works):

```sh
docker run --rm postgres:18-alpine psql \
  "postgres://<USER>:<PASSWORD>@postgresql-34450c45-o6e17b183.database.cloud.ovh.us:16875/licensedb?sslmode=require" \
  -c "\conninfo"
```

⚠️ **This psql check proves reachability + credentials only — NOT that the api
will connect.** libpq's `sslmode=require` skips certificate verification;
node-pg's does not. The CA file (step 5) is still required.

---

## Phase 2 — Workstation SSH setup

`~/.ssh/config` (OVH uses its own key; `IdentitiesOnly` avoids
too-many-auth-failures when the agent holds several keys):

```
Host lic-1
  HostName <floating-ip-2>
  User ubuntu                # check with whoami — debian on Debian images
  IdentityFile ~/.ssh/ovh_key
  IdentitiesOnly yes

Host lic-2
  HostName 10.0.0.8
  User ubuntu
  IdentityFile ~/.ssh/ovh_key
  IdentitiesOnly yes
  ProxyJump lic-1
```

Test: `ssh lic-1 whoami && ssh lic-2 whoami`.

---

## Phase 3 — Host provisioning

Only `provision-host.sh` runs ON the instances; every other script runs from
the workstation. From `license-server/deploy/`:

```sh
scp scripts/provision-host.sh lic-1:/tmp/
ssh lic-1 'sudo INSTALL_CRON=yes bash /tmp/provision-host.sh'   # cron: lic-1 ONLY

scp scripts/provision-host.sh lic-2:/tmp/
ssh lic-2 'sudo bash /tmp/provision-host.sh'
```

Installs docker + compose, creates `/opt/zeropdf`, and (lic-1) the hourly
notification sweep + daily telemetry prune cron.

If a host-level nginx was ever installed manually: `sudo systemctl disable
--now nginx` — the `web` container owns :80.

---

## Phase 4 — Production `.env` (both hosts)

Place at `/opt/zeropdf/.env` on BOTH hosts — identical except `HOST_TAG`.

Generate secrets **on lic-1**, fresh (never promote dev values):

```sh
openssl genpkey -algorithm ed25519        # → LICENSE_SIGNING_KEY (quoted, multiline)
openssl rand -base64 48                   # → BETTER_AUTH_SECRET
openssl rand -base64 18 | tr -d '/+='     # → SUPERADMIN_PASSWORD
```

```sh
# ── Images (docker save/load path — no registry) ────────────────────────────
REGISTRY=local
TAG=latest

# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgres://zeropdf:<DB_PASSWORD>@postgresql-34450c45-o6e17b183.database.cloud.ovh.us:16875/licensedb?sslmode=require

# ── Secrets ──────────────────────────────────────────────────────────────────
LICENSE_SIGNING_KEY="<PRIVATE_PEM>"
BETTER_AUTH_SECRET=<RAND48>
LICENSE_SIGNING_KID=v1

# ── URLs ─────────────────────────────────────────────────────────────────────
APP_URL=https://zeropdf.zeropdf.net
BETTER_AUTH_URL=https://zeropdf.zeropdf.net
TRUSTED_ORIGINS=https://zeropdf.zeropdf.net
HSTS_ENABLED=true

# ── Tuning ───────────────────────────────────────────────────────────────────
PG_POOL_MAX=15
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=1000
RATE_LIMIT_MAX=50

# ── SMTP (none yet → emails are logged, not sent) ────────────────────────────
SMTP_HOST=
SMTP_FROM=no-reply@zeropdf.com
SMTP_FROM_NAME=ZeroPDF
PRODUCT_NAME=ZeroPDF
SUPPORT_EMAIL=support@zeropdf.com

# ── Superadmin bootstrap ─────────────────────────────────────────────────────
SUPERADMIN_EMAIL=criston@zeropdf.com
SUPERADMIN_NAME=Criston
SUPERADMIN_PASSWORD=<RAND18>

# ── Observability (parked) ───────────────────────────────────────────────────
SIGNOZ_OTLP_ENDPOINT=
HOST_TAG=lic-1        # ← lic-2 on the other host
```

---

## Phase 5 — Build & ship images

From `license-server/` on the workstation. Apple Silicon note: production
hosts are x86_64 — `build.sh` cross-builds `linux/amd64` by default (without
this, containers die with exec-format errors).

```sh
deploy/scripts/build.sh                      # builds license-api / license-web

# retag for the no-registry compose reference (${REGISTRY}/name with REGISTRY=local)
docker tag license-api:latest local/license-api:latest
docker tag license-web:latest local/license-web:latest

for h in lic-1 lic-2; do
  docker save local/license-api:latest local/license-web:latest | gzip | \
    ssh $h 'gunzip | docker load'
  scp deploy/docker-compose.prod.yml deploy/otel-collector-config.yaml $h:/opt/zeropdf/
done
```

---

## Phase 6 — Schema + superadmin

Migrations are **baked into the api image**: `npx drizzle-kit generate` (run
locally, offline — no DB connection) writes numbered `.sql` files + journal to
`apps/api/drizzle/`, which the Dockerfile copies into the image. On the host,
drizzle-orm's built-in migrator applies them — idempotent (tracked in
`drizzle.__drizzle_migrations`), safe to run on every deploy.

Prerequisites that bit us (both must hold before the migrator can succeed):

1. `/opt/zeropdf/ovh-ca.pem` present + the compose that mounts it shipped
   (else `self-signed certificate in certificate chain`).
2. The `.env` user has `CREATE` on the database (else
   `permission denied for database`). As `avnadmin`:
   `GRANT CREATE ON DATABASE licensedb TO <user>;` then verify
   `SELECT has_database_privilege('<user>','licensedb','CREATE');` → `t`.

```sh
ssh lic-1 'cd /opt/zeropdf && docker compose -f docker-compose.prod.yml --env-file .env \
  run --rm api node apps/api/dist/scripts/migrate.js'
# → "migrations applied"; re-running is a no-op   ✅ VERIFIED 2026-07-17
```

Debugging tip that saved us: drizzle wraps **connection** failures as
`Failed query: CREATE SCHEMA ...`, which reads like a permissions problem when
it may be TLS. To see the real error, probe with the container's own
connection:

```sh
ssh lic-1 'cat > /tmp/dbcheck.js <<EOF
const { Pool } = require("pg");
const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
p.query("SELECT current_database() db, current_user usr, has_database_privilege(current_user, current_database(), \x27CREATE\x27) can_create")
 .then(r => { console.log("CONNECTED:", JSON.stringify(r.rows[0])); return p.end(); })
 .catch(e => { console.error("CONN_ERR:", e.message); process.exit(1); });
EOF
cd /opt/zeropdf && docker compose -f docker-compose.prod.yml --env-file .env \
  run --rm -v /tmp/dbcheck.js:/repo/dbcheck.js api node /repo/dbcheck.js'
# mount under /repo (not /tmp) — module resolution needs /repo/node_modules
```

Schema-change workflow from now on: edit `src/db/schema.ts` → `npm run
db:generate` (new numbered `.sql` appears — review it, commit it) → rebuild +
ship the image → run the migrate one-off BEFORE `deploy.sh` starts the new
code. Never hand-edit applied migration files; add a new one.

Note: databases originally created with `drizzle-kit push` (local dev) have no
migrations journal — the first `migrate.js` run there would re-CREATE existing
tables and fail. Dev keeps using `db:push`; fresh production DBs are
unaffected.

Failure table:

| Error | Cause |
| --- | --- |
| `self-signed certificate in certificate chain` | OVH's private CA missing from Node's trust store — download CA from the DB service page to `/opt/zeropdf/ovh-ca.pem` (compose mounts it via `NODE_EXTRA_CA_CERTS`). `psql` working anyway is expected: libpq's `require` skips verification, node-pg's doesn't. |
| `password authentication failed` | special chars in password — URL-encode (`@` → `%40`) |
| `database "licensedb" does not exist` | create it in console → Databases first |
| hangs forever | allowlist missing `10.0.0.0/24` |
| relation already exists | DB was previously pushed via drizzle-kit (see note above) |

Superadmin (one-off container on lic-1, reads `SUPERADMIN_*` from `.env`):

```sh
ssh lic-1 'cd /opt/zeropdf && docker compose -f docker-compose.prod.yml --env-file .env \
  run --rm api node apps/api/dist/scripts/create-superadmin.js'
```

---

## Phase 7 — Start & verify

```sh
# per host (or HOSTS="lic-1 lic-2" deploy/scripts/deploy.sh latest):
ssh lic-1 'cd /opt/zeropdf && docker compose -f docker-compose.prod.yml --env-file .env up -d'
ssh lic-2 'cd /opt/zeropdf && docker compose -f docker-compose.prod.yml --env-file .env up -d'

ssh lic-1 'curl -s localhost/readyz'   # {"ready":true,"db":"up",...}
ssh lic-2 'curl -s localhost/readyz'
curl -s http://40.160.68.111/readyz    # through the LB
```

✅ VERIFIED 2026-07-17: `/readyz` green on both hosts and through the LB;
dashboard serves; `/v1/public-key` returns the prod signing key (`kid: v1`).

Three first-start failures hit and their fixes (all now expected states):

| Failure | Fix |
| --- | --- |
| web container: `bind :80 address already in use` | Host-level nginx (installed during LB bring-up testing) still owned the port — `sudo systemctl disable --now nginx`. The web CONTAINER owns :80. |
| web restart-loops: `host not found in upstream "api"` | Stale compose network from an earlier failed start — full recreate: `docker compose down && docker compose up -d`. |
| One host `db: down` while the other is green | Per-host `.env` drift — the DB password was fixed on one host only. `.env` changes must be applied to BOTH hosts, then `up -d --force-recreate api`. |

Console: flip the LB health monitor to `GET /readyz` (if it was `/` during
bring-up) and confirm both members ONLINE.

Smoke test the real flow: dashboard login (`http://40.160.68.111`) as
superadmin → create test customer + license key → run one generation with
`ZEROPDF_LICENSE_KEY=<test key> ZEROPDF_LICENSE_SERVER=http://40.160.68.111`
→ expect clean output and usage on the dashboard.

## Routine release

### Code-only change (api or dashboard)

```sh
cd license-server

# 1. build (cross-compiles linux/amd64 for the x86 hosts)
deploy/scripts/build.sh

# 2. retag for the no-registry compose reference + ship to both hosts
docker tag license-api:latest local/license-api:latest
docker tag license-web:latest local/license-web:latest
for h in lic-1 lic-2; do
  docker save local/license-api:latest local/license-web:latest | gzip | \
    ssh $h 'gunzip | docker load'
done

# 3. rolling restart — one host at a time, LB serves from the other.
#    Confirm lic-1 is green BEFORE touching lic-2.
ssh lic-1 'cd /opt/zeropdf && docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate'
ssh lic-1 'curl -s localhost/readyz'
ssh lic-2 'cd /opt/zeropdf && docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate'
ssh lic-2 'curl -s localhost/readyz'
```

### Schema change (two extra steps around the same flow)

```sh
# 0. after editing src/db/schema.ts — generate the migration OFFLINE
cd license-server/apps/api
npx drizzle-kit generate      # new numbered .sql in drizzle/ — REVIEW it
git add drizzle/ && git commit  # must be committed: migrations bake into the image

# … build + ship as above (new image carries the migration), then BEFORE restarting:
ssh lic-1 'cd /opt/zeropdf && docker compose -f docker-compose.prod.yml --env-file .env \
  run --rm api node apps/api/dist/scripts/migrate.js'
# → "migrations applied" — idempotent, safe to re-run

# … then the rolling restart from step 3
```

**Order matters:** migrate BEFORE restarting, so new code never meets old
schema. The reverse (old code + new schema, during the rolling window) is safe
as long as migrations stay additive — new columns nullable/defaulted; never
drop a column in the same release as the code that stops using it.

Rules that keep releases boring:

- Never edit an applied migration file — generate a new one.
- Compose/`.env` changes must be applied to BOTH hosts (see the per-host
  drift failure in Phase 7).
- **Rollback:** previous images still exist on the hosts — retag the old image
  to `local/license-api:latest` (`docker images` to find it) and `up -d`.
  No re-shipping. If a release included a migration, additive-only means old
  code keeps working against the new schema; destructive changes need a DB
  restore first.

---

## Launch blockers (clear before first real customer)

- [x] **DNS + TLS — DONE 2026-07-17.** `https://zeropdf.zeropdf.net`
      live: HTTP/2, HSTS on, Let's Encrypt cert (expires **2026-10-15** —
      ⏰ RENEWAL every ~90 days, see below). How it was built (console cannot
      do this on OVH US — CLI only):
      1. certbot DNS-01 on workstation (`docker run certbot/certbot certonly
         --manual --preferred-challenges dns -d zeropdf.zeropdf.net`).
      2. fullchain+privkey → PKCS12 (empty pass) → Barbican:
         `openstack secret store --name='LE-zeropdf-2026-10'
         -t 'application/octet-stream' -e 'base64' --payload="$(base64 < zeropdf.p12)"`.
      3. `openstack loadbalancer listener create --protocol-port 443
         --protocol TERMINATED_HTTPS --default-tls-container=<secret href>
         --default-pool <existing pool id> A11yDocLib-LB`.
      4. RENEWAL: repeat 1–2 with a new secret name, then
         `openstack loadbalancer listener set --default-tls-container=<new> https-listener`.
      OpenStack creds: `~/openrc.sh` (chmod 600, password via edited line or
      macOS Keychain lookup).
      **Architecture bug found & fixed during this step:** the DNS floating IP
      `40.160.68.111` had been attached to lic-1's port, NOT the LB VIP — the
      domain was bypassing the load balancer entirely (and :443 was refused
      because instances terminate no TLS). Fixed: `40.160.68.111` → LB VIP
      (port of `10.0.0.22`), `40.160.10.34` → lic-1 for SSH (ssh config
      updated). Real load-balancing effective only since this fix.
      Console :80→HTTPS redirect policy: not yet added (HSTS covers repeat
      visitors) — optional follow-up.
- [ ] **Postgres Essential → Business** (2-node HA). Fail-closed client means
      DB downtime stops customer generation. Check console for in-place
      upgrade; else schedule a dump/restore switchover.
- [ ] **DB user hygiene** — the app currently runs as `avnadmin` (the
      `zeropdf` role was accidentally deleted mid-setup and migrations were
      run as admin per explicit call). Before launch: recreate the app user in
      the console, then as `avnadmin` in `licensedb`:
      `REASSIGN OWNED BY avnadmin TO <user>; GRANT CREATE ON DATABASE
      licensedb TO <user>;` — flip both `.env`s to the app user and
      `up -d --force-recreate api` on both hosts. Also reset any credential
      that was ever pasted into a chat/ticket.
- [ ] **`sslmode=verify-full`** in both `.env` `DATABASE_URL`s — pins today's
      node-pg verification behavior before pg v9 weakens `require`.
- [x] **SMTP provider** — **Done 2026-07-20**: M365 `smtp.office365.com:587`
      STARTTLS as `support@zeropdf.net` (app password; tenant still
      allows SMTP AUTH). Wired into both instances' `.env` (api recreated —
      trial/renewal notifications now actually SEND) and Grafana
      (`GF_SMTP_*`). Send verified from lic-1. ⚠ The app password was pasted
      into a chat during setup — rotate it and update both
      `/opt/zeropdf/.env` + `lic-1:~/monitoring/.env`.
- [ ] **Client library release build**:
      `ZEROPDF_LICENSE_SERVER=https://<domain>` +
      `ZEROPDF_LICENSE_PUBKEYS='{"v1":"<PEM from /v1/public-key>"}'`.
      Never bake the bare IP; never skip the keys (bake script warns).
- [x] Licensing companion package publishes as **0.2.1+** — **Done
      2026-07-17**: `0.2.1` live on `npm.zeropdf.net` (release `a5cd44f`,
      includes the canonical-v3 client). `0.2.0` stays deprecated on the
      registry from the rolled-back release.
- [x] ~~SigNoz~~ **Done 2026-07-20 as Loki + Prometheus + Grafana** (SigNoz
      dropped — was never wired; otel-collector had been crash-looping with an
      empty endpoint since day one). See "Observability (as-built)" below.
      Still TODO inside it: Grafana alerts (5xx rate,
      `license_sweep_age_seconds` > 7200, pg pool saturation, missing host);
      external uptime check on `/readyz`.

## Origin pinning for API keys (2026-07-20)

New migration `0001_quick_cannonball.sql` adds `api_keys.allowed_origins`
(nullable `text[]`; null/empty = unrestricted — every existing key is
unaffected). Follows the standard additive-migration release flow above:
migration ships in the image, applied automatically by `migrate.js` on deploy.

Lets browser/extension keys be pinned to specific origins from the customer
portal (API keys → "Origins"); `/v1/authorize`, `/v1/usage`, `/v1/license` all
reject a pinned key when the request's `Origin` header doesn't match —
including requests with no `Origin` at all, so a pinned key only ever works
from a browser. Documented as abuse mitigation, not cryptographic protection,
in `docs/guide/licensing.md#origin-pinning-browser-chrome-extension-keys`.

## Observability (as-built, 2026-07-20)

Grafana Alloy on each instance (service `alloy` in `docker-compose.prod.yml`)
tails all docker containers → Loki and scrapes `api:8787/metrics` →
Prometheus remote-write. The Loki/Prometheus/Grafana stack runs **on lic-1**
at `~/monitoring/` (no separate monitoring server), bound to `10.0.0.4` only
via `BIND_IP` — nothing on a public interface.

| Thing | Value |
| --- | --- |
| Loki | `http://10.0.0.4:3100` (`LOKI_ENDPOINT` in both `/opt/zeropdf/.env`) |
| Prometheus | `http://10.0.0.4:9090` (`PROM_ENDPOINT`) |
| Grafana | `10.0.0.4:3000` — SSH tunnel only |
| Grafana login | `admin` / `GRAFANA_ADMIN_PASSWORD` in `lic-1:~/monitoring/.env` |
| Host labels | `HOST_TAG=lic-1` / `lic-2` → `host` label on every log/metric |

Access:

```bash
ssh -L 3000:10.0.0.4:3000 lic-1   # then http://localhost:3000
```

Logs: Explore → Loki → `{host="lic-2", container="zeropdf-api"}`.
Metrics: Explore → Prometheus → `up{job="license-api"}`.

Verified at deploy: both hosts streaming to Loki (api/web/alloy containers),
`up{job="license-api"} == 1` for lic-1 and lic-2. The old
`otel-collector-config.yaml`/`SIGNOZ_*` vars are gone from repo and hosts.

Dashboard **"ZeroPDF License Server"** (`/d/zeropdf-overview`) is
file-provisioned from `monitoring/dashboards/zeropdf-overview.json`
(provider `grafana-dashboards.yaml`, mounted in compose) — the repo JSON is
source of truth; UI edits don't persist back. 12 panels: up/sweep-age/
in-flight/5xx stats, request rate + status classes, p50/p95/p99 latency,
pg pool, rate-limited, log volume, error + api log panels.

Alert rules (added 2026-07-20, file-provisioned from `monitoring/alerting/`):
`lic-5xx-rate` (>0.05/s 5xx for 5m), `lic-sweep-stale` (sweep age >7200s),
`lic-pool-saturation` (pg pool waiting >0 for 5m), `lic-host-down`
(<2 healthy hosts — catches both up==0 and a host that stops reporting).
Contact point `ops-email` → `ALERT_EMAIL` via M365 SMTP (`GF_SMTP_*`);
pipeline verified end-to-end with a temporary always-firing smoke rule.
Editing rules: change the YAML in repo, scp to `lic-1:~/monitoring/alerting/`,
restart grafana — removing a rule needs a `deleteRules:` entry, deleting the
file alone does not unprovision it. Still TODO: external uptime check on
`/readyz`.

## Parked (deliberate)

- Managed Private Registry (save/load fine at 2 hosts; revisit if deploys
  become frequent).
- Secret Manager (secrets in `/opt/zeropdf/.env` on-host for now).
- Object Storage offsite `pg_dump` (managed auto-backups only).
- WireGuard into the vRack (SSH jump host in the meantime).
