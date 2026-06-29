import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateLicensePolicy,
  notificationEventsForUsage,
  scheduleRemindersDue,
} from "../src/domain/policy.js";

const baseLicense = {
  active: true,
  limitUnits: 100,
  usedUnits: 0,
  status: "none" as const,
  firstOverageAt: null,
  trialEndsAt: null,
  expiresAt: null,
};

const now = new Date("2026-06-25T10:00:00Z");

test("the run that crosses the limit (still within limit pre-charge) passes clean", () => {
  const decision = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 99 },
    now,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.watermark, false);
  assert.equal(decision.status, "none");
});

test("hard-blocks immediately at 100% — no grace period", () => {
  const decision = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 100 },
    now,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, "hard_blocked");
  assert.equal(decision.reason, "limit_reached");
});

test("blocks inactive and expired licenses", () => {
  const inactive = evaluateLicensePolicy({ license: { ...baseLicense, active: false }, now });
  assert.equal(inactive.allowed, false);
  assert.equal(inactive.reason, "license_inactive");

  const expired = evaluateLicensePolicy({
    license: { ...baseLicense, expiresAt: new Date("2026-06-24T00:00:00Z") },
    now,
  });
  assert.equal(expired.allowed, false);
  assert.equal(expired.reason, "license_expired");
});

test("trial licenses watermark within the limit but hard-block once the limit is reached", () => {
  const activeTrial = evaluateLicensePolicy({
    license: { ...baseLicense, trialEndsAt: new Date("2026-07-01T00:00:00Z") },
    now,
  });
  assert.equal(activeTrial.allowed, true);
  assert.equal(activeTrial.watermark, true);
  assert.equal(activeTrial.status, "trial");

  // A trial gets its page allotment (then it is blocked, same as any license).
  const trialAtLimit = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 100, trialEndsAt: new Date("2026-07-01T00:00:00Z") },
    now,
  });
  assert.equal(trialAtLimit.allowed, false);
  assert.equal(trialAtLimit.status, "hard_blocked");
  assert.equal(trialAtLimit.reason, "limit_reached");

  const expiredWithinLimit = evaluateLicensePolicy({
    license: { ...baseLicense, trialEndsAt: new Date("2026-06-01T00:00:00Z") },
    now,
  });
  assert.equal(expiredWithinLimit.allowed, true);
  assert.equal(expiredWithinLimit.watermark, false);
  assert.equal(expiredWithinLimit.status, "none");

  const expiredAtLimit = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 100, trialEndsAt: new Date("2026-06-01T00:00:00Z") },
    now,
  });
  assert.equal(expiredAtLimit.allowed, false);
  assert.equal(expiredAtLimit.status, "hard_blocked");
});

test("usage notifications fire at 90 / 95 / 100% once per transition", () => {
  assert.deepEqual(
    notificationEventsForUsage({ previousUsedPages: 89, nextUsedPages: 90, pageLimit: 100 }),
    ["usage_90_percent"],
  );
  assert.deepEqual(
    notificationEventsForUsage({ previousUsedPages: 94, nextUsedPages: 96, pageLimit: 100 }),
    ["usage_95_percent"],
  );
  // A single big jump can cross several thresholds at once.
  assert.deepEqual(
    notificationEventsForUsage({ previousUsedPages: 50, nextUsedPages: 100, pageLimit: 100 }),
    ["usage_90_percent", "usage_95_percent", "usage_100_percent"],
  );
  // No threshold crossed → no events.
  assert.deepEqual(
    notificationEventsForUsage({ previousUsedPages: 10, nextUsedPages: 20, pageLimit: 100 }),
    [],
  );
});

test("trial reminders fire at 5/2 days before expiry and once expired", () => {
  const trialEndsAt = new Date("2026-06-30T10:00:00Z");
  assert.deepEqual(scheduleRemindersDue({ trialEndsAt, expiresAt: null }, new Date("2026-06-26T10:00:00Z")), ["trial_5_days"]);
  assert.deepEqual(scheduleRemindersDue({ trialEndsAt, expiresAt: null }, new Date("2026-06-29T10:00:00Z")), ["trial_2_days"]);
  assert.deepEqual(scheduleRemindersDue({ trialEndsAt, expiresAt: null }, new Date("2026-07-01T10:00:00Z")), ["trial_expired"]);
  // Outside any window → nothing.
  assert.deepEqual(scheduleRemindersDue({ trialEndsAt, expiresAt: null }, new Date("2026-06-20T10:00:00Z")), []);
});

test("subscription renewal reminders fire at 30/15/2 days before expiry, not while on trial", () => {
  const expiresAt = new Date("2026-12-31T10:00:00Z");
  assert.deepEqual(scheduleRemindersDue({ trialEndsAt: null, expiresAt }, new Date("2026-12-05T10:00:00Z")), ["renewal_30_days"]);
  assert.deepEqual(scheduleRemindersDue({ trialEndsAt: null, expiresAt }, new Date("2026-12-20T10:00:00Z")), ["renewal_15_days"]);
  assert.deepEqual(scheduleRemindersDue({ trialEndsAt: null, expiresAt }, new Date("2026-12-30T10:00:00Z")), ["renewal_2_days"]);

  // An active trial suppresses renewal reminders even if expiresAt is near.
  const onTrial = scheduleRemindersDue(
    { trialEndsAt: new Date("2027-01-15T10:00:00Z"), expiresAt },
    new Date("2026-12-20T10:00:00Z"),
  );
  assert.equal(onTrial.includes("renewal_15_days"), false);
});
