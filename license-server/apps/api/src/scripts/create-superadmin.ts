import { eq } from "drizzle-orm";

import { auth } from "../auth.js";
import { db } from "../db/client.js";
import { user } from "../db/auth-schema.js";

/**
 * Creates (or promotes) a SUPERADMIN — a maintainer of this SaaS library, who
 * gets the operator portal. This is distinct from an organization's own
 * owner/admin (a customer, tracked by `member.role`): superadmins are us.
 *
 *   npm run create-superadmin -- <email> <password> [name]
 *
 * or via env: SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, SUPERADMIN_NAME. The
 * password is hashed by better-auth's sign-up flow; we then set
 * `role = 'superadmin'` so the operator endpoints and the dashboard guard
 * accept the session.
 */
const email = process.argv[2] ?? process.env.SUPERADMIN_EMAIL;
const password = process.argv[3] ?? process.env.SUPERADMIN_PASSWORD;
const name = process.argv[4] ?? process.env.SUPERADMIN_NAME ?? "Superadmin";

if (!email || !password) {
  console.error("Usage: npm run create-superadmin -- <email> <password> [name]");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

try {
  const [existing] = await db.select().from(user).where(eq(user.email, email));

  if (!existing) {
    await auth.api.signUpEmail({ body: { email, password, name } });
    console.log(`Created user ${email}.`);
  } else {
    console.log(`User ${email} already exists — promoting to superadmin.`);
  }

  const [updated] = await db
    .update(user)
    .set({ role: "superadmin" })
    .where(eq(user.email, email))
    .returning({ id: user.id, email: user.email, role: user.role });

  if (!updated) throw new Error("User row not found after creation.");
  console.log(`✅ ${updated.email} is now role=${updated.role} (id ${updated.id}).`);
  process.exit(0);
} catch (err) {
  console.error("Failed to create superadmin:", err instanceof Error ? err.message : err);
  process.exit(1);
}
