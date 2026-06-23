import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  evaluateRetellAgentAlert,
  getRetellAgentAlertingState,
  __resetRetellAgentAlerterForTests,
  __setRetellAgentAlerterDeliveriesForTests,
  type RetellAgentAlertPayload,
  type DeliveryResult,
} from "../lib/retell-agent-alerter";
import {
  setCachedRetellSetupResult,
  type RetellSetupResult,
} from "../lib/retell-agent-setup";

interface StubDelivery {
  fn: (p: RetellAgentAlertPayload) => Promise<DeliveryResult>;
  calls: RetellAgentAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: RetellAgentAlertPayload[] = [];
  const fn = vi.fn(
    async (p: RetellAgentAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

const stamp = "2026-06-23T00:00:00.000Z";

/** A "configured but broken" setup result → verdict "misconfigured". */
const MISCONFIGURED: RetellSetupResult = {
  skipped: true,
  reason: `RETELL_AGENT_ID must start with "agent_" (got "llm_abc123…")`,
  ranAt: stamp,
};

/** A healthy setup result → verdict "healthy". */
const HEALTHY: RetellSetupResult = {
  skipped: false,
  reason: "KB tool and prompt already match — no changes needed",
  ranAt: stamp,
};

/** Voice intentionally off → verdict "not_configured" (must NOT page). */
const NOT_CONFIGURED: RetellSetupResult = {
  skipped: true,
  reason: "RETELL_API_KEY or RETELL_AGENT_ID not configured",
  ranAt: stamp,
};

describe("retell-agent-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetRetellAgentAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setRetellAgentAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setCachedRetellSetupResult(MISCONFIGURED);
  });

  afterEach(() => {
    __setRetellAgentAlerterDeliveriesForTests(null);
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("fires a 'fire' alert on every channel when the agent is misconfigured", async () => {
    await evaluateRetellAgentAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(pd.calls[0].status).toBe("misconfigured");
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].kind).toBe("fire");
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].kind).toBe("fire");
    expect(getRetellAgentAlertingState().alerting).toBe(true);
  });

  it("does not page when the agent is intentionally not configured", async () => {
    setCachedRetellSetupResult(NOT_CONFIGURED);

    const results = await evaluateRetellAgentAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
    expect(getRetellAgentAlertingState().alerting).toBe(false);
  });

  it("does not page when the setup has not reported a result yet (unknown)", async () => {
    setCachedRetellSetupResult(null as unknown as RetellSetupResult);

    const results = await evaluateRetellAgentAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
  });

  it("does not re-fire while the agent stays misconfigured", async () => {
    await evaluateRetellAgentAlert();
    expect(pd.calls).toHaveLength(1);

    // Polling repeats — state hasn't transitioned, no second fire.
    await evaluateRetellAgentAlert();
    await evaluateRetellAgentAlert();
    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("sends an 'all clear' alert when the agent recovers", async () => {
    await evaluateRetellAgentAlert();
    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");

    setCachedRetellSetupResult(HEALTHY);
    await evaluateRetellAgentAlert();

    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].kind).toBe("clear");
    expect(pd.calls[1].status).toBe("healthy");
    expect(email.calls[1].kind).toBe("clear");
    expect(slack.calls[1].kind).toBe("clear");
    expect(getRetellAgentAlertingState().alerting).toBe(false);
  });

  it("clears when a misconfigured agent is turned off (becomes not_configured)", async () => {
    await evaluateRetellAgentAlert();
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

    setCachedRetellSetupResult(NOT_CONFIGURED);
    await evaluateRetellAgentAlert();

    expect(pd.calls.filter((c) => c.kind === "clear")).toHaveLength(1);
  });

  it("re-fires after a recovery once a new outage transitions in", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    await evaluateRetellAgentAlert();

    // Recover.
    setCachedRetellSetupResult(HEALTHY);
    await evaluateRetellAgentAlert();

    // Wait past the per-delivery throttle window before the next outage.
    vi.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    setCachedRetellSetupResult(MISCONFIGURED);
    await evaluateRetellAgentAlert();

    const fires = pd.calls.filter((c) => c.kind === "fire");
    const clears = pd.calls.filter((c) => c.kind === "clear");
    expect(fires).toHaveLength(2);
    expect(clears).toHaveLength(1);
  });

  it("throttles a re-fire that happens within the per-delivery throttle window", async () => {
    const prev = process.env.RETELL_AGENT_NOTIFICATION_THROTTLE_MS;
    process.env.RETELL_AGENT_NOTIFICATION_THROTTLE_MS = String(
      24 * 60 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      await evaluateRetellAgentAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // Recover, then immediately go bad again — well inside the 24h throttle.
      setCachedRetellSetupResult(HEALTHY);
      await evaluateRetellAgentAlert();
      vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
      setCachedRetellSetupResult(MISCONFIGURED);
      const results = await evaluateRetellAgentAlert();

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
        delete process.env.RETELL_AGENT_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.RETELL_AGENT_NOTIFICATION_THROTTLE_MS = prev;
      }
    }
  });

  it("does not let a single delivery failure block other deliveries", async () => {
    __setRetellAgentAlerterDeliveriesForTests({
      pagerduty: async () => {
        throw new Error("pd boom");
      },
      email: email.fn,
      slack: slack.fn,
    });

    const results = await evaluateRetellAgentAlert();

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
    __setRetellAgentAlerterDeliveriesForTests({
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

    const a = evaluateRetellAgentAlert();
    const b = evaluateRetellAgentAlert();
    release();
    const [resA, resB] = await Promise.all([a, b]);

    const dispatched = [resA, resB].filter((r) => r.length > 0);
    expect(dispatched).toHaveLength(1);
    expect(pdMaxInflight).toBe(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("treats unconfigured providers as skipped without consuming the throttle slot", async () => {
    __setRetellAgentAlerterDeliveriesForTests({
      pagerduty: async () => ({
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: email.fn,
      slack: slack.fn,
    });

    const r1 = await evaluateRetellAgentAlert();
    const pd1 = r1.find((r) => r.channel === "pagerduty");
    expect(pd1?.skipped).toBe(true);
    expect(pd1?.reason).toBe("not_configured");

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });
});
