import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { statusMock } = vi.hoisted(() => {
  const statusMock = vi.fn();
  return { statusMock };
});

vi.mock("../lib/abuse-rate-limit-cleanup", () => ({
  getAbuseRateLimitCleanupStatus: statusMock,
}));

import {
  evaluateAbuseRateLimitCleanupAlert,
  __resetAbuseRateLimitCleanupAlerterForTests,
  __setAbuseRateLimitCleanupAlerterDeliveriesForTests,
  type AbuseRateLimitCleanupAlertPayload,
  type DeliveryResult,
} from "../lib/abuse-rate-limit-cleanup-alerter";

interface StubDelivery {
  fn: (p: AbuseRateLimitCleanupAlertPayload) => Promise<DeliveryResult>;
  calls: AbuseRateLimitCleanupAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: AbuseRateLimitCleanupAlertPayload[] = [];
  const fn = vi.fn(
    async (p: AbuseRateLimitCleanupAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

function setStatus(opts: {
  enabled?: boolean;
  stale?: boolean;
  lastRanAt?: string | null;
  lastError?: { at: string; message: string } | null;
}): void {
  statusMock.mockResolvedValue({
    enabled: opts.enabled ?? true,
    intervalMs: 60 * 60 * 1000,
    lastRanAt: opts.lastRanAt ?? null,
    lastResult: null,
    lastError: opts.lastError ?? null,
    stale: opts.stale ?? false,
  });
}

describe("abuse-rate-limit-cleanup-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetAbuseRateLimitCleanupAlerterForTests();
    statusMock.mockReset();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setAbuseRateLimitCleanupAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setAbuseRateLimitCleanupAlerterDeliveriesForTests(null);
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("fires a 'fire' alert on every channel when the sweep is stale", async () => {
    setStatus({ enabled: true, stale: true, lastRanAt: null });

    await evaluateAbuseRateLimitCleanupAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].kind).toBe("fire");
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].kind).toBe("fire");
  });

  it("is a no-op when the cleanup job is disabled (no REDIS_URL)", async () => {
    setStatus({ enabled: false, stale: true });

    const results = await evaluateAbuseRateLimitCleanupAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
  });

  it("is a no-op while the sweep is fresh", async () => {
    setStatus({ enabled: true, stale: false, lastRanAt: new Date().toISOString() });

    const results = await evaluateAbuseRateLimitCleanupAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
  });

  it("does not re-fire while the sweep stays stale", async () => {
    setStatus({ enabled: true, stale: true });

    await evaluateAbuseRateLimitCleanupAlert();
    expect(pd.calls).toHaveLength(1);

    // Polling repeats — state hasn't transitioned, no second fire.
    await evaluateAbuseRateLimitCleanupAlert();
    await evaluateAbuseRateLimitCleanupAlert();
    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("sends an 'all clear' alert when the sweep recovers", async () => {
    setStatus({ enabled: true, stale: true });
    await evaluateAbuseRateLimitCleanupAlert();
    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");

    setStatus({
      enabled: true,
      stale: false,
      lastRanAt: new Date().toISOString(),
    });
    await evaluateAbuseRateLimitCleanupAlert();

    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].kind).toBe("clear");
    expect(email.calls[1].kind).toBe("clear");
    expect(slack.calls[1].kind).toBe("clear");
  });

  it("re-fires after a recovery once a new outage transitions in", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    setStatus({ enabled: true, stale: true });
    await evaluateAbuseRateLimitCleanupAlert();

    // Recover.
    setStatus({
      enabled: true,
      stale: false,
      lastRanAt: "2026-01-01T00:30:00Z",
    });
    await evaluateAbuseRateLimitCleanupAlert();

    // Wait past the per-delivery throttle window before the next outage.
    vi.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    setStatus({ enabled: true, stale: true });
    await evaluateAbuseRateLimitCleanupAlert();

    const fires = pd.calls.filter((c) => c.kind === "fire");
    const clears = pd.calls.filter((c) => c.kind === "clear");
    expect(fires).toHaveLength(2);
    expect(clears).toHaveLength(1);
  });

  it("throttles a re-fire that happens within the per-delivery throttle window", async () => {
    const prev = process.env.ABUSE_RATE_LIMIT_CLEANUP_NOTIFICATION_THROTTLE_MS;
    process.env.ABUSE_RATE_LIMIT_CLEANUP_NOTIFICATION_THROTTLE_MS = String(
      24 * 60 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      setStatus({ enabled: true, stale: true });
      await evaluateAbuseRateLimitCleanupAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // Recover, then immediately go bad again — well inside the 24h throttle.
      setStatus({
        enabled: true,
        stale: false,
        lastRanAt: "2026-01-01T00:01:00Z",
      });
      await evaluateAbuseRateLimitCleanupAlert();
      vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
      setStatus({ enabled: true, stale: true });
      const results = await evaluateAbuseRateLimitCleanupAlert();

      // No NEW "fire" delivery on any channel.
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(email.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(slack.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      const throttled = results.filter(
        (r) => r.skipped && r.reason === "throttled",
      );
      expect(throttled).toHaveLength(3);
    } finally {
      if (prev === undefined) {
        delete process.env.ABUSE_RATE_LIMIT_CLEANUP_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.ABUSE_RATE_LIMIT_CLEANUP_NOTIFICATION_THROTTLE_MS = prev;
      }
    }
  });

  it("does not let a single delivery failure block other deliveries", async () => {
    setStatus({ enabled: true, stale: true });
    __setAbuseRateLimitCleanupAlerterDeliveriesForTests({
      pagerduty: async () => {
        throw new Error("pd boom");
      },
      email: email.fn,
      slack: slack.fn,
    });

    const results = await evaluateAbuseRateLimitCleanupAlert();

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    const pdResult = results.find((r) => r.channel === "pagerduty");
    expect(pdResult?.ok).toBe(false);
    expect(pdResult?.reason).toContain("pd boom");
  });

  it("does not double-fire when two evaluations race on the same first-time outage", async () => {
    setStatus({ enabled: true, stale: true });

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let pdInflight = 0;
    let pdMaxInflight = 0;
    __setAbuseRateLimitCleanupAlerterDeliveriesForTests({
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

    const a = evaluateAbuseRateLimitCleanupAlert();
    const b = evaluateAbuseRateLimitCleanupAlert();
    release();
    const [resA, resB] = await Promise.all([a, b]);

    const dispatched = [resA, resB].filter((r) => r.length > 0);
    expect(dispatched).toHaveLength(1);
    expect(pdMaxInflight).toBe(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("treats unconfigured providers as skipped without consuming the throttle slot", async () => {
    setStatus({ enabled: true, stale: true });
    __setAbuseRateLimitCleanupAlerterDeliveriesForTests({
      pagerduty: async () => ({
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: email.fn,
      slack: slack.fn,
    });

    const r1 = await evaluateAbuseRateLimitCleanupAlert();
    const pd1 = r1.find((r) => r.channel === "pagerduty");
    expect(pd1?.skipped).toBe(true);
    expect(pd1?.reason).toBe("not_configured");

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("includes the System Health link reference in the fire payload", async () => {
    setStatus({
      enabled: true,
      stale: true,
      lastRanAt: "2026-01-01T00:00:00.000Z",
      lastError: { at: "2026-01-01T01:30:00.000Z", message: "redis down" },
    });

    await evaluateAbuseRateLimitCleanupAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].status.lastRanAt).toBe("2026-01-01T00:00:00.000Z");
    expect(pd.calls[0].status.lastError?.message).toBe("redis down");
  });
});
