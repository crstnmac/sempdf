# License Policy Enforcement

How the license server decides whether a generation run is allowed, when output
is watermarked, when a license is blocked, and which notifications fire. This
document describes the behavior as implemented — the source of truth is
`apps/api/src/domain/policy.ts` (decisions) and `apps/api/src/domain/licenses.ts`
(metering), with tests in `apps/api/test/policy.test.ts`.

## Concepts

- **License** — issued per organization. Has a metered `limitUnits` (pages) over
  a `window` (year / lifetime — plans are annual), a running `usedUnits` counter,
  an optional `trialEndsAt`, and an optional `expiresAt` (the subscription end
  date). Annual plans pick a page-volume tier whose ceiling becomes `limitUnits`
  (0–50k, 50k–250k, 250k–1M, 1M–5M, 5M–20M, 20M+ custom).
- **Metric** — pages. One PDF page consumes one unit.
- **Fail-closed** — if the library cannot reach the server or the response can't
  be verified, generation is denied. Authorize responses are Ed25519-signed.

## The two machine endpoints

The core library talks to the server automatically (the licensing guard is baked
in; customers only set `ZEROPDF_LICENSE_KEY`).

- `POST /v1/authorize` — called before generation. This is where consumption is
  charged and the allow/watermark/block decision is made.
- `POST /v1/usage` — called after generation to reconcile actual document/page
  counts. **Audit only** — it does not change the billing counter.

### Reserve-as-charge

Consumption is debited at **authorize**, not at usage flush. This means the
server enforces the limit on its own and never depends on a client calling
`/v1/usage`. When a run is authorized, `usedUnits` is incremented by the granted
amount immediately.

The decision for a run is computed on the **pre-charge** `usedUnits`. So the run
that *crosses* the limit is evaluated while still under the limit and completes
normally; the **next** authorize sees `usedUnits >= limitUnits` and is rejected.

## Decision order (`evaluateLicensePolicy`)

Evaluated top to bottom; the first matching rule wins.

1. **Inactive** → blocked, reason `license_inactive`.
2. **Expired** (`expiresAt <= now`) → blocked, reason `license_expired`.
3. **At or over limit** (`usedUnits >= limitUnits`) → **blocked**, reason
   `limit_reached`, status `hard_blocked`. **This applies to trials too** — the
   page limit is enforced regardless of trial state.
4. **Active trial** (`trialEndsAt > now`, within the limit) → **allowed,
   watermarked** "ZeroPDF - For Trial Use Only", status `trial`. Every trial run
   is watermarked.
5. **Otherwise** → allowed, clean output, status `none`.

### Hard block at 100% — no grace period

Reaching 100% of the page limit blocks generation immediately. There is no grace
period: a run is either within the limit or the limit is reached and subsequent
runs are rejected. The single run that tips the meter to/over the limit still
completes (rule 3 sees pre-charge usage), but the following authorize is blocked.

A **trial** therefore gets its page allotment (e.g. 1000 pages) watermarked
"ZeroPDF - For Trial Use Only", and is hard-blocked once those pages are
exhausted — just like any
license. A trial is also blocked once its `trialEndsAt` date passes (it stops
matching rule 4 and, post-trial, meters clean against the limit until reached).

> The `grace_period` status value still exists in the schema for historical rows,
> but the current policy never assigns it.

## Window reset

For the `year` window, when the yearly anniversary of `windowStartedAt` has
passed the counter resets to zero on the next authorize, `windowStartedAt`
advances by a year, one-time `bonusUnits` expire, and the status returns to
`trial` (if the trial is still active) or `none`. `lifetime` windows never reset.

## Notifications

Two families of notifications are produced. Each enabled channel (email and/or
webhook in the org's notification settings) gets one queued row per event;
delivery happens out of band.

### Page-utilization alerts (inline)

Fired from the metering path as a single authorize crosses a threshold — once per
upward transition. Gated by `usageAlertsEnabled`.

- `usage_90_percent` — crossed 90% of the limit.
- `usage_95_percent` — crossed 95%.
- `usage_100_percent` — reached the limit (this run also triggers the hard block
  for the next run).

A single large run can cross several thresholds at once and emit all of them.

### Time-based reminders (sweep)

Produced by `runNotificationSweep`, exposed as `POST /v1/admin/sweep`
(superadmin-only). Run it from an external scheduler, e.g. hourly. These are
critical lifecycle notices and are always delivered to a configured channel
(not gated by the alert toggles).

**Subscription renewal** — for a non-trial license with an `expiresAt` (treated
as the yearly subscription end):

- `renewal_30_days` — 30 days before expiry.
- `renewal_15_days` — 15 days before.
- `renewal_2_days` — 2 days before.

**Trial** — for a license with a `trialEndsAt`:

- `trial_5_days` — 5 days before expiry.
- `trial_2_days` — 2 days before.
- `trial_expired` — once the trial has ended.

Only the nearest bucket fires on a given run. The sweep is idempotent: a reminder
already sent for a license within the last ~31 days is skipped, so repeated runs
send each reminder once per term while still re-firing the next term. Renewal
reminders are suppressed while a trial is active.

## Who can change trials

Only operators (SaaS maintainers, `superadmin` role) can change or extend a
trial, via `POST /v1/admin/licenses/:id/extend-trial`. The customer portal's
`POST /v1/portal/trial` only auto-provisions a trial on first use — it never
modifies an existing trial's end date.

## Telemetry

Every authorize/usage call records a telemetry row with the result
(`success` / `watermarked` / `blocked` / `fail`), page count, and client/runtime
metadata (library version, Node version, platform, tagged/language/conformance,
and an `error_code` on blocked runs — e.g. `limit_reached`, `license_expired`).
Blocked-run telemetry is committed even though the request errors, so the reason
is always visible in the operator dashboard.
