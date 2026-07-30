/**
 * resolveAdSpendReconciliation — manual reconciliation of stuck ad-spend deposits.
 *
 * Covers:
 *  1. reconciliation-needed deposit → ledger credit written + receipt email queued
 *     with reconciled amounts (order number, deposit, 3% fee, total charged)
 *  2. re-run → already_resolved, NO second credit, NO second email
 *  3. fresh-paid deposit (outcomeType "paid") → not_reconciliation_needed, no email
 *     (no duplicate of the receipt the paid path already sent)
 *  4. pre-existing credit row (onOrderPaid wrote it before failing) → resolved
 *     with creditInserted=false, single credit row, receipt still sent
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  productsTable,
  btsOrdersTable,
  checkoutIdempotencyTable,
  adSpendTransactionsTable,
  auditLogTable,
} from "@workspace/db";

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: vi.fn().mockResolvedValue(undefined),
    queueSms: vi.fn().mockResolvedValue(undefined),
  },
}));

import { CommunicationService } from "../lib/communication-service";
import { resolveAdSpendReconciliation } from "../lib/payments/ad-spend-funding-service";

const TEST_TAG = `adspend-recon-${randomUUID().slice(0, 8)}`;
const queueEmailMock = vi.mocked(CommunicationService.queueEmail);

let userId: number;
let productId: number;
const orderIds: number[] = [];
const idemKeys: string[] = [];

const DEPOSIT_CENTS = 250_000; // $2,500 deposit
const FEE_CENTS = 7_500; // 3%
const CHARGED_CENTS = 257_500;

async function seedStuckDeposit(opts?: { outcomeType?: string; transactionId?: string | null }) {
  const orderNumber = `NMI-TEST-${TEST_TAG}-${randomUUID().slice(0, 8)}`;
  const transactionId =
    opts?.transactionId === undefined ? `txn-${randomUUID().slice(0, 12)}` : opts.transactionId;
  const [order] = await db
    .insert(btsOrdersTable)
    .values({
      orderNumber,
      userId,
      email: `${TEST_TAG}@example.com`,
      totalCents: CHARGED_CENTS,
      currency: "USD",
      status: "paid",
      orderType: "wallet_topup",
      gatewayTransactionId: transactionId,
    })
    .returning();
  orderIds.push(order.id);

  const idempotencyKey = `idem-${TEST_TAG}-${randomUUID().slice(0, 8)}`;
  idemKeys.push(idempotencyKey);
  await db.insert(checkoutIdempotencyTable).values({
    idempotencyKey,
    userId,
    productId,
    status: "completed",
    orderId: order.id,
    result: {
      outcomeType: opts?.outcomeType ?? "paid_reconciliation_needed",
      status: opts?.outcomeType ?? "paid_reconciliation_needed",
      orderNumber,
      transactionId,
    },
    completedAt: new Date(),
  });

  return { orderNumber, orderId: order.id, transactionId };
}

beforeAll(async () => {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}@example.com`,
      name: `Recon Tester ${TEST_TAG}`,
      passwordHash: "x",
    })
    .returning();
  userId = user.id;

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-product`,
      name: `Recon test product ${TEST_TAG}`,
      priceCents: 0,
      currency: "USD",
    })
    .returning();
  productId = product.id;
});

afterAll(async () => {
  await db.delete(adSpendTransactionsTable).where(eq(adSpendTransactionsTable.userId, userId));
  if (idemKeys.length > 0) {
    await db
      .delete(checkoutIdempotencyTable)
      .where(inArray(checkoutIdempotencyTable.idempotencyKey, idemKeys));
  }
  if (orderIds.length > 0) {
    await db.delete(btsOrdersTable).where(inArray(btsOrdersTable.id, orderIds));
  }
  await db.delete(productsTable).where(eq(productsTable.id, productId));
  await db.delete(auditLogTable).where(eq(auditLogTable.actorId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
});

beforeEach(() => {
  queueEmailMock.mockClear();
});

describe("resolveAdSpendReconciliation", () => {
  it("writes the ledger credit and queues the receipt with reconciled amounts", async () => {
    const { orderNumber, transactionId } = await seedStuckDeposit();

    const outcome = await resolveAdSpendReconciliation({ orderNumber, actor: "ops-test" });

    expect(outcome.type).toBe("resolved");
    if (outcome.type !== "resolved") return;
    expect(outcome.creditedCents).toBe(DEPOSIT_CENTS);
    expect(outcome.feeCents).toBe(FEE_CENTS);
    expect(outcome.chargedCents).toBe(CHARGED_CENTS);
    expect(outcome.creditInserted).toBe(true);

    const credits = await db
      .select()
      .from(adSpendTransactionsTable)
      .where(eq(adSpendTransactionsTable.nmiTransactionId, transactionId!));
    expect(credits).toHaveLength(1);
    expect(credits[0].amountCents).toBe(DEPOSIT_CENTS);
    expect(credits[0].type).toBe("funding");

    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    const call = queueEmailMock.mock.calls[0][0] as Record<string, any>;
    expect(call.templateSlug).toBe("ad_spend_deposit_receipt");
    expect(call.userId).toBe(userId);
    expect(call.variables.order_number).toBe(orderNumber);
    expect(call.variables.deposit_amount).toBe("2,500.00");
    expect(call.variables.card_fee).toBe("75.00");
    expect(call.variables.total_charged).toBe("2,575.00");
  });

  it("re-run returns already_resolved with no second credit or email", async () => {
    const { orderNumber, transactionId } = await seedStuckDeposit();

    const first = await resolveAdSpendReconciliation({ orderNumber });
    expect(first.type).toBe("resolved");
    queueEmailMock.mockClear();

    const second = await resolveAdSpendReconciliation({ orderNumber });
    expect(second.type).toBe("already_resolved");
    expect(queueEmailMock).not.toHaveBeenCalled();

    const credits = await db
      .select()
      .from(adSpendTransactionsTable)
      .where(eq(adSpendTransactionsTable.nmiTransactionId, transactionId!));
    expect(credits).toHaveLength(1);
  });

  it("never re-sends a receipt for deposits that emailed on the fresh paid path", async () => {
    const { orderNumber } = await seedStuckDeposit({ outcomeType: "paid" });

    const outcome = await resolveAdSpendReconciliation({ orderNumber });
    expect(outcome.type).toBe("not_reconciliation_needed");
    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("keeps a single credit row when the original attempt already wrote it, still sends receipt", async () => {
    const { orderNumber, transactionId } = await seedStuckDeposit();

    // Simulate onOrderPaid having written the credit before failing later.
    await db.insert(adSpendTransactionsTable).values({
      userId,
      amountCents: DEPOSIT_CENTS,
      type: "funding",
      source: "nmi",
      nmiTransactionId: transactionId,
      note: "pre-existing credit",
    });

    const outcome = await resolveAdSpendReconciliation({ orderNumber });
    expect(outcome.type).toBe("resolved");
    if (outcome.type !== "resolved") return;
    expect(outcome.creditInserted).toBe(false);

    const credits = await db
      .select()
      .from(adSpendTransactionsTable)
      .where(eq(adSpendTransactionsTable.nmiTransactionId, transactionId!));
    expect(credits).toHaveLength(1);
    expect(queueEmailMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back the resolution claim when the credit write fails, so a retry still credits + emails once", async () => {
    const { orderNumber, transactionId } = await seedStuckDeposit();

    // Force the ledger insert inside the transaction to throw while letting
    // the claim UPDATE run for real — the whole tx must roll back.
    const origTransaction = db.transaction.bind(db);
    const txSpy = vi.spyOn(db, "transaction").mockImplementationOnce(((cb: any) =>
      origTransaction(async (tx: any) => {
        const proxied = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === "insert") {
              return () => {
                throw new Error("simulated credit write failure");
              };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return cb(proxied);
      })) as any);

    await expect(resolveAdSpendReconciliation({ orderNumber })).rejects.toThrow(
      "simulated credit write failure",
    );
    txSpy.mockRestore();

    // Claim must NOT have stuck: no credit, no email, and the retry succeeds.
    expect(queueEmailMock).not.toHaveBeenCalled();
    let credits = await db
      .select()
      .from(adSpendTransactionsTable)
      .where(eq(adSpendTransactionsTable.nmiTransactionId, transactionId!));
    expect(credits).toHaveLength(0);

    const retry = await resolveAdSpendReconciliation({ orderNumber });
    expect(retry.type).toBe("resolved");
    if (retry.type !== "resolved") return;
    expect(retry.creditInserted).toBe(true);

    credits = await db
      .select()
      .from(adSpendTransactionsTable)
      .where(eq(adSpendTransactionsTable.nmiTransactionId, transactionId!));
    expect(credits).toHaveLength(1);
    expect(queueEmailMock).toHaveBeenCalledTimes(1);
  });

  it("returns order_not_found for unknown or non-wallet-topup orders", async () => {
    const outcome = await resolveAdSpendReconciliation({ orderNumber: `nope-${TEST_TAG}` });
    expect(outcome.type).toBe("order_not_found");
  });
});
