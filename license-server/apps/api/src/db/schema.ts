import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Application tables. better-auth owns its own auth tables (user, session,
// account, verification, organization, member, apikey) — generate those with
// its CLI (`npx @better-auth/cli generate`). `accountId` below references a
// better-auth organization id (a customer).

/** Host/server metadata reported by the library's auto-guard (Node only). */
export interface HostMeta {
  hostname?: string | undefined;
  osType?: string | undefined;
  osRelease?: string | undefined;
  cpuCount?: number | undefined;
  totalMemBytes?: number | undefined;
  cloud?: string | undefined;
  region?: string | undefined;
}

/**
 * A license: the unit of enforcement. Carries a page quota (`limitUnits`) over
 * a window, a running counter (`usedUnits`), trial and overage state, and
 * operational flags.
 */
export const licenses = pgTable("licenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(), // better-auth organization id
  metric: text("metric").notNull().default("pages"),
  window: text("window", { enum: ["year", "lifetime"] }).notNull().default("year"),
  // Recurring per-window allowance.
  limitUnits: bigint("limit_units", { mode: "number" }).notNull(),
  // One-time extra pages granted for the CURRENT window only; reset to 0 when the
  // window rolls over. Effective allowance = limitUnits + bonusUnits.
  bonusUnits: bigint("bonus_units", { mode: "number" }).notNull().default(0),
  usedUnits: bigint("used_units", { mode: "number" }).notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status", { enum: ["none", "trial", "hard_blocked"] }).notNull().default("trial"),
  firstOverageAt: timestamp("first_overage_at", { withTimezone: true }),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }).notNull().defaultNow(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * API keys for a license. A license (the quota/plan) can have many keys — e.g.
 * one per environment (prod, staging, CI) — that all meter against the same
 * limit. The plaintext key is never stored: `keyHash` is the SHA-256 used for
 * lookup, `keyPrefix` the non-secret prefix shown in the UI. A key is active
 * while `revokedAt` is null.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    licenseId: uuid("license_id")
      .notNull()
      .references(() => licenses.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Default"),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    licenseIdx: index("api_keys_license_idx").on(t.licenseId),
  }),
);

export const apiTelemetry = pgTable(
  "api_telemetry",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    licenseId: uuid("license_id")
      .notNull()
      .references(() => licenses.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    endpoint: text("endpoint").notNull(),
    pages: bigint("pages", { mode: "number" }).notNull().default(0),
    status: text("status", { enum: ["success", "fail", "watermarked", "blocked"] }).notNull(),
    jobId: text("job_id"),
    jobDescription: text("job_description"),
    // Client + runtime metadata captured from the library's auto-guard.
    libVersion: text("lib_version"),
    nodeVersion: text("node_version"),
    platform: text("platform"),
    tagged: boolean("tagged"),
    language: text("language"),
    conformance: text("conformance"),
    errorCode: text("error_code"),
    // Host/server metadata captured once per client process (Node only):
    // { hostname, osType, osRelease, cpuCount, totalMemBytes, cloud, region }.
    host: jsonb("host").$type<HostMeta>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountIdx: index("api_telemetry_account_idx").on(t.accountId, t.createdAt),
    licenseIdx: index("api_telemetry_license_idx").on(t.licenseId, t.createdAt),
    // Every dashboard/portal view shows generations only — i.e. endpoint =
    // '/v1/authorize' ordered by createdAt DESC. PARTIAL indexes on exactly that
    // predicate stay small (no /v1/usage rows) and turn the previous full
    // scan + sort over the whole table into a bounded index scan. /v1/usage
    // inserts never touch these, so the metering write path pays nothing.
    //
    // NOTE: columns are ASCENDING on purpose. `ORDER BY created_at DESC`
    // defaults to NULLS FIRST; a `DESC NULLS LAST` index does NOT match it, so
    // Postgres would re-sort. A plain ascending index is scanned BACKWARD for
    // the DESC query (yielding DESC NULLS FIRST) and stops at LIMIT — no sort.
    authorizeRecentIdx: index("api_telemetry_authorize_recent_idx")
      .on(t.createdAt)
      .where(sql`${t.endpoint} = '/v1/authorize'`),
    authorizeLicenseIdx: index("api_telemetry_authorize_license_idx")
      .on(t.licenseId, t.createdAt)
      .where(sql`${t.endpoint} = '/v1/authorize'`),
    authorizeAccountIdx: index("api_telemetry_authorize_account_idx")
      .on(t.accountId, t.createdAt)
      .where(sql`${t.endpoint} = '/v1/authorize'`),
  }),
);

