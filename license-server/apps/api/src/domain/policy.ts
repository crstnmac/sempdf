export type LicenseStatus = "none" | "trial" | "grace_period" | "hard_blocked";
export type NotificationEventType =
  | "usage_80_percent"
  | "usage_100_percent"
  | "overage_started"
  | "hard_block_warning";

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
  reason?: "license_inactive" | "license_expired" | "grace_period_expired" | "hard_blocked";
  firstOverageAt: Date | null;
  hardBlockAt: Date | null;
}

export function evaluateLicensePolicy(options: {
  license: PolicyLicenseSnapshot;
  now: Date;
  gracePeriodDays: number;
}): LicensePolicyDecision {
  const { license, now, gracePeriodDays } = options;

  if (!license.active) {
    return blocked("license_inactive", "hard_blocked", license.firstOverageAt, null);
  }
  if (license.expiresAt && license.expiresAt.getTime() <= now.getTime()) {
    return blocked("license_expired", "hard_blocked", license.firstOverageAt, null);
  }

  const trialActive = license.trialEndsAt !== null && license.trialEndsAt.getTime() > now.getTime();
  if (trialActive) {
    return { allowed: true, watermark: true, status: "trial", firstOverageAt: license.firstOverageAt, hardBlockAt: null };
  }

  const overLimit = license.usedUnits > license.limitUnits;
  if (!overLimit && license.status !== "hard_blocked") {
    return { allowed: true, watermark: false, status: "none", firstOverageAt: license.firstOverageAt, hardBlockAt: null };
  }

  const firstOverageAt = license.firstOverageAt ?? now;
  const hardBlockAt = addDays(firstOverageAt, gracePeriodDays);
  if (license.status === "hard_blocked" || now.getTime() >= hardBlockAt.getTime()) {
    return blocked(license.status === "hard_blocked" ? "hard_blocked" : "grace_period_expired", "hard_blocked", firstOverageAt, hardBlockAt);
  }

  // Already over the limit (meter negative): every run from here is watermarked.
  // The single run that *crosses* the limit isn't watermarked because the
  // caller evaluates this on the pre-charge usage, which is still within limit.
  return {
    allowed: true,
    watermark: true,
    status: "grace_period",
    firstOverageAt,
    hardBlockAt,
  };
}

export function notificationEventsForUsage(options: {
  previousUsedPages: number;
  nextUsedPages: number;
  pageLimit: number;
  wasOverLimit: boolean;
  isOverLimit: boolean;
}): NotificationEventType[] {
  const events: NotificationEventType[] = [];
  if (options.pageLimit <= 0) return events;
  if (options.previousUsedPages < options.pageLimit * 0.8 && options.nextUsedPages >= options.pageLimit * 0.8) {
    events.push("usage_80_percent");
  }
  if (options.previousUsedPages < options.pageLimit && options.nextUsedPages >= options.pageLimit) {
    events.push("usage_100_percent");
  }
  if (!options.wasOverLimit && options.isOverLimit) {
    events.push("overage_started");
  }
  return events;
}

export function hardBlockWarningDue(options: { firstOverageAt: Date | null; now: Date; gracePeriodDays: number }): boolean {
  if (!options.firstOverageAt) return false;
  const hardBlockAt = addDays(options.firstOverageAt, options.gracePeriodDays);
  const warningAt = new Date(hardBlockAt.getTime() - 24 * 60 * 60 * 1000);
  return options.now.getTime() >= warningAt.getTime() && options.now.getTime() < hardBlockAt.getTime();
}

function blocked(
  reason: NonNullable<LicensePolicyDecision["reason"]>,
  status: LicenseStatus,
  firstOverageAt: Date | null,
  hardBlockAt: Date | null,
): LicensePolicyDecision {
  return { allowed: false, watermark: true, status, reason, firstOverageAt, hardBlockAt };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
