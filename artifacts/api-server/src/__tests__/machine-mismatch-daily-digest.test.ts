import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface FakeAuditRow {
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt?: Date;
}

interface FakeFlaggedRow {
  externalOrderId: string;
  userEmail: string | null;
  grantedSlugs: string[] | null;
  portalProductKeys: unknown;
  mostRecentPurchasedAt: Date | null;
}

const auditRows: FakeAuditRow[] = [];
let flaggedQueryRows: FakeFlaggedRow[] = [];
let flaggedQueryShouldThrow = false;

vi.mock("@workspace/db", () => {
  const select = (_cols: unknown) => ({
    from: (_table: unknown) => ({
      innerJoin: (_t: unknown, _on: unknown) => ({
        leftJoin: (_t2: unknown, _on2: unknown) => ({
          leftJoin: (_t3: unknown, _on3: unknown) => ({
            where: (_cond: unknown) => ({
              groupBy: (_col: unknown) => ({
                orderBy: async (_o: unknown) => {
                  if (flaggedQueryShouldThrow) {
                    throw new Error("simulated DB outage");
                  }
                  return flaggedQueryRows;
                },
              }),
            }),
          }),
        }),
      }),
    }),
  });

  const db = {
    insert: (_table: unknown) => ({
      values: async (row: FakeAuditRow) => {
        auditRows.push(row);
      },
    }),
    select,
  };

  return {
    db,
    userProductsTable: { externalOrderId: { n: "external_order_id" }, externalSource: { n: "external_source" }, purchasedAt: { n: "purchased_at" }, productId: { n: "product_id" }, userId: { n: "user_id" } },
    productsTable: { id: { n: "id" }, slug: { n: "slug" } },
    webhookLogsTable: { externalId: { n: "external_id" }, payload: { n: "payload" } },
    usersTable: { id: { n: "id" }, email: { n: "email" } },
    auditLogTable: {
      actionType: { n: "action_type" },
      entityType: { n: "entity_type" },
      entityId: { n: "entity_id" },
      description: { n: "description" },
      metadata: { n: "metadata" },
      createdAt: { n: "created_at" },
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  desc: (a: unknown) => ({ _desc: a }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ _gte: [a, b] }),
  isNotNull: (a: unknown) => ({ _isNotNull: a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) =>
      ({ _sql: strings.join("?") }) as unknown,
    {},
  ),
}));

const mockOpsAlertEmail = { value: null as string | null };
vi.mock("../lib/oncall-settings", () => ({
  getOnCallDestinations: async () => ({
    pagerdutyIntegrationKey: null,
    opsAlertEmail: mockOpsAlertEmail.value,
    opsAlertSlackWebhookUrl: null,
  }),
}));

vi.mock("../lib/portal-url-settings", () => ({
  getPortalUrl: async () => "https://portal.example.com",
}));

// Treat every row our fake query returns as a real mismatch. The actual
// computeOrderMismatch heuristic is covered separately in
// external-order-mismatch.test.ts.
vi.mock("../lib/external-order-mismatch", () => ({
  computeOrderMismatch: () => true,
  parsePortalProductKeys: (raw: unknown) =>
    Array.isArray(raw) ? raw : raw ? [String(raw)] : [],
}));

import {
  runMachineMismatchDigest,
  __setMachineMismatchDigestSenderForTests,
  MACHINE_MISMATCH_DIGEST_ACTION_TYPE,
  MACHINE_MISMATCH_DIGEST_ENTITY_TYPE,
  MACHINE_MISMATCH_DIGEST_ENTITY_ID,
} from "../lib/machine-mismatch-daily-digest";

function buildFlaggedRow(i: number): FakeFlaggedRow {
  return {
    externalOrderId: `order-${i}`,
    userEmail: `buyer${i}@example.com`,
    grantedSlugs: [`granted-slug-${i}`],
    portalProductKeys: [`expected-key-${i}`],
    mostRecentPurchasedAt: new Date("2026-05-26T12:00:00Z"),
  };
}

beforeEach(() => {
  auditRows.length = 0;
  flaggedQueryRows = [];
  flaggedQueryShouldThrow = false;
  mockOpsAlertEmail.value = null;
  __setMachineMismatchDigestSenderForTests(null);
});

