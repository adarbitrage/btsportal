import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

import {
  evaluateTicketDeskDeliveryProbe,
  getTicketDeskDeliveryProbeState,
  __resetTicketDeskDeliveryProbeForTests,
  __setTicketDeskDeliveryProbeDeliveriesForTests,
  __setTicketDeskDeliveryProbeFetchForTests,
  type DeliveryResult,
  type TicketDeskDeliveryAlertPayload,
} from "../lib/ticketdesk-delivery-probe";

/** Build a fetch stub that returns the given status + body once per call. */
function fetchReturning(status: number, body = "ok"): typeof fetch {
  return (async () =>
    new Response(body, { status })) as unknown as typeof fetch;
}

function fetchThrowing(message: string): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;
}

interface StubDelivery {
  fn: (p: TicketDeskDeliveryAlertPayload) => Promise<DeliveryResult>;
  calls: TicketDeskDeliveryAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: TicketDeskDeliveryAlertPayload[] = [];
  const fn = vi.fn(
    async (p: TicketDeskDeliveryAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

describe("TicketDesk delivery-gate probe state machine", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetTicketDeskDeliveryProbeForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setTicketDeskDeliveryProbeDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    __resetTicketDeskDeliveryProbeForTests();
    logSpy?.mockRestore();
    errSpy?.mockRestore();
  });

  it("stays quiet and reports ok when the origin gate accepts the session", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(fetchReturning(201));
    const { outcome, deliveries } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("ok");
    expect(deliveries).toEqual([]);
    const state = getTicketDeskDeliveryProbeState();
    expect(state.status).toBe("ok");
    expect(state.alerting).toBe(false);
    expect(state.consecutiveBlocked).toBe(0);
  });

  it("treats a non-403 4xx (request validation) as ok — origin accepted", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(fetchReturning(400, "Bad Request"));
    const { outcome } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("ok");
    expect(getTicketDeskDeliveryProbeState().consecutiveBlocked).toBe(0);
  });

  it("does not page until blocked for `threshold` consecutive probes, then fires once", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(
      fetchReturning(403, "Origin not allowed"),
    );

    // threshold defaults to 3.
    await evaluateTicketDeskDeliveryProbe();
    expect(pd.calls.length).toBe(0);
    expect(getTicketDeskDeliveryProbeState().alerting).toBe(false);

    await evaluateTicketDeskDeliveryProbe();
    expect(pd.calls.length).toBe(0);

    const { deliveries } = await evaluateTicketDeskDeliveryProbe();
    expect(pd.calls.length).toBe(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(email.calls.length).toBe(1);
    expect(slack.calls.length).toBe(1);
    expect(deliveries.some((d) => d.channel === "pagerduty" && d.ok)).toBe(true);

    const state = getTicketDeskDeliveryProbeState();
    expect(state.status).toBe("blocked");
    expect(state.alerting).toBe(true);
    expect(state.consecutiveBlocked).toBe(3);
    expect(state.reasons.join(" ")).toMatch(/origin not allowed/i);
  });

  it("a non-origin 403 is inconclusive (unreachable), never blocked", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(fetchReturning(403, "Forbidden"));
    const { outcome } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("unreachable");
    const state = getTicketDeskDeliveryProbeState();
    expect(state.consecutiveBlocked).toBe(0);
    expect(state.consecutiveUnreachable).toBe(1);
    expect(pd.calls.length).toBe(0);
  });

  it("a single transient unreachable does NOT trip the alarm (resilience)", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(
      fetchReturning(403, "Origin not allowed"),
    );
    await evaluateTicketDeskDeliveryProbe(); // blocked #1
    await evaluateTicketDeskDeliveryProbe(); // blocked #2
    expect(getTicketDeskDeliveryProbeState().consecutiveBlocked).toBe(2);

    __setTicketDeskDeliveryProbeFetchForTests(fetchThrowing("ECONNRESET"));
    await evaluateTicketDeskDeliveryProbe(); // unreachable — inconclusive
    let state = getTicketDeskDeliveryProbeState();
    expect(state.status).toBe("unreachable");
    expect(state.consecutiveBlocked).toBe(2); // unchanged
    expect(state.consecutiveUnreachable).toBe(1);
    expect(pd.calls.length).toBe(0);

    __setTicketDeskDeliveryProbeFetchForTests(
      fetchReturning(403, "Origin not allowed"),
    );
    await evaluateTicketDeskDeliveryProbe(); // blocked #3 (streak continues)
    state = getTicketDeskDeliveryProbeState();
    expect(state.consecutiveBlocked).toBe(3);
    expect(pd.calls.length).toBe(1); // now it fires
  });

  it("treats a 5xx as unreachable, not blocked", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(fetchReturning(503));
    const { outcome } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("unreachable");
    expect(getTicketDeskDeliveryProbeState().consecutiveUnreachable).toBe(1);
  });

  it("clears the alert once delivery recovers", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(
      fetchReturning(403, "Origin not allowed"),
    );
    await evaluateTicketDeskDeliveryProbe();
    await evaluateTicketDeskDeliveryProbe();
    await evaluateTicketDeskDeliveryProbe();
    expect(getTicketDeskDeliveryProbeState().alerting).toBe(true);
    const fireCalls = pd.calls.length;

    __setTicketDeskDeliveryProbeFetchForTests(fetchReturning(201));
    const { deliveries } = await evaluateTicketDeskDeliveryProbe();
    const state = getTicketDeskDeliveryProbeState();
    expect(state.status).toBe("ok");
    expect(state.alerting).toBe(false);
    expect(state.consecutiveBlocked).toBe(0);
    expect(pd.calls.length).toBe(fireCalls + 1);
    expect(pd.calls[pd.calls.length - 1].kind).toBe("clear");
    expect(deliveries.some((d) => d.channel === "pagerduty" && d.ok)).toBe(true);
  });

  it("does not re-page on every poll while still blocked (throttled)", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(
      fetchReturning(403, "Origin not allowed"),
    );
    await evaluateTicketDeskDeliveryProbe();
    await evaluateTicketDeskDeliveryProbe();
    await evaluateTicketDeskDeliveryProbe(); // fires
    expect(pd.calls.length).toBe(1);

    await evaluateTicketDeskDeliveryProbe();
    await evaluateTicketDeskDeliveryProbe();
    expect(pd.calls.length).toBe(1);
  });
});
