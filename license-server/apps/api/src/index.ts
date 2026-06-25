import { serve } from "@hono/node-server";

import { app } from "./app.js";
import { env } from "./env.js";

// Entry point: start the HTTP server.
serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`license server listening on :${info.port}`);
});
