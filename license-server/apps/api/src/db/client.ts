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
  // node-postgres defaults to 10s: shorter than the 30s Prometheus scrape
  // interval (renderPrometheus's sweepFreshness query) and than typical gaps
  // between dashboard navigations (better-auth's session lookup shares this
  // same pool). Both were paying a ~140ms cold TLS+auth handshake on every
  // hit instead of reusing a warm connection (~1ms) — measured live. Keep
  // connections around well past both cadences; DB has ample headroom
  // (max_connections=100 vs our 15-per-instance pool ceiling).
  idleTimeoutMillis: 120_000,
});

/** Drizzle client bound to the app schema. */
export const db = drizzle(pool, { schema });

export type DB = typeof db;
