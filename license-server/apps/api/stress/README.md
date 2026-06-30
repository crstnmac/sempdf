# License API stress test

Load harness for the machine-facing license API, tuned for:

| Tier | Spec |
|------|------|
| API  | OVH b3-8 — 2 vCPU / 8 GB (single Node instance, `PG_POOL_MAX≈10`) |
| DB   | OVH Managed PostgreSQL Essential — ~2 vCPU / 4 GB / 80 GB |

## What's measured

`POST /v1/authorize` is the bottleneck and gets 70% of traffic. Each call runs a
DB transaction: `SELECT … FOR UPDATE` on the license row → telemetry `INSERT` →
Ed25519 sign. Write-bound and lock-contended. Because **many keys share one
license row**, concurrent calls for the same license serialize on the row lock —
the seeder's `KEYS_PER_LICENSE` knob controls how hard you push that.

Traffic mix: authorize 70% · usage 20% · license 8% · health/public-key 2%.

## Prereqs

- [k6](https://k6.io/docs/get-started/installation/) on the load box (NOT the API box).
- `.env` with a working `DATABASE_URL` (seeder writes straight to Postgres).
- **Run the load generator from a separate machine** — sharing the 2 vCPU API box skews everything.

## 1. Seed

```bash
cd apps/api
npm run stress:seed                                     # 100 licenses x 4 keys
STRESS_LICENSES=300 STRESS_KEYS_PER_LICENSE=8 npm run stress:seed   # heavier contention
```

Writes `stress/keys.json`. Seeder knobs (env):

| Var | Default | Meaning |
|-----|---------|---------|
| `STRESS_LICENSES` | 100 | distinct license rows = distinct lock targets |
| `STRESS_KEYS_PER_LICENSE` | 4 | keys/license; ↑ = more row-lock contention |
| `STRESS_LIMIT` | 1e9 | bulk-cohort page limit (never blocks) |
| `STRESS_TIGHT_FRACTION` | 0.1 | share of licenses pre-maxed → exercise 403 path |

## 2. Run

```bash
k6 run -e SCENARIO=smoke  -e BASE_URL=https://api.example.com stress/k6-stress.js
k6 run -e SCENARIO=load   -e BASE_URL=https://api.example.com stress/k6-stress.js
k6 run -e SCENARIO=stress -e BASE_URL=https://api.example.com stress/k6-stress.js
k6 run -e SCENARIO=spike  -e BASE_URL=https://api.example.com stress/k6-stress.js
k6 run -e SCENARIO=soak   -e BASE_URL=https://api.example.com stress/k6-stress.js
```

| Scenario | Shape | Purpose |
|----------|-------|---------|
| smoke  | 1 VU / 30s | wiring + correctness |
| load   | 60 VU / 5m steady | expected sustainable traffic |
| stress | staircase 50→450 VU | find the knee |
| spike  | 40→700→40 | shock + drain |
| soak   | 80 VU / 30m | leaks, pool exhaustion, telemetry bloat |

## 3. Read results

- `authorize_latency` — the number that matters. Thresholds: p95<800ms (load/soak), p95<2500ms (stress/spike).
- `authorize_blocked_403` — expected hits on the tight cohort (correctness, not error).
- `business_errors` — unexpected non-2xx/-403. Must stay <1%.
- `http_req_failed` — network/5xx ceiling <5%.

Watch on the boxes during the run:
- API: CPU (Ed25519 + JSON), event-loop lag, RSS.
- DB: `pg_stat_activity` for `Lock` waits on the licenses row, connection count vs pool, CPU, IOPS, WAL/disk on the 80 GB volume.

**Pool note:** `PG_POOL_MAX≈10` per instance is the binding limit. If authorize
latency climbs while DB CPU stays low, you're queueing on the pool, not the DB —
raise `PG_POOL_MAX` (stay under the DB's `max_connections`) or scale API instances.

## 4. Teardown

```bash
npm run stress:clean   # deletes only stress-test:* rows (licenses, keys, telemetry, notifications)
```

Then `VACUUM (ANALYZE) api_telemetry;` if a long soak bloated it.
