import { Hono } from "hono";
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { auth } from "../auth.js";
import { db } from "../db/client.js";
import { apiKeys, apiTelemetry, licenses, notificationSettings } from "../db/schema.js";
import { invitation, member, organization, user } from "../db/auth-schema.js";
import { generateKey, hashKey, keyPrefix } from "../domain/keys.js";
import { createApiKey, windowResetAt } from "../domain/licenses.js";
import { randomUUID } from "node:crypto";

/**
 * Customer-facing endpoints. Unlike the operator routes in admin.ts, these are
 * gated only by a valid session and scope every query to the organizations the
 * signed-in user belongs to (a license's `accountId` is an organization id).
 */
export const portalRoutes = new Hono<{ Variables: { userId: string } }>();

portalRoutes.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.user.id);
  await next();
});

/** Organizations the user is a member/owner of. */
async function userOrgs(userId: string) {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId));
}

/** The caller's org-level role for one organization, or null if not a member. */
async function userOrgRole(userId: string, orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  return row?.role ?? null;
}

const isOrgAdmin = (role: string | null) => role === "owner" || role === "admin";

portalRoutes.get("/overview", async (c) => {
  const userId = c.get("userId");

  const orgs = await userOrgs(userId);
  const orgIds = orgs.map((org) => org.id);

  if (orgIds.length === 0) {
    return c.json({
      organizations: [],
      licenses: [],
      telemetry: [],
      summary: { pagesUsed: 0, pageLimit: 0, activeLicenses: 0 },
    });
  }

  const myLicenses = await db
    .select()
    .from(licenses)
    .where(inArray(licenses.accountId, orgIds))
    .orderBy(desc(licenses.createdAt));

  // Active API keys for those licenses, grouped by license.
  const licenseIds = myLicenses.map((lic) => lic.id);
  const keyRows = licenseIds.length
    ? await db
        .select()
        .from(apiKeys)
        .where(and(inArray(apiKeys.licenseId, licenseIds), isNull(apiKeys.revokedAt)))
        .orderBy(asc(apiKeys.createdAt))
    : [];
  const keysByLicense = new Map<string, typeof keyRows>();
  for (const k of keyRows) {
    const list = keysByLicense.get(k.licenseId) ?? [];
    list.push(k);
    keysByLicense.set(k.licenseId, list);
  }

  // Activity = generations: show authorize events (the charge point), not the
  // /v1/usage reconciliation flushes.
  const myTelemetry = await db
    .select()
    .from(apiTelemetry)
    .where(and(inArray(apiTelemetry.accountId, orgIds), eq(apiTelemetry.endpoint, "/v1/authorize")))
    .orderBy(desc(apiTelemetry.createdAt))
    .limit(100);

  const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));

  return c.json({
    organizations: orgs,
    licenses: myLicenses.map((lic) => ({
      id: lic.id,
      accountId: lic.accountId,
      organizationName: orgNameById.get(lic.accountId) ?? lic.accountId,
      metric: lic.metric,
      window: lic.window,
      limitUnits: lic.limitUnits + lic.bonusUnits,
      usedUnits: lic.usedUnits,
      remainingUnits: lic.limitUnits + lic.bonusUnits - lic.usedUnits,
      status: lic.status,
      active: lic.active,
      trialEndsAt: lic.trialEndsAt?.toISOString() ?? null,
      resetAt: windowResetAt(lic.window, lic.windowStartedAt),
      createdAt: lic.createdAt.toISOString(),
      keys: (keysByLicense.get(lic.id) ?? []).map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
    })),
    telemetry: myTelemetry.map((event) => ({
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
    summary: {
      pagesUsed: myLicenses.reduce((sum, lic) => sum + lic.usedUnits, 0),
      pageLimit: myLicenses.reduce((sum, lic) => sum + lic.limitUnits, 0),
      activeLicenses: myLicenses.filter((lic) => lic.active).length,
    },
  });
});

/**
 * Pages generated per day across the caller's organizations, zero-filled over
 * the requested window (default 30 days). Drives the usage trend chart. Counts
 * authorize events (the charge point), matching the usage counters.
 */
portalRoutes.get("/usage-series", async (c) => {
  const userId = c.get("userId");
  const days = Math.min(180, Math.max(7, Number(c.req.query("days") ?? 30)));
  const orgs = await userOrgs(userId);
  const orgIds = orgs.map((org) => org.id);
  if (orgIds.length === 0) return c.json({ days, series: [] });

  // Window start at UTC midnight so day buckets line up with `to_char` dates.
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${apiTelemetry.createdAt}), 'YYYY-MM-DD')`,
      pages: sql<number>`coalesce(sum(${apiTelemetry.pages}), 0)`.mapWith(Number),
    })
    .from(apiTelemetry)
    .where(
      and(
        inArray(apiTelemetry.accountId, orgIds),
        eq(apiTelemetry.endpoint, "/v1/authorize"),
        gte(apiTelemetry.createdAt, since),
      ),
    )
    .groupBy(sql`1`);

  const byDay = new Map(rows.map((r) => [r.day, r.pages]));
  const series: { date: string; pages: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, pages: byDay.get(key) ?? 0 });
  }
  return c.json({ days, series });
});

/**
 * Paginated generation history (authorize events) across the caller's orgs,
 * with an optional status filter. The overview only shows the latest few; this
 * is the full, browsable log.
 */
portalRoutes.get("/activity", async (c) => {
  const userId = c.get("userId");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 25)));
  const statusFilter = c.req.query("status");

  const orgs = await userOrgs(userId);
  const orgIds = orgs.map((org) => org.id);
  if (orgIds.length === 0) return c.json({ rows: [], total: 0, page, pageSize });

  const conditions = [
    inArray(apiTelemetry.accountId, orgIds),
    eq(apiTelemetry.endpoint, "/v1/authorize"),
  ];
  if (statusFilter && statusFilter !== "all") {
    conditions.push(eq(apiTelemetry.status, statusFilter as typeof apiTelemetry.status.enumValues[number]));
  }
  const where = and(...conditions);

  const [totalRow] = await db.select({ total: count() }).from(apiTelemetry).where(where);
  const rows = await db
    .select()
    .from(apiTelemetry)
    .where(where)
    .orderBy(desc(apiTelemetry.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));
  return c.json({
    rows: rows.map((event) => ({
      id: event.id,
      organizationName: orgNameById.get(event.accountId) ?? event.accountId,
      endpoint: event.endpoint,
      pages: event.pages,
      status: event.status,
      jobId: event.jobId,
      jobDescription: event.jobDescription,
      errorCode: event.errorCode,
      createdAt: event.createdAt.toISOString(),
    })),
    total: totalRow?.total ?? 0,
    page,
    pageSize,
  });
});

/**
 * Lists / creates API keys for one of the caller's own licenses. A license can
 * have many keys (e.g. prod / staging / CI) that all meter against the same
 * page quota. Creating returns the plaintext key ONCE. Owners/admins only.
 */
portalRoutes.post("/licenses/:id/keys", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "New key";

  const [lic] = await db.select().from(licenses).where(eq(licenses.id, id));
  if (!lic) return c.json({ error: "unknown_license" }, 404);
  if (!isOrgAdmin(await userOrgRole(userId, lic.accountId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!lic.active) return c.json({ error: "license_inactive" }, 409);

  const apiKey = await createApiKey(id, name);
  return c.json(apiKey, 201);
});

/**
 * Revokes one API key. The key stops working immediately; other keys on the
 * same license are unaffected. Scoped to the caller's orgs; owners/admins only.
 */
portalRoutes.delete("/keys/:keyId", async (c) => {
  const userId = c.get("userId");
  const keyId = c.req.param("keyId");

  const [row] = await db
    .select({ id: apiKeys.id, accountId: licenses.accountId })
    .from(apiKeys)
    .innerJoin(licenses, eq(apiKeys.licenseId, licenses.id))
    .where(eq(apiKeys.id, keyId));
  if (!row) return c.json({ error: "unknown_key" }, 404);
  if (!isOrgAdmin(await userOrgRole(userId, row.accountId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyId));
  return c.json({ ok: true });
});

/**
 * Notification settings for one of the caller's own organizations. Only org
 * owners/admins may read or change them (the operator portal has its own,
 * separate admin-gated version).
 */
portalRoutes.get("/orgs/:orgId/notification-settings", async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("orgId");
  if (!isOrgAdmin(await userOrgRole(userId, orgId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const [settings] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.accountId, orgId));
  return c.json(
    settings ?? {
      accountId: orgId,
      emailTo: null,
      webhookUrl: null,
      usageSummaryFrequency: "weekly",
      usageAlertsEnabled: true,
      overageAlertsEnabled: true,
      hardBlockWarningsEnabled: true,
    },
  );
});

portalRoutes.put("/orgs/:orgId/notification-settings", async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("orgId");
  if (!isOrgAdmin(await userOrgRole(userId, orgId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const values = {
    accountId: orgId,
    emailTo: body.emailTo === undefined ? null : String(body.emailTo),
    webhookUrl: body.webhookUrl === undefined ? null : String(body.webhookUrl),
    usageSummaryFrequency: body.usageSummaryFrequency === "monthly" ? ("monthly" as const) : ("weekly" as const),
    usageAlertsEnabled: body.usageAlertsEnabled !== false,
    overageAlertsEnabled: body.overageAlertsEnabled !== false,
    hardBlockWarningsEnabled: body.hardBlockWarningsEnabled !== false,
    updatedAt: new Date(),
  };
  const [settings] = await db
    .insert(notificationSettings)
    .values(values)
    .onConflictDoUpdate({ target: notificationSettings.accountId, set: values })
    .returning();
  return c.json(settings);
});

// ----- organization administration (owner/admin only) -----------------------

/** Members + pending invitations for one of the caller's organizations. */
portalRoutes.get("/orgs/:orgId/members", async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("orgId");
  if (!isOrgAdmin(await userOrgRole(userId, orgId))) return c.json({ error: "forbidden" }, 403);

  const members = await db
    .select({
      id: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId));

  const invites = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")));

  return c.json({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      isSelf: m.userId === userId,
      createdAt: m.createdAt.toISOString(),
    })),
    invitations: invites.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      status: inv.status,
      expiresAt: inv.expiresAt.toISOString(),
    })),
  });
});

/** Invite a teammate by email. owner/admin only. */
portalRoutes.post("/orgs/:orgId/invitations", async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("orgId");
  if (!isOrgAdmin(await userOrgRole(userId, orgId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = body.role === "admin" || body.role === "owner" ? body.role : "member";
  if (!email) return c.json({ error: "email_required" }, 400);

  const [row] = await db
    .insert(invitation)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      email,
      role,
      status: "pending",
      inviterId: userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning();
  return c.json(row, 201);
});

/** Cancel a pending invitation. owner/admin only. */
portalRoutes.delete("/orgs/:orgId/invitations/:invId", async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("orgId");
  if (!isOrgAdmin(await userOrgRole(userId, orgId))) return c.json({ error: "forbidden" }, 403);
  await db
    .delete(invitation)
    .where(and(eq(invitation.id, c.req.param("invId")), eq(invitation.organizationId, orgId)));
  return c.json({ ok: true });
});

/** Change a member's org role. owner/admin only. */
portalRoutes.patch("/orgs/:orgId/members/:memberId", async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("orgId");
  if (!isOrgAdmin(await userOrgRole(userId, orgId))) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const role = body.role === "admin" || body.role === "owner" || body.role === "member" ? body.role : null;
  if (!role) return c.json({ error: "invalid_role" }, 400);
  const [row] = await db
    .update(member)
    .set({ role })
    .where(and(eq(member.id, c.req.param("memberId")), eq(member.organizationId, orgId)))
    .returning();
  if (!row) return c.json({ error: "unknown_member" }, 404);
  return c.json(row);
});

/** Remove a member. owner/admin only; cannot remove the last owner. */
portalRoutes.delete("/orgs/:orgId/members/:memberId", async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("orgId");
  if (!isOrgAdmin(await userOrgRole(userId, orgId))) return c.json({ error: "forbidden" }, 403);

  const memberId = c.req.param("memberId");
  const [target] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)));
  if (!target) return c.json({ error: "unknown_member" }, 404);

  if (target.role === "owner") {
    const owners = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")));
    if (owners.length <= 1) return c.json({ error: "last_owner" }, 409);
  }
  await db.delete(member).where(eq(member.id, memberId));
  return c.json({ ok: true });
});

/** Update organization profile (name / slug / logo). owner/admin only. */
portalRoutes.patch("/orgs/:orgId", async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("orgId");
  if (!isOrgAdmin(await userOrgRole(userId, orgId))) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json().catch(() => ({}));
  const patch: { name?: string; slug?: string; logo?: string | null } = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.slug === "string" && body.slug.trim()) patch.slug = body.slug.trim().toLowerCase();
  if (body.logo !== undefined) patch.logo = body.logo ? String(body.logo) : null;
  if (Object.keys(patch).length === 0) return c.json({ error: "nothing_to_update" }, 400);

  try {
    const [row] = await db
      .update(organization)
      .set(patch)
      .where(eq(organization.id, orgId))
      .returning({ id: organization.id, name: organization.name, slug: organization.slug, logo: organization.logo });
    return c.json(row);
  } catch {
    // slug has a unique constraint
    return c.json({ error: "slug_taken" }, 409);
  }
});
