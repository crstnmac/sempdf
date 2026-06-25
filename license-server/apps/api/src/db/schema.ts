import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Application tables. better-auth owns its own auth tables (user, session,
// account, verification, organization, member, apikey) — generate those with
// its CLI (`npx @better-auth/cli generate`). `accountId` below references a
// better-auth organization id (a customer).

/**
 * A license: the unit of enforcement. Carries a page quota (`limitUnits`) over
 * a window, a running counter (`usedUnits`), trial and overage state, and
 * operational flags.
 */
export const licenses = pgTable("licenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The licence key is never stored in plaintext. `keyHash` is a SHA-256 of the
  // key (used for lookup); `keyPrefix` is the first few non-secret characters,
  // kept for display/identification in the dashboard.
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  accountId: text("account_id").notNull(), // better-auth organization id
  metric: text("metric").notNull().default("pages"),
  window: text("window", { enum: ["day", "month", "lifetime"] }).notNull().default("month"),
  limitUnits: bigint("limit_units", { mode: "number" }).notNull(),
  usedUnits: bigint("used_units", { mode: "number" }).notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status", { enum: ["none", "trial", "grace_period", "hard_blocked"] }).notNull().default("trial"),
  firstOverageAt: timestamp("first_overage_at", { withTimezone: true }),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }).notNull().defaultNow(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  gracePeriodDays: integer("grace_period_days").notNull().default(7),
  failMode: text("fail_mode", { enum: ["closed", "open"] }).notNull().default("closed"),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only audit trail of authorize/usage events for billing and anomaly
 * detection. The server (not the client) is the billing source of truth.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    licenseId: uuid("license_id")
      .notNull()
      .references(() => licenses.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["authorize", "usage"] }).notNull(),
    // `units` is the amount in the license's metered dimension (set on
    // authorize). `documents` and `pages` capture both dimensions on reconciled
    // usage events, so reports can show e.g. "200 PDFs, 5200 pages".
    units: bigint("units", { mode: "number" }).notNull(),
    documents: bigint("documents", { mode: "number" }).notNull().default(0),
    pages: bigint("pages", { mode: "number" }).notNull().default(0),
    endpoint: text("endpoint"),
    status: text("status", { enum: ["success", "fail", "watermarked", "blocked"] }),
    jobId: text("job_id"),
    jobDescription: text("job_description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    licenseIdx: index("usage_events_license_idx").on(t.licenseId, t.createdAt),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountIdx: index("api_telemetry_account_idx").on(t.accountId, t.createdAt),
    licenseIdx: index("api_telemetry_license_idx").on(t.licenseId, t.createdAt),
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
      enum: ["usage_80_percent", "usage_100_percent", "overage_started", "hard_block_warning", "usage_summary"],
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
export type UsageEvent = typeof usageEvents.$inferSelect;
export type ApiTelemetry = typeof apiTelemetry.$inferSelect;
export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type NotificationEvent = typeof notificationEvents.$inferSelect;

// Re-export for migration tooling that wants a single namespace.
export const appSchema = { licenses, usageEvents, apiTelemetry, notificationSettings, notificationEvents };
export { sql };
