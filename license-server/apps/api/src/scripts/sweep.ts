import { pool } from "../db/client.js";
import { runNotificationSweep } from "../domain/notifications.js";
import { deliverPendingNotifications } from "../domain/delivery.js";

/**
 * Cron entrypoint: queue any due lifecycle reminders (trial/renewal), then
 * deliver all pending notifications (email via SMTP, webhooks via POST). Talks to
 * the DB directly — no HTTP, no auth — so it can run from cron without a session.
 *
 *   Run hourly:  0 * * * *  cd /app/apps/api && npm run sweep
 */
async function main() {
  const startedAt = Date.now();
  const queued = await runNotificationSweep();
  const delivered = await deliverPendingNotifications();
  const ms = Date.now() - startedAt;
  console.log(
    `[sweep] scanned=${queued.scanned} queued=${queued.queued} ` +
      `delivered.sent=${delivered.sent} skipped=${delivered.skipped} failed=${delivered.failed} (${ms}ms)`,
  );
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("[sweep] failed:", err instanceof Error ? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
