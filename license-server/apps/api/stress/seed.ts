/**
 * Stress-test data seeder.
 *
 * Provisions a fleet of licenses + API keys directly in Postgres and writes the
 * plaintext keys to `stress/keys.json` for the k6 load script to consume.
 *
 * Two cohorts are created so the load test exercises both the happy path and the
 * over-quota (403) path:
 *
 *   - "bulk"  : huge limit, status "none", no trial, never blocks. The vast
 *               majority of traffic hits these — measures raw throughput and
 *               row-lock contention on the licenses row (SELECT ... FOR UPDATE).
 *   - "tight" : tiny limit, already at/over it, so /v1/authorize returns 403.
 *               Exercises the blocked-path transaction (telemetry write + status
 *               update + rollback-avoidance branch).
 *
 * Multi-key fan-out is deliberate: many keys share ONE license row, so concurrent
 * authorize calls for the same license serialize on the FOR UPDATE lock. Tune
 * KEYS_PER_LICENSE up to amplify contention, down to spread load across rows.
 *
 * Run:
 *   npm run stress:seed                 # from apps/api (uses --env-file=.env)
 *   STRESS_LICENSES=200 STRESS_KEYS_PER_LICENSE=5 npm run stress:seed
 *   STRESS_CLEAN=1 npm run stress:seed  # delete previously-seeded rows, then exit
 *
 * Teardown removes ONLY rows tagged with the STRESS_TAG account prefix, so it
 * never touches real customer data.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { eq, like } from "drizzle-orm";

import { db, pool } from "../src/db/client.js";
import { apiKeys, apiTelemetry, licenses, notificationEvents } from "../src/db/schema.js";
import { generateKey, hashKey, keyPrefix } from "../src/domain/keys.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** All seeded rows hang off account ids beginning with this, so cleanup is exact. */
const STRESS_TAG = "stress-test";

const cfg = {
  /** How many distinct license rows (= distinct FOR UPDATE lock targets). */
  licenses: int("STRESS_LICENSES", 100),
  /** API keys per license. >1 makes keys share a quota row → lock contention. */
  keysPerLicense: int("STRESS_KEYS_PER_LICENSE", 4),
  /** Per-window page allowance for bulk licenses. Big enough to never block. */
  bulkLimit: int("STRESS_LIMIT", 1_000_000_000),
  /** Fraction of licenses created in the over-quota "tight" cohort (0..1). */
  tightFraction: num("STRESS_TIGHT_FRACTION", 0.1),
};

async function main() {
  if (process.env.STRESS_CLEAN === "1") {
    await clean();
    console.log("cleaned stress rows");
    await pool.end();
    return;
  }

  const tightCount = Math.round(cfg.licenses * cfg.tightFraction);
  const entries: Array<{ key: string; license: string; cohort: "bulk" | "tight" }> = [];

  console.log(
    `seeding ${cfg.licenses} licenses x ${cfg.keysPerLicense} keys ` +
      `(${tightCount} tight / ${cfg.licenses - tightCount} bulk)`,
  );

  for (let i = 0; i < cfg.licenses; i++) {
    const tight = i < tightCount;
    const accountId = `${STRESS_TAG}:${tight ? "tight" : "bulk"}:${i}`;

    // bulk: huge limit, used=0, no trial, active, no expiry → always allowed.
    // tight: limit 10, already over it → /v1/authorize returns 403 limit_reached.
    const [lic] = await db
      .insert(licenses)
      .values({
        accountId,
        metric: "pages",
        window: "lifetime", // avoid annual-rollover branch resetting usage mid-run
        limitUnits: tight ? 10 : cfg.bulkLimit,
        usedUnits: tight ? 10 : 0,
        bonusUnits: 0,
        status: "none",
        trialStartedAt: new Date(),
        trialEndsAt: null, // no watermark, no trial-expiry branch
        active: true,
        expiresAt: null,
      })
      .returning({ id: licenses.id });

    if (!lic) throw new Error("license insert failed");

    const rows = Array.from({ length: cfg.keysPerLicense }, () => {
      const key = generateKey();
      return { key, hash: hashKey(key), prefix: keyPrefix(key) };
    });

    await db.insert(apiKeys).values(
      rows.map((r) => ({
        licenseId: lic.id,
        name: "stress",
        keyHash: r.hash,
        keyPrefix: r.prefix,
      })),
    );

    for (const r of rows) entries.push({ key: r.key, license: lic.id, cohort: tight ? "tight" : "bulk" });
  }

  const out = join(HERE, "keys.json");
  writeFileSync(out, JSON.stringify({ tag: STRESS_TAG, cfg, keys: entries }, null, 2));
  console.log(`wrote ${entries.length} keys -> ${out}`);
  await pool.end();
}

/** Removes every row this seeder created, matched by the STRESS_TAG account prefix. */
async function clean() {
  const tagged = await db
    .select({ id: licenses.id })
    .from(licenses)
    .where(like(licenses.accountId, `${STRESS_TAG}:%`));
  for (const { id } of tagged) {
    await db.delete(apiTelemetry).where(eq(apiTelemetry.licenseId, id));
    await db.delete(notificationEvents).where(eq(notificationEvents.licenseId, id));
    await db.delete(apiKeys).where(eq(apiKeys.licenseId, id));
    await db.delete(licenses).where(eq(licenses.id, id));
  }
}

function int(name: string, dflt: number): number {
  const v = process.env[name];
  return v === undefined ? dflt : Math.max(0, Math.floor(Number(v)));
}
function num(name: string, dflt: number): number {
  const v = process.env[name];
  return v === undefined ? dflt : Number(v);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
