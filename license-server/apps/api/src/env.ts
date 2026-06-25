/** Centralized runtime configuration read from the environment. */
export const env = {
  /** HTTP port the server listens on. */
  port: Number(process.env.PORT ?? 8787),
};
