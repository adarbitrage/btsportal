import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import sgMail from "@sendgrid/mail";

import {
  evaluateTicketDeskDeliveryProbe,
  getTicketDeskDeliveryProbeState,
  __resetTicketDeskDeliveryProbeForTests,
  __setTicketDeskDeliveryProbeDeliveriesForTests,
  __setTicketDeskDeliveryProbeFetchForTests,
  type DeliveryResult,
  type TicketDeskDeliveryAlertPayload,
} from "../lib/ticketdesk-delivery-probe";
import { __resetSendGridInitForTests } from "../lib/oncall-dispatcher";

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

/**
 * End-to-end on-call wiring: this suite does NOT stub the delivery functions.
 * It drives the probe to a real "blocked" verdict and lets the SHARED
 * `oncall-dispatcher` build and "send" the actual PagerDuty / email / Slack
 * payloads, intercepting only the transport (global `fetch` for PagerDuty +
 * Slack, `sgMail.send` for email). This is the test that fails if the
 * dispatcher config drifts (wrong dedupKey, severity, subject, or throttle
 * behavior) — the gap the stubbed state-machine suite above can't catch.
 */
describe("TicketDesk delivery-gate probe — real on-call dispatcher payloads", () => {
  const SLACK_WEBHOOK = "https://hooks.slack.test/services/T000/B000/XXX";
  const OPS_EMAIL = "oncall@buildtestscale.com";
  const PD_KEY = "pd-routing-key-test";

  let pagerdutyBodies: any[];
  let slackBodies: any[];
  let emailSends: Array<{ to: unknown; from: unknown; subject: unknown; text: unknown }>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let sendSpy: ReturnType<typeof vi.spyOn>;
  let setApiKeySpy: ReturnType<typeof vi.spyOn>;

  const savedEnv: Record<string, string | undefined> = {};
  function setEnv(name: string, value: string): void {
    savedEnv[name] = process.env[name];
    process.env[name] = value;
  }

  beforeEach(() => {
    __resetTicketDeskDeliveryProbeForTests();
    // Use the real default delivery functions (no override).
    __setTicketDeskDeliveryProbeDeliveriesForTests(null);
    __resetSendGridInitForTests();

    setEnv("PAGERDUTY_INTEGRATION_KEY", PD_KEY);
    setEnv("OPS_ALERT_EMAIL", OPS_EMAIL);
    setEnv("OPS_ALERT_SLACK_WEBHOOK_URL", SLACK_WEBHOOK);
    setEnv("SENDGRID_API_KEY", "SG.test-key");

    pagerdutyBodies = [];
    slackBodies = [];
    emailSends = [];

    // Intercept ONLY the dispatcher transport. The probe itself reads its own
    // fetch override (set per-test), so global fetch never sees probe traffic.
    const fetchMock = vi.fn(
      async (input: any, init?: any): Promise<Response> => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        if (url.includes("events.pagerduty.com")) {
          pagerdutyBodies.push(body);
          return new Response(JSON.stringify({ status: "success" }), {
            status: 202,
          });
        }
        if (url === SLACK_WEBHOOK) {
          slackBodies.push(body);
          return new Response("ok", { status: 200 });
        }
        throw new Error(`unexpected fetch to ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    setApiKeySpy = vi
      .spyOn(sgMail, "setApiKey")
      .mockImplementation(() => undefined);
    sendSpy = vi.spyOn(sgMail, "send").mockImplementation((async (msg: any) => {
      emailSends.push({
        to: msg.to,
        from: msg.from,
        subject: msg.subject,
        text: msg.text,
      });
      return [{ statusCode: 202 }, {}] as any;
    }) as any);

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sendSpy.mockRestore();
    setApiKeySpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    __resetSendGridInitForTests();
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  afterAll(() => {
    __resetTicketDeskDeliveryProbeForTests();
  });

  /** Drive the probe to a confirmed "blocked" fire (threshold = 3). */
  async function driveToBlockedFire(): Promise<void> {
    __setTicketDeskDeliveryProbeFetchForTests(
      fetchReturning(403, "Origin not allowed"),
    );
    await evaluateTicketDeskDeliveryProbe();
    await evaluateTicketDeskDeliveryProbe();
    await evaluateTicketDeskDeliveryProbe(); // crosses threshold -> fires
  }

  it("emits a correctly-formed PagerDuty trigger when delivery is blocked past threshold", async () => {
    await driveToBlockedFire();

    expect(pagerdutyBodies).toHaveLength(1);
    const pd = pagerdutyBodies[0];
    expect(pd.routing_key).toBe(PD_KEY);
    expect(pd.event_action).toBe("trigger");
    expect(pd.dedup_key).toBe("ticketdesk-delivery-gate:blocked");
    expect(pd.payload.severity).toBe("critical");
    expect(pd.payload.component).toBe("ticketdesk-delivery-gate");
    expect(pd.payload.class).toBe("support_ticket_delivery_blocked");
    expect(pd.payload.summary).toMatch(/BLOCKED/);
    expect(pd.payload.custom_details.consecutiveBlocked).toBe(3);
    expect(pd.payload.custom_details.threshold).toBe(3);
    expect(pd.payload.custom_details.link).toBe("/admin/system");
    expect(
      String(pd.payload.custom_details.reasons.join(" ")),
    ).toMatch(/origin not allowed/i);
  });

  it("emits the expected ops email (subject + recipient) when blocked", async () => {
    await driveToBlockedFire();

    expect(emailSends).toHaveLength(1);
    const mail = emailSends[0];
    expect(mail.to).toBe(OPS_EMAIL);
    expect(mail.subject).toBe(
      "[ALERT] Support tickets are not reaching TicketDesk (origin blocked)",
    );
    expect(String(mail.text)).toMatch(/no longer reaching the TicketDesk/i);
    expect(String(mail.text)).toMatch(/Origin not allowed/);
  });

  it("emits the expected Slack message when blocked", async () => {
    await driveToBlockedFire();

    expect(slackBodies).toHaveLength(1);
    expect(String(slackBodies[0].text)).toMatch(
      /Support ticket delivery BLOCKED/,
    );
    expect(String(slackBodies[0].text)).toContain("/admin/system");
  });

  it("emits a PagerDuty resolve + recovered email/Slack when delivery recovers", async () => {
    await driveToBlockedFire();
    expect(pagerdutyBodies).toHaveLength(1);

    // Recover: origin gate now accepts the session.
    __setTicketDeskDeliveryProbeFetchForTests(fetchReturning(201));
    await evaluateTicketDeskDeliveryProbe();

    // PagerDuty: a resolve for the SAME dedup key (no severity payload).
    expect(pagerdutyBodies).toHaveLength(2);
    const resolve = pagerdutyBodies[1];
    expect(resolve.event_action).toBe("resolve");
    expect(resolve.dedup_key).toBe("ticketdesk-delivery-gate:blocked");
    expect(resolve.routing_key).toBe(PD_KEY);
    expect(resolve.payload).toBeUndefined();

    // Email + Slack carry the recovered/resolved copy.
    expect(emailSends).toHaveLength(2);
    expect(emailSends[1].subject).toBe(
      "[RESOLVED] Support ticket delivery recovered",
    );
    expect(slackBodies).toHaveLength(2);
    expect(String(slackBodies[1].text)).toMatch(/recovered/i);
  });

  it("does not re-page on every poll while still blocked (real dispatcher throttle)", async () => {
    await driveToBlockedFire();
    expect(pagerdutyBodies).toHaveLength(1);
    expect(emailSends).toHaveLength(1);
    expect(slackBodies).toHaveLength(1);

    // Still blocked on the next polls — inside the throttle window, so no new
    // transport calls go out on any channel, and the dispatcher reports the
    // suppressed sends as throttled skips.
    const { deliveries: d4 } = await evaluateTicketDeskDeliveryProbe();
    const { deliveries: d5 } = await evaluateTicketDeskDeliveryProbe();

    expect(pagerdutyBodies).toHaveLength(1);
    expect(emailSends).toHaveLength(1);
    expect(slackBodies).toHaveLength(1);
    for (const d of [d4, d5]) {
      expect(
        d.filter((r) => r.skipped && r.reason === "throttled"),
      ).toHaveLength(3);
    }
  });
});

/**
 * Build a fetch stub that records every request and routes the response by URL:
 *   - .../chat/session       → the configured session response
 *   - everything else (the cleanup endpoint) → the configured cleanup response
 */
function routingFetch(opts: {
  sessionStatus: number;
  sessionBody: string;
  cleanupStatus?: number;
  cleanupBody?: string;
  cleanupThrows?: string;
}): { fn: typeof fetch; calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
    if (url.endsWith("/chat/session")) {
      return new Response(opts.sessionBody, { status: opts.sessionStatus });
    }
    if (opts.cleanupThrows) throw new Error(opts.cleanupThrows);
    return new Response(opts.cleanupBody ?? "{}", {
      status: opts.cleanupStatus ?? 200,
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const SESSION_OK_BODY = JSON.stringify({
  sessionToken: "tok-123",
  threadId: "thread-abc",
});

describe("TicketDesk delivery-probe thread cleanup (best-effort, opt-in)", () => {
  const ORIGINAL = process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH;

  beforeEach(() => {
    __resetTicketDeskDeliveryProbeForTests();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH;
    else process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH = ORIGINAL;
    __resetTicketDeskDeliveryProbeForTests();
  });

  it("does NOT call any cleanup endpoint when none is configured (default)", async () => {
    delete process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH;
    const stub = routingFetch({ sessionStatus: 201, sessionBody: SESSION_OK_BODY });
    __setTicketDeskDeliveryProbeFetchForTests(stub.fn);

    const { outcome } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("ok");
    // Only the session POST — no cleanup request.
    expect(stub.calls.length).toBe(1);
    expect(stub.calls[0].url.endsWith("/chat/session")).toBe(true);
  });

  it("archives the probe thread after an ok probe when an endpoint is configured", async () => {
    process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH = "/chat/session/resolve";
    const stub = routingFetch({
      sessionStatus: 201,
      sessionBody: SESSION_OK_BODY,
      cleanupStatus: 200,
    });
    __setTicketDeskDeliveryProbeFetchForTests(stub.fn);

    const { outcome } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("ok");

    const cleanup = stub.calls.find((c) =>
      c.url.endsWith("/chat/session/resolve"),
    );
    expect(cleanup).toBeDefined();
    expect(cleanup?.method).toBe("POST");
  });

  it("does not attempt cleanup when the ok response carried no session token", async () => {
    process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH = "/chat/session/resolve";
    // Non-JSON 2xx body (e.g. a 400-classified-ok or empty body) → no token.
    const stub = routingFetch({ sessionStatus: 200, sessionBody: "ok" });
    __setTicketDeskDeliveryProbeFetchForTests(stub.fn);

    const { outcome } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("ok");
    expect(stub.calls.some((c) => c.url.endsWith("/chat/session/resolve"))).toBe(
      false,
    );
  });

  it("never lets a failing cleanup affect the ok verdict", async () => {
    process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH = "/chat/session/resolve";
    const stub = routingFetch({
      sessionStatus: 201,
      sessionBody: SESSION_OK_BODY,
      cleanupStatus: 404,
    });
    __setTicketDeskDeliveryProbeFetchForTests(stub.fn);

    const { outcome, deliveries } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("ok");
    expect(deliveries).toEqual([]);
    expect(getTicketDeskDeliveryProbeState().status).toBe("ok");
    // Cleanup was attempted despite the 404.
    expect(stub.calls.some((c) => c.url.endsWith("/chat/session/resolve"))).toBe(
      true,
    );
  });

  it("swallows a cleanup network error without affecting the probe", async () => {
    process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH = "/chat/session/resolve";
    const stub = routingFetch({
      sessionStatus: 201,
      sessionBody: SESSION_OK_BODY,
      cleanupThrows: "ECONNRESET",
    });
    __setTicketDeskDeliveryProbeFetchForTests(stub.fn);

    const { outcome } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("ok");
    expect(getTicketDeskDeliveryProbeState().status).toBe("ok");
  });

  it("does not attempt cleanup on a blocked probe", async () => {
    process.env.TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH = "/chat/session/resolve";
    const stub = routingFetch({
      sessionStatus: 403,
      sessionBody: "Origin not allowed",
    });
    __setTicketDeskDeliveryProbeFetchForTests(stub.fn);

    const { outcome } = await evaluateTicketDeskDeliveryProbe();
    expect(outcome.status).toBe("blocked");
    expect(stub.calls.some((c) => c.url.endsWith("/chat/session/resolve"))).toBe(
      false,
    );
  });
});
