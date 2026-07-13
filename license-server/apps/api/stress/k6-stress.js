/**
 * Production stress test for the ZeroPDF license API (Hono + Postgres).
 *
 * Target hardware this is tuned for:
 *   API : OVH Public Cloud b3-8  — 2 vCPU / 8 GB RAM (single instance, PG_POOL_MAX≈10)
 *   DB  : OVH Managed PostgreSQL Essential — ~2 vCPU / 4 GB / 80 GB
 *
 * What it exercises, weighted toward the money path:
 *   POST /v1/authorize  (70%) — reserve-as-charge. DB transaction with
 *                               SELECT ... FOR UPDATE on the license row +
 *                               telemetry INSERT + Ed25519 signature. THE
 *                               bottleneck: write-bound and lock-contended.
 *   POST /v1/usage      (20%) — audit insert + status re-evaluate.
 *   GET  /v1/license     (8%) — two indexed SELECTs, read-only.
 *   GET  /v1/public-key + /healthz (2%) — cheap, baseline/control.
 *
 * Scenarios (pick with SCENARIO env, default "load"):
 *   smoke  — 1 VU / 30s. Correctness + wiring check before real load.
 *   load   — steady ~60 VU / 5m. Expected sustainable production traffic.
 *   stress — staircase 50→450 VU. Find the knee (where p95 / errors blow up).
 *   spike  — 40 VU baseline, jump to 700 for 1m, recover. Shock + drain test.
 *   soak   — 80 VU / 30m. Memory leaks, pool exhaustion, telemetry-table bloat.
 *
 * Run (k6 must be installed — https://k6.io/docs/get-started/installation/):
 *   k6 run -e BASE_URL=https://api.example.com stress/k6-stress.js
 *   k6 run -e SCENARIO=stress -e BASE_URL=http://1.2.3.4:8787 stress/k6-stress.js
 *   k6 run -e SCENARIO=soak   stress/k6-stress.js
 *
 * keys.json must be generated first by `npm run stress:seed`.
 *
 * NOTE: every authorize/usage hit writes a telemetry row. A long soak inflates
 * api_telemetry by millions of rows — truncate the stress rows afterwards with
 * `STRESS_CLEAN=1 npm run stress:seed`, and VACUUM if needed.
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:8787").replace(/\/$/, "");
const SCENARIO = __ENV.SCENARIO || "load";

// 403 is a CORRECT response for the over-quota "tight" cohort, not a failure.
// Without this, k6's built-in http_req_failed counts every 403 as an error and
// trips its threshold. business_errors (custom) remains the true failure signal.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 403));

// ---- seed data ------------------------------------------------------------
// Loaded once per VU pool (SharedArray dedupes across VUs to save memory).
const SEED = new SharedArray("keys", () => {
  const data = JSON.parse(open("./keys.json"));
  return data.keys;
});
const BULK = new SharedArray("bulk", () =>
  JSON.parse(open("./keys.json")).keys.filter((k) => k.cohort === "bulk"),
);
const TIGHT = new SharedArray("tight", () =>
  JSON.parse(open("./keys.json")).keys.filter((k) => k.cohort === "tight"),
);

// ---- custom metrics -------------------------------------------------------
const authorizeLatency = new Trend("authorize_latency", true);
const usageLatency = new Trend("usage_latency", true);
const licenseLatency = new Trend("license_latency", true);
const granted = new Counter("authorize_granted");
const overQuota = new Counter("authorize_blocked_403"); // expected for tight cohort
const businessErrors = new Rate("business_errors"); // unexpected non-2xx/-403

// ---- scenario / threshold profiles ---------------------------------------
const STAGES = {
  smoke: [
    { duration: "2s", target: 1 },
    { duration: "28s", target: 1 },
  ],
  // Fast feedback run: ramp to 50 VU in 10s, hold 50s. Use before a full load/stress.
  quick: [
    { duration: "10s", target: 50 },
    { duration: "50s", target: 50 },
  ],
  load: [
    { duration: "1m", target: 60 },
    { duration: "5m", target: 60 },
    { duration: "1m", target: 0 },
  ],
  stress: [
    { duration: "1m", target: 50 },
    { duration: "2m", target: 150 },
    { duration: "2m", target: 300 },
    { duration: "2m", target: 450 },
    { duration: "2m", target: 450 },
    { duration: "1m", target: 0 },
  ],
  spike: [
    { duration: "1m", target: 40 },
    { duration: "10s", target: 700 },
    { duration: "1m", target: 700 },
    { duration: "30s", target: 40 },
    { duration: "1m", target: 40 },
    { duration: "30s", target: 0 },
  ],
  soak: [
    { duration: "2m", target: 80 },
    { duration: "30m", target: 80 },
    { duration: "2m", target: 0 },
  ],
};

if (!STAGES[SCENARIO]) throw new Error(`unknown SCENARIO "${SCENARIO}"`);

export const options = {
  scenarios: {
    [SCENARIO]: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: STAGES[SCENARIO],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    // Hard pass/fail gates. Looser on the stress/spike runs (we WANT to push past
    // the knee there), strict on load/soak (must hold under real traffic).
    authorize_latency: [
      SCENARIO === "stress" || SCENARIO === "spike" ? "p(95)<2500" : "p(95)<800",
      "p(99)<5000",
    ],
    business_errors: ["rate<0.01"], // <1% unexpected failures, always
    http_req_failed: ["rate<0.05"], // network/5xx ceiling (402/403 excluded below via tags)
    license_latency: ["p(95)<300"],
  },
  // Don't let a slow ramp-down skew the percentiles we report.
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// ---- helpers --------------------------------------------------------------
function pick(arr) {
  return arr[randomIntBetween(0, arr.length - 1)];
}

function authHeaders(key) {
  return {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

// Realistic client telemetry payload (mirrors the baked-in auto-guard).
function meta() {
  return {
    libVersion: "2.0.0",
    nodeVersion: "v22.11.0",
    platform: "linux",
    tagged: true,
    language: "en",
    conformance: "pdf/ua-1",
  };
}

function doAuthorize() {
  // 90% of authorize traffic hits the bulk cohort (happy path / contention),
  // 10% hits the tight cohort to exercise the 403 limit_reached transaction.
  const useTight = TIGHT.length > 0 && Math.random() < 0.1;
  const entry = pick(useTight ? TIGHT : BULK.length ? BULK : SEED);
  const body = JSON.stringify({
    requested: randomIntBetween(1, 5),
    nonce: `${__VU}-${__ITER}-${randomIntBetween(0, 1e9)}`,
    meta: meta(),
  });
  const res = http.post(`${BASE_URL}/v1/authorize`, body, {
    ...authHeaders(entry.key),
    tags: { name: "authorize", cohort: entry.cohort },
  });
  authorizeLatency.add(res.timings.duration);

  if (res.status === 200) {
    granted.add(1);
    check(res, { "authorize signed": (r) => !!r.json("signature") });
    businessErrors.add(false);
  } else if (res.status === 403) {
    overQuota.add(1); // expected for the tight cohort
    businessErrors.add(false);
  } else {
    businessErrors.add(true);
    check(res, { "authorize 2xx/403": () => false });
  }
}

function doUsage() {
  const entry = pick(BULK.length ? BULK : SEED);
  const docs = randomIntBetween(1, 3);
  const body = JSON.stringify({
    documents: docs,
    pages: docs * randomIntBetween(1, 20),
    status: "success",
    jobId: `job-${__VU}-${__ITER}`,
    meta: meta(),
  });
  const res = http.post(`${BASE_URL}/v1/usage`, body, {
    ...authHeaders(entry.key),
    tags: { name: "usage" },
  });
  usageLatency.add(res.timings.duration);
  businessErrors.add(res.status !== 200);
  check(res, { "usage ok": (r) => r.status === 200 });
}

function doLicense() {
  const entry = pick(SEED);
  const res = http.get(`${BASE_URL}/v1/license`, {
    ...authHeaders(entry.key),
    tags: { name: "license" },
  });
  licenseLatency.add(res.timings.duration);
  businessErrors.add(res.status !== 200);
  check(res, { "license ok": (r) => r.status === 200 });
}

function doCheap() {
  const res =
    Math.random() < 0.5
      ? http.get(`${BASE_URL}/healthz`, { tags: { name: "healthz" } })
      : http.get(`${BASE_URL}/v1/public-key`, { tags: { name: "public-key" } });
  businessErrors.add(res.status !== 200);
}

// ---- main VU loop ---------------------------------------------------------
export default function () {
  const r = Math.random();
  if (r < 0.7) doAuthorize();
  else if (r < 0.9) doUsage();
  else if (r < 0.98) doLicense();
  else doCheap();
}

export function setup() {
  // Fail fast if the seed file is empty or the server is unreachable.
  if (SEED.length === 0) throw new Error("keys.json is empty — run `npm run stress:seed` first");
  const ping = http.get(`${BASE_URL}/healthz`);
  if (ping.status !== 200) throw new Error(`server not healthy at ${BASE_URL}/healthz (got ${ping.status})`);
  console.log(`scenario=${SCENARIO} base=${BASE_URL} keys=${SEED.length} bulk=${BULK.length} tight=${TIGHT.length}`);
}
