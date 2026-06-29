import { env } from "../env.js";
import { verifyTransport, sendEmail } from "../domain/email/mailer.js";
import { renderNotificationEmail, renderWelcomeEmail } from "../domain/email/templates.js";
import type { NotificationEventType } from "../domain/policy.js";

/**
 * Sends one of every email template through the configured SMTP transport so you
 * can eyeball them in your mail catcher / inbox.
 *
 *   npm run emails:test            # sends to SMTP_FROM
 *   npm run emails:test -- you@x   # sends to a specific recipient
 */
const recipient = process.argv[2] || env.smtp.from || env.supportEmail;

const day = 86400000;
const sample = {
  orgName: "Acme Inc.",
  usedPages: 9500,
  pageLimit: 10000,
  trialEndsAt: new Date(Date.now() + 3 * day).toISOString(),
  expiresAt: new Date(Date.now() + 12 * day).toISOString(),
};

const notificationTypes: NotificationEventType[] = [
  "usage_90_percent",
  "usage_95_percent",
  "usage_100_percent",
  "renewal_30_days",
  "renewal_15_days",
  "renewal_2_days",
  "trial_5_days",
  "trial_2_days",
  "trial_expired",
];

async function main() {
  const health = await verifyTransport();
  console.log(`[emails:test] SMTP configured=${health.configured} ok=${health.ok}${health.error ? ` error=${health.error}` : ""}`);
  console.log(`[emails:test] sending ${notificationTypes.length + 1} emails to ${recipient}\n`);

  const emails = [
    ...notificationTypes.map((type) => ({ name: type, email: renderNotificationEmail(type, sample) })),
    {
      name: "welcome",
      email: renderWelcomeEmail({
        orgName: sample.orgName,
        customerName: "Jane Doe",
        email: "jane@acme.com",
        temporaryPassword: "Tmp-9f3kQ2xL",
        isTrial: true,
        trialEndsAt: new Date(Date.now() + 15 * day),
      }),
    },
  ];

  let sent = 0;
  let failed = 0;
  for (const { name, email } of emails) {
    const result = await sendEmail(recipient, email);
    if (result.ok && result.status === "sent") sent++;
    else failed++;
    console.log(`  ${result.status === "sent" ? "✓" : result.status === "skipped" ? "·" : "✗"} ${name.padEnd(18)} ${email.subject}`);
  }

  console.log(`\n[emails:test] done — sent=${sent} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[emails:test] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
