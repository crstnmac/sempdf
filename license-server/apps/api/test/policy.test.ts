import test from "node:test";
import assert from "node:assert/strict";

import { evaluateLicensePolicy, notificationEventsForUsage } from "../src/domain/policy.js";

const baseLicense = {
  active: true,
  limitUnits: 100,
  usedUnits: 0,
  status: "none" as const,
  firstOverageAt: null,
  trialEndsAt: null,
  expiresAt: null,
};

test("watermarks every run once the meter is already over the limit", () => {
  const now = new Date("2026-06-25T10:00:00Z");
  const decision = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 120, firstOverageAt: now, status: "grace_period" },
    now,
    gracePeriodDays: 7,
  });

  // Already negative: the next run is allowed but watermarked. Only the single
  // run that crosses the limit passes clean (evaluated on pre-charge usage).
  assert.equal(decision.allowed, true);
  assert.equal(decision.watermark, true);
  assert.equal(decision.status, "grace_period");
});

test("the crossing run (still within limit) passes clean, no watermark", () => {
  const now = new Date("2026-06-25T10:00:00Z");
  const decision = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 100, status: "none" },
    now,
    gracePeriodDays: 7,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.watermark, false);
  assert.equal(decision.status, "none");
});

test("watermarks new jobs during overage grace and hard-blocks after grace expires", () => {
  const firstOverageAt = new Date("2026-06-01T00:00:00Z");
  const duringGrace = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 101, firstOverageAt, status: "grace_period" },
    now: new Date("2026-06-07T23:59:00Z"),
    gracePeriodDays: 7,
  });
  assert.equal(duringGrace.allowed, true);
  assert.equal(duringGrace.watermark, true);
  assert.equal(duringGrace.status, "grace_period");

  const afterGrace = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 101, firstOverageAt, status: "grace_period" },
    now: new Date("2026-06-08T00:00:01Z"),
    gracePeriodDays: 7,
  });
  assert.equal(afterGrace.allowed, false);
  assert.equal(afterGrace.watermark, true);
  assert.equal(afterGrace.status, "hard_blocked");
  assert.equal(afterGrace.reason, "grace_period_expired");
});

test("trial licenses always watermark and expired trials enter grace only when over limit", () => {
  const activeTrial = evaluateLicensePolicy({
    license: { ...baseLicense, trialEndsAt: new Date("2026-07-01T00:00:00Z") },
    now: new Date("2026-06-25T00:00:00Z"),
    gracePeriodDays: 7,
  });
  assert.equal(activeTrial.allowed, true);
  assert.equal(activeTrial.watermark, true);
  assert.equal(activeTrial.status, "trial");

  const expiredWithinLimit = evaluateLicensePolicy({
    license: { ...baseLicense, trialEndsAt: new Date("2026-06-01T00:00:00Z") },
    now: new Date("2026-06-02T00:00:00Z"),
    gracePeriodDays: 7,
  });
  assert.equal(expiredWithinLimit.allowed, true);
  assert.equal(expiredWithinLimit.watermark, false);
  assert.equal(expiredWithinLimit.status, "none");

  const expiredOverLimit = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 120, trialEndsAt: new Date("2026-06-01T00:00:00Z") },
    now: new Date("2026-06-02T00:00:00Z"),
    gracePeriodDays: 7,
  });
  assert.equal(expiredOverLimit.allowed, true);
  assert.equal(expiredOverLimit.watermark, true);
  assert.equal(expiredOverLimit.status, "grace_period");
  assert.equal(expiredOverLimit.firstOverageAt?.toISOString(), "2026-06-02T00:00:00.000Z");
});

test("usage notifications include threshold and overage events once per transition", () => {
  assert.deepEqual(
    notificationEventsForUsage({
      previousUsedPages: 79,
      nextUsedPages: 80,
      pageLimit: 100,
      wasOverLimit: false,
      isOverLimit: false,
    }),
    ["usage_80_percent"],
  );

  assert.deepEqual(
    notificationEventsForUsage({
      previousUsedPages: 99,
      nextUsedPages: 101,
      pageLimit: 100,
      wasOverLimit: false,
      isOverLimit: true,
    }),
    ["usage_100_percent", "overage_started"],
  );
});
