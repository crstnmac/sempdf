/** Centralized runtime configuration read from the environment. */
export const env = {
  /** HTTP port the server listens on. */
  port: Number(process.env.PORT ?? 8787),

  /** Public base URL of the customer portal/dashboard, used in email links. */
  appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),

  /** Outbound SMTP configuration for transactional + lifecycle emails. */
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    /** Implicit TLS (port 465). STARTTLS (587) leaves this false. */
    secure: process.env.SMTP_SECURE === "true" || Number(process.env.SMTP_PORT) === 465,
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    /** From address; defaults to the SMTP user when unset. */
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
    fromName: process.env.SMTP_FROM_NAME ?? "ZeroPDF",
  },

  /** Product name shown in email subjects/bodies. */
  productName: process.env.PRODUCT_NAME ?? "ZeroPDF",

  /** Support address shown in email footers. */
  supportEmail: process.env.SUPPORT_EMAIL ?? process.env.SMTP_FROM ?? "support@zeropdf.com",
} as const;

/** True once enough SMTP config is present to actually send mail. */
export function isSmtpConfigured(): boolean {
  return Boolean(env.smtp.host && env.smtp.from);
}
