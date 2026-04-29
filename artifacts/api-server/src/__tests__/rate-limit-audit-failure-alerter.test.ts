import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  recordRateLimitAuditFailure,
  __resetRateLimitAuditFailureTrackerForTests,
} from "../lib/rate-limit-audit-failure-tracker";
import {
  evaluateRateLimitAuditFailureAlert,
  getRateLimitAuditFailureAlertingState,
  __resetRateLimitAuditFailureAlerterForTests,
  __setRateLimitAuditFailureAlerterDeliveriesForTests,
  type DeliveryResult,
  type RateLimitAuditFailureAlertPayload,
} from "../lib/rate-limit-audit-failure-alerter";

interface StubDelivery {
  fn: (p: RateLimitAuditFailureAlertPayload) => Promise<DeliveryResult>;
  calls: RateLimitAuditFailureAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: RateLimitAuditFailureAlertPayload[] = [];
  const fn = vi.fn(
    async (p: RateLimitAuditFailureAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

function recordN(name: string, n: number): void {
  for (let i = 0; i < n; i++) {
    recordRateLimitAuditFailure(name, new Error(`failure ${i}`));
  }
}

describe("rate-limit-audit-failure-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetRateLimitAuditFailureTrackerForTests();
    __resetRateLimitAuditFailureAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setRateLimitAuditFailureAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setRateLimitAuditFailureAlerterDeliveriesForTests(null);
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("is a no-op when no audit failures have been recorded", async () => {
    const results = await evaluateRateLimitAuditFailureAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
    expect(getRateLimitAuditFailureAlertingState().alerting).toBe(false);
  });

  it("does not fire below the threshold", async () => {
    // Default threshold is 5 — record 4 and confirm we stay quiet.
    recordN("login-ip", 4);

    const results = await evaluateRateLimitAuditFailureAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(getRateLimitAuditFailureAlertingState().alerting).toBe(false);
  });

  it("fires a 'fire' alert on every channel once growth crosses the threshold", async () => {
    recordN("login-ip", 5);

    await evaluateRateLimitAuditFailureAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(pd.calls[0].delta).toBe(5);
    expect(pd.calls[0].stats.totalCount).toBe(5);
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].kind).toBe("fire");
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].kind).toBe("fire");
    expect(getRateLimitAuditFailureAlertingState().alerting).toBe(true);
  });

  it("fires once per throttle window even when failures keep happening (sustained outage)", async () => {
    const prevThrottle =
      process.env.RATE_LIMIT_AUDIT_FAILURE_NOTIFICATION_THROTTLE_MS;
    process.env.RATE_LIMIT_AUDIT_FAILURE_NOTIFICATION_THROTTLE_MS = String(
      15 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      // First burst — crosses threshold, fires once.
      recordN("login-ip", 5);
      await evaluateRateLimitAuditFailureAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // Continued sustained outage: another burst arrives 1 minute later.
      // We're well inside the 15m throttle window, so no NEW page should
      // go out — even though the counter keeps growing past the threshold.
      vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
      recordN("login-ip", 10);
      let results = await evaluateRateLimitAuditFailureAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      // The dispatch was attempted but throttled on every channel.
      expect(
        results.filter((r) => r.skipped && r.reason === "throttled"),
      ).toHaveLength(3);

      // 5 minutes later, more failures, still throttled.
      vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
      recordN("login-ip", 100);
      results = await evaluateRateLimitAuditFailureAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(email.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(slack.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(
        results.filter((r) => r.skipped && r.reason === "throttled"),
      ).toHaveLength(3);

      // Past the throttle window: another burst now produces a second
      // page (one per window, as advertised).
      vi.setSystemTime(new Date("2026-01-01T00:16:00Z"));
      recordN("login-ip", 5);
      await evaluateRateLimitAuditFailureAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
      expect(email.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
      expect(slack.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
    } finally {
      if (prevThrottle === undefined) {
        delete process.env.RATE_LIMIT_AUDIT_FAILURE_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.RATE_LIMIT_AUDIT_FAILURE_NOTIFICATION_THROTTLE_MS =
          prevThrottle;
      }
    }
  });

  it("does not re-fire on additional polls if no new failures arrive between them", async () => {
    recordN("login-ip", 5);
    await evaluateRateLimitAuditFailureAlert();
    expect(pd.calls).toHaveLength(1);

    // Polling repeats with no new failures — we already alerted on 5,
    // baseline is now 5, total is still 5, so sinceBaseline = 0 < threshold.
    await evaluateRateLimitAuditFailureAlert();
    await evaluateRateLimitAuditFailureAlert();
    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("sends an 'all clear' alert after the recovery window of no growth", async () => {
    const prevRecovery =
      process.env.RATE_LIMIT_AUDIT_FAILURE_RECOVERY_WINDOW_MS;
    process.env.RATE_LIMIT_AUDIT_FAILURE_RECOVERY_WINDOW_MS = String(
      10 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      recordN("login-ip", 5);
      await evaluateRateLimitAuditFailureAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // Counter goes quiet — advance past the recovery window without
      // any new failures.
      vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
      const results = await evaluateRateLimitAuditFailureAlert();

      const clears = results.filter((r) => r.channel && !r.skipped);
      expect(clears.length).toBeGreaterThan(0);
      expect(pd.calls).toHaveLength(2);
      expect(pd.calls[1].kind).toBe("clear");
      expect(email.calls[1].kind).toBe("clear");
      expect(slack.calls[1].kind).toBe("clear");
      expect(getRateLimitAuditFailureAlertingState().alerting).toBe(false);
    } finally {
      if (prevRecovery === undefined) {
        delete process.env.RATE_LIMIT_AUDIT_FAILURE_RECOVERY_WINDOW_MS;
      } else {
        process.env.RATE_LIMIT_AUDIT_FAILURE_RECOVERY_WINDOW_MS = prevRecovery;
      }
    }
  });

  it("re-fires after a recovery once a new outage transitions in", async () => {
    const prevThrottle =
      process.env.RATE_LIMIT_AUDIT_FAILURE_NOTIFICATION_THROTTLE_MS;
    const prevRecovery =
      process.env.RATE_LIMIT_AUDIT_FAILURE_RECOVERY_WINDOW_MS;
    // Throttle window short enough that the second outage isn't suppressed.
    process.env.RATE_LIMIT_AUDIT_FAILURE_NOTIFICATION_THROTTLE_MS = String(
      5 * 60 * 1000,
    );
    process.env.RATE_LIMIT_AUDIT_FAILURE_RECOVERY_WINDOW_MS = String(
      10 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      recordN("login-ip", 5);
      await evaluateRateLimitAuditFailureAlert();

      // Recover: quiet for the recovery window.
      vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
      await evaluateRateLimitAuditFailureAlert();

      // New outage well past the throttle window.
      vi.setSystemTime(new Date("2026-01-01T00:30:00Z"));
      recordN("login-ip", 5);
      await evaluateRateLimitAuditFailureAlert();

      const fires = pd.calls.filter((c) => c.kind === "fire");
      const clears = pd.calls.filter((c) => c.kind === "clear");
      expect(fires).toHaveLength(2);
      expect(clears).toHaveLength(1);
    } finally {
      if (prevThrottle === undefined) {
        delete process.env.RATE_LIMIT_AUDIT_FAILURE_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.RATE_LIMIT_AUDIT_FAILURE_NOTIFICATION_THROTTLE_MS =
          prevThrottle;
      }
      if (prevRecovery === undefined) {
        delete process.env.RATE_LIMIT_AUDIT_FAILURE_RECOVERY_WINDOW_MS;
      } else {
        process.env.RATE_LIMIT_AUDIT_FAILURE_RECOVERY_WINDOW_MS = prevRecovery;
      }
    }
  });

  it("includes per-limiter detail in the fire payload", async () => {
    recordN("login-ip", 3);
    recordN("signup-ip", 2);

    await evaluateRateLimitAuditFailureAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].stats.totalCount).toBe(5);
    expect(pd.calls[0].stats.byName["login-ip"].count).toBe(3);
    expect(pd.calls[0].stats.byName["signup-ip"].count).toBe(2);
    expect(pd.calls[0].delta).toBe(5);
  });

  it("does not let a single delivery failure block other deliveries", async () => {
    __setRateLimitAuditFailureAlerterDeliveriesForTests({
      pagerduty: async () => {
        throw new Error("pd boom");
      },
      email: email.fn,
      slack: slack.fn,
    });

    recordN("login-ip", 5);
    const results = await evaluateRateLimitAuditFailureAlert();

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    const pdResult = results.find((r) => r.channel === "pagerduty");
    expect(pdResult?.ok).toBe(false);
    expect(pdResult?.reason).toContain("pd boom");
  });

  it("does not double-fire when two evaluations race on the same first-time outage", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let pdInflight = 0;
    let pdMaxInflight = 0;
    __setRateLimitAuditFailureAlerterDeliveriesForTests({
      pagerduty: async () => {
        pdInflight += 1;
        pdMaxInflight = Math.max(pdMaxInflight, pdInflight);
        await gate;
        pdInflight -= 1;
        return { channel: "pagerduty", ok: true };
      },
      email: email.fn,
      slack: slack.fn,
    });

    recordN("login-ip", 5);
    const a = evaluateRateLimitAuditFailureAlert();
    const b = evaluateRateLimitAuditFailureAlert();
    release();
    const [resA, resB] = await Promise.all([a, b]);

    // Exactly one of the two evaluations actually dispatched — the other
    // saw the baseline already advanced and returned []. (Without the
    // synchronous baseline flip, both would have raced into dispatchAll
    // and double-paged on the first burst.)
    const dispatched = [resA, resB].filter((r) => r.length > 0);
    expect(dispatched).toHaveLength(1);
    expect(pdMaxInflight).toBe(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("treats unconfigured providers as skipped without consuming the throttle slot", async () => {
    __setRateLimitAuditFailureAlerterDeliveriesForTests({
      pagerduty: async () => ({
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: email.fn,
      slack: slack.fn,
    });

    recordN("login-ip", 5);
    const r1 = await evaluateRateLimitAuditFailureAlert();
    const pd1 = r1.find((r) => r.channel === "pagerduty");
    expect(pd1?.skipped).toBe(true);
    expect(pd1?.reason).toBe("not_configured");

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });
});
