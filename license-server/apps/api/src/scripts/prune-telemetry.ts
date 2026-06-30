import { pool } from "../db/client.js";
import { env } from "../env.js";

/**
 * Retention/pruning for the unbounded raw-telemetry table (and the idempotency
 * nonce ledger), so they cannot fill the disk.
 *
 *   Run daily:  30 3 * * *  cd /app/apps/api && npm run telemetry:prune
 *
 * Deletes in bounded BATCHES, each its own transaction, so we never take a long
 * lock or build a giant delete that bloats WAL — important on the multi-million-
 * row api_telemetry table. A short pause between batches lets autovacuum keep up.
 *
 * Retention is TELEMETRY_RETENTION_DAYS (default 90). request_nonces only need to
 * outlive a client's retry window, so they are pruned far more aggressively
 * (NONCE_RETENTION_DAYS, default 7).
 *
 * NOTE: this is delete-based retention (the minimum). A daily rollup into a small
 * summary table could be layered on later for long-term analytics without keeping
 * raw rows; not implemented here to keep the metering write path untouched.
 */

const BATCH_SIZE = Number(process.env.PRUNE_BATCH_SIZE ?? 10_000);
const BATCH_PAUSE_MS = Number(process.env.PRUNE_BATCH_PAUSE_MS ?? 200);
const NONCE_RETENTION_DAYS = Number(process.env.NONCE_RETENTION_DAYS ?? 7);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Deletes rows older than `days` from `table` in batches. Uses a ctid-bounded
 * subquery so each statement deletes at most BATCH_SIZE rows.
 */
async function pruneTable(table: "api_telemetry" | "request_nonces", days: number): Promise<number> {
  let totalDeleted = 0;
  for (;;) {
    const { rowCount } = await pool.query(
      `DELETE FROM ${table}
       WHERE ctid IN (
         SELECT ctid FROM ${table}
         WHERE created_at < now() - ($1 || ' days')::interval
         LIMIT ${BATCH_SIZE}
       )`,
      [days],
    );
    const n = rowCount ?? 0;
    totalDeleted += n;
    if (n < BATCH_SIZE) break;
    await sleep(BATCH_PAUSE_MS);
  }
  return totalDeleted;
}

async function main() {
  const startedAt = Date.now();
  const telemetryDeleted = await pruneTable("api_telemetry", env.telemetryRetentionDays);
  const noncesDeleted = await pruneTable("request_nonces", NONCE_RETENTION_DAYS);
  console.log(
    JSON.stringify({
      level: "info",
      msg: "prune",
      telemetryRetentionDays: env.telemetryRetentionDays,
      telemetryDeleted,
      nonceRetentionDays: NONCE_RETENTION_DAYS,
      noncesDeleted,
      ms: Date.now() - startedAt,
    }),
  );
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(JSON.stringify({ level: "error", msg: "prune_failed", error: err instanceof Error ? err.message : String(err) }));
    await pool.end().catch(() => {});
    process.exit(1);
  });
