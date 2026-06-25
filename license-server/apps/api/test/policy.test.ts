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

test("allows an in-flight job without watermark even after usage exceeds the limit", () => {
  const now = new Date("2026-06-25T10:00:00Z");
  const decision = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 120, firstOverageAt: now, status: "grace_period" },
    now,
    gracePeriodDays: 7,
    isExistingJob: true,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.watermark, false);
  assert.equal(decision.status, "grace_period");
});

test("watermarks new jobs during overage grace and hard-blocks after grace expires", () => {
  const firstOverageAt = new Date("2026-06-01T00:00:00Z");
  const duringGrace = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 101, firstOverageAt, status: "grace_period" },
    now: new Date("2026-06-07T23:59:00Z"),
    gracePeriodDays: 7,
    isExistingJob: false,
  });
  assert.equal(duringGrace.allowed, true);
  assert.equal(duringGrace.watermark, true);
  assert.equal(duringGrace.status, "grace_period");

  const afterGrace = evaluateLicensePolicy({
    license: { ...baseLicense, usedUnits: 101, firstOverageAt, status: "grace_period" },
    now: new Date("2026-06-08T00:00:01Z"),
    gracePeriodDays: 7,
    isExistingJob: false,
  });
  assert.equal(afterGrace.allowed, false);
  assert.equal(afterGrace.watermark, true);
  assert.equal(afterGrace.status, "hard_blocked");
  assert.equal(afterGrace.reason, "grace_period_expired");
});

test("trial licenses always watermark and expired trials enter overage flow", () => {
  const activeTrial = evaluateLicensePolicy({
    license: { ...baseLicense, trialEndsAt: new Date("2026-07-01T00:00:00Z") },
    now: new Date("2026-06-25T00:00:00Z"),
    gracePeriodDays: 7,
    isExistingJob: false,
  });
  assert.equal(activeTrial.allowed, true);
  assert.equal(activeTrial.watermark, true);
  assert.equal(activeTrial.status, "trial");

  const expiredTrial = evaluateLicensePolicy({
    license: { ...baseLicense, trialEndsAt: new Date("2026-06-01T00:00:00Z") },
    now: new Date("2026-06-02T00:00:00Z"),
    gracePeriodDays: 7,
    isExistingJob: false,
  });
  assert.equal(expiredTrial.allowed, true);
  assert.equal(expiredTrial.watermark, true);
  assert.equal(expiredTrial.status, "grace_period");
  assert.equal(expiredTrial.firstOverageAt?.toISOString(), "2026-06-02T00:00:00.000Z");
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
