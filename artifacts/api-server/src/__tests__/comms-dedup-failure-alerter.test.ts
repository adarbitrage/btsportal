import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  recordCommsDedupFailure,
  getCommsDedupFailuresInWindow,
  getCommsDedupFailureCumulativeStats,
  __resetCommsDedupFailureTrackerForTests,
} from "../lib/comms-dedup-failure-tracker";
import {
  evaluateCommsDedupFailureAlert,
  getCommsDedupFailureAlertingState,
  __resetCommsDedupFailureAlerterForTests,
  __setCommsDedupFailureAlerterDeliveriesForTests,
  type DeliveryResult,
  type CommsDedupFailureAlertPayload,
} from "../lib/comms-dedup-failure-alerter";

interface StubDelivery {
  fn: (p: CommsDedupFailureAlertPayload) => Promise<DeliveryResult>;
  calls: CommsDedupFailureAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: CommsDedupFailureAlertPayload[] = [];
  const fn = vi.fn(async (p: CommsDedupFailureAlertPayload): Promise<DeliveryResult> => {
    calls.push(p);
    return { channel, ok: true };
  });
  return { fn, calls };
}

function recordN(channel: "email" | "sms", n: number, baseId = 1): void {
  for (let i = 0; i < n; i++) {
    recordCommsDedupFailure(channel, `mentorship-expiry:user:${baseId + i}`);
  }
}

describe("comms-dedup-failure-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetCommsDedupFailureTrackerForTests();
    __resetCommsDedupFailureAlerterForTests();
    // Threshold defaults to 3, window 15m, recovery 10m — exercise those.
    delete process.env.COMMS_DEDUP_FAILURE_ALERT_THRESHOLD;
    delete process.env.COMMS_DEDUP_FAILURE_ALERT_WINDOW_MS;
    delete process.env.COMMS_DEDUP_FAILURE_RECOVERY_WINDOW_MS;
    delete process.env.COMMS_DEDUP_FAILURE_NOTIFICATION_THROTTLE_MS;
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setCommsDedupFailureAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setCommsDedupFailureAlerterDeliveriesForTests(null);
    warnSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("is a no-op when no failures have been recorded", async () => {
    const results = await evaluateCommsDedupFailureAlert();
    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
    expect(getCommsDedupFailureAlertingState().alerting).toBe(false);
  });

  it("does not fire below the configured threshold", async () => {
    // Default threshold is 3 — record 2 and confirm we stay quiet.
    recordN("email", 2);
    const results = await evaluateCommsDedupFailureAlert();
    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(getCommsDedupFailureAlertingState().alerting).toBe(false);
  });

  it("fires on every channel once the rolling window crosses the threshold", async () => {
    recordN("email", 3);
    await evaluateCommsDedupFailureAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(pd.calls[0].window.totalCount).toBe(3);
    expect(pd.calls[0].window.byChannel.email).toBe(3);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    expect(getCommsDedupFailureAlertingState().alerting).toBe(true);
  });

  it("tracks email vs sms failures separately in the fire payload", async () => {
    recordN("email", 2);
    recordN("sms", 1, 100);
    await evaluateCommsDedupFailureAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].window.totalCount).toBe(3);
    expect(pd.calls[0].window.byChannel.email).toBe(2);
    expect(pd.calls[0].window.byChannel.sms).toBe(1);
    expect(pd.calls[0].cumulative.totalCount).toBe(3);
    expect(pd.calls[0].cumulative.byChannel.email).toBe(2);
    expect(pd.calls[0].cumulative.byChannel.sms).toBe(1);
  });

  it("throttles repeated fires inside the throttle window", async () => {
    recordN("email", 3);
    await evaluateCommsDedupFailureAlert();
    expect(pd.calls).toHaveLength(1);

    // Immediate re-evaluation while still over threshold should NOT re-page —
    // the per-channel throttle keeps a sustained outage from spamming on-call.
    recordN("email", 3, 50);
    const second = await evaluateCommsDedupFailureAlert();
    expect(pd.calls).toHaveLength(1);
    expect(
      second.some((r) => r.channel === "pagerduty" && r.skipped && r.reason === "throttled"),
    ).toBe(true);
  });

  it("clears the alert once the window goes quiet for the recovery window", async () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-06-17T00:00:00Z").getTime();
    vi.setSystemTime(t0);

    recordN("email", 3);
    await evaluateCommsDedupFailureAlert(t0);
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

    // Advance past both the rolling window (15m) AND the recovery window (10m)
    // so no in-window failures remain and quietFor > recovery.
    const t1 = t0 + 30 * 60 * 1000;
    vi.setSystemTime(t1);
    await evaluateCommsDedupFailureAlert(t1);

    const clears = pd.calls.filter((c) => c.kind === "clear");
    expect(clears).toHaveLength(1);
    expect(getCommsDedupFailureAlertingState().alerting).toBe(false);
  });

  it("getCommsDedupFailuresInWindow excludes events outside the window", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    recordN("email", 3);

    // Move 20 minutes forward — events should fall out of a 10-minute window.
    const t1 = t0 + 20 * 60 * 1000;
    vi.setSystemTime(t1);
    recordN("sms", 2, 50);

    const tenMin = getCommsDedupFailuresInWindow(10 * 60 * 1000, t1);
    expect(tenMin.totalCount).toBe(2);
    expect(tenMin.byChannel.sms).toBe(2);
    expect(tenMin.byChannel.email).toBeUndefined();

    const thirtyMin = getCommsDedupFailuresInWindow(30 * 60 * 1000, t1);
    expect(thirtyMin.totalCount).toBe(5);

    const cumulative = getCommsDedupFailureCumulativeStats();
    expect(cumulative.totalCount).toBe(5);
    expect(cumulative.byChannel.email).toBe(3);
    expect(cumulative.byChannel.sms).toBe(2);
  });

  it("does not consume the throttle slot for channels with no provider configured", async () => {
    // No delivery overrides → fall back to the real deliveries, which skip
    // when their env vars are unset. A skipped delivery must NOT gate the next
    // fire, so a later evaluation (after the provider is configured) can page.
    __setCommsDedupFailureAlerterDeliveriesForTests(null);
    delete process.env.PAGERDUTY_INTEGRATION_KEY;
    delete process.env.OPS_ALERT_EMAIL;
    delete process.env.OPS_ALERT_SLACK_WEBHOOK_URL;

    recordN("email", 3);
    const results = await evaluateCommsDedupFailureAlert();
    expect(results.every((r) => r.ok && r.skipped)).toBe(true);
    // State still flips to alerting even though every channel was a no-op.
    expect(getCommsDedupFailureAlertingState().alerting).toBe(true);
  });
});
