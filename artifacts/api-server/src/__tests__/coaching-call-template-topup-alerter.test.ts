import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The alerter reads its input purely through `getCoachingCallTemplateTopUpStatus`,
// so we mock the status module and drive the transition logic directly. This
// keeps the test DB-free and lets us assert exactly when on-call is paged.
const { statusMock } = vi.hoisted(() => {
  const statusMock = vi.fn();
  return { statusMock };
});

vi.mock("../lib/coaching-call-template-topup", () => ({
  getCoachingCallTemplateTopUpHealth: statusMock,
}));

import {
  evaluateCoachingCallTopUpAlert,
  __resetCoachingCallTopUpAlerterForTests,
  __setCoachingCallTopUpAlerterDeliveriesForTests,
  type CoachingCallTopUpAlertPayload,
  type DeliveryResult,
} from "../lib/coaching-call-template-topup-alerter";

interface StubDelivery {
  fn: (p: CoachingCallTopUpAlertPayload) => Promise<DeliveryResult>;
  calls: CoachingCallTopUpAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: CoachingCallTopUpAlertPayload[] = [];
  const fn = vi.fn(
    async (p: CoachingCallTopUpAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

function setStatus(opts: {
  stale?: boolean;
  lastRanAt?: string | null;
  lastSuccessfulRunAt?: string | null;
  lastError?: { at: string; message: string } | null;
}): void {
  statusMock.mockReturnValue({
    intervalMs: 24 * 60 * 60 * 1000,
    lastRanAt: opts.lastRanAt ?? null,
    lastSuccessfulRunAt: opts.lastSuccessfulRunAt ?? null,
    lastResult: null,
    lastError: opts.lastError ?? null,
    stale: opts.stale ?? false,
  });
}

describe("coaching-call-template-topup-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetCoachingCallTopUpAlerterForTests();
    statusMock.mockReset();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setCoachingCallTopUpAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setCoachingCallTopUpAlerterDeliveriesForTests(null);
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("fires a 'fire' alert on every channel when the job is stale", async () => {
    setStatus({ stale: true, lastSuccessfulRunAt: null });

    await evaluateCoachingCallTopUpAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].kind).toBe("fire");
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].kind).toBe("fire");
  });

  it("carries the 'erroring every run' cause through to the payload", async () => {
    setStatus({
      stale: true,
      lastRanAt: "2026-06-18T00:00:00.000Z",
      lastSuccessfulRunAt: "2026-06-10T00:00:00.000Z",
      lastError: { at: "2026-06-18T00:00:00.000Z", message: "generate boom" },
    });

    await evaluateCoachingCallTopUpAlert();

    expect(pd.calls[0].status.lastError?.message).toBe("generate boom");
  });

  it("is a no-op while the job is fresh", async () => {
    setStatus({
      stale: false,
      lastSuccessfulRunAt: new Date().toISOString(),
    });

    const results = await evaluateCoachingCallTopUpAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
  });

  it("does not re-fire while the job stays stale", async () => {
    setStatus({ stale: true });

    await evaluateCoachingCallTopUpAlert();
    const second = await evaluateCoachingCallTopUpAlert();

    // Second evaluation sees `alerting` already true and short-circuits.
    expect(second).toEqual([]);
    expect(pd.calls).toHaveLength(1);
  });

  it("sends a 'clear' once a fresh successful run lands after a fire", async () => {
    setStatus({ stale: true });
    await evaluateCoachingCallTopUpAlert();
    expect(pd.calls[0].kind).toBe("fire");

    setStatus({
      stale: false,
      lastSuccessfulRunAt: new Date().toISOString(),
    });
    await evaluateCoachingCallTopUpAlert();

    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].kind).toBe("clear");
    expect(slack.calls[1].kind).toBe("clear");
  });

  it("re-fires on a fresh stale->fresh->stale cycle but throttles the second page", async () => {
    const t0 = 1_000_000;

    // First stale period fires.
    setStatus({ stale: true });
    await evaluateCoachingCallTopUpAlert(t0);
    expect(pd.calls).toHaveLength(1);

    // Recover (clear), then go stale again 10 minutes later — inside the
    // default 1h throttle window. The transition flips so dispatch is
    // attempted, but the per-channel throttle suppresses the actual send.
    setStatus({ stale: false, lastSuccessfulRunAt: new Date(t0).toISOString() });
    await evaluateCoachingCallTopUpAlert(t0 + 60_000);
    expect(pd.calls).toHaveLength(2); // the clear

    setStatus({ stale: true });
    const results = await evaluateCoachingCallTopUpAlert(t0 + 10 * 60 * 1000);

    // No new fire delivery — throttled within the window.
    const fires = pd.calls.filter((c) => c.kind === "fire");
    expect(fires).toHaveLength(1);
    expect(results.find((r) => r.channel === "pagerduty")?.reason).toBe(
      "throttled",
    );
  });
});
