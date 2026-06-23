import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { db, auditLogTable } from "@workspace/db";
import { and, eq, gt, desc } from "drizzle-orm";
import {
  evaluateRetellAgentAlert,
  __resetRetellAgentAlerterForTests,
  __setRetellAgentAlerterDeliveriesForTests,
  RETELL_AGENT_ALERT_ACTION_TYPE,
  RETELL_AGENT_ALERT_ENTITY_TYPE,
  RETELL_AGENT_ALERT_ENTITY_ID,
  type DeliveryResult,
} from "../lib/retell-agent-alerter";
import {
  setCachedRetellSetupResult,
  type RetellSetupResult,
} from "../lib/retell-agent-setup";

const stamp = "2026-06-23T00:00:00.000Z";

const MISCONFIGURED: RetellSetupResult = {
  skipped: true,
  reason: `RETELL_AGENT_ID must start with "agent_" (got "llm_abc123…")`,
  ranAt: stamp,
};

const HEALTHY: RetellSetupResult = {
  skipped: false,
  reason: "KB tool and prompt already match — no changes needed",
  ranAt: stamp,
};

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
        eq(auditLogTable.actionType, RETELL_AGENT_ALERT_ACTION_TYPE),
      ),
    );
}

async function fetchAlertRows() {
  return db
    .select()
    .from(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        eq(auditLogTable.actionType, RETELL_AGENT_ALERT_ACTION_TYPE),
      ),
    )
    .orderBy(desc(auditLogTable.id));
}

afterAll(async () => {
  await clearAlertRows();
});

beforeEach(async () => {
  __resetRetellAgentAlerterForTests();
  await clearAlertRows();
  __setRetellAgentAlerterDeliveriesForTests({
    pagerduty: async (): Promise<DeliveryResult> => ({ channel: "pagerduty", ok: true }),
    email: async (): Promise<DeliveryResult> => ({ channel: "email", ok: true }),
    slack: async (): Promise<DeliveryResult> => ({ channel: "slack", ok: true }),
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  __setRetellAgentAlerterDeliveriesForTests(null);
  vi.restoreAllMocks();
});

describe("retell-agent-alerter writes timeline audit rows", () => {
  it("records one alert row per delivery channel on a fire transition", async () => {
    setCachedRetellSetupResult(MISCONFIGURED);
    await evaluateRetellAgentAlert();

    const rows = await fetchAlertRows();
    expect(rows).toHaveLength(3);

    for (const row of rows) {
      expect(row.entityType).toBe(RETELL_AGENT_ALERT_ENTITY_TYPE);
      expect(row.entityId).toBe(RETELL_AGENT_ALERT_ENTITY_ID);
      const meta = row.metadata as Record<string, unknown>;
      expect(meta.kind).toBe("fire");
      expect(meta.outcome).toBe("sent");
      expect(meta.status).toBe("misconfigured");
    }

    const channels = rows
      .map((r) => (r.metadata as Record<string, unknown>).deliveryChannel)
      .sort();
    expect(channels).toEqual(["email", "pagerduty", "slack"]);
  });

  it("records clear-transition rows when the agent recovers", async () => {
    setCachedRetellSetupResult(MISCONFIGURED);
    await evaluateRetellAgentAlert();

    setCachedRetellSetupResult(HEALTHY);
    await evaluateRetellAgentAlert();

    const rows = await fetchAlertRows();
    const clearRows = rows.filter(
      (r) => (r.metadata as Record<string, unknown>).kind === "clear",
    );
    expect(clearRows).toHaveLength(3);
    for (const row of clearRows) {
      expect((row.metadata as Record<string, unknown>).outcome).toBe("sent");
      expect((row.metadata as Record<string, unknown>).status).toBe("healthy");
      expect(row.description).toMatch(/clear alert via .* for voice assistant agent/);
    }
  });
});
