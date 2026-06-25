import { Hono } from "hono";

import { auth } from "./auth.js";
import { machine } from "./routes/machine.js";
import { adminRoutes } from "./routes/admin.js";
import { portalRoutes } from "./routes/portal.js";

/** Assembles the Hono application: health, better-auth, machine + admin + portal routes. */
export const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

// better-auth handles all of /api/auth/** (sign-in, sessions, organization,
// admin). The dashboard talks to these routes.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/v1", machine);
app.route("/v1/admin", adminRoutes);
app.route("/v1/portal", portalRoutes);
