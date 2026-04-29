import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  evaluateSignupChallengeAlert,
  __resetSignupChallengeAlerterForTests,
  __setSignupChallengeAlerterDeliveriesForTests,
  type SignupChallengeAlertPayload,
  type DeliveryResult,
} from "../lib/signup-challenge-alerter";

interface StubDelivery {
  fn: (p: SignupChallengeAlertPayload) => Promise<DeliveryResult>;
  calls: SignupChallengeAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: SignupChallengeAlertPayload[] = [];
  const fn = vi.fn(
    async (p: SignupChallengeAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

describe("signup-challenge-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;

  beforeEach(() => {
    __resetSignupChallengeAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setSignupChallengeAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  afterEach(() => {
    __setSignupChallengeAlerterDeliveriesForTests(null);
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalSecret === undefined) {
      delete process.env.TURNSTILE_SECRET_KEY;
    } else {
      process.env.TURNSTILE_SECRET_KEY = originalSecret;
    }
    vi.useRealTimers();
  });

  it("fires a 'fire' alert on every channel when the secret is missing in production", async () => {
    await evaluateSignupChallengeAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].kind).toBe("fire");
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].kind).toBe("fire");
  });

  it("is a no-op outside production even when the secret is missing", async () => {
    process.env.NODE_ENV = "development";

    const results = await evaluateSignupChallengeAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
  });

  it("treats a whitespace-only secret as disabled", async () => {
    process.env.TURNSTILE_SECRET_KEY = "   ";

    await evaluateSignupChallengeAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
  });

  it("does not re-fire while the challenge stays disabled", async () => {
    await evaluateSignupChallengeAlert();
    expect(pd.calls).toHaveLength(1);

    // Polling repeats — state hasn't transitioned, no second fire.
    await evaluateSignupChallengeAlert();
    await evaluateSignupChallengeAlert();
    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("sends an 'all clear' alert when the secret is restored", async () => {
    await evaluateSignupChallengeAlert();
    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");

    process.env.TURNSTILE_SECRET_KEY = "real-secret";
    await evaluateSignupChallengeAlert();

    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].kind).toBe("clear");
    expect(email.calls[1].kind).toBe("clear");
    expect(slack.calls[1].kind).toBe("clear");
  });

  it("re-fires after a recovery once a new outage transitions in", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    await evaluateSignupChallengeAlert();

    // Recover.
    process.env.TURNSTILE_SECRET_KEY = "real-secret";
    await evaluateSignupChallengeAlert();

    // Wait past the per-delivery throttle window before the next outage.
    vi.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    delete process.env.TURNSTILE_SECRET_KEY;
    await evaluateSignupChallengeAlert();

    const fires = pd.calls.filter((c) => c.kind === "fire");
    const clears = pd.calls.filter((c) => c.kind === "clear");
    expect(fires).toHaveLength(2);
    expect(clears).toHaveLength(1);
  });

  it("throttles a re-fire that happens within the per-delivery throttle window", async () => {
    const prev = process.env.SIGNUP_CHALLENGE_NOTIFICATION_THROTTLE_MS;
    process.env.SIGNUP_CHALLENGE_NOTIFICATION_THROTTLE_MS = String(
      24 * 60 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      await evaluateSignupChallengeAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // Recover, then immediately go bad again — well inside the 24h throttle.
      process.env.TURNSTILE_SECRET_KEY = "real-secret";
      await evaluateSignupChallengeAlert();
      vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
      delete process.env.TURNSTILE_SECRET_KEY;
      const results = await evaluateSignupChallengeAlert();

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
        delete process.env.SIGNUP_CHALLENGE_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.SIGNUP_CHALLENGE_NOTIFICATION_THROTTLE_MS = prev;
      }
    }
  });

  it("does not let a single delivery failure block other deliveries", async () => {
    __setSignupChallengeAlerterDeliveriesForTests({
      pagerduty: async () => {
        throw new Error("pd boom");
      },
      email: email.fn,
      slack: slack.fn,
    });

    const results = await evaluateSignupChallengeAlert();

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    const pdResult = results.find((r) => r.channel === "pagerduty");
    expect(pdResult?.ok).toBe(false);
    expect(pdResult?.reason).toContain("pd boom");
  });

  it("does not double-fire when two evaluations race on the same first-time outage", async () => {
    // Simulate the route-level fire-and-forget dispatch arriving at the
    // same moment as the background poll. Both call evaluate() before either
    // has finished awaiting dispatchAll. The state flag is flipped
    // synchronously, so only one call should reach the delivery functions.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let pdInflight = 0;
    let pdMaxInflight = 0;
    __setSignupChallengeAlerterDeliveriesForTests({
      pagerduty: async (p) => {
        pdInflight += 1;
        pdMaxInflight = Math.max(pdMaxInflight, pdInflight);
        await gate;
        pdInflight -= 1;
        return { channel: "pagerduty", ok: true };
      },
      email: email.fn,
      slack: slack.fn,
    });

    const a = evaluateSignupChallengeAlert();
    const b = evaluateSignupChallengeAlert();
    release();
    const [resA, resB] = await Promise.all([a, b]);

    // Exactly one of the two evaluations actually dispatched.
    const dispatched = [resA, resB].filter((r) => r.length > 0);
    expect(dispatched).toHaveLength(1);
    expect(pdMaxInflight).toBe(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("treats unconfigured providers as skipped without consuming the throttle slot", async () => {
    __setSignupChallengeAlerterDeliveriesForTests({
      pagerduty: async () => ({
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: email.fn,
      slack: slack.fn,
    });

    const r1 = await evaluateSignupChallengeAlert();
    const pd1 = r1.find((r) => r.channel === "pagerduty");
    expect(pd1?.skipped).toBe(true);
    expect(pd1?.reason).toBe("not_configured");

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });
});
