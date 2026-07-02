import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db, usersTable, btsOrdersTable, memberRefundEventsTable, systemSettingsTable } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { classifyTransaction, __resetNmiRefundPollerStateForTests } from "../lib/nmi-refund-poller";
import type { NmiTransactionRecord } from "../lib/payments/nmi-gateway";

// Poller is READ-ONLY against NMI and never touches charging/refund/dunning
// logic. These tests exercise: classification, matching to bts_orders,
// idempotent insert (dedup), unmatched-but-recorded (never dropped), and
// watermark advance. The gateway network call is mocked; nothing here talks
// to real NMI.

const TAG = `nmi-poller-${randomUUID().slice(0, 8)}`;
const WATERMARK_KEY = "nmi_refund_poller.last_polled_at";

const hoisted = vi.hoisted(() => ({
  transactions: [] as NmiTransactionRecord[],
}));

vi.mock("../lib/payments/nmi-gateway.js", () => ({
  queryTransactionsByDateRange: async () => ({
    transactions: hoisted.transactions,
    raw: "<xml/>",
  }),
}));

const userIds: number[] = [];
const orderIds: number[] = [];

let memberId: number;
let orderNumber: string;

async function insertMember(): Promise<number> {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}@example.test`,
      name: "Refund Poller Member",
      passwordHash: "x",
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

async function insertOrder(memberId: number, orderNumber: string): Promise<number> {
  const [row] = await db
    .insert(btsOrdersTable)
    .values({
      orderNumber,
      userId: memberId,
      email: `${TAG}@example.test`,
      totalCents: 9900,
      status: "paid",
      orderType: "one_time",
    })
    .returning({ id: btsOrdersTable.id });
  orderIds.push(row.id);
  return row.id;
}

async function cleanupEvents() {
  await db.delete(memberRefundEventsTable).where(like(memberRefundEventsTable.nmiTransactionId, `${TAG}%`));
}

beforeAll(async () => {
  memberId = await insertMember();
  orderNumber = `${TAG}-order-1`;
  await insertOrder(memberId, orderNumber);
});

afterAll(async () => {
  await cleanupEvents();
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, WATERMARK_KEY));
  if (orderIds.length > 0) await db.delete(btsOrdersTable).where(inArray(btsOrdersTable.id, orderIds));
  if (userIds.length > 0) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
});

beforeEach(async () => {
  hoisted.transactions = [];
  __resetNmiRefundPollerStateForTests();
});

describe("classifyTransaction", () => {
  it("classifies a successful refund action", () => {
    const result = classifyTransaction({
      transactionId: "txn-1",
      orderId: "order-1",
      condition: "refunded",
      actions: [
        { actionType: "sale", amountCents: 5000, date: "2026-01-01T00:00:00Z", success: true },
        { actionType: "refund", amountCents: 5000, date: "2026-01-02T00:00:00Z", success: true },
      ],
    });
    expect(result).toMatchObject({ type: "refund", amountCents: 5000, transactionId: "txn-1" });
  });

  it("classifies a chargeback and prefers it over a co-present refund action", () => {
    const result = classifyTransaction({
      transactionId: "txn-2",
      orderId: "order-2",
      condition: undefined,
      actions: [
        { actionType: "refund", amountCents: 1000, date: "2026-01-01T00:00:00Z", success: true },
        { actionType: "chargeback", amountCents: 1000, date: "2026-01-03T00:00:00Z", success: true },
      ],
    });
    expect(result?.type).toBe("chargeback");
  });

  it("treats a void as a refund", () => {
    const result = classifyTransaction({
      transactionId: "txn-3",
      orderId: "order-3",
      condition: undefined,
      actions: [{ actionType: "void", amountCents: 2500, date: "2026-01-01T00:00:00Z", success: true }],
    });
    expect(result?.type).toBe("refund");
  });

  it("falls back to condition=chargeback when there's no explicit chargeback action", () => {
    const result = classifyTransaction({
      transactionId: "txn-4",
      orderId: "order-4",
      condition: "chargeback",
      actions: [{ actionType: "sale", amountCents: 3000, date: "2026-01-01T00:00:00Z", success: true }],
    });
    expect(result?.type).toBe("chargeback");
  });

  it("returns null for a plain sale with no reversal action", () => {
    const result = classifyTransaction({
      transactionId: "txn-5",
      orderId: "order-5",
      condition: "complete",
      actions: [{ actionType: "sale", amountCents: 1000, date: "2026-01-01T00:00:00Z", success: true }],
    });
    expect(result).toBeNull();
  });

  it("ignores a failed reversal attempt", () => {
    const result = classifyTransaction({
      transactionId: "txn-6",
      orderId: "order-6",
      condition: undefined,
      actions: [{ actionType: "refund", amountCents: 1000, date: "2026-01-01T00:00:00Z", success: false }],
    });
    expect(result).toBeNull();
  });
});

describe("pollNmiRefundEvents", () => {
  it("matches a transaction to a member via bts_orders and inserts a matched event", async () => {
    const { pollNmiRefundEvents } = await import("../lib/nmi-refund-poller");
    hoisted.transactions = [
      {
        transactionId: `${TAG}-matched-1`,
        orderId: orderNumber,
        condition: "refunded",
        actions: [{ actionType: "refund", amountCents: 4500, date: "2026-06-01T00:00:00Z", success: true }],
      },
    ];

    const result = await pollNmiRefundEvents();
    expect(result.eventsMatched).toBe(1);
    expect(result.eventsUnmatched).toBe(0);
    expect(result.error).toBeNull();

    const [row] = await db
      .select()
      .from(memberRefundEventsTable)
      .where(eq(memberRefundEventsTable.nmiTransactionId, `${TAG}-matched-1`));
    expect(row).toBeTruthy();
    expect(row.memberId).toBe(memberId);
    expect(row.matched).toBe(true);
    expect(row.type).toBe("refund");
    expect(row.amountCents).toBe(4500);
  });

  it("still records (never drops) a transaction with no matching order", async () => {
    const { pollNmiRefundEvents } = await import("../lib/nmi-refund-poller");
    hoisted.transactions = [
      {
        transactionId: `${TAG}-unmatched-1`,
        orderId: "order-does-not-exist",
        condition: undefined,
        actions: [{ actionType: "chargeback", amountCents: 2000, date: "2026-06-02T00:00:00Z", success: true }],
      },
    ];

    const result = await pollNmiRefundEvents();
    expect(result.eventsUnmatched).toBe(1);
    expect(result.eventsMatched).toBe(0);

    const [row] = await db
      .select()
      .from(memberRefundEventsTable)
      .where(eq(memberRefundEventsTable.nmiTransactionId, `${TAG}-unmatched-1`));
    expect(row).toBeTruthy();
    expect(row.matched).toBe(false);
    expect(row.memberId).toBeNull();
  });

  it("is idempotent: re-polling the same transaction never double-inserts", async () => {
    const { pollNmiRefundEvents } = await import("../lib/nmi-refund-poller");
    const txnId = `${TAG}-dedup-1`;
    hoisted.transactions = [
      {
        transactionId: txnId,
        orderId: orderNumber,
        condition: undefined,
        actions: [{ actionType: "refund", amountCents: 1000, date: "2026-06-03T00:00:00Z", success: true }],
      },
    ];

    const first = await pollNmiRefundEvents();
    expect(first.eventsInserted).toBe(1);

    // Same transaction re-appears in the next (overlapping) window.
    const second = await pollNmiRefundEvents();
    expect(second.eventsInserted).toBe(0);

    const rows = await db
      .select()
      .from(memberRefundEventsTable)
      .where(eq(memberRefundEventsTable.nmiTransactionId, txnId));
    expect(rows.length).toBe(1);
  });

  it("advances the watermark on a successful poll", async () => {
    const { pollNmiRefundEvents } = await import("../lib/nmi-refund-poller");
    hoisted.transactions = [];

    const before = await db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, WATERMARK_KEY));

    const result = await pollNmiRefundEvents();

    const [after] = await db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, WATERMARK_KEY));

    expect(after).toBeTruthy();
    const afterValue = (after.value as { lastPolledAt: string }).lastPolledAt;
    expect(new Date(afterValue).toISOString()).toBe(result.windowEnd);

    if (before.length > 0) {
      const beforeValue = (before[0].value as { lastPolledAt: string }).lastPolledAt;
      expect(new Date(afterValue).getTime()).toBeGreaterThanOrEqual(new Date(beforeValue).getTime());
    }
  });
});
