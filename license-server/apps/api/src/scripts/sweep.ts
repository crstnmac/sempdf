import { db, pool } from "../db/client.js";
import { sweepRuns } from "../db/schema.js";
import { runNotificationSweep } from "../domain/notifications.js";
import { deliverPendingNotifications } from "../domain/delivery.js";
import { eq } from "drizzle-orm";

/**
 * Cron entrypoint: queue any due lifecycle reminders (trial/renewal), then
 * deliver all pending notifications (email via SMTP, webhooks via POST). Talks to
 * the DB directly — no HTTP, no auth — so it can run from cron without a session.
 *
 *   Run hourly:  0 * * * *  cd /app/apps/api && npm run sweep:prod
 *
 * HEARTBEAT (self-heal / alerting): each run writes a row to `sweep_runs`
 * (started, then finished + outcome). The most recent ok=true row's finishedAt is
 * the "last successful sweep" timestamp surfaced by /readyz and /metrics — so a
 * wedged or never-running cron becomes visible (alert on license_sweep_age_seconds
 * exceeding SWEEP_STALE_SECONDS) instead of failing silently.
 */
async function main() {
  const startedAt = Date.now();
  // Open a heartbeat row immediately so even a hard crash leaves evidence the
  // sweep started (ok stays false until we finish successfully).
  const [run] = await db.insert(sweepRuns).values({ ok: false }).returning({ id: sweepRuns.id });
  const runId = run!.id;

  try {
    const queued = await runNotificationSweep();
    const delivered = await deliverPendingNotifications();
    const ms = Date.now() - startedAt;
    await db
      .update(sweepRuns)
      .set({
        finishedAt: new Date(),
        ok: true,
        scanned: queued.scanned,
        queued: queued.queued,
        delivered: delivered.sent,
        failed: delivered.failed,
      })
      .where(eq(sweepRuns.id, runId));
    console.log(
      JSON.stringify({
        level: "info",
        msg: "sweep",
        scanned: queued.scanned,
        queued: queued.queued,
        deliveredSent: delivered.sent,
        skipped: delivered.skipped,
        failed: delivered.failed,
        ms,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Record the failure on the heartbeat row so staleness/last-error is visible.
    await db
      .update(sweepRuns)
      .set({ finishedAt: new Date(), ok: false, error: message })
      .where(eq(sweepRuns.id, runId))
      .catch(() => {});
    throw err;
  }
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(JSON.stringify({ level: "error", msg: "sweep_failed", error: err instanceof Error ? err.message : String(err) }));
    await pool.end().catch(() => {});
    process.exit(1);
  });
