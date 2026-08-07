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
let flaggedQueryErrorToThrow: Error | null = null;

vi.mock("@workspace/db", () => {
  const select = (_cols: unknown) => ({
    from: (_table: unknown) => ({
      innerJoin: (_t: unknown, _on: unknown) => ({
        leftJoin: (_t2: unknown, _on2: unknown) => ({
          leftJoin: (_t3: unknown, _on3: unknown) => ({
            where: (_cond: unknown) => ({
              groupBy: (_col: unknown) => ({
                orderBy: async (_o: unknown) => {
                  if (flaggedQueryErrorToThrow) {
                    throw flaggedQueryErrorToThrow;
                  }
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
  runScheduledDigestAttempt,
  describeDigestError,
  __setMachineMismatchDigestSenderForTests,
  __resetMachineMismatchDigestStateForTests,
  __getMachineMismatchDigestRetryStateForTests,
  getMachineMismatchDigestStatus,
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
  flaggedQueryErrorToThrow = null;
  mockOpsAlertEmail.value = null;
  __setMachineMismatchDigestSenderForTests(null);
  __resetMachineMismatchDigestStateForTests();
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

  it("exposes a heartbeat for the System Health page that advances on every run", async () => {
    // Before any run, the status carries the cadence but no last-run info so
    // the System Health card can render a "Pending" placeholder.
    const before = getMachineMismatchDigestStatus();
    expect(before.intervalMs).toBeGreaterThan(0);
    expect(before.lastRanAt).toBeNull();
    expect(before.lastOutcome).toBeNull();
    expect(before.lastFlaggedCount).toBeNull();
    expect(before.lastRecipient).toBeNull();
    expect(before.lastReason).toBeNull();

    // Successful "sent" run populates outcome, count, and recipient.
    mockOpsAlertEmail.value = "ops@example.com";
    flaggedQueryRows = [buildFlaggedRow(1), buildFlaggedRow(2)];
    __setMachineMismatchDigestSenderForTests(async () => {});
    await runMachineMismatchDigest();
    const afterSent = getMachineMismatchDigestStatus();
    expect(afterSent.lastOutcome).toBe("sent");
    expect(afterSent.lastFlaggedCount).toBe(2);
    expect(afterSent.lastRecipient).toBe("ops@example.com");
    expect(afterSent.lastReason).toBeNull();
    expect(afterSent.lastRanAt).not.toBeNull();
    const sentAt = new Date(afterSent.lastRanAt as string).getTime();
    expect(Number.isFinite(sentAt)).toBe(true);

    // A subsequent "skipped_no_mismatches" run rewrites the snapshot — admins
    // should always see the *most recent* run, never the last successful send.
    flaggedQueryRows = [];
    await runMachineMismatchDigest();
    const afterSkip = getMachineMismatchDigestStatus();
    expect(afterSkip.lastOutcome).toBe("skipped_no_mismatches");
    expect(afterSkip.lastFlaggedCount).toBe(0);
    expect(afterSkip.lastRecipient).toBeNull();

    // A failing run also advances the heartbeat (and surfaces the reason)
    // — exactly the signal an on-call needs for a sweep that started
    // silently throwing.
    flaggedQueryShouldThrow = true;
    await runMachineMismatchDigest();
    const afterFail = getMachineMismatchDigestStatus();
    expect(afterFail.lastOutcome).toBe("failed");
    expect(afterFail.lastReason).toContain("simulated DB outage");
    expect(afterFail.lastRanAt).not.toBeNull();
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

describe("getMachineMismatchDigestStatus — stale flag", () => {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  let prevInterval: string | undefined;

  beforeEach(() => {
    prevInterval = process.env.MACHINE_MISMATCH_DIGEST_INTERVAL_MS;
    process.env.MACHINE_MISMATCH_DIGEST_INTERVAL_MS = String(ONE_HOUR_MS);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T00:00:00Z"));
    // Re-seed the cold-start baseline at the (now frozen) current time so the
    // staleness window is measured from a known instant.
    __resetMachineMismatchDigestStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (prevInterval === undefined) {
      delete process.env.MACHINE_MISMATCH_DIGEST_INTERVAL_MS;
    } else {
      process.env.MACHINE_MISMATCH_DIGEST_INTERVAL_MS = prevInterval;
    }
  });

  it("treats a fresh cold start as not stale, then flips after 2× the interval with no run", () => {
    // Cold start: baseline just set, no run yet. Not stale even though
    // lastRanAt is null — matches the retention-sweep cards.
    expect(getMachineMismatchDigestStatus().lastRanAt).toBeNull();
    expect(getMachineMismatchDigestStatus().stale).toBe(false);

    // Exactly at 2× the interval is still within the window (boundary uses >).
    vi.advanceTimersByTime(2 * ONE_HOUR_MS);
    expect(getMachineMismatchDigestStatus().stale).toBe(false);

    // One tick past 2× the interval with no run trips the alarm.
    vi.advanceTimersByTime(1);
    expect(getMachineMismatchDigestStatus().stale).toBe(true);
  });

  it("clears the stale flag after a run and re-trips once the heartbeat ages past 2× the interval", async () => {
    // Let the baseline go stale first.
    vi.advanceTimersByTime(3 * ONE_HOUR_MS);
    expect(getMachineMismatchDigestStatus().stale).toBe(true);

    // A real run advances the heartbeat to "now" and clears staleness.
    flaggedQueryRows = [];
    await runMachineMismatchDigest();
    expect(getMachineMismatchDigestStatus().lastRanAt).not.toBeNull();
    expect(getMachineMismatchDigestStatus().stale).toBe(false);

    // Fresh through 2× the interval...
    vi.advanceTimersByTime(2 * ONE_HOUR_MS);
    expect(getMachineMismatchDigestStatus().stale).toBe(false);

    // ...and stale again just past it.
    vi.advanceTimersByTime(1);
    expect(getMachineMismatchDigestStatus().stale).toBe(true);
  });
});

describe("describeDigestError — cause-chain unwrapping", () => {
  it("surfaces the underlying Postgres error code + message from err.cause", () => {
    const pgErr = Object.assign(new Error("Authentication timed out"), {
      code: "08P01",
    });
    const drizzleErr = new Error("Failed query: select ...", { cause: pgErr });
    const detail = describeDigestError(drizzleErr);
    expect(detail.reason).toBe(
      "Failed query: select ... — caused by: [08P01] Authentication timed out",
    );
    expect(detail.dbErrorCode).toBe("08P01");
    expect(detail.dbErrorMessage).toBe("Authentication timed out");
  });

  it("falls back to the top-level message when there is no cause", () => {
    const detail = describeDigestError(new Error("plain failure"));
    expect(detail.reason).toBe("plain failure");
    expect(detail.dbErrorCode).toBeNull();
    expect(detail.dbErrorMessage).toBeNull();
  });

  it("walks nested causes to the deepest coded error", () => {
    const pgErr = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const mid = new Error("wrapper", { cause: pgErr });
    const top = new Error("Failed query: x", { cause: mid });
    const detail = describeDigestError(top);
    expect(detail.dbErrorCode).toBe("40P01");
    expect(detail.dbErrorMessage).toBe("deadlock detected");
  });
});

describe("failure detail capture in heartbeat + audit", () => {
  it("records the DB error code and cause message in the run reason, status, and audit metadata", async () => {
    flaggedQueryErrorToThrow = new Error("Failed query: select mismatch ...", {
      cause: Object.assign(new Error("Authentication timed out"), { code: "08P01" }),
    });
    const result = await runMachineMismatchDigest(Date.now());
    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("[08P01] Authentication timed out");
    expect(result.dbErrorCode).toBe("08P01");

    const status = getMachineMismatchDigestStatus();
    expect(status.lastReason).toContain("[08P01] Authentication timed out");
    expect(status.lastDbErrorCode).toBe("08P01");

    const audit = auditRows.at(-1)!;
    const auditMeta = audit.metadata as Record<string, unknown>;
    expect(auditMeta.dbErrorCode).toBe("08P01");
    expect(auditMeta.dbErrorMessage).toBe("Authentication timed out");
  });

  it("stamps trigger and attempt on the heartbeat and audit metadata", async () => {
    const result = await runMachineMismatchDigest(Date.now(), {
      trigger: "manual",
    });
    expect(result.trigger).toBe("manual");
    expect(result.attempt).toBe(0);
    const status = getMachineMismatchDigestStatus();
    expect(status.lastTrigger).toBe("manual");
    expect(status.lastAttempt).toBe(0);
    const audit = auditRows.at(-1)!;
    const auditMeta = audit.metadata as Record<string, unknown>;
    expect(auditMeta.trigger).toBe("manual");
    expect(auditMeta.attempt).toBe(0);
  });
});

describe("failure retry backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.MACHINE_MISMATCH_DIGEST_RETRY_BACKOFF_MS = "1000";
    process.env.MACHINE_MISMATCH_DIGEST_MAX_RETRIES = "2";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.MACHINE_MISMATCH_DIGEST_RETRY_BACKOFF_MS;
    delete process.env.MACHINE_MISMATCH_DIGEST_MAX_RETRIES;
  });

  it("schedules a short-backoff retry after a failed scheduled run and self-heals on success", async () => {
    flaggedQueryShouldThrow = true;
    const first = await runScheduledDigestAttempt("scheduled", 0);
    expect(first!.outcome).toBe("failed");
    let retryState = __getMachineMismatchDigestRetryStateForTests();
    expect(retryState.hasTimer).toBe(true);
    expect(getMachineMismatchDigestStatus().nextRetryAt).not.toBeNull();

    // DB recovers before the retry fires.
    flaggedQueryShouldThrow = false;
    await vi.advanceTimersByTimeAsync(1000);

    const status = getMachineMismatchDigestStatus();
    expect(status.lastOutcome).toBe("skipped_no_mismatches");
    expect(status.lastTrigger).toBe("retry");
    expect(status.lastAttempt).toBe(1);
    retryState = __getMachineMismatchDigestRetryStateForTests();
    expect(retryState.hasTimer).toBe(false);
    expect(status.nextRetryAt).toBeNull();
  });

  it("stops retrying after the bounded number of attempts", async () => {
    flaggedQueryShouldThrow = true;
    await runScheduledDigestAttempt("scheduled", 0);
    expect(__getMachineMismatchDigestRetryStateForTests().hasTimer).toBe(true);

    // Retry 1 fails → retry 2 scheduled.
    await vi.advanceTimersByTimeAsync(1000);
    expect(getMachineMismatchDigestStatus().lastAttempt).toBe(1);
    expect(__getMachineMismatchDigestRetryStateForTests().hasTimer).toBe(true);

    // Retry 2 fails → max reached, no further retry.
    await vi.advanceTimersByTimeAsync(1000);
    expect(getMachineMismatchDigestStatus().lastAttempt).toBe(2);
    expect(__getMachineMismatchDigestRetryStateForTests().hasTimer).toBe(false);
    expect(getMachineMismatchDigestStatus().nextRetryAt).toBeNull();
  });

  it("a manual run failure does not schedule a retry, and a manual success clears a pending one", async () => {
    flaggedQueryShouldThrow = true;
    const failed = await runMachineMismatchDigest(Date.now(), { trigger: "manual" });
    expect(failed.outcome).toBe("failed");
    expect(__getMachineMismatchDigestRetryStateForTests().hasTimer).toBe(false);

    // Now a scheduled failure leaves a pending retry...
    await runScheduledDigestAttempt("scheduled", 0);
    expect(__getMachineMismatchDigestRetryStateForTests().hasTimer).toBe(true);

    // ...which a successful manual run clears.
    flaggedQueryShouldThrow = false;
    const ok = await runMachineMismatchDigest(Date.now(), { trigger: "manual" });
    expect(ok.outcome).toBe("skipped_no_mismatches");
    expect(__getMachineMismatchDigestRetryStateForTests().hasTimer).toBe(false);
    expect(getMachineMismatchDigestStatus().nextRetryAt).toBeNull();
  });
});
