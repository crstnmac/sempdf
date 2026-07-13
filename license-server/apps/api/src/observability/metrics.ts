import { pool } from "../db/client.js";

/**
 * In-process metrics registry. Zero-dependency: simple counters + latency
 * buckets accumulated in memory, rendered as Prometheus text on /metrics.
 *
 * IMPORTANT: these counters are PER-INSTANCE. With more than one API instance
 * behind the load balancer, each exposes its own numbers — scrape them all and
 * aggregate in Prometheus (see docs/infrastructure-recommendation.md).
 */

let requestsTotal = 0;
let requestsInFlight = 0;
/** Count of responses by status class (2xx/3xx/4xx/5xx). */
const statusClass: Record<string, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
let rateLimitedTotal = 0;
/** Latency histogram: fixed millisecond buckets (cumulative rendered at export). */
const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const latencyCounts = new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0); // +1 for +Inf
let latencySumMs = 0;

export function incInFlight(): void {
  requestsInFlight++;
}
export function decInFlight(): void {
  requestsInFlight = Math.max(0, requestsInFlight - 1);
}

/** Record a completed request: bumps total, status class, and latency histogram. */
export function recordRequest(status: number, durationMs: number): void {
  requestsTotal++;
  const cls = `${Math.floor(status / 100)}xx`;
  if (cls in statusClass) statusClass[cls]!++;
  latencySumMs += durationMs;
  let placed = false;
  for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
    if (durationMs <= LATENCY_BUCKETS_MS[i]!) {
      latencyCounts[i]!++;
      placed = true;
      break;
    }
  }
  if (!placed) latencyCounts[LATENCY_BUCKETS_MS.length]!++; // +Inf bucket
}

export function recordRateLimited(): void {
  rateLimitedTotal++;
}

/** Seconds since the last successful sweep, or null when never recorded. */
async function sweepFreshness(): Promise<{ lastOkEpoch: number | null; ageSeconds: number | null }> {
  try {
    const { rows } = await pool.query<{ finished_at: Date | null }>(
      `SELECT finished_at FROM sweep_runs WHERE ok = true ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
    );
    const finishedAt = rows[0]?.finished_at ?? null;
    if (!finishedAt) return { lastOkEpoch: null, ageSeconds: null };
    const epoch = new Date(finishedAt).getTime();
    return { lastOkEpoch: Math.floor(epoch / 1000), ageSeconds: Math.floor((Date.now() - epoch) / 1000) };
  } catch {
    return { lastOkEpoch: null, ageSeconds: null };
  }
}

/** Renders the current metrics in Prometheus text exposition format. */
export async function renderPrometheus(): Promise<string> {
  const sweep = await sweepFreshness();
  const lines: string[] = [];

  lines.push("# HELP license_requests_total Total HTTP requests handled.");
  lines.push("# TYPE license_requests_total counter");
  lines.push(`license_requests_total ${requestsTotal}`);

  lines.push("# HELP license_requests_in_flight Requests currently being processed.");
  lines.push("# TYPE license_requests_in_flight gauge");
  lines.push(`license_requests_in_flight ${requestsInFlight}`);

  lines.push("# HELP license_responses_total Responses by status class.");
  lines.push("# TYPE license_responses_total counter");
  for (const [cls, n] of Object.entries(statusClass)) {
    lines.push(`license_responses_total{class="${cls}"} ${n}`);
  }

  lines.push("# HELP license_rate_limited_total Requests rejected with 429.");
  lines.push("# TYPE license_rate_limited_total counter");
  lines.push(`license_rate_limited_total ${rateLimitedTotal}`);

  lines.push("# HELP license_request_duration_ms Request latency histogram (ms).");
  lines.push("# TYPE license_request_duration_ms histogram");
  let cumulative = 0;
  for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
    cumulative += latencyCounts[i]!;
    lines.push(`license_request_duration_ms_bucket{le="${LATENCY_BUCKETS_MS[i]}"} ${cumulative}`);
  }
  cumulative += latencyCounts[LATENCY_BUCKETS_MS.length]!;
  lines.push(`license_request_duration_ms_bucket{le="+Inf"} ${cumulative}`);
  lines.push(`license_request_duration_ms_sum ${latencySumMs}`);
  lines.push(`license_request_duration_ms_count ${requestsTotal}`);

  lines.push("# HELP license_pg_pool_connections Postgres pool connection counts.");
  lines.push("# TYPE license_pg_pool_connections gauge");
  lines.push(`license_pg_pool_connections{state="total"} ${pool.totalCount}`);
  lines.push(`license_pg_pool_connections{state="idle"} ${pool.idleCount}`);
  lines.push(`license_pg_pool_connections{state="waiting"} ${pool.waitingCount}`);

  lines.push("# HELP license_sweep_last_success_timestamp Unix time of last successful sweep.");
  lines.push("# TYPE license_sweep_last_success_timestamp gauge");
  lines.push(`license_sweep_last_success_timestamp ${sweep.lastOkEpoch ?? 0}`);

  lines.push("# HELP license_sweep_age_seconds Seconds since last successful sweep.");
  lines.push("# TYPE license_sweep_age_seconds gauge");
  lines.push(`license_sweep_age_seconds ${sweep.ageSeconds ?? -1}`);

  return lines.join("\n") + "\n";
}

export { sweepFreshness };
