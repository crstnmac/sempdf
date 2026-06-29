import { Hono } from "hono";
import { randomBytes, randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { auth } from "../auth.js";
import { db } from "../db/client.js";
import { apiKeys, apiTelemetry, licenses } from "../db/schema.js";
import { member, organization } from "../db/auth-schema.js";
import { createApiKey } from "../domain/licenses.js";
import { runNotificationSweep } from "../domain/notifications.js";

/** Slugify an org name and append a short random suffix to keep slugs unique. */
function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${randomBytes(3).toString("hex")}`;
}

/**
 * Operator endpoints, gated by a better-auth session with the `admin` role.
 * Licences are addressed by their UUID `id`, never the secret key.
 */
export const adminRoutes = new Hono();

adminRoutes.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  // Operator portal is for SaaS maintainers only (role `superadmin`), never for
  // an organization's own owner/admin (that is the org portal, gated per-org).
  if (!session || session.user.role !== "superadmin") return c.json({ error: "unauthorized" }, 401);
  await next();
});

/**
 * Queues any due time-based reminders (trial expiry, subscription renewal).
 * Idempotent — intended to be hit on a schedule (e.g. hourly) by external cron.
 */
adminRoutes.post("/sweep", async (c) => {
  const result = await runNotificationSweep();
  return c.json(result);
});

adminRoutes.get("/dashboard", async (c) => {
  const allLicenses = await db.select().from(licenses).orderBy(desc(licenses.createdAt));
  // Activity = generations. Under reserve-as-charge the authorize event is the
  // generation (pages charged, watermark/block decided there); the /v1/usage
  // flush is reconciliation and is not shown.
  const recentTelemetry = await db
    .select()
    .from(apiTelemetry)
    .where(eq(apiTelemetry.endpoint, "/v1/authorize"))
    .orderBy(desc(apiTelemetry.createdAt))
    .limit(50);
  const orgs = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization);
  const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));

  // Active keys per license — surface a representative prefix and the count.
  const activeKeys = await db.select().from(apiKeys).where(isNull(apiKeys.revokedAt));
  const keysByLicense = new Map<string, typeof activeKeys>();
  for (const k of activeKeys) {
    const list = keysByLicense.get(k.licenseId) ?? [];
    list.push(k);
    keysByLicense.set(k.licenseId, list);
  }

  const tenants = allLicenses.map((lic) => {
    const licKeys = keysByLicense.get(lic.id) ?? [];
    return {
      id: lic.id,
      accountId: lic.accountId,
      organizationName: orgNameById.get(lic.accountId) ?? lic.accountId,
      keyPrefix: licKeys[0]?.keyPrefix ?? "—",
      keyCount: licKeys.length,
      metric: lic.metric,
      window: lic.window,
      limitUnits: lic.limitUnits + lic.bonusUnits,
      bonusUnits: lic.bonusUnits,
      usedUnits: lic.usedUnits,
      remainingUnits: lic.limitUnits + lic.bonusUnits - lic.usedUnits,
      status: lic.status,
      active: lic.active,
      firstOverageAt: lic.firstOverageAt?.toISOString() ?? null,
      trialStartedAt: lic.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: lic.trialEndsAt?.toISOString() ?? null,
      createdAt: lic.createdAt.toISOString(),
    };
  });

  const summary = {
    totalTenants: tenants.length,
    pagesUsed: tenants.reduce((sum, tenant) => sum + tenant.usedUnits, 0),
    hardBlockedTenants: tenants.filter((tenant) => tenant.status === "hard_blocked").length,
    trialTenants: tenants.filter((tenant) => tenant.status === "trial").length,
  };

  return c.json({
    generatedAt: new Date().toISOString(),
    summary,
    tenants,
    telemetry: recentTelemetry.map((event) => ({
      id: event.id,
      accountId: event.accountId,
      organizationName: orgNameById.get(event.accountId) ?? event.accountId,
      licenseId: event.licenseId,
      endpoint: event.endpoint,
      pages: event.pages,
      status: event.status,
      jobId: event.jobId,
      jobDescription: event.jobDescription,
      libVersion: event.libVersion,
      nodeVersion: event.nodeVersion,
      platform: event.platform,
      tagged: event.tagged,
      language: event.language,
      conformance: event.conformance,
      errorCode: event.errorCode,
      createdAt: event.createdAt.toISOString(),
    })),
  });
});

/**
 * Lists every organization (customer) with how many licenses it already has, so
 * an operator can issue the first license for a newly signed-up customer.
 */
adminRoutes.get("/organizations", async (c) => {
  const orgs = await db.select().from(organization).orderBy(desc(organization.createdAt));
  const lics = await db.select({ accountId: licenses.accountId }).from(licenses);
  const members = await db
    .select({ organizationId: member.organizationId })
    .from(member);

  const licenseCounts = new Map<string, number>();
  for (const lic of lics) licenseCounts.set(lic.accountId, (licenseCounts.get(lic.accountId) ?? 0) + 1);
  const memberCounts = new Map<string, number>();
  for (const m of members) memberCounts.set(m.organizationId, (memberCounts.get(m.organizationId) ?? 0) + 1);

  return c.json({
    organizations: orgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      licenseCount: licenseCounts.get(org.id) ?? 0,
      memberCount: memberCounts.get(org.id) ?? 0,
      createdAt: org.createdAt.toISOString(),
    })),
  });
});

/**
 * Sales onboarding: create a brand-new customer in one step. Creates the
 * organization, the customer's user account (with a temporary password), makes
 * that user the org owner, provisions a trial license with an explicit expiry
 * date, and issues the first API key.
 *
 * Returns the API key and the temporary password ONCE — Sales relays both to the
 * customer (no email is sent). The customer signs in at /login and should change
 * the password. Convert to paid later via the license "Change plan" action.
 */
adminRoutes.post("/customers", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const orgName = String(b.orgName ?? "").trim();
  const customerName = String(b.customerName ?? "").trim();
  const email = String(b.customerEmail ?? "").trim().toLowerCase();
  const limit = Math.floor(Number(b.limit));
  const window = b.window === "lifetime" ? "lifetime" : "year";
  const kind = b.kind === "paid" ? "paid" : "trial";
  if (!orgName || !customerName || !email || !Number.isFinite(limit) || limit <= 0) {
    return c.json({ error: "bad_request" }, 400);
  }

  const now = new Date();
  // Trial: operator-specified expiry. Paid: live annual plan ending one year out
  // (the renewal date that drives renewal reminders); lifetime never expires.
  const trialEndsAt =
    kind === "paid"
      ? null
      : b.trialEndsAt
        ? new Date(b.trialEndsAt)
        : new Date(now.getTime() + Number(b.trialDays ?? process.env.DEFAULT_TRIAL_DAYS ?? 15) * 24 * 60 * 60 * 1000);
  const oneYearOut = new Date(now);
  oneYearOut.setUTCFullYear(oneYearOut.getUTCFullYear() + 1);
  const expiresAt = kind === "paid" && window === "year" ? oneYearOut : null;

  // Create the customer's user account first (fails fast on duplicate email)
  // with a temporary password shown once. Runs under the superadmin session.
  const tempPassword = randomBytes(9).toString("base64url");
  let userId: string;
  try {
    const created = await auth.api.createUser({
      body: { email, password: tempPassword, name: customerName, role: "user" },
      headers: c.req.raw.headers,
    });
    userId = created.user.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "could_not_create_user";
    return c.json({ error: message }, 400);
  }

  // Organization + owner membership.
  const [org] = await db
    .insert(organization)
    .values({ id: randomUUID(), name: orgName, slug: makeSlug(orgName), createdAt: now })
    .returning();
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: org!.id,
    userId,
    role: "owner",
    createdAt: now,
  });

  // Trial (watermarked, expiry date) or paid (live annual plan, no watermark).
  const [lic] = await db
    .insert(licenses)
    .values({
      accountId: org!.id,
      metric: "pages",
      window,
      limitUnits: limit,
      status: kind === "paid" ? "none" : "trial",
      trialStartedAt: now,
      trialEndsAt,
      expiresAt,
    })
    .returning();
  const apiKey = await createApiKey(lic!.id, "Default");

  return c.json(
    {
      organization: { id: org!.id, name: org!.name, slug: org!.slug },
      customerEmail: email,
      temporaryPassword: tempPassword,
      license: {
        id: lic!.id,
        status: lic!.status,
        limitUnits: lic!.limitUnits,
        trialEndsAt: lic!.trialEndsAt,
        expiresAt: lic!.expiresAt,
      },
      keyPrefix: apiKey.keyPrefix,
      key: apiKey.key,
    },
    201,
  );
});

/**
 * Issue a licence for an organization (customer). Returns the key ONCE.
 * `kind: "trial"` (default) issues a watermarked, date-bound trial that
 * hard-blocks at the page cap or trial end. `kind: "paid"` issues a live plan
 * (no trial, no watermark) on the given annual page limit and optional renewal
 * `expiresAt`.
 */
adminRoutes.post("/licenses", async (c) => {
  const b = await c.req.json();
  const kind = b.kind === "paid" ? "paid" : "trial";
  const window = b.window === "lifetime" ? "lifetime" : "year";
  const limit = Math.floor(Number(b.limit));
  if (!b.accountId || !Number.isFinite(limit) || limit <= 0) return c.json({ error: "bad_request" }, 400);

  const now = new Date();
  const trialDays = Number(b.trialDays ?? process.env.DEFAULT_TRIAL_DAYS ?? 15);
  const trialEndsAt =
    kind === "paid"
      ? null
      : b.trialEndsAt
        ? new Date(b.trialEndsAt)
        : new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(licenses)
    .values({
      accountId: b.accountId, // better-auth organization id
      metric: "pages",
      window,
      limitUnits: limit,
      status: kind === "paid" ? "none" : "trial",
      trialStartedAt: now,
      trialEndsAt,
      // Renewal date only meaningful for annual plans; lifetime never expires.
      expiresAt: window === "year" && b.expiresAt ? new Date(b.expiresAt) : null,
    })
    .returning();
  if (!row) return c.json({ error: "provision_failed" }, 500);
  // Issue the first API key; `key` is shown once and never stored in plaintext.
  const apiKey = await createApiKey(row.id, "Default");
  return c.json({ ...row, keyPrefix: apiKey.keyPrefix, key: apiKey.key }, 201);
});

/** Rotate a licence's keys: revoke all existing keys and issue a fresh one. */
adminRoutes.post("/licenses/:id/rotate", async (c) => {
  const id = c.req.param("id");
  const [lic] = await db.select().from(licenses).where(eq(licenses.id, id));
  if (!lic) return c.json({ error: "unknown_license" }, 404);
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.licenseId, id), isNull(apiKeys.revokedAt)));
  const apiKey = await createApiKey(id, "Default");
  return c.json({ id, keyPrefix: apiKey.keyPrefix, key: apiKey.key }, 200);
});

adminRoutes.post("/licenses/:id/revoke", async (c) => {
  await db.update(licenses).set({ active: false }).where(eq(licenses.id, c.req.param("id")));
  return c.json({ ok: true });
});

adminRoutes.post("/licenses/:id/extend-trial", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const trialEndsAt = body.trialEndsAt
    ? new Date(body.trialEndsAt)
    : new Date(Date.now() + Number(body.days ?? process.env.DEFAULT_TRIAL_DAYS ?? 15) * 24 * 60 * 60 * 1000);
  const [row] = await db
    .update(licenses)
    .set({ trialEndsAt, status: "trial", firstOverageAt: null })
    .where(eq(licenses.id, c.req.param("id")))
    .returning();
  if (!row) return c.json({ error: "unknown_license" }, 404);
  return c.json({ id: row.id, trialEndsAt: row.trialEndsAt, status: row.status });
});

/**
 * Changes a license's plan: sets the annual page limit (`limitUnits`), the
 * billing window (`year` | `lifetime`), and optionally the renewal date.
 *
 * By default usage is KEPT — an upgrade keeps the running counter and may lift a
 * hard-blocked license back into service; a downgrade below current usage stays
 * blocked. Pass `convertToPaid: true` to turn a trial into a paid plan: this
 * additionally ends the trial (status `none`, clears `trialEndsAt`), reactivates
 * the license, and flushes usage to zero on a fresh window.
 */
adminRoutes.post("/licenses/:id/plan", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param("id");
  const limit = Math.floor(Number(body.limit));
  if (!Number.isFinite(limit) || limit <= 0) return c.json({ error: "bad_request" }, 400);
  const window = body.window === "lifetime" ? "lifetime" : "year";
  const convertToPaid = body.convertToPaid === true;

  const [lic] = await db.select().from(licenses).where(eq(licenses.id, id));
  if (!lic) return c.json({ error: "unknown_license" }, 404);

  const update: Partial<typeof licenses.$inferInsert> = { limitUnits: limit, window };
  if (body.expiresAt !== undefined) {
    update.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }

  if (convertToPaid) {
    // End the trial and start the paid plan clean: status none, no trial, usage
    // flushed on a fresh window, reactivated.
    update.status = "none";
    update.trialEndsAt = null;
    update.active = true;
    update.firstOverageAt = null;
    update.usedUnits = 0;
    update.bonusUnits = 0;
    update.windowStartedAt = new Date();
  } else {
    // Keep usage; recompute status against the new effective limit.
    const effectiveLimit = limit + lic.bonusUnits;
    const stillOver = lic.usedUnits >= effectiveLimit;
    const trialActive = lic.trialEndsAt !== null && lic.trialEndsAt.getTime() > Date.now();
    update.status = stillOver ? lic.status : trialActive ? "trial" : "none";
    update.firstOverageAt = stillOver ? lic.firstOverageAt : null;
  }

  const [row] = await db.update(licenses).set(update).where(eq(licenses.id, id)).returning();
  return c.json({
    id: row!.id,
    status: row!.status,
    window: row!.window,
    limitUnits: row!.limitUnits + row!.bonusUnits,
    usedUnits: row!.usedUnits,
    expiresAt: row!.expiresAt,
  });
});

/**
 * Grants more pages to a license. Operator action (e.g. extend a trial's
 * allowance). `recurring: true` raises the per-window `limitUnits` permanently;
 * otherwise the pages are a ONE-TIME `bonusUnits` grant for the current window
 * that expires at the next window reset. If the extra headroom puts usage back
 * under the effective limit, a hard-blocked license is reactivated.
 */
adminRoutes.post("/licenses/:id/add-pages", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const pages = Math.floor(Number(body.pages ?? 0));
  const recurring = body.recurring === true;
  if (!Number.isFinite(pages) || pages <= 0) return c.json({ error: "bad_request" }, 400);

  const id = c.req.param("id");
  const [lic] = await db.select().from(licenses).where(eq(licenses.id, id));
  if (!lic) return c.json({ error: "unknown_license" }, 404);

  const newLimit = recurring ? lic.limitUnits + pages : lic.limitUnits;
  const newBonus = recurring ? lic.bonusUnits : lic.bonusUnits + pages;
  const effectiveLimit = newLimit + newBonus;
  const trialActive = lic.trialEndsAt !== null && lic.trialEndsAt.getTime() > Date.now();
  const stillOver = lic.usedUnits >= effectiveLimit;
  const status = stillOver ? lic.status : trialActive ? "trial" : "none";

  const [row] = await db
    .update(licenses)
    .set({ limitUnits: newLimit, bonusUnits: newBonus, status, firstOverageAt: stillOver ? lic.firstOverageAt : null })
    .where(eq(licenses.id, id))
    .returning();
  return c.json({
    id: row!.id,
    limitUnits: row!.limitUnits + row!.bonusUnits,
    usedUnits: row!.usedUnits,
    status: row!.status,
    recurring,
  });
});

adminRoutes.get("/licenses/:id/usage", async (c) => {
  const [lic] = await db.select().from(licenses).where(eq(licenses.id, c.req.param("id")));
  if (!lic) return c.json({ error: "unknown_license" }, 404);
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, lic.accountId));
  const events = await db
    .select()
    .from(apiTelemetry)
    .where(and(eq(apiTelemetry.licenseId, lic.id), eq(apiTelemetry.endpoint, "/v1/authorize")))
    .orderBy(desc(apiTelemetry.createdAt))
    .limit(100);
  return c.json({
    id: lic.id,
    accountId: lic.accountId,
    organizationName: org?.name ?? lic.accountId,
    metric: "pages",
    window: lic.window,
    limit: lic.limitUnits + lic.bonusUnits,
    baseLimit: lic.limitUnits,
    bonusUnits: lic.bonusUnits,
    used: lic.usedUnits,
    remaining: lic.limitUnits + lic.bonusUnits - lic.usedUnits,
    status: lic.status,
    firstOverageAt: lic.firstOverageAt,
    trialEndsAt: lic.trialEndsAt,
    expiresAt: lic.expiresAt,
    telemetry: events,
  });
});

/**
 * Paginated telemetry with date-range, status, and free-text search filters.
 * Returns summary metrics for the matching window alongside the rows.
 */
adminRoutes.get("/telemetry", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query("pageSize") ?? 50)));
  const from = c.req.query("from");
  const to = c.req.query("to");
  const statusFilter = c.req.query("status");
  const q = c.req.query("q");

  const conditions = [];
  if (from) conditions.push(gte(apiTelemetry.createdAt, new Date(from)));
  if (to) conditions.push(lte(apiTelemetry.createdAt, new Date(to)));
  if (statusFilter && statusFilter !== "all") conditions.push(eq(apiTelemetry.status, statusFilter as typeof apiTelemetry.status.enumValues[number]));
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(or(
      ilike(apiTelemetry.accountId, pattern),
      ilike(apiTelemetry.endpoint, pattern),
      ilike(apiTelemetry.jobId, pattern),
      ilike(apiTelemetry.jobDescription, pattern),
    ));
  }
  // Activity = generations: show authorize events, not /v1/usage reconciliation.
  const where = and(eq(apiTelemetry.endpoint, "/v1/authorize"), ...conditions);

  const [totalResult] = await db
    .select({ total: count() })
    .from(apiTelemetry)
    .where(where);
  const total = totalResult?.total ?? 0;

  // Summary: total pages and error count for the matching window
  const [summaryResult] = await db
    .select({
      totalPages: sql<number>`COALESCE(SUM(${apiTelemetry.pages}), 0)`.mapWith(Number),
      errorCount: sql<number>`COALESCE(SUM(CASE WHEN ${apiTelemetry.status} = 'blocked' OR ${apiTelemetry.status} = 'fail' THEN 1 ELSE 0 END), 0)`.mapWith(Number),
      watermarkedCount: sql<number>`COALESCE(SUM(CASE WHEN ${apiTelemetry.status} = 'watermarked' THEN 1 ELSE 0 END), 0)`.mapWith(Number),
      uniqueOrgs: sql<number>`COALESCE(COUNT(DISTINCT ${apiTelemetry.accountId}), 0)`.mapWith(Number),
    })
    .from(apiTelemetry)
    .where(where);

  const rows = await db
    .select()
    .from(apiTelemetry)
    .where(where)
    .orderBy(desc(apiTelemetry.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const orgs = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization);
  const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));

  return c.json({
    rows: rows.map((event) => ({
      id: event.id,
      accountId: event.accountId,
      organizationName: orgNameById.get(event.accountId) ?? event.accountId,
      licenseId: event.licenseId,
      endpoint: event.endpoint,
      pages: event.pages,
      status: event.status,
      jobId: event.jobId,
      jobDescription: event.jobDescription,
      libVersion: event.libVersion,
      nodeVersion: event.nodeVersion,
      platform: event.platform,
      tagged: event.tagged,
      language: event.language,
      conformance: event.conformance,
      errorCode: event.errorCode,
      createdAt: event.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    summary: {
      totalPages: summaryResult?.totalPages ?? 0,
      errorCount: summaryResult?.errorCount ?? 0,
      watermarkedCount: summaryResult?.watermarkedCount ?? 0,
      uniqueOrgs: summaryResult?.uniqueOrgs ?? 0,
    },
  });
});
