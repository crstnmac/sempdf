import { env } from "../../env.js";
import { TRIAL_WATERMARK_TEXT, type NotificationEventType } from "../policy.js";
import { renderLayout, type EmailTone, type RenderedEmail } from "./layout.js";

function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const billingUrl = () => `${env.appUrl}/portal/settings`;
const usageUrl = () => `${env.appUrl}/portal`;

/** Data resolved by the delivery worker from the queued event payload + license. */
export interface NotificationData {
  orgName: string;
  usedPages?: number | undefined;
  pageLimit?: number | undefined;
  trialEndsAt?: string | null | undefined;
  expiresAt?: string | null | undefined;
}

/**
 * Renders the email for a queued notification event. One template per event type,
 * sharing the layout so every message reads consistently. Copy is deliberately
 * plain and transactional — state the fact, give one action.
 */
export function renderNotificationEmail(
  type: NotificationEventType,
  data: NotificationData,
): RenderedEmail {
  const org = data.orgName;
  const product = env.productName;
  const used = data.usedPages ?? 0;
  const limit = data.pageLimit ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const usageFacts = [
    { label: "Pages used", value: fmtNum(used) },
    { label: "Plan limit", value: limit > 0 ? fmtNum(limit) : "Unlimited" },
    { label: "Used", value: `${pct}%` },
  ];

  switch (type) {
    case "usage_90_percent":
      return build("warning", `${org} has used 90% of its page limit`, {
        eyebrow: "Usage",
        heading: "You've used 90% of your page limit",
        body: `${org} has used ${pct}% of the page allowance for the current billing period. Generation continues normally until the limit is reached.`,
        facts: usageFacts,
        factsLabel: "Usage details",
        cta: { label: "View usage", url: usageUrl() },
      });

    case "usage_95_percent":
      return build("warning", `${org} has used 95% of its page limit`, {
        eyebrow: "Usage",
        heading: "You've used 95% of your page limit",
        body: `${org} has used ${pct}% of the page allowance for the current billing period. When usage reaches 100%, new generation is blocked until the period resets or the limit is raised.`,
        facts: usageFacts,
        factsLabel: "Usage details",
        cta: { label: "Review plan", url: billingUrl() },
      });

    case "usage_100_percent":
      return build("danger", `${org} has reached its page limit`, {
        eyebrow: "Usage",
        heading: "You've reached your page limit",
        body: `${org} has used the full page allowance for the current billing period. New generation is blocked until the period resets or you raise the limit.`,
        facts: usageFacts,
        factsLabel: "Usage details",
        cta: { label: "Manage plan", url: billingUrl() },
        note: "Generation resumes automatically when the billing period resets.",
      });

    case "renewal_30_days":
    case "renewal_15_days":
    case "renewal_2_days": {
      const date = fmtDate(data.expiresAt);
      return build("info", `Your ${product} subscription renews on ${date}`, {
        eyebrow: "Billing",
        heading: `Your subscription renews on ${date}`,
        body: `The ${product} subscription for ${org} is scheduled to renew on ${date}. No action is needed if your billing details are up to date.`,
        facts: [{ label: "Renewal date", value: date }],
        factsLabel: "Subscription details",
        cta: { label: "Manage subscription", url: billingUrl() },
      });
    }

    case "trial_5_days":
    case "trial_2_days": {
      const date = fmtDate(data.trialEndsAt);
      return build("warning", `Your ${product} trial ends on ${date}`, {
        eyebrow: "Trial",
        heading: `Your trial ends on ${date}`,
        body: `The ${product} trial for ${org} ends on ${date}. Upgrade before then to continue generating without the trial watermark.`,
        facts: [{ label: "Trial ends", value: date }],
        factsLabel: "Trial details",
        cta: { label: "Upgrade plan", url: billingUrl() },
        note: `Until you upgrade, generated PDFs carry the “${TRIAL_WATERMARK_TEXT}” watermark.`,
      });
    }

    case "trial_expired":
      return build("danger", `Your ${product} trial has ended`, {
        eyebrow: "Trial",
        heading: "Your trial has ended",
        body: [
          `The ${product} trial for ${org} ended on ${fmtDate(data.trialEndsAt)}, and generation is now paused.`,
          "Your account, settings, and API keys remain intact. Upgrading to a paid plan restores generation.",
        ],
        cta: { label: "Choose a plan", url: billingUrl() },
      });
  }
}

function build(tone: EmailTone, subject: string, block: Parameters<typeof renderLayout>[2]): RenderedEmail {
  return renderLayout(subject, tone, block);
}

/** Indefinite article for a role name ("an admin", "a member"). */
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** Invitation email sent when an owner/admin invites a teammate to an org. */
export function renderInvitationEmail(data: {
  orgName: string;
  inviterName?: string | null;
  role: string;
  acceptUrl: string;
  expiresAt?: Date | null;
}): RenderedEmail {
  const product = env.productName;
  const inviter = data.inviterName?.trim();
  const intro = inviter
    ? `${inviter} invited you to join ${data.orgName} on ${product} as ${article(data.role)} ${data.role}.`
    : `You've been invited to join ${data.orgName} on ${product} as ${article(data.role)} ${data.role}.`;
  const facts = [
    { label: "Organization", value: data.orgName },
    { label: "Role", value: data.role },
  ];
  if (data.expiresAt) facts.push({ label: "Invitation expires", value: fmtDate(data.expiresAt) });

  return renderLayout(`You're invited to ${data.orgName} on ${product}`, "neutral", {
    eyebrow: "Invitation",
    heading: `Join ${data.orgName} on ${product}`,
    body: [intro, "Accept the invitation to access the organization's licenses and usage."],
    facts,
    factsLabel: "Invitation details",
    cta: { label: "Accept invitation", url: data.acceptUrl },
    note: "If you weren't expecting this invitation, you can safely ignore this email.",
  });
}

/** Onboarding email sent when a customer account is provisioned. */
export function renderWelcomeEmail(data: {
  orgName: string;
  customerName: string;
  email: string;
  temporaryPassword: string;
  isTrial: boolean;
  trialEndsAt?: Date | null;
  expiresAt?: Date | null;
}): RenderedEmail {
  const product = env.productName;
  const facts = [
    { label: "Sign-in email", value: data.email },
    { label: "Temporary password", value: data.temporaryPassword },
  ];
  if (data.isTrial) facts.push({ label: "Trial ends", value: fmtDate(data.trialEndsAt) });
  else if (data.expiresAt) facts.push({ label: "Renews", value: fmtDate(data.expiresAt) });

  return renderLayout(`Your ${product} account is ready`, "neutral", {
    eyebrow: "Welcome",
    heading: `Your ${product} account is ready`,
    body: [
      `Hi ${data.customerName}, the account for ${data.orgName} has been set up.`,
      "Sign in with the temporary password below, then set a new password from your account settings.",
    ],
    facts,
    factsLabel: "Sign-in details",
    cta: { label: "Sign in", url: `${env.appUrl}/login` },
    note: "For security, the temporary password is shown only this once. Change it after your first sign-in.",
  });
}
