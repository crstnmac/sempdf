/** Centralized runtime configuration read from the environment. */
export const env = {
  /** HTTP port the server listens on. */
  port: Number(process.env.PORT ?? 8787),

  /** Public base URL of the customer portal/dashboard, used in email links. */
  appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),

  /**
   * Browser origins allowed to call the credentialed dashboard routes
   * (`/v1/admin/*`, `/v1/portal/*`) via CORS, and trusted by better-auth.
   * Comma-separated. Mirrors better-auth's own `trustedOrigins`.
   */
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  /** Outbound SMTP configuration for transactional + lifecycle emails. */
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    /** Implicit TLS (port 465). STARTTLS (587) leaves this false. */
    secure: process.env.SMTP_SECURE === "true" || Number(process.env.SMTP_PORT) === 465,
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    /** From address; defaults to the SMTP user when unset. */
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
    fromName: process.env.SMTP_FROM_NAME ?? "A11yDocs",
  },

  /** Product name shown in email subjects/bodies. */
  productName: process.env.PRODUCT_NAME ?? "A11yDocs",

  /** Support address shown in email footers. */
  supportEmail: process.env.SUPPORT_EMAIL ?? process.env.SMTP_FROM ?? "support@a11ydocs.com",

  /** Postgres connection pool tuning. */
  pg: {
    /** Max connections in the pool. */
    max: Number(process.env.PG_POOL_MAX ?? 10),
    /**
     * How long `pool.connect()` waits for a free connection before failing.
     * Prevents request handlers from hanging forever when the pool is saturated.
     */
    connectionTimeoutMs: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 5_000),
    /**
     * Per-session `statement_timeout`. A single stuck query is aborted instead of
     * pinning a connection indefinitely. Applied via the libpq `options` string.
     */
    statementTimeoutMs: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 10_000),
  },

  /** Ed25519 signing key id (`kid`) advertised to clients for key selection. */
  signing: {
    /** Stable id for the primary key; clients use it to pick the right public key. */
    kid: process.env.LICENSE_SIGNING_KID ?? "v1",
  },

  /**
   * Upper bound on the `requested` units a single /v1/authorize call may charge,
   * so one call cannot debit an arbitrary amount. Over the cap → 400 bad_request.
   */
  maxRequestedPerCall: Number(process.env.MAX_REQUESTED_PER_CALL ?? 10_000),

  /** api_telemetry retention (days) for the prune script. */
  telemetryRetentionDays: Number(process.env.TELEMETRY_RETENTION_DAYS ?? 90),

  /** Rate limiting for machine routes (/v1 authorize/usage/license). */
  rateLimit: {
    /** Disable entirely by setting RATE_LIMIT_ENABLED=false. */
    enabled: process.env.RATE_LIMIT_ENABLED !== "false",
    /** Sliding-window length in milliseconds. */
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 1_000),
    /** Max requests per window per (api-key + client IP). */
    max: Number(process.env.RATE_LIMIT_MAX ?? 50),
  },

  /** Request guards (body size + timeout) for machine routes. */
  limits: {
    /** Max JSON body size in bytes for machine routes; over → 413. */
    maxBodyBytes: Number(process.env.MAX_BODY_BYTES ?? 64 * 1024),
    /** Per-request timeout in ms for machine routes; over → 504. */
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 15_000),
  },

  /**
   * Seconds after which the notification sweep is considered stale. /readyz and
   * /metrics surface staleness so a wedged cron is visible. Default 2h (the sweep
   * is expected hourly), 0 disables the staleness check.
   */
  sweepStaleSeconds: Number(process.env.SWEEP_STALE_SECONDS ?? 7_200),

  /** Enable HSTS header (only meaningful when served behind TLS). */
  hstsEnabled: process.env.HSTS_ENABLED === "true",
} as const;

/** True once enough SMTP config is present to actually send mail. */
export function isSmtpConfigured(): boolean {
  return Boolean(env.smtp.host && env.smtp.from);
}

/**
 * Fail-fast startup check for secrets that have no safe default. In production
 * these MUST be injected by the platform's secret store, never committed. Called
 * from the server entrypoint so a misconfigured deploy crashes loudly at boot
 * rather than failing the first authorize request.
 */
export function assertRequiredSecrets(): void {
  const required = ["DATABASE_URL", "LICENSE_SIGNING_KEY", "BETTER_AUTH_SECRET"] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required secret(s): ${missing.join(", ")}. ` +
        `Set them in the environment (production: inject via the platform secret store, not a committed .env).`,
    );
  }
}