afterEach(() => {
  __setMachineMismatchDigestSenderForTests(null);
});

describe("runMachineMismatchDigest", () => {
  it("suppresses the email entirely when there are zero flagged orders", async () => {
    mockOpsAlertEmail.value = "ops@example.com";
    let sent = 0;
    __setMachineMismatchDigestSenderForTests(async () => {
      sent++;
    });

    const result = await runMachineMismatchDigest();

    expect(result.outcome).toBe("skipped_no_mismatches");
    expect(result.flagged).toEqual([]);
    expect(sent).toBe(0);
    // The audit row is still written so admins can see the job fired on a
    // quiet day.
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].actionType).toBe(MACHINE_MISMATCH_DIGEST_ACTION_TYPE);
    expect(auditRows[0].entityType).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_TYPE);
    expect(auditRows[0].entityId).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_ID);
    expect((auditRows[0].metadata as Record<string, unknown>).outcome).toBe(
      "skipped_no_mismatches",
    );
  });

  it("emails the ops list with a summary table and admin link when orders are flagged", async () => {
    mockOpsAlertEmail.value = "ops@example.com";
    flaggedQueryRows = [buildFlaggedRow(1), buildFlaggedRow(2)];
    const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
    __setMachineMismatchDigestSenderForTests(async (msg) => {
      sent.push({ to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    });

    const result = await runMachineMismatchDigest();

    expect(result.outcome).toBe("sent");
    expect(result.flagged.length).toBe(2);
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe("ops@example.com");
    expect(sent[0].subject).toMatch(/2 Machine orders/);
    // Each flagged order appears with its id, buyer, granted slugs, and
    // portal_product_keys in the plaintext body.
    for (const id of ["order-1", "order-2"]) {
      expect(sent[0].text).toContain(id);
      expect(sent[0].html).toContain(id);
    }
    expect(sent[0].text).toContain("buyer1@example.com");
    expect(sent[0].text).toContain("granted-slug-2");
    expect(sent[0].text).toContain("expected-key-1");
    // Link points into the admin Integrations page.
    expect(sent[0].text).toContain(
      "https://portal.example.com/admin/integrations/yse?source=machine",
    );

    expect(auditRows.length).toBe(1);
    const meta = auditRows[0].metadata as Record<string, unknown>;
    expect(meta.outcome).toBe("sent");
    expect(meta.flaggedCount).toBe(2);
    expect(meta.recipient).toBe("ops@example.com");
  });

  it("skips the email when no ops recipient is configured but still records the run", async () => {
    mockOpsAlertEmail.value = null;
    flaggedQueryRows = [buildFlaggedRow(1)];
    let sent = 0;
    __setMachineMismatchDigestSenderForTests(async () => {
      sent++;
    });

    const result = await runMachineMismatchDigest();

    expect(result.outcome).toBe("skipped_no_recipient");
    expect(result.flagged.length).toBe(1);
    expect(sent).toBe(0);
    expect(
      (auditRows[0].metadata as Record<string, unknown>).outcome,
    ).toBe("skipped_no_recipient");
  });

  it("records a failed outcome with a reason when the underlying query throws", async () => {
    mockOpsAlertEmail.value = "ops@example.com";
    flaggedQueryShouldThrow = true;

    const result = await runMachineMismatchDigest();

    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("simulated DB outage");
    expect(auditRows.length).toBe(1);
    const meta = auditRows[0].metadata as Record<string, unknown>;
    expect(meta.outcome).toBe("failed");
    expect(meta.reason).toContain("simulated DB outage");
  });

  it("records a failed outcome when the email send throws", async () => {
    mockOpsAlertEmail.value = "ops@example.com";
    flaggedQueryRows = [buildFlaggedRow(1)];
    __setMachineMismatchDigestSenderForTests(async () => {
      throw new Error("sendgrid 502");
    });

    const result = await runMachineMismatchDigest();

    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("sendgrid 502");
    expect(
      (auditRows[0].metadata as Record<string, unknown>).outcome,
    ).toBe("failed");
  });
});
