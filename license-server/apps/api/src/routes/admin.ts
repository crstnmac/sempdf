import { Hono } from "hono";
import { and, count, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";

import { auth } from "../auth.js";
import { db } from "../db/client.js";
import { apiTelemetry, licenses } from "../db/schema.js";
import { member, organization } from "../db/auth-schema.js";
import { generateKey, hashKey, keyPrefix } from "../domain/keys.js";

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

adminRoutes.get("/dashboard", async (c) => {
  const allLicenses = await db.select().from(licenses).orderBy(desc(licenses.createdAt));
  const recentTelemetry = await db
    .select()
    .from(apiTelemetry)
    .orderBy(desc(apiTelemetry.createdAt))
    .limit(50);
  const orgs = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization);
  const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));

  const tenants = allLicenses.map((lic) => {
    const hardBlockAt = hardBlockDate(lic.firstOverageAt, lic.gracePeriodDays);
    return {
      id: lic.id,
      accountId: lic.accountId,
      organizationName: orgNameById.get(lic.accountId) ?? lic.accountId,
      keyPrefix: lic.keyPrefix,
      metric: lic.metric,
      window: lic.window,
      limitUnits: lic.limitUnits,
      usedUnits: lic.usedUnits,
      remainingUnits: lic.limitUnits - lic.usedUnits,
      status: lic.status,
      active: lic.active,
      firstOverageAt: lic.firstOverageAt?.toISOString() ?? null,
      trialStartedAt: lic.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: lic.trialEndsAt?.toISOString() ?? null,
      hardBlockAt: hardBlockAt?.toISOString() ?? null,
      gracePeriodDays: lic.gracePeriodDays,
      createdAt: lic.createdAt.toISOString(),
    };
  });

  const summary = {
    totalTenants: tenants.length,
    pagesUsed: tenants.reduce((sum, tenant) => sum + tenant.usedUnits, 0),
    watermarkedTenants: tenants.filter((tenant) => tenant.status === "trial" || tenant.status === "grace_period").length,
    hardBlockedTenants: tenants.filter((tenant) => tenant.status === "hard_blocked").length,
    graceTenants: tenants.filter((tenant) => tenant.status === "grace_period").length,
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

/** Issue a licence for an organization (customer). Returns the key ONCE. */
adminRoutes.post("/licenses", async (c) => {
  const b = await c.req.json();
  const key = generateKey();
  const trialDays = Number(b.trialDays ?? process.env.DEFAULT_TRIAL_DAYS ?? 15);
  const trialStartedAt = new Date();
  const trialEndsAt = b.trialEndsAt
    ? new Date(b.trialEndsAt)
    : new Date(trialStartedAt.getTime() + trialDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(licenses)
    .values({
      keyHash: hashKey(key),
      keyPrefix: keyPrefix(key),
      accountId: b.accountId, // better-auth organization id
      metric: "pages",
      window: b.window ?? "month",
      limitUnits: Number(b.limit),
      status: "trial",
      trialStartedAt,
      trialEndsAt,
      gracePeriodDays: Number(b.gracePeriodDays ?? process.env.DEFAULT_GRACE_PERIOD_DAYS ?? 7),
      failMode: b.failMode ?? "closed",
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
    })
    .returning();
  // `key` is shown once and never stored in plaintext — surface it now.
  return c.json({ ...row, key }, 201);
});

/** Rotate a licence's key: issues a new key, invalidating the old one. */
adminRoutes.post("/licenses/:id/rotate", async (c) => {
  const id = c.req.param("id");
  const key = generateKey();
  const [row] = await db
    .update(licenses)
    .set({ keyHash: hashKey(key), keyPrefix: keyPrefix(key) })
    .where(eq(licenses.id, id))
    .returning();
  if (!row) return c.json({ error: "unknown_license" }, 404);
  return c.json({ id: row.id, keyPrefix: row.keyPrefix, key }, 200);
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
    .where(eq(apiTelemetry.licenseId, lic.id))
    .orderBy(desc(apiTelemetry.createdAt))
    .limit(100);
  return c.json({
    id: lic.id,
    accountId: lic.accountId,
    organizationName: org?.name ?? lic.accountId,
    metric: "pages",
    limit: lic.limitUnits,
    used: lic.usedUnits,
    remaining: lic.limitUnits - lic.usedUnits,
    status: lic.status,
    firstOverageAt: lic.firstOverageAt,
    trialEndsAt: lic.trialEndsAt,
    gracePeriodDays: lic.gracePeriodDays,
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
  const where = and(...conditions);

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

function hardBlockDate(firstOverageAt: Date | null, gracePeriodDays: number): Date | null {
  if (!firstOverageAt) return null;
  return new Date(firstOverageAt.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
}
