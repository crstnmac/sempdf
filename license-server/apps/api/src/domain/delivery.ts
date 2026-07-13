import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../db/client.js";
import { notificationEvents, notificationSettings } from "../db/schema.js";
import { organization } from "../db/auth-schema.js";
import type { NotificationEventType } from "./policy.js";
import { renderNotificationEmail, type NotificationData } from "./email/templates.js";
import { assertResolvableSafeWebhookUrl } from "./net-guard.js";
import { sendEmail } from "./email/mailer.js";

export interface DeliveryResult {
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** How many queued events to process per sweep, to bound work per invocation. */
const BATCH = 200;

// In-process single-flight guard. Immediate usage-alert delivery can be
// triggered concurrently by many authorize calls; running two drains at once
// could select+send the same row twice before either marks it delivered. We
// serialize within the process and coalesce overlapping triggers into one
// trailing re-run so freshly queued rows aren't missed.
let draining = false;
let rerunRequested = false;

/**
 * Drains undelivered notification events and dispatches them: email events are
 * rendered with the structured templates and sent over SMTP; webhook events are
 * POSTed to the account's configured URL. A row is stamped `deliveredAt` only on
 * success, so failures are retried on the next sweep. Idempotent and safe to run
 * repeatedly from cron or fire-and-forget from the metering path.
 */
export async function deliverPendingNotifications(): Promise<DeliveryResult> {
  if (draining) {
    // A drain is in flight; ask it to run once more so our rows get picked up.
    rerunRequested = true;
    return { pending: 0, sent: 0, skipped: 0, failed: 0 };
  }
  draining = true;
  try {
    let total = await drainOnce();
    while (rerunRequested) {
      rerunRequested = false;
      const more = await drainOnce();
      total = {
        pending: total.pending + more.pending,
        sent: total.sent + more.sent,
        skipped: total.skipped + more.skipped,
        failed: total.failed + more.failed,
      };
    }
    return total;
  } finally {
    draining = false;
  }
}

/** Single pass over one batch of undelivered events. */
async function drainOnce(): Promise<DeliveryResult> {
  const pending = await db
    .select()
    .from(notificationEvents)
    .where(isNull(notificationEvents.deliveredAt))
    .orderBy(asc(notificationEvents.createdAt))
    .limit(BATCH);

  if (pending.length === 0) return { pending: 0, sent: 0, skipped: 0, failed: 0 };

  // Resolve recipients (emailTo / webhookUrl) and org names in two batched reads.
  const accountIds = [...new Set(pending.map((e) => e.accountId))];
  const [settingsRows, orgRows] = await Promise.all([
    db.select().from(notificationSettings).where(inArray(notificationSettings.accountId, accountIds)),
    db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(inArray(organization.id, accountIds)),
  ]);
  const settingsByAccount = new Map(settingsRows.map((s) => [s.accountId, s]));
  const orgNameById = new Map(orgRows.map((o) => [o.id, o.name]));

  const deliveredIds: number[] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of pending) {
    const settings = settingsByAccount.get(event.accountId);
    const orgName = orgNameById.get(event.accountId) ?? "your organization";
    const payload = safeParse(event.payload);

    if (event.channel === "email") {
      const to = settings?.emailTo;
      if (!to) {
        // No recipient configured anymore — drop it so it doesn't loop forever.
        deliveredIds.push(event.id);
        skipped++;
        continue;
      }
      const data: NotificationData = {
        orgName,
        usedPages: numberOrUndefined(payload.usedPages),
        pageLimit: numberOrUndefined(payload.pageLimit),
        trialEndsAt: stringOrNull(payload.trialEndsAt),
        expiresAt: stringOrNull(payload.expiresAt),
      };
      const result = await sendEmail(to, renderNotificationEmail(event.type as NotificationEventType, data));
      if (result.status === "sent") sent++;
      else if (result.status === "skipped") skipped++;
      if (result.ok) deliveredIds.push(event.id);
      else failed++;
    } else if (event.channel === "webhook") {
      const url = settings?.webhookUrl;
      if (!url) {
        deliveredIds.push(event.id);
        skipped++;
        continue;
      }
      const ok = await postWebhook(url, event.payload);
      if (ok) {
        deliveredIds.push(event.id);
        sent++;
      } else {
        failed++;
      }
    }
  }

  if (deliveredIds.length > 0) {
    await db
      .update(notificationEvents)
      .set({ deliveredAt: new Date() })
      .where(
        and(
          inArray(notificationEvents.id, deliveredIds),
          isNull(notificationEvents.deliveredAt),
        ),
      );
  }

  return { pending: pending.length, sent, skipped, failed };
}

async function postWebhook(url: string, body: string): Promise<boolean> {
  try {
    // Re-validate + DNS-resolve at delivery time (defense in depth vs. DNS
    // rebinding / a record that flipped to an internal IP after set-time).
    const safeUrl = await assertResolvableSafeWebhookUrl(url);
    const res = await fetch(safeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      redirect: "error", // a redirect could bounce us to an internal address
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    console.error(`[webhook:error] ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
