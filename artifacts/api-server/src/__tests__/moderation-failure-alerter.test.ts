import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  recordModerationFailure,
  getModerationFailuresInWindow,
  getModerationFailureCumulativeStats,
  __resetModerationFailureTrackerForTests,
} from "../lib/moderation/failure-tracker";
import {
  evaluateModerationFailureAlert,
  getModerationFailureAlertingState,
  __resetModerationFailureAlerterForTests,
  __setModerationFailureAlerterDeliveriesForTests,
  type DeliveryResult,
  type ModerationFailureAlertPayload,
} from "../lib/moderation/failure-alerter";

vi.mock("../lib/moderation/failure-alert-settings", () => {
  let threshold = 5;
  let windowMinutes = 15;
  return {
    MODERATION_FAILURE_ALERT_DEFAULTS: { threshold: 5, windowMinutes: 15 },
    getModerationFailureAlertConfig: vi.fn(async () => ({ threshold, windowMinutes })),
    __setForTests: (t: number, w: number) => {
      threshold = t;
      windowMinutes = w;
    },
  };
});

interface StubDelivery {
  fn: (p: ModerationFailureAlertPayload) => Promise<DeliveryResult>;
  calls: ModerationFailureAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: ModerationFailureAlertPayload[] = [];
  const fn = vi.fn(async (p: ModerationFailureAlertPayload): Promise<DeliveryResult> => {
    calls.push(p);
    return { channel, ok: true };
  });
  return { fn, calls };
}

function recordN(kind: "engine" | "persist", n: number, baseId = 1): void {
  for (let i = 0; i < n; i++) {
    recordModerationFailure(kind, new Error(`boom ${i}`), {
      targetType: "post",
      targetId: baseId + i,
    });
  }
}

describe("moderation-failure-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetModerationFailureTrackerForTests();
    __resetModerationFailureAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setModerationFailureAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setModerationFailureAlerterDeliveriesForTests(null);
    warnSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("is a no-op when no failures have been recorded", async () => {
    const results = await evaluateModerationFailureAlert();
    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
    expect(getModerationFailureAlertingState().alerting).toBe(false);
  });

  it("does not fire below the configured threshold", async () => {
    // Default threshold is 5 — record 4 and confirm we stay quiet.
    recordN("engine", 4);
    const results = await evaluateModerationFailureAlert();
    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(getModerationFailureAlertingState().alerting).toBe(false);
  });

  it("fires on every channel once the rolling window crosses the threshold", async () => {
    recordN("engine", 5);
    await evaluateModerationFailureAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(pd.calls[0].window.totalCount).toBe(5);
    expect(pd.calls[0].window.byKind.engine).toBe(5);
    expect(pd.calls[0].window.byKind.persist).toBe(0);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    expect(getModerationFailureAlertingState().alerting).toBe(true);
  });

  it("tracks engine vs persist failures separately in the fire payload", async () => {
    recordN("engine", 3);
    recordN("persist", 2, 100);
    await evaluateModerationFailureAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].window.totalCount).toBe(5);
    expect(pd.calls[0].window.byKind.engine).toBe(3);
    expect(pd.calls[0].window.byKind.persist).toBe(2);
    expect(pd.calls[0].cumulative.byKind.engine).toBe(3);
    expect(pd.calls[0].cumulative.byKind.persist).toBe(2);
  });

  it("throttles repeated fires inside the throttle window", async () => {
    recordN("engine", 5);
    await evaluateModerationFailureAlert();
    expect(pd.calls).toHaveLength(1);

    // Immediate re-evaluation while still over threshold should NOT
    // re-page — the per-channel throttle keeps a sustained outage from
    // spamming on-call.
    recordN("engine", 5, 50);
    const second = await evaluateModerationFailureAlert();
    expect(pd.calls).toHaveLength(1);
    expect(second.some((r) => r.channel === "pagerduty" && r.skipped && r.reason === "throttled")).toBe(true);
  });

  it("clears the alert once the window goes quiet for the recovery window", async () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-05-27T00:00:00Z").getTime();
    vi.setSystemTime(t0);

    recordN("persist", 5);
    await evaluateModerationFailureAlert(t0);
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

    // Advance past both the rolling window (15m) AND the recovery
    // window (10m) so no in-window failures remain and quietFor > recovery.
    const t1 = t0 + 30 * 60 * 1000;
    vi.setSystemTime(t1);
    await evaluateModerationFailureAlert(t1);

    const clears = pd.calls.filter((c) => c.kind === "clear");
    expect(clears).toHaveLength(1);
    expect(getModerationFailureAlertingState().alerting).toBe(false);
  });

  it("getModerationFailuresInWindow excludes events outside the window", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    recordN("engine", 3);

    // Move 20 minutes forward — events should fall out of a 10-minute window.
    const t1 = t0 + 20 * 60 * 1000;
    vi.setSystemTime(t1);
    recordN("persist", 2, 50);

    const tenMin = getModerationFailuresInWindow(10 * 60 * 1000, t1);
    expect(tenMin.totalCount).toBe(2);
    expect(tenMin.byKind.persist).toBe(2);
    expect(tenMin.byKind.engine).toBe(0);

    const thirtyMin = getModerationFailuresInWindow(30 * 60 * 1000, t1);
    expect(thirtyMin.totalCount).toBe(5);

    const cumulative = getModerationFailureCumulativeStats();
    expect(cumulative.totalCount).toBe(5);
    expect(cumulative.byKind.engine).toBe(3);
    expect(cumulative.byKind.persist).toBe(2);
  });
});
