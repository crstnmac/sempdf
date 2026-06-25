import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { licenses, notificationEvents, notificationSettings } from "../db/schema.js";
import { notificationEventsForUsage, type NotificationEventType } from "./policy.js";

/** A drizzle client or an open transaction — both expose select/insert. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Which on/off setting gates each event type. */
function isEnabled(
  type: NotificationEventType,
  settings: typeof notificationSettings.$inferSelect,
): boolean {
  if (type === "overage_started") return settings.overageAlertsEnabled;
  // usage_80_percent / usage_100_percent
  return settings.usageAlertsEnabled;
}

/**
 * Emits proactive usage notifications (80% / 100% / overage-started) when a
 * single change in consumption crosses a threshold. Called from the metering
 * path so alerts are produced as usage happens, not only on the admin sweep.
 * Queues one row per enabled channel (email/webhook); delivery is out of band.
 */
export async function queueUsageNotifications(
  exec: Executor,
  license: typeof licenses.$inferSelect,
  change: { prevUsed: number; nextUsed: number; limit: number },
): Promise<void> {
  if (change.limit <= 0 || change.nextUsed === change.prevUsed) return;

  const events = notificationEventsForUsage({
    previousUsedPages: change.prevUsed,
    nextUsedPages: change.nextUsed,
    pageLimit: change.limit,
    wasOverLimit: change.prevUsed > change.limit,
    isOverLimit: change.nextUsed > change.limit,
  });
  if (events.length === 0) return;

  const [settings] = await exec
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.accountId, license.accountId));
  if (!settings) return;

  const rows = [];
  for (const type of events) {
    if (!isEnabled(type, settings)) continue;
    const payload = JSON.stringify({
      type,
      accountId: license.accountId,
      licenseId: license.id,
      usedPages: change.nextUsed,
      pageLimit: change.limit,
    });
    if (settings.emailTo) {
      rows.push({ accountId: license.accountId, licenseId: license.id, type, channel: "email" as const, payload });
    }
    if (settings.webhookUrl) {
      rows.push({ accountId: license.accountId, licenseId: license.id, type, channel: "webhook" as const, payload });
    }
  }
  if (rows.length > 0) await exec.insert(notificationEvents).values(rows);
}
