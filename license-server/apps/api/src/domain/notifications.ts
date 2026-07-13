import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "../db/client.js";
import { licenses, notificationEvents, notificationSettings } from "../db/schema.js";
import {
  notificationEventsForUsage,
  scheduleRemindersDue,
  type NotificationEventType,
} from "./policy.js";

/** A drizzle client or an open transaction — both expose select/insert. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Which on/off setting gates each event type. Page-utilization alerts honour
 * `usageAlertsEnabled`; trial and renewal reminders are critical lifecycle
 * notices and are always delivered to any configured channel.
 */
function isEnabled(
  type: NotificationEventType,
  settings: typeof notificationSettings.$inferSelect,
): boolean {
  if (type.startsWith("usage_")) return settings.usageAlertsEnabled;
  return true;
}

/** Builds one queued row per configured channel (email/webhook). */
function channelRows(
  settings: typeof notificationSettings.$inferSelect,
  license: typeof licenses.$inferSelect,
  type: NotificationEventType,
  extra: Record<string, unknown>,
) {
  const rows: { accountId: string; licenseId: string; type: NotificationEventType; channel: "email" | "webhook"; payload: string }[] = [];
  const payload = JSON.stringify({ type, accountId: license.accountId, licenseId: license.id, ...extra });
  if (settings.emailTo) rows.push({ accountId: license.accountId, licenseId: license.id, type, channel: "email", payload });
  if (settings.webhookUrl) rows.push({ accountId: license.accountId, licenseId: license.id, type, channel: "webhook", payload });
  return rows;
}

/**
 * Emits page-utilization alerts (90% / 95% / 100%) when a single change in
 * consumption crosses a threshold. Called from the metering path so alerts are
 * produced as usage happens. Delivery is out of band.
 */
export async function queueUsageNotifications(
  exec: Executor,
  license: typeof licenses.$inferSelect,
  change: { prevUsed: number; nextUsed: number; limit: number },
): Promise<number> {
  if (change.limit <= 0 || change.nextUsed === change.prevUsed) return 0;

  const events = notificationEventsForUsage({
    previousUsedPages: change.prevUsed,
    nextUsedPages: change.nextUsed,
    pageLimit: change.limit,
  });
  if (events.length === 0) return 0;

  const [settings] = await exec
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.accountId, license.accountId));
  if (!settings) return 0;

  const rows = events
    .filter((type) => isEnabled(type, settings))
    .flatMap((type) => channelRows(settings, license, type, { usedPages: change.nextUsed, pageLimit: change.limit }));
  if (rows.length > 0) await exec.insert(notificationEvents).values(rows);
  return rows.length;
}

/**
 * Scans all licenses and queues any due time-based reminders: subscription
 * renewals (30/15/2 days before `expiresAt`) and trial expiry (5/2 days before,
 * and once expired). Idempotent — a reminder already sent for a license within
 * the last ~31 days is skipped, so running the sweep repeatedly (e.g. hourly
 * from cron) sends each reminder once per term while still re-firing next term.
 */
export async function runNotificationSweep(now: Date = new Date()): Promise<{ scanned: number; queued: number }> {
  const allLicenses = await db.select().from(licenses).where(eq(licenses.active, true));
  if (allLicenses.length === 0) return { scanned: 0, queued: 0 };

  const settingsRows = await db.select().from(notificationSettings);
  const settingsByAccount = new Map(settingsRows.map((s) => [s.accountId, s]));

  // Reminders sent in the recent past, to dedup. 31 days comfortably covers the
  // widest reminder window (renewal 30→15 days) without suppressing next term.
  const dedupSince = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
  const recent = await db
    .select({ licenseId: notificationEvents.licenseId, type: notificationEvents.type })
    .from(notificationEvents)
    .where(
      and(
        gte(notificationEvents.createdAt, dedupSince),
        inArray(notificationEvents.type, [
          "renewal_30_days",
          "renewal_15_days",
          "renewal_2_days",
          "trial_5_days",
          "trial_2_days",
          "trial_expired",
        ]),
      ),
    );
  const alreadySent = new Set(recent.map((r) => `${r.licenseId}:${r.type}`));

  const rows: { accountId: string; licenseId: string; type: NotificationEventType; channel: "email" | "webhook"; payload: string }[] = [];
  for (const license of allLicenses) {
    const settings = settingsByAccount.get(license.accountId);
    if (!settings || (!settings.emailTo && !settings.webhookUrl)) continue;

    for (const type of scheduleRemindersDue(license, now)) {
      if (alreadySent.has(`${license.id}:${type}`)) continue;
      rows.push(
        ...channelRows(settings, license, type, {
          trialEndsAt: license.trialEndsAt?.toISOString() ?? null,
          expiresAt: license.expiresAt?.toISOString() ?? null,
        }),
      );
      alreadySent.add(`${license.id}:${type}`);
    }
  }

  if (rows.length > 0) await db.insert(notificationEvents).values(rows);
  return { scanned: allLicenses.length, queued: rows.length };
}
