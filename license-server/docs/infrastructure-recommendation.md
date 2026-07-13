# License Server — Infrastructure Recommendation (Initial Launch)

**Audience:** Engineering management
**Scope:** Hosting for the licensing/metering server and customer dashboard at launch (trials + first paying customers)
**Constraint:** US-only data residency
**Provider:** OVHcloud **US** (us.ovhcloud.com)

---

## Summary

For initial launch we recommend a lean, single-region setup on OVHcloud US: one application
instance for the API, a managed PostgreSQL database, and CDN-hosted static dashboard. This is
low-cost, low-maintenance, and scales horizontally when trials convert to paying customers.

| Component | Service | Spec |
|---|---|---|
| API server | OVH Public Cloud instance `b3-8` | 2 vCPU / 8 GB RAM |
| Database | OVH Managed PostgreSQL — **Essential** | ~2 vCPU / 4 GB / 80 GB |
| Dashboard | Object Storage + CDN | Static build (negligible compute) |
| Networking | vRack private network | Database has no public IP |
| Region | **US-EAST (Vint Hill, Virginia)** | Single region at launch |

---

## Why this setup

- **The API is lightweight; the database does the real work.** Each license check is one small
  database transaction plus a digital signature. CPU demand is low, so we do not over-provision
  compute. A single `b3-8` instance comfortably handles dozens of trial customers and tens of
  requests per second.
- **Managed PostgreSQL removes operational burden.** Backups, patching, and monitoring are handled
  by OVH. This matters because the system is *fail-closed* — if the database is unavailable,
  customers cannot generate documents. The database must be reliable from day one.
- **The dashboard is static** and served from CDN, so it adds essentially no server cost.
- **Single region keeps latency low.** License checks are synchronous, so the API and database must
  sit in the same region. US-EAST (Virginia) is closest to the majority of US business traffic.

---

## US data residency note

OVHcloud US is a **separate legal entity under US jurisdiction** — this is the correct choice for
US-only data residency. (OVH's Beauharnois data center is in Canada and should not be used if the
requirement is strictly US soil.) Available US regions are **Vint Hill, Virginia (US-EAST)** and
**Hillsboro, Oregon (US-WEST)**; we default to Virginia.

---

## One item to verify before purchase

Confirm **Managed PostgreSQL is available in the chosen US region** (OVHcloud US has narrower
service availability than OVH Europe).

- **If available:** use Managed PostgreSQL Essential as above.
- **If not available:** run PostgreSQL on a second `b3-8` instance with automated backups to US
  Object Storage, or use a US-region managed database from another provider (e.g. AWS RDS
  us-east-1). We should **not** run an unbacked self-hosted database for live customers.

---

## Cost posture

This is the minimum responsible footprint: one application instance, one managed database, and
CDN storage. No load balancer, database high-availability cluster, or connection pooler is needed
at launch — these are added later as load grows, not pre-purchased.

---

## Scaling path (for later, not now)

| Trigger | Action |
|---|---|
| Trials convert to paying customers | Upgrade database to **Managed PostgreSQL Business** (2-node high availability) |
| Sustained higher traffic | Add a 2nd/3rd API instance behind a Public Cloud Load Balancer (the API is stateless) |
| ~80+ database connections | Introduce a PgBouncer connection pooler |
| Telemetry table grows large | Apply data retention / archival to cold storage |

---

## Non-negotiables at launch

- **Automated database backups** (included with Managed PostgreSQL).
- **Secrets** (signing key, auth secret, database credentials) stored in a secret manager — not in
  the application image.
- **Database on the private network (vRack)** — never exposed to the public internet.

---

## Recommendation in one line

> Launch on **OVHcloud US, US-EAST (Virginia)**: one `b3-8` API instance + Managed PostgreSQL
> Essential + Object Storage/CDN dashboard, on a vRack private network. Verify Managed PostgreSQL
> availability in the region first. Upgrade the database to a high-availability plan and add a
> second API instance once trials convert to paying customers.

---

## High availability & single points of failure (post-hardening review)

The launch footprint above is deliberately minimal, but it is worth naming the single points of
failure explicitly and the constraints the application code now imposes on horizontal scaling.

### SPOFs at launch

- **Single API instance.** One `b3-8` is a SPOF: a crash, a bad deploy, or host maintenance takes
  the licensing surface down entirely. Authorize is on the customers' critical path (the SDK calls
  it before generating), so an outage blocks customer workloads.
- **Single PostgreSQL.** Managed PostgreSQL *Essential* is single-node. The DB is the hard
  dependency for every authorize/usage call; losing it is a full outage. Backups protect against
  data loss but not against downtime.

### Recommendation

- **Run ≥2 API instances behind the load balancer.** The API is stateless *except* for the two
  in-process concerns below, so two or three small instances + the Public Cloud Load Balancer give
  rolling deploys and host-failure tolerance. Health-check the LB against **`/readyz`** (which
  verifies DB connectivity), not `/healthz` (liveness only), so an instance with a dead DB
  connection is drained.
- **PostgreSQL HA / read replica.** Move to **Managed PostgreSQL Business** (2-node HA) before the
  first paying customer depends on uptime. A read replica can later offload the heavy
  dashboard/telemetry reads from the write primary that authorize needs.
- **Connection pooler (PgBouncer)** once instance-count × `PG_POOL_MAX` approaches the server's
  connection ceiling.

### Per-instance state — the multi-instance caveats

Two pieces of the hardened API hold state **in process memory**, so they do **not** coordinate
across instances:

1. **Rate limiter** (`src/middleware/rate-limit.ts`). The sliding-window counters live in each
   instance's memory. With *N* instances behind the LB, the effective global limit is *N* ×
   `RATE_LIMIT_MAX` (and a client pinned to one instance by sticky routing sees the single-instance
   limit). For correct global limiting across instances, back the limiter with a **shared store**
   (Redis with a sliding-window or token-bucket Lua script). Until then, set `RATE_LIMIT_MAX` with
   the instance count in mind, or treat it as best-effort abuse protection rather than a hard quota.
2. **Metrics counters** (`src/observability/metrics.ts`). `license_requests_total`, latency
   histograms, the 429 counter, etc. are per-instance. Scrape **every** instance's `/metrics` and
   aggregate in Prometheus; do not read a single instance and assume it is the whole fleet. (Pool
   gauges and `license_sweep_age_seconds` are read live — pool stats are inherently per-instance;
   sweep age comes from the shared DB so it is consistent across instances.)

The **idempotency ledger** (`request_nonces`) and the **sweep heartbeat** (`sweep_runs`) are in
Postgres, so they *are* shared and correct across instances — authorize de-duplication and sweep
freshness work regardless of which instance handles a request.

### Operational cron jobs

Two maintenance jobs run from external cron (single-runner; do **not** fan out across instances):

- **`npm run sweep:prod`** — hourly. Lifecycle reminders + notification delivery. Writes a
  `sweep_runs` heartbeat; alert when `license_sweep_age_seconds` (from `/metrics`) exceeds
  `SWEEP_STALE_SECONDS`.
- **`npm run telemetry:prune:prod`** — daily. Batched retention delete on `api_telemetry`
  (`TELEMETRY_RETENTION_DAYS`) and `request_nonces` (`NONCE_RETENTION_DAYS`) so neither fills the
  disk.
