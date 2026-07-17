import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Applies the SQL migrations bundled in ./drizzle (baked into the api image)
 * against DATABASE_URL. drizzle-orm's migrator records applied files in the
 * `drizzle.__drizzle_migrations` table, so re-running is a no-op — safe to run
 * on every deploy:
 *
 *   docker compose -f docker-compose.prod.yml --env-file .env \
 *     run --rm api node apps/api/dist/scripts/migrate.js
 *
 * New migrations are authored locally with `npx drizzle-kit generate` (offline,
 * no DB connection) and land in drizzle/ at the next image build.
 *
 * NOTE for databases originally created via `drizzle-kit push` (dev): push does
 * not write the migrations journal, so the first `migrate` run would re-CREATE
 * existing tables and fail. Fresh production databases are unaffected.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    // Resolved relative to the process cwd (/repo in the image), where the
    // drizzle folder is baked next to apps/api/dist.
    await migrate(drizzle(pool), { migrationsFolder: "apps/api/drizzle" });
    console.log("migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
