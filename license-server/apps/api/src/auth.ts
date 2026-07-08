import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, defaultRoles } from 'better-auth/plugins/admin/access';

import { db } from './db/client.js';
import * as authSchema from './db/auth-schema.js';

/**
 * better-auth instance for the dashboard/admin surface.
 *
 * - Drizzle adapter (Postgres provider) shares the same database as the app
 *   tables. Generate the auth tables with `npx @better-auth/cli generate` (or
 *   `migrate`), which creates user/session/account/verification plus the
 *   organization + admin plugin tables.
 * - `organization` models customers: a license's `accountId` is an organization
 *   id, so quota is owned by an org rather than a single user.
 * - `admin` gates the operator endpoints (issuing/revoking licenses).
 *
 * Machine endpoints (`/v1/authorize`, `/v1/usage`) are NOT behind better-auth —
 * they authenticate with the license key itself.
 */

const ac = createAccessControl(defaultStatements);

export const roles = {
  ...defaultRoles,
  superadmin: ac.newRole({
    user: [...defaultRoles.admin.statements.user, 'impersonate-admins'],
    session: [...defaultRoles.admin.statements.session],
  }),
};

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // The dashboard runs on a different origin (Vite :3000) and proxies to the
  // API (:8787), so its origin must be trusted or better-auth rejects requests
  // with INVALID_ORIGIN. Override/extend via TRUSTED_ORIGINS (comma-separated).
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // No self-serve signup: accounts are provisioned by Sales via the operator
  // portal (POST /v1/admin/customers). Disabling signUp closes the public
  // `/api/auth/sign-up/email` route so the DB can't be spammed with accounts.
  emailAndPassword: { enabled: true, disableSignUp: true },
  // Throttle better-auth's own endpoints (sign-in, etc.) to blunt password
  // brute-force. The machine-route limiter does NOT cover /api/auth/*.
  rateLimit: {
    enabled: process.env.AUTH_RATE_LIMIT_ENABLED !== "false",
    window: Number(process.env.AUTH_RATE_LIMIT_WINDOW_S ?? 60),
    max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 30),
  },
  advanced: {
    // Mark session cookies Secure in production so they are never sent over
    // plaintext http. Locally (http) this stays off so dev sign-in works.
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  // `superadmin` is the global maintainer role for this SaaS (the operator
  // portal). Organization-level roles (owner/admin/member) are separate and
  // handled by the organization plugin.
  plugins: [
    organization(),
    admin({
      roles,
      adminRoles: ['superadmin'],
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