/**
 * Idempotency ledger for /v1/authorize. Reserve-as-charge increments usedUnits on
 * every call, so a client retry (same `nonce`) would double-charge. Each authorize
 * claims (license_id, nonce) here inside the same transaction that charges; a
 * second attempt with the same pair hits the UNIQUE constraint, and the handler
 * replays the previously-stored grant WITHOUT charging again.
 *
 * RETENTION: nonces are only useful for the client's retry window (seconds to
 * minutes). Rows older than the retention horizon are prunable by the sweep /
 * prune-telemetry script — see `prune-telemetry.ts` and `sweep.ts`.
 */
export const requestNonces = pgTable(
  "request_nonces",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    licenseId: uuid("license_id")
      .notNull()
      .references(() => licenses.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id"),
    nonce: text("nonce").notNull(),
    /** The grant JSON returned to the client, replayed verbatim on a retry. */
    grant: text("grant").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One grant per (license, nonce). Scoping to license (not api_key) means a
    // retry on a sibling key of the same license still de-duplicates against the
    // shared quota.
    uniq: uniqueIndex("request_nonces_license_nonce_uniq").on(t.licenseId, t.nonce),
    // Supports range-delete pruning by age.
    createdIdx: index("request_nonces_created_idx").on(t.createdAt),
  }),
);

/**
 * Heartbeat for the external-cron notification sweep. One row per run records
 * start/finish and outcome counts. The most recent successful row's `finishedAt`
 * is the "last successful sweep" timestamp surfaced by /readyz and /metrics so a
 * wedged cron becomes visible instead of silently failing.
 */
export const sweepRuns = pgTable(
  "sweep_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ok: boolean("ok").notNull().default(false),
    scanned: bigint("scanned", { mode: "number" }).notNull().default(0),
    queued: bigint("queued", { mode: "number" }).notNull().default(0),
    delivered: bigint("delivered", { mode: "number" }).notNull().default(0),
    failed: bigint("failed", { mode: "number" }).notNull().default(0),
    /** Error message when ok=false. */
    error: text("error"),
  },
  (t) => ({
    // "Most recent successful run" lookups: WHERE ok ORDER BY finished_at DESC.
    finishedIdx: index("sweep_runs_finished_idx").on(t.finishedAt),
  }),
);

export const notificationSettings = pgTable("notification_settings", {
  accountId: text("account_id").primaryKey(),
  emailTo: text("email_to"),
  webhookUrl: text("webhook_url"),
  usageSummaryFrequency: text("usage_summary_frequency", { enum: ["weekly", "monthly"] }).notNull().default("weekly"),
  usageAlertsEnabled: boolean("usage_alerts_enabled").notNull().default(true),
  overageAlertsEnabled: boolean("overage_alerts_enabled").notNull().default(true),
  hardBlockWarningsEnabled: boolean("hard_block_warnings_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    accountId: text("account_id").notNull(),
    licenseId: uuid("license_id")
      .notNull()
      .references(() => licenses.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        // page-utilization alerts
        "usage_90_percent",
        "usage_95_percent",
        "usage_100_percent",
        // subscription renewal reminders
        "renewal_30_days",
        "renewal_15_days",
        "renewal_2_days",
        // trial lifecycle reminders
        "trial_5_days",
        "trial_2_days",
        "trial_expired",
      ],
    }).notNull(),
    channel: text("channel", { enum: ["email", "webhook"] }).notNull(),
    payload: text("payload").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountIdx: index("notification_events_account_idx").on(t.accountId, t.createdAt),
  }),
);

export type License = typeof licenses.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiTelemetry = typeof apiTelemetry.$inferSelect;
export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type NotificationEvent = typeof notificationEvents.$inferSelect;
export type RequestNonce = typeof requestNonces.$inferSelect;
export type SweepRun = typeof sweepRuns.$inferSelect;

// Re-export for migration tooling that wants a single namespace.
export const appSchema = { licenses, apiKeys, apiTelemetry, requestNonces, sweepRuns, notificationSettings, notificationEvents };
export { sql };
