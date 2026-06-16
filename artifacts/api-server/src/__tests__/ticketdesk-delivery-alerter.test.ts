import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  evaluateTicketDeskDeliveryAlert,
  formatOutageAge,
  getTicketDeskDeliveryAlertingState,
  __resetTicketDeskDeliveryAlerterForTests,
  __setTicketDeskDeliveryAlerterDeliveriesForTests,
  __setTicketDeskDeliveryStatsReaderForTests,
  type DeliveryResult,
  type TicketDeskDeliveryAlertPayload,
} from "../lib/ticketdesk-delivery-alerter";
import type { StuckTicketDeliveryStats } from "../lib/ticketdesk-queue";

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

/**
 * Build a stuck-ticket stats snapshot. `count` is split across failed/pending
 * (all into `failed` by default) so a test can just say "N tickets stuck".
 */
function stats(
  count: number,
  overrides: Partial<StuckTicketDeliveryStats> = {},
): StuckTicketDeliveryStats {
  return {
    count,
    byStatus: { failed: count, pending: 0 },
    oldestCreatedAt: count > 0 ? "2026-06-16T00:00:00.000Z" : null,
    lastError: count > 0 ? "connect ECONNREFUSED ticketdesk" : null,
    stuckMinutes: 30,
    ...overrides,
  };
}

