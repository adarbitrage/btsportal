import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db, auditLogTable } from "@workspace/db";
import { and, eq, gt, desc } from "drizzle-orm";
import {
  evaluateQueueFallbackAlerts,
  __resetQueueFallbackAlerterForTests,
  __setQueueFallbackAlerterDeliveriesForTests,
  QUEUE_FALLBACK_ALERT_ACTION_TYPE,
  QUEUE_FALLBACK_ALERT_ENTITY_TYPE,
  type AlertPayload,
  type DeliveryResult,
} from "../lib/queue-fallback-alerter";
import {
  recordQueueFallback,
  __resetQueueFallbackTrackerForTests,
} from "../lib/queue-fallback-tracker";

const TAG = `qfb-alert-audit-${randomUUID().slice(0, 8)}`;
let baselineAuditId = 0;

beforeAll(async () => {
  const [maxRow] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.id))
    .limit(1);
  baselineAuditId = maxRow?.id ?? 0;
});

async function clearAlertRows() {
  await db
    .delete(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        eq(auditLogTable.actionType, QUEUE_FALLBACK_ALERT_ACTION_TYPE),
      ),
    );
}

afterAll(async () => {
  await clearAlertRows();
});

beforeEach(async () => {
  __resetQueueFallbackTrackerForTests();
  __resetQueueFallbackAlerterForTests();
  await clearAlertRows();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  __setQueueFallbackAlerterDeliveriesForTests(null);
  vi.restoreAllMocks();
});

async function fetchAlertRows() {
  return db
    .select()
    .from(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        eq(auditLogTable.actionType, QUEUE_FALLBACK_ALERT_ACTION_TYPE),
      ),
    )
    .orderBy(desc(auditLogTable.id));
}

describe("queue-fallback-alerter writes audit rows for delivery attempts", () => {
  it("records one row per delivery channel on a fire transition", async () => {
    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: async (): Promise<DeliveryResult> => ({ channel: "pagerduty", ok: true }),
      email: async (): Promise<DeliveryResult> => ({ channel: "email", ok: true }),
      slack: async (): Promise<DeliveryResult> => ({ channel: "slack", ok: true }),
    });

    recordQueueFallback("email", { recipient: `${TAG}@example.test`, reason: "queue_unavailable" });
    await evaluateQueueFallbackAlerts();

    const rows = await fetchAlertRows();
    expect(rows).toHaveLength(3);

    for (const row of rows) {
      expect(row.entityType).toBe(QUEUE_FALLBACK_ALERT_ENTITY_TYPE);
      expect(row.entityId).toBe("email");
      const meta = row.metadata as Record<string, unknown>;
      expect(meta.queueChannel).toBe("email");
      expect(meta.kind).toBe("fire");
      expect(meta.outcome).toBe("sent");
      // Recipient PII must not leak into the alert audit metadata — only
      // aggregate counts.
      expect("recipient" in meta).toBe(false);
      expect(meta.recentCount).toBe(1);
    }

    const channels = rows.map((r) => (r.metadata as Record<string, unknown>).deliveryChannel).sort();
    expect(channels).toEqual(["email", "pagerduty", "slack"]);
  });

  it("records skipped/failed/sent outcomes distinctly so admins can filter on them", async () => {
    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: async (): Promise<DeliveryResult> => ({
        channel: "pagerduty",
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: async (): Promise<DeliveryResult> => ({
        channel: "email",
        ok: false,
        reason: "http_500",
      }),
      slack: async (): Promise<DeliveryResult> => ({ channel: "slack", ok: true }),
    });

    recordQueueFallback("email");
    await evaluateQueueFallbackAlerts();

    const rows = await fetchAlertRows();
    expect(rows).toHaveLength(3);

    const byChannel = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const meta = row.metadata as Record<string, unknown>;
      byChannel.set(String(meta.deliveryChannel), meta);
    }

    expect(byChannel.get("pagerduty")?.outcome).toBe("skipped");
    expect(byChannel.get("pagerduty")?.reason).toBe("not_configured");

    expect(byChannel.get("email")?.outcome).toBe("failed");
    expect(byChannel.get("email")?.reason).toBe("http_500");

    expect(byChannel.get("slack")?.outcome).toBe("sent");
  });

  it("records a 'throttled' outcome when a re-fire is suppressed by the per-delivery throttle", async () => {
    const prevThrottle = process.env.QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS;
    process.env.QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS = String(60 * 60 * 1000);
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      const sent: AlertPayload[] = [];
      __setQueueFallbackAlerterDeliveriesForTests({
        pagerduty: async (p): Promise<DeliveryResult> => {
          sent.push(p);
          return { channel: "pagerduty", ok: true };
        },
        email: async (): Promise<DeliveryResult> => ({ channel: "email", ok: true }),
        slack: async (): Promise<DeliveryResult> => ({ channel: "slack", ok: true }),
      });

      recordQueueFallback("email");
      await evaluateQueueFallbackAlerts();

      // Recover (event ages out of the 5-minute recent window).
      vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
      await evaluateQueueFallbackAlerts();

      // Re-fire well inside the 60m throttle window.
      vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
      recordQueueFallback("email");
      await evaluateQueueFallbackAlerts();

      vi.useRealTimers();

      const rows = await fetchAlertRows();
      // 3 fire (initial) + 3 clear (recover) + 3 throttled (re-fire suppressed) = 9
      expect(rows).toHaveLength(9);

      const fireOutcomes = rows
        .filter((r) => (r.metadata as Record<string, unknown>).kind === "fire")
        .map((r) => (r.metadata as Record<string, unknown>).outcome)
        .sort();
      // First fire: 3x "sent"; second fire: 3x "throttled".
      expect(fireOutcomes).toEqual([
        "sent",
        "sent",
        "sent",
        "throttled",
        "throttled",
        "throttled",
      ]);

      const throttledRow = rows.find(
        (r) =>
          (r.metadata as Record<string, unknown>).outcome === "throttled" &&
          (r.metadata as Record<string, unknown>).deliveryChannel === "pagerduty",
      );
      expect(throttledRow).toBeDefined();
      expect(throttledRow!.description).toMatch(/Throttled fire alert via pagerduty/);
      expect((throttledRow!.metadata as Record<string, unknown>).reason).toBe("throttled");
    } finally {
      vi.useRealTimers();
      if (prevThrottle === undefined) delete process.env.QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS;
      else process.env.QUEUE_FALLBACK_NOTIFICATION_THROTTLE_MS = prevThrottle;
    }
  });

  it("records clear-transition deliveries so admins can confirm a resolve fired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: async (): Promise<DeliveryResult> => ({ channel: "pagerduty", ok: true }),
      email: async (): Promise<DeliveryResult> => ({ channel: "email", ok: true }),
      slack: async (): Promise<DeliveryResult> => ({ channel: "slack", ok: true }),
    });

    recordQueueFallback("sms");
    await evaluateQueueFallbackAlerts();

    vi.setSystemTime(new Date("2026-02-01T00:10:00Z"));
    await evaluateQueueFallbackAlerts();

    vi.useRealTimers();

    const rows = await fetchAlertRows();
    const clearRows = rows.filter(
      (r) => (r.metadata as Record<string, unknown>).kind === "clear",
    );
    expect(clearRows).toHaveLength(3);
    for (const row of clearRows) {
      expect(row.entityId).toBe("sms");
      expect((row.metadata as Record<string, unknown>).queueChannel).toBe("sms");
      expect((row.metadata as Record<string, unknown>).outcome).toBe("sent");
      expect(row.description).toMatch(/Sent clear alert via .* for sms queue/);
    }
  });
});
