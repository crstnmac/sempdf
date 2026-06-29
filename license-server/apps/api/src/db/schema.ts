import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

// Re-export for migration tooling that wants a single namespace.
export const appSchema = { licenses, apiKeys, apiTelemetry, notificationSettings, notificationEvents };
export { sql };
