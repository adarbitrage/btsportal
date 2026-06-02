import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { statusMock, auditMock, destinationsMock } = vi.hoisted(() => {
  const statusMock = vi.fn();
  const auditMock = vi.fn(async () => {});
  const destinationsMock = vi.fn(async () => ({
    pagerdutyIntegrationKey: null,
    opsAlertEmail: null,
    opsAlertSlackWebhookUrl: null,
  }));
  return { statusMock, auditMock, destinationsMock };
});

vi.mock("../lib/machine-mismatch-daily-digest", () => ({
  getMachineMismatchDigestStatus: statusMock,
}));

vi.mock("../lib/audit-log", () => ({
  logAuditEvent: auditMock,
}));

vi.mock("../lib/oncall-settings", () => ({
  getOnCallDestinations: destinationsMock,
}));

import {
  evaluateMachineMismatchDigestAlert,
  evaluateDigestHealth,
  __resetMachineMismatchDigestAlerterForTests,
  __setMachineMismatchDigestAlerterDeliveriesForTests,
  __getMachineMismatchDigestAlerterStateForTests,
  MACHINE_MISMATCH_DIGEST_ALERT_ACTION_TYPE,
  MACHINE_MISMATCH_DIGEST_ALERT_ENTITY_TYPE,
  type MachineMismatchDigestAlertPayload,
  type DeliveryResult,
} from "../lib/machine-mismatch-digest-alerter";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-06-01T00:00:00.000Z");

