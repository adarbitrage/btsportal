import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

import {
  evaluateLiveChatEmbedProbe,
  getLiveChatEmbedProbeState,
  __resetLiveChatEmbedProbeForTests,
  __setLiveChatEmbedProbeDeliveriesForTests,
  __setLiveChatEmbedProbeFetchForTests,
  type DeliveryResult,
  type LiveChatEmbedAlertPayload,
} from "../lib/live-chat-embed-probe";

type AlertKind = "fire" | "clear";

const ALLOWED = ["buildtestscale.com"];

/** A Headers-like reader backed by a plain object (case-insensitive). */
function headers(map: Record<string, string>): Headers {
  return new Headers(map);
}

/** Build a fetch stub that returns the given status + headers once per call. */
function fetchReturning(status: number, hdrs: Record<string, string>): typeof fetch {
  return (async () =>
    new Response("ok", { status, headers: new Headers(hdrs) })) as unknown as typeof fetch;
}

function fetchThrowing(message: string): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;
}

interface StubDelivery {
  fn: (p: LiveChatEmbedAlertPayload) => Promise<DeliveryResult>;
  calls: LiveChatEmbedAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: LiveChatEmbedAlertPayload[] = [];
  const fn = vi.fn(async (p: LiveChatEmbedAlertPayload): Promise<DeliveryResult> => {
    calls.push(p);
    return { channel, ok: true };
  });
  return { fn, calls };
}

describe("Live Chat embed probe state machine", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetLiveChatEmbedProbeForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setLiveChatEmbedProbeDeliveriesForTests({ pagerduty: pd.fn, email: email.fn, slack: slack.fn });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    __resetLiveChatEmbedProbeForTests();
    logSpy?.mockRestore();
    errSpy?.mockRestore();
  });

  it("stays quiet and reports ok when the embed loads cleanly", async () => {
    __setLiveChatEmbedProbeFetchForTests(fetchReturning(200, {}));
    const { outcome, deliveries } = await evaluateLiveChatEmbedProbe();
    expect(outcome.status).toBe("ok");
    expect(deliveries).toEqual([]);
    const state = getLiveChatEmbedProbeState();
    expect(state.status).toBe("ok");
    expect(state.alerting).toBe(false);
    expect(state.consecutiveBlocked).toBe(0);
  });

  it("does not page until blocked for `threshold` consecutive probes, then fires once", async () => {
    __setLiveChatEmbedProbeFetchForTests(fetchReturning(200, { "x-frame-options": "DENY" }));

    // threshold defaults to 3.
    await evaluateLiveChatEmbedProbe();
    expect(pd.calls.length).toBe(0);
    expect(getLiveChatEmbedProbeState().alerting).toBe(false);

    await evaluateLiveChatEmbedProbe();
    expect(pd.calls.length).toBe(0);

    const { deliveries } = await evaluateLiveChatEmbedProbe();
    expect(pd.calls.length).toBe(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(email.calls.length).toBe(1);
    expect(slack.calls.length).toBe(1);
    expect(deliveries.some((d) => d.channel === "pagerduty" && d.ok)).toBe(true);

    const state = getLiveChatEmbedProbeState();
    expect(state.status).toBe("blocked");
    expect(state.alerting).toBe(true);
    expect(state.consecutiveBlocked).toBe(3);
    expect(state.reasons).toContain("X-Frame-Options: DENY");
  });

  it("a single transient unreachable does NOT trip the alarm (resilience)", async () => {
    // Two blocked probes, then a transient outage, then a fourth blocked probe.
    // Without resilience this would be 3 blocked-in-a-row at the third call and
    // fire; instead the unreachable must not count toward the streak.
    __setLiveChatEmbedProbeFetchForTests(fetchReturning(200, { "x-frame-options": "DENY" }));
    await evaluateLiveChatEmbedProbe(); // blocked #1
    await evaluateLiveChatEmbedProbe(); // blocked #2
    expect(getLiveChatEmbedProbeState().consecutiveBlocked).toBe(2);

    __setLiveChatEmbedProbeFetchForTests(fetchThrowing("ECONNRESET"));
    await evaluateLiveChatEmbedProbe(); // unreachable — inconclusive
    let state = getLiveChatEmbedProbeState();
    expect(state.status).toBe("unreachable");
    expect(state.consecutiveBlocked).toBe(2); // unchanged
    expect(state.consecutiveUnreachable).toBe(1);
    expect(pd.calls.length).toBe(0); // no page

    __setLiveChatEmbedProbeFetchForTests(fetchReturning(200, { "x-frame-options": "DENY" }));
    await evaluateLiveChatEmbedProbe(); // blocked #3 (streak continues from 2)
    state = getLiveChatEmbedProbeState();
    expect(state.consecutiveBlocked).toBe(3);
    expect(pd.calls.length).toBe(1); // now it fires
  });

  it("treats a 5xx as unreachable, not ok", async () => {
    __setLiveChatEmbedProbeFetchForTests(fetchReturning(503, {}));
    const { outcome } = await evaluateLiveChatEmbedProbe();
    expect(outcome.status).toBe("unreachable");
    expect(getLiveChatEmbedProbeState().consecutiveUnreachable).toBe(1);
  });

  it("clears the alert once the embed recovers", async () => {
    __setLiveChatEmbedProbeFetchForTests(fetchReturning(200, { "content-security-policy": "frame-ancestors 'none'" }));
    await evaluateLiveChatEmbedProbe();
    await evaluateLiveChatEmbedProbe();
    await evaluateLiveChatEmbedProbe();
    expect(getLiveChatEmbedProbeState().alerting).toBe(true);
    const fireCalls = pd.calls.length;

    __setLiveChatEmbedProbeFetchForTests(fetchReturning(200, {}));
    const { deliveries } = await evaluateLiveChatEmbedProbe();
    const state = getLiveChatEmbedProbeState();
    expect(state.status).toBe("ok");
    expect(state.alerting).toBe(false);
    expect(state.consecutiveBlocked).toBe(0);
    expect(pd.calls.length).toBe(fireCalls + 1);
    expect(pd.calls[pd.calls.length - 1].kind).toBe("clear");
    expect(deliveries.some((d) => d.channel === "pagerduty" && d.ok)).toBe(true);
  });

  it("does not re-page on every poll while still blocked (throttled)", async () => {
    __setLiveChatEmbedProbeFetchForTests(fetchReturning(200, { "x-frame-options": "DENY" }));
    await evaluateLiveChatEmbedProbe();
    await evaluateLiveChatEmbedProbe();
    await evaluateLiveChatEmbedProbe(); // fires
    expect(pd.calls.length).toBe(1);

    // Two more blocked polls within the throttle window — no extra pages.
    await evaluateLiveChatEmbedProbe();
    await evaluateLiveChatEmbedProbe();
    expect(pd.calls.length).toBe(1);
  });
});
