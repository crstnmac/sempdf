import { defineConfig } from "drizzle-kit";

// Pushes both the app tables (schema.ts) and the better-auth tables, whose
// drizzle schema is emitted by `npm run auth:generate` into auth-schema.ts.
// better-auth's own `migrate` command does not support the drizzle adapter, so
// drizzle-kit owns the single push to the shared database.
export default defineConfig({
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