interface StubDelivery {
  fn: (p: MachineMismatchDigestAlertPayload) => Promise<DeliveryResult>;
  calls: MachineMismatchDigestAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: MachineMismatchDigestAlertPayload[] = [];
  const fn = vi.fn(
    async (p: MachineMismatchDigestAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

function setStatus(opts: {
  intervalMs?: number;
  lastRanAt?: string | null;
  lastOutcome?:
    | "sent"
    | "skipped_no_mismatches"
    | "skipped_no_recipient"
    | "skipped_sendgrid_not_configured"
    | "failed"
    | null;
  lastReason?: string | null;
}): void {
  statusMock.mockReturnValue({
    intervalMs: opts.intervalMs ?? DAY,
    lastRanAt: opts.lastRanAt ?? null,
    lastOutcome: opts.lastOutcome ?? null,
    lastFlaggedCount: null,
    lastRecipient: null,
    lastReason: opts.lastReason ?? null,
  });
}

describe("machine-mismatch-digest-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Seed the staleness baseline at T0 so "never run yet" cases are
    // deterministic relative to the timestamps the tests feed in.
    __resetMachineMismatchDigestAlerterForTests(T0);
    statusMock.mockReset();
    auditMock.mockClear();
    destinationsMock.mockClear();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setMachineMismatchDigestAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setMachineMismatchDigestAlerterDeliveriesForTests(null);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  describe("evaluateDigestHealth", () => {
    it("flags stale when the heartbeat is older than 2x the interval", () => {
      const status = {
        intervalMs: DAY,
        lastRanAt: new Date(T0 - 3 * DAY).toISOString(),
        lastOutcome: "sent" as const,
        lastFlaggedCount: null,
        lastRecipient: null,
        lastReason: null,
      };
      const health = evaluateDigestHealth(status, T0);
      expect(health.stale).toBe(true);
      expect(health.failed).toBe(false);
      expect(health.alerting).toBe(true);
    });

    it("flags failed when the most recent outcome is 'failed' even if fresh", () => {
      const status = {
        intervalMs: DAY,
        lastRanAt: new Date(T0 - HOUR).toISOString(),
        lastOutcome: "failed" as const,
        lastFlaggedCount: null,
        lastRecipient: null,
        lastReason: "boom",
      };
      const health = evaluateDigestHealth(status, T0);
      expect(health.stale).toBe(false);
      expect(health.failed).toBe(true);
      expect(health.alerting).toBe(true);
    });

    it("is healthy when fresh and last outcome succeeded", () => {
      const status = {
        intervalMs: DAY,
        lastRanAt: new Date(T0 - HOUR).toISOString(),
        lastOutcome: "sent" as const,
        lastFlaggedCount: null,
        lastRecipient: null,
        lastReason: null,
      };
      const health = evaluateDigestHealth(status, T0);
      expect(health.alerting).toBe(false);
    });
  });

  it("fires on every channel when the heartbeat is stale", async () => {
    setStatus({ lastRanAt: new Date(T0 - 3 * DAY).toISOString(), lastOutcome: "sent" });

    await evaluateMachineMismatchDigestAlert(T0);

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].kind).toBe("fire");
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].kind).toBe("fire");
    expect(__getMachineMismatchDigestAlerterStateForTests()).toBe(true);
  });

  it("fires when the most recent run failed even though the heartbeat is fresh", async () => {
    setStatus({ lastRanAt: new Date(T0 - HOUR).toISOString(), lastOutcome: "failed", lastReason: "smtp down" });

    await evaluateMachineMismatchDigestAlert(T0);

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(pd.calls[0].health.failed).toBe(true);
    expect(pd.calls[0].health.stale).toBe(false);
  });

  it("is a no-op when the digest is healthy (fresh + succeeded)", async () => {
    setStatus({ lastRanAt: new Date(T0 - HOUR).toISOString(), lastOutcome: "sent" });

    const results = await evaluateMachineMismatchDigestAlert(T0);

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
  });

  it("is a no-op when the digest job is disabled (intervalMs <= 0)", async () => {
    setStatus({ intervalMs: 0, lastRanAt: null });

    const results = await evaluateMachineMismatchDigestAlert(T0 + 10 * DAY);

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
  });

  it("uses the module-load baseline for a never-run digest so a fresh restart does not false-page", async () => {
    // lastRanAt null, evaluated right at the baseline → not yet stale.
    setStatus({ lastRanAt: null });
    const noFire = await evaluateMachineMismatchDigestAlert(T0);
    expect(noFire).toEqual([]);
    expect(pd.calls).toHaveLength(0);

    // ...but if the process stays up past 2 intervals with no run, it fires.
    const fired = await evaluateMachineMismatchDigestAlert(T0 + 3 * DAY);
    expect(fired.length).toBeGreaterThan(0);
    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
  });

  it("does not re-fire while the digest stays unhealthy", async () => {
    setStatus({ lastRanAt: new Date(T0 - 3 * DAY).toISOString(), lastOutcome: "sent" });

    await evaluateMachineMismatchDigestAlert(T0);
    expect(pd.calls).toHaveLength(1);

    await evaluateMachineMismatchDigestAlert(T0 + HOUR);
    await evaluateMachineMismatchDigestAlert(T0 + 2 * HOUR);
    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("sends an all-clear when the digest recovers", async () => {
    setStatus({ lastRanAt: new Date(T0 - 3 * DAY).toISOString(), lastOutcome: "failed" });
    await evaluateMachineMismatchDigestAlert(T0);
    expect(pd.calls[0].kind).toBe("fire");

    setStatus({ lastRanAt: new Date(T0 + HOUR).toISOString(), lastOutcome: "sent" });
    await evaluateMachineMismatchDigestAlert(T0 + HOUR);

    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].kind).toBe("clear");
    expect(email.calls[1].kind).toBe("clear");
    expect(slack.calls[1].kind).toBe("clear");
    expect(__getMachineMismatchDigestAlerterStateForTests()).toBe(false);
  });

  it("writes an audit row per delivery attempt with the digest alert action type", async () => {
    setStatus({ lastRanAt: new Date(T0 - 3 * DAY).toISOString(), lastOutcome: "sent" });

    await evaluateMachineMismatchDigestAlert(T0);

    expect(auditMock).toHaveBeenCalledTimes(3);
    for (const call of auditMock.mock.calls) {
      const event = (call as unknown[])[0] as {
        actionType: string;
        entityType: string;
        metadata: { outcome: string; kind: string };
      };
      expect(event.actionType).toBe(MACHINE_MISMATCH_DIGEST_ALERT_ACTION_TYPE);
      expect(event.entityType).toBe(MACHINE_MISMATCH_DIGEST_ALERT_ENTITY_TYPE);
      expect(event.metadata.outcome).toBe("sent");
      expect(event.metadata.kind).toBe("fire");
    }
  });

  it("does not let a single delivery failure block other channels", async () => {
    setStatus({ lastRanAt: new Date(T0 - 3 * DAY).toISOString(), lastOutcome: "sent" });
    __setMachineMismatchDigestAlerterDeliveriesForTests({
      pagerduty: async () => {
        throw new Error("pd boom");
      },
      email: email.fn,
      slack: slack.fn,
    });

    const results = await evaluateMachineMismatchDigestAlert(T0);

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    const pdResult = results.find((r) => r.channel === "pagerduty");
    expect(pdResult?.ok).toBe(false);
    expect(pdResult?.reason).toContain("pd boom");
  });

  it("does not double-fire when two evaluations race on the same first-time transition", async () => {
    setStatus({ lastRanAt: new Date(T0 - 3 * DAY).toISOString(), lastOutcome: "sent" });

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let pdInflight = 0;
    let pdMaxInflight = 0;
    __setMachineMismatchDigestAlerterDeliveriesForTests({
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

    const a = evaluateMachineMismatchDigestAlert(T0);
    const b = evaluateMachineMismatchDigestAlert(T0);
    release();
    const [resA, resB] = await Promise.all([a, b]);

    const dispatched = [resA, resB].filter((r) => r.length > 0);
    expect(dispatched).toHaveLength(1);
    expect(pdMaxInflight).toBe(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });
});
