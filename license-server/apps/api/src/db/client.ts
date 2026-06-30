import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "../env.js";
import * as schema from "./schema.js";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: env.pg.max,
  // Cap how long a handler waits to acquire a connection. Without this, a
  // saturated pool makes requests hang indefinitely instead of failing fast.
  connectionTimeoutMillis: env.pg.connectionTimeoutMs,
  // Per-session statement_timeout via the libpq `options` string: a single stuck
  // query is aborted by Postgres instead of pinning a pooled connection forever.
  // Applied to every connection the pool opens.
  options: `-c statement_timeout=${env.pg.statementTimeoutMs}`,
});

/** Drizzle client bound to the app schema. */
export const db = drizzle(pool, { schema });

export type DB = typeof db;