describe("ticketdesk-delivery-alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let currentStats: StuckTicketDeliveryStats;

  beforeEach(() => {
    __resetTicketDeskDeliveryAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setTicketDeskDeliveryAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    currentStats = stats(0);
    __setTicketDeskDeliveryStatsReaderForTests(async () => currentStats);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __resetTicketDeskDeliveryAlerterForTests();
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  it("is a no-op when no tickets are stuck", async () => {
    const results = await evaluateTicketDeskDeliveryAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
    expect(getTicketDeskDeliveryAlertingState().alerting).toBe(false);
  });

  it("does not fire below the threshold", async () => {
    // Default threshold is 5 — 4 stuck tickets should stay quiet.
    currentStats = stats(4);

    const results = await evaluateTicketDeskDeliveryAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(getTicketDeskDeliveryAlertingState().alerting).toBe(false);
    expect(getTicketDeskDeliveryAlertingState().lastSeenCount).toBe(4);
  });

  it("fires a 'fire' alert on every channel once the backlog crosses the threshold", async () => {
    currentStats = stats(5);

    await evaluateTicketDeskDeliveryAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(pd.calls[0].stats.count).toBe(5);
    expect(pd.calls[0].threshold).toBe(5);
    expect(pd.calls[0].stuckMinutes).toBe(30);
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].kind).toBe("fire");
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].kind).toBe("fire");
    expect(getTicketDeskDeliveryAlertingState().alerting).toBe(true);
  });

  it("fires once per throttle window while the backlog persists (sustained outage)", async () => {
    const prev = process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS;
    process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS = String(
      15 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-16T00:00:00Z"));

      currentStats = stats(5);
      await evaluateTicketDeskDeliveryAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // 1 minute later the backlog is still over threshold — inside the 15m
      // throttle window, so no NEW page goes out.
      vi.setSystemTime(new Date("2026-06-16T00:01:00Z"));
      currentStats = stats(12);
      let results = await evaluateTicketDeskDeliveryAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(
        results.filter((r) => r.skipped && r.reason === "throttled"),
      ).toHaveLength(3);

      // 6 minutes in, still throttled.
      vi.setSystemTime(new Date("2026-06-16T00:06:00Z"));
      currentStats = stats(30);
      results = await evaluateTicketDeskDeliveryAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(
        results.filter((r) => r.skipped && r.reason === "throttled"),
      ).toHaveLength(3);

      // Past the throttle window: a second page goes out (one per window).
      vi.setSystemTime(new Date("2026-06-16T00:16:00Z"));
      currentStats = stats(30);
      await evaluateTicketDeskDeliveryAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
      expect(email.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
      expect(slack.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
    } finally {
      if (prev === undefined) {
        delete process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS = prev;
      }
    }
  });

  it("auto-resolves the moment the backlog drains below the threshold", async () => {
    currentStats = stats(6);
    await evaluateTicketDeskDeliveryAlert();
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
    expect(getTicketDeskDeliveryAlertingState().alerting).toBe(true);

    // Backlog drains below threshold — the live count IS the recovery signal,
    // so the clear fires immediately, no quiet window needed.
    currentStats = stats(1);
    const results = await evaluateTicketDeskDeliveryAlert();

    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].kind).toBe("clear");
    expect(email.calls[1].kind).toBe("clear");
    expect(slack.calls[1].kind).toBe("clear");
    expect(results.filter((r) => !r.skipped)).toHaveLength(3);
    expect(getTicketDeskDeliveryAlertingState().alerting).toBe(false);
  });

  it("does not re-clear on subsequent polls once already cleared", async () => {
    currentStats = stats(6);
    await evaluateTicketDeskDeliveryAlert();
    currentStats = stats(0);
    await evaluateTicketDeskDeliveryAlert();
    expect(pd.calls.filter((c) => c.kind === "clear")).toHaveLength(1);

    // Still clear on the next polls — no duplicate "clear".
    await evaluateTicketDeskDeliveryAlert();
    await evaluateTicketDeskDeliveryAlert();
    expect(pd.calls.filter((c) => c.kind === "clear")).toHaveLength(1);
  });

  it("re-fires after a recovery once a new outage transitions in", async () => {
    const prev = process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS;
    process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS = String(
      5 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-16T00:00:00Z"));

      currentStats = stats(5);
      await evaluateTicketDeskDeliveryAlert();

      // Recover.
      vi.setSystemTime(new Date("2026-06-16T00:02:00Z"));
      currentStats = stats(0);
      await evaluateTicketDeskDeliveryAlert();

      // New outage past the throttle window.
      vi.setSystemTime(new Date("2026-06-16T00:30:00Z"));
      currentStats = stats(7);
      await evaluateTicketDeskDeliveryAlert();

      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
      expect(pd.calls.filter((c) => c.kind === "clear")).toHaveLength(1);
    } finally {
      if (prev === undefined) {
        delete process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS = prev;
      }
    }
  });

  it("pages immediately on a NEW outage right after recovery, even inside the throttle window", async () => {
    const prev = process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS;
    // Long throttle window so, without the per-transition throttle reset, the
    // second outage's opening page would be wrongly suppressed.
    process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS = String(
      15 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-16T00:00:00Z"));

      // Outage #1 fires.
      currentStats = stats(6);
      await evaluateTicketDeskDeliveryAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // Recovers a minute later (well inside the throttle window).
      vi.setSystemTime(new Date("2026-06-16T00:01:00Z"));
      currentStats = stats(0);
      await evaluateTicketDeskDeliveryAlert();
      expect(pd.calls.filter((c) => c.kind === "clear")).toHaveLength(1);

      // Outage #2 starts another minute later — still inside the 15m window,
      // but it's a fresh incident and MUST page right away.
      vi.setSystemTime(new Date("2026-06-16T00:02:00Z"));
      currentStats = stats(8);
      const results = await evaluateTicketDeskDeliveryAlert();
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
      expect(email.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
      expect(slack.calls.filter((c) => c.kind === "fire")).toHaveLength(2);
      expect(results.filter((r) => r.skipped && r.reason === "throttled")).toHaveLength(0);
    } finally {
      if (prev === undefined) {
        delete process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.TICKETDESK_DELIVERY_NOTIFICATION_THROTTLE_MS = prev;
      }
    }
  });

  it("includes the pending/failed breakdown in the fire payload", async () => {
    currentStats = stats(6, { byStatus: { failed: 4, pending: 2 } });

    await evaluateTicketDeskDeliveryAlert();

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].stats.count).toBe(6);
    expect(pd.calls[0].stats.byStatus.failed).toBe(4);
    expect(pd.calls[0].stats.byStatus.pending).toBe(2);
  });

  it("does not let a single delivery failure block other deliveries", async () => {
    __setTicketDeskDeliveryAlerterDeliveriesForTests({
      pagerduty: async () => {
        throw new Error("pd boom");
      },
      email: email.fn,
      slack: slack.fn,
    });

    currentStats = stats(5);
    const results = await evaluateTicketDeskDeliveryAlert();

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    const pdResult = results.find((r) => r.channel === "pagerduty");
    expect(pdResult?.ok).toBe(false);
    expect(pdResult?.reason).toContain("pd boom");
  });

  it("treats unconfigured providers as skipped without consuming the throttle slot", async () => {
    __setTicketDeskDeliveryAlerterDeliveriesForTests({
      pagerduty: async () => ({
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: email.fn,
      slack: slack.fn,
    });

    currentStats = stats(5);
    const r1 = await evaluateTicketDeskDeliveryAlert();
    const pd1 = r1.find((r) => r.channel === "pagerduty");
    expect(pd1?.skipped).toBe(true);
    expect(pd1?.reason).toBe("not_configured");

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("degrades to a no-op when the stats read throws (a flaky DB can't flip the alert)", async () => {
    __setTicketDeskDeliveryStatsReaderForTests(async () => {
      throw new Error("db down");
    });

    const results = await evaluateTicketDeskDeliveryAlert();

    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(getTicketDeskDeliveryAlertingState().alerting).toBe(false);
  });

  it("includes the outage age (oldest-stuck-ticket age) in the fire payload", async () => {
    const oldest = "2026-06-16T00:00:00.000Z";
    // 90 minutes after the oldest stuck ticket — under the 2h escalate cutoff.
    const now = Date.parse(oldest) + 90 * 60 * 1000;
    currentStats = stats(5, { oldestCreatedAt: oldest });

    await evaluateTicketDeskDeliveryAlert(now);

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].outageAgeMs).toBe(90 * 60 * 1000);
    expect(pd.calls[0].escalateMinutes).toBe(120);
    expect(pd.calls[0].escalated).toBe(false);
  });

  it("escalates once the oldest stuck ticket is past the escalation cutoff", async () => {
    const oldest = "2026-06-16T00:00:00.000Z";
    // 3 hours later — well past the default 2h cutoff.
    const now = Date.parse(oldest) + 3 * 60 * 60 * 1000;
    currentStats = stats(6, { oldestCreatedAt: oldest });

    await evaluateTicketDeskDeliveryAlert(now);

    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].escalated).toBe(true);
    expect(pd.calls[0].outageAgeMs).toBe(3 * 60 * 60 * 1000);
  });

  it("respects a custom TICKETDESK_DELIVERY_ESCALATE_MINUTES", async () => {
    const prev = process.env.TICKETDESK_DELIVERY_ESCALATE_MINUTES;
    process.env.TICKETDESK_DELIVERY_ESCALATE_MINUTES = "30";
    try {
      const oldest = "2026-06-16T00:00:00.000Z";
      const now = Date.parse(oldest) + 45 * 60 * 1000; // 45m > 30m cutoff
      currentStats = stats(5, { oldestCreatedAt: oldest });

      await evaluateTicketDeskDeliveryAlert(now);

      expect(pd.calls[0].escalateMinutes).toBe(30);
      expect(pd.calls[0].escalated).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.TICKETDESK_DELIVERY_ESCALATE_MINUTES;
      } else {
        process.env.TICKETDESK_DELIVERY_ESCALATE_MINUTES = prev;
      }
    }
  });

  it("exposes the outage age + escalation in the public alerting state", async () => {
    const oldest = "2026-06-16T00:00:00.000Z";
    const now = Date.parse(oldest) + 3 * 60 * 60 * 1000;
    currentStats = stats(6, { oldestCreatedAt: oldest });

    await evaluateTicketDeskDeliveryAlert(now);

    const state = getTicketDeskDeliveryAlertingState();
    expect(state.alerting).toBe(true);
    expect(state.oldestCreatedAt).toBe(oldest);
    expect(state.outageAgeMs).toBe(3 * 60 * 60 * 1000);
    expect(state.outageAge).toBe("~3h");
    expect(state.escalated).toBe(true);
  });

  it("clamps a negative outage age (oldest ticket clock-skewed into the future) to 0", async () => {
    const oldest = "2026-06-16T01:00:00.000Z";
    const now = Date.parse(oldest) - 5 * 60 * 1000; // now is before oldest
    currentStats = stats(5, { oldestCreatedAt: oldest });

    await evaluateTicketDeskDeliveryAlert(now);

    expect(pd.calls[0].outageAgeMs).toBe(0);
    expect(pd.calls[0].escalated).toBe(false);
  });

  describe("formatOutageAge", () => {
    it("returns null for unknown/zero/negative ages", () => {
      expect(formatOutageAge(null)).toBeNull();
      expect(formatOutageAge(undefined)).toBeNull();
      expect(formatOutageAge(0)).toBeNull();
      expect(formatOutageAge(-1000)).toBeNull();
    });

    it("formats minutes, hours, and days", () => {
      expect(formatOutageAge(5 * 60 * 1000)).toBe("~5m");
      expect(formatOutageAge(90 * 60 * 1000)).toBe("~1h 30m");
      expect(formatOutageAge(3 * 60 * 60 * 1000)).toBe("~3h");
      expect(formatOutageAge(26 * 60 * 60 * 1000)).toBe("~1d 2h");
      expect(formatOutageAge(48 * 60 * 60 * 1000)).toBe("~2d");
    });
  });
});
