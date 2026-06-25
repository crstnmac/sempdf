import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";

import { auth } from "../auth.js";
import { db } from "../db/client.js";
import { apiTelemetry, licenses, notificationSettings } from "../db/schema.js";
import { invitation, member, organization, user } from "../db/auth-schema.js";
import { generateKey, hashKey, keyPrefix } from "../domain/keys.js";
import { windowResetAt } from "../domain/licenses.js";
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

  const myTelemetry = await db
    .select()
    .from(apiTelemetry)
    .where(inArray(apiTelemetry.accountId, orgIds))
    .orderBy(desc(apiTelemetry.createdAt))
    .limit(100);

  const orgNameById = new Map(orgs.map((org) => [org.id, org.name]));

  return c.json({
    organizations: orgs,
    licenses: myLicenses.map((lic) => ({
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
      trialEndsAt: lic.trialEndsAt?.toISOString() ?? null,
      resetAt: windowResetAt(lic.window, lic.windowStartedAt),
      createdAt: lic.createdAt.toISOString(),
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
 * Self-service trial provisioning for a customer's own organization. Trials are
 * mandatory for new sign-ups (the signup flow calls this right after creating
 * the org), and a portal button offers it for any org that has no license yet.
 *
 * Date-bound, not page-bound: status is `trial` with a default end date; output
 * is watermarked "Trial Mode" until upgraded. One trial per org — if the org
 * already has a license, the existing one is returned untouched.
 */
portalRoutes.post("/trial", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));

  const orgs = await userOrgs(userId);
  if (orgs.length === 0) return c.json({ error: "no_organization" }, 400);
  const org = body.organizationId
    ? orgs.find((o) => o.id === body.organizationId)
    : orgs[0];
  if (!org) return c.json({ error: "unknown_organization" }, 404);

  const [existing] = await db
    .select()
    .from(licenses)
    .where(eq(licenses.accountId, org.id))
    .limit(1);
  if (existing) {
    return c.json({ id: existing.id, accountId: existing.accountId, status: existing.status, created: false });
  }

  const trialDays = Number(process.env.DEFAULT_TRIAL_DAYS ?? 15);
  const trialStartedAt = new Date();
  const trialEndsAt = new Date(trialStartedAt.getTime() + trialDays * 24 * 60 * 60 * 1000);
  const key = generateKey();
  const [row] = await db
    .insert(licenses)
    .values({
      keyHash: hashKey(key),
      keyPrefix: keyPrefix(key),
      accountId: org.id,
      metric: "pages",
      window: "month",
      limitUnits: Number(process.env.DEFAULT_TRIAL_PAGE_LIMIT ?? 1000),
      status: "trial",
      trialStartedAt,
      trialEndsAt,
      gracePeriodDays: Number(process.env.DEFAULT_GRACE_PERIOD_DAYS ?? 7),
      failMode: "closed",
    })
    .returning();

  if (!row) return c.json({ error: "provision_failed" }, 500);
  // Surface the key once, the same contract as admin issuance and rotation.
  return c.json({ id: row.id, accountId: row.accountId, status: row.status, key, created: true }, 201);
});

/**
 * (Re)generates the plaintext license key for one of the caller's own licenses.
 * The key is only ever returned here, once: the server stores just its hash, so
 * there is no "reveal existing key" — calling this rotates to a fresh key and
 * invalidates any previous one. Scoped to the user's organizations.
 */
portalRoutes.post("/licenses/:id/key", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const orgIds = (await userOrgs(userId)).map((org) => org.id);
  const [lic] = await db.select().from(licenses).where(eq(licenses.id, id));
  if (!lic || !orgIds.includes(lic.accountId)) {
    return c.json({ error: "unknown_license" }, 404);
  }
  if (!lic.active) {
    return c.json({ error: "license_inactive" }, 409);
  }

  const key = generateKey();
  await db
    .update(licenses)
    .set({ keyHash: hashKey(key), keyPrefix: keyPrefix(key) })
    .where(eq(licenses.id, id));

  return c.json({ id, keyPrefix: keyPrefix(key), key });
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
  return c.json(settings ?? { accountId: orgId });
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
