export type LicenseStatus = "none" | "trial" | "hard_blocked";

/**
 * The watermark stamped onto every PDF generated under a trial license. Single
 * source of truth: the authorize endpoint sends this to the library to stamp,
 * and customer-facing copy (emails) references it. Change it here only.
 */
export const TRIAL_WATERMARK_TEXT = "ZeroPDF - For Trial Use Only";

/** Page-utilization alerts fired inline as consumption crosses a threshold. */
export type UsageEventType = "usage_90_percent" | "usage_95_percent" | "usage_100_percent";

/** Time-based lifecycle reminders fired by the periodic sweep. */
export type ScheduleEventType =
  | "renewal_30_days"
  | "renewal_15_days"
  | "renewal_2_days"
  | "trial_5_days"
  | "trial_2_days"
  | "trial_expired";

export type NotificationEventType = UsageEventType | ScheduleEventType;

export interface PolicyLicenseSnapshot {
  active: boolean;
  limitUnits: number;
  usedUnits: number;
  status: LicenseStatus;
  firstOverageAt: Date | null;
  trialEndsAt: Date | null;
  expiresAt: Date | null;
}

export interface LicensePolicyDecision {
  allowed: boolean;
  watermark: boolean;
  status: LicenseStatus;
  reason?: "license_inactive" | "license_expired" | "limit_reached" | "hard_blocked";
  firstOverageAt: Date | null;
  hardBlockAt: Date | null;
}

/**
 * Decides whether a license may generate. Enforcement model: trials watermark
 * every run; reaching 100% of the page limit hard-blocks immediately (no grace
 * period). The run that *crosses* the limit still completes, because callers
 * evaluate this on the pre-charge usage which is still under the limit; the next
 * authorize sees `usedUnits >= limitUnits` and is rejected.
 */
export function evaluateLicensePolicy(options: {
  license: PolicyLicenseSnapshot;
  now: Date;
}): LicensePolicyDecision {
  const { license, now } = options;

  if (!license.active) {
    return blocked("license_inactive", license.firstOverageAt);
  }
  if (license.expiresAt && license.expiresAt.getTime() <= now.getTime()) {
    return blocked("license_expired", license.firstOverageAt);
  }

  // The page limit applies to every license, INCLUDING trials: reaching 100%
  // hard-blocks regardless of trial state. (Trial expiry is enforced by date via
  // the absence of `trialActive` below; the page cap is enforced here.)
  const atLimit = license.usedUnits >= license.limitUnits;
  if (atLimit || license.status === "hard_blocked") {
    return blocked(license.status === "hard_blocked" ? "hard_blocked" : "limit_reached", license.firstOverageAt ?? now);
  }

  // Within the limit and trial still active: allow, but watermark every run.
  const trialActive = license.trialEndsAt !== null && license.trialEndsAt.getTime() > now.getTime();
  if (trialActive) {
    return { allowed: true, watermark: true, status: "trial", firstOverageAt: license.firstOverageAt, hardBlockAt: null };
  }

  return { allowed: true, watermark: false, status: "none", firstOverageAt: license.firstOverageAt, hardBlockAt: null };
}

/** Page-utilization alerts crossed by a single change in consumption: 90/95/100%. */
export function notificationEventsForUsage(options: {
  previousUsedPages: number;
  nextUsedPages: number;
  pageLimit: number;
}): UsageEventType[] {
  const events: UsageEventType[] = [];
  const { previousUsedPages: prev, nextUsedPages: next, pageLimit: limit } = options;
  if (limit <= 0) return events;
  if (prev < limit * 0.9 && next >= limit * 0.9) events.push("usage_90_percent");
  if (prev < limit * 0.95 && next >= limit * 0.95) events.push("usage_95_percent");
  if (prev < limit && next >= limit) events.push("usage_100_percent");
  return events;
}

/**
 * Time-based reminders due for a license right now. Subscriptions (a non-trial
 * license with an `expiresAt`) warn 30/15/2 days before renewal; trials warn
 * 5/2 days before expiry and once expired. Only the nearest bucket is returned;
 * the sweep dedups so each reminder is sent once per term.
 */
export function scheduleRemindersDue(
  license: Pick<PolicyLicenseSnapshot, "trialEndsAt" | "expiresAt">,
  now: Date,
): ScheduleEventType[] {
  const events: ScheduleEventType[] = [];

  if (license.trialEndsAt) {
    if (now.getTime() >= license.trialEndsAt.getTime()) {
      events.push("trial_expired");
    } else {
      const days = daysUntil(license.trialEndsAt, now);
      if (days <= 2) events.push("trial_2_days");
      else if (days <= 5) events.push("trial_5_days");
    }
  }

  // Renewal reminders apply to active subscriptions only (not trials, not expired).
  const trialActive = license.trialEndsAt !== null && license.trialEndsAt.getTime() > now.getTime();
  if (license.expiresAt && !trialActive && now.getTime() < license.expiresAt.getTime()) {
    const days = daysUntil(license.expiresAt, now);
    if (days <= 2) events.push("renewal_2_days");
    else if (days <= 15) events.push("renewal_15_days");
    else if (days <= 30) events.push("renewal_30_days");
  }

  return events;
}

function daysUntil(target: Date, now: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function blocked(
  reason: NonNullable<LicensePolicyDecision["reason"]>,
  firstOverageAt: Date | null,
): LicensePolicyDecision {
  return { allowed: false, watermark: true, status: "hard_blocked", reason, firstOverageAt, hardBlockAt: null };
}
