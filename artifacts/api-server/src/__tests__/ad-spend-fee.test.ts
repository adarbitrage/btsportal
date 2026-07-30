import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AD_SPEND_CARD_FEE_RATE,
  cardFeeCents,
  chargedTotalCents,
} from "../lib/payments/ad-spend-fee.js";

describe("ad-spend card fee math", () => {
  it("uses a 3% rate", () => {
    expect(AD_SPEND_CARD_FEE_RATE).toBe(0.03);
  });

  it("computes 3% fee on typical amounts", () => {
    expect(cardFeeCents(250_000)).toBe(7_500); // $2,500 → $75.00
    expect(chargedTotalCents(250_000)).toBe(257_500); // $2,575.00
  });

  it("handles the min boundary ($1,000)", () => {
    expect(cardFeeCents(100_000)).toBe(3_000); // $30.00
    expect(chargedTotalCents(100_000)).toBe(103_000); // $1,030.00
  });

  it("handles the max boundary ($10,000)", () => {
    expect(cardFeeCents(1_000_000)).toBe(30_000); // $300.00
    expect(chargedTotalCents(1_000_000)).toBe(1_030_000); // $10,300.00
  });

  it("rounds fractional cents deterministically (half-up)", () => {
    // $2,501 → fee $75.03 exactly
    expect(cardFeeCents(250_100)).toBe(7_503);
    // 1015 cents ($10.15) * 0.03 = 30.45 → 30
    expect(cardFeeCents(1_015)).toBe(30);
    // 1050 cents * 0.03 = 31.5 → 32 (Math.round half-up)
    expect(cardFeeCents(1_050)).toBe(32);
    // charged total is always deposit + rounded fee (whole cents)
    expect(chargedTotalCents(250_100)).toBe(257_603);
  });
});

// ── Service-level: charge total includes fee, ledger credits deposit only ──

const runCheckoutCoreMock = vi.fn();
const peekMock = vi.fn();
const valuesMock = vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) }));

vi.mock("../lib/payments/checkout-core.js", () => ({
  runCheckoutCore: (opts: unknown) => runCheckoutCoreMock(opts),
}));
vi.mock("../lib/payments/checkout-idempotency.js", () => ({
  peekIdempotencyKey: (...args: unknown[]) => peekMock(...args),
}));
vi.mock("../storage/payment-methods-store.js", () => ({
  getPaymentMethodForUser: vi.fn(async () => ({ vaultId: "vault-1" })),
}));
const queueEmailMock = vi.fn(async () => ({ result: "queued" }));
vi.mock("../lib/communication-service.js", () => ({
  CommunicationService: {
    queueEmail: (...args: unknown[]) => queueEmailMock(...(args as [])),
  },
}));
vi.mock("@workspace/db", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => [{ id: 77, currency: "USD", email: "m@x.com", name: "Mem Ber" }],
  };
  return {
    db: {
      select: () => chain,
      insert: () => ({ values: valuesMock }),
    },
    usersTable: { id: "id", email: "email", name: "name" },
    productsTable: { id: "id", currency: "currency", slug: "slug" },
    adSpendTransactionsTable: { userId: "user_id" },
  };
});

describe("fundAdSpend fee behavior", () => {
  beforeEach(() => {
    runCheckoutCoreMock.mockReset();
    peekMock.mockReset();
    valuesMock.mockClear();
    queueEmailMock.mockClear();
    peekMock.mockResolvedValue({ type: "not_found" });
  });

  /** The receipt email is fired-and-forgotten; let queued microtasks drain. */
  async function drainReceiptSend() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  async function loadService() {
    const mod = await import("../lib/payments/ad-spend-funding-service.js");
    return mod.fundAdSpend;
  }

  it("charges deposit + 3% via checkout core and credits the deposit only", async () => {
    const fundAdSpend = await loadService();

    runCheckoutCoreMock.mockImplementation(async (opts: {
      amountCents: number;
      onOrderPaid: (
        orderId: number,
        orderNumber: string,
        details: { transactionId?: string; confirmedAmountCents?: number },
      ) => Promise<Record<string, unknown>>;
    }) => {
      // NMI confirms exactly what we asked it to charge
      const extra = await opts.onOrderPaid(1, "ORD-1", {
        transactionId: "txn-1",
        confirmedAmountCents: opts.amountCents,
      });
      return { type: "paid", orderNumber: "ORD-1", extra };
    });

    const outcome = await fundAdSpend({
      userId: 42,
      amountCents: 250_000,
      idempotencyKey: "key-1",
      paymentToken: "tok-1",
    });

    // Charged total sent to the gateway includes the fee
    expect(runCheckoutCoreMock).toHaveBeenCalledTimes(1);
    expect(runCheckoutCoreMock.mock.calls[0][0].amountCents).toBe(257_500);

    // Ledger credited the deposit, not the charged total
    expect(valuesMock).toHaveBeenCalledTimes(1);
    const inserted = (valuesMock.mock.calls as unknown as unknown[][])[0]![0] as {
      amountCents: number;
      note: string;
    };
    expect(inserted.amountCents).toBe(250_000);
    expect(inserted.note).toContain("$2575.00");
    expect(inserted.note).toContain("$75.00");

    expect(outcome).toMatchObject({
      type: "paid",
      creditedCents: 250_000,
      feeCents: 7_500,
      chargedCents: 257_500,
    });
  });

  it("validates the ENTERED amount, not the fee-inclusive total", async () => {
    const fundAdSpend = await loadService();

    // $10,000 entered is valid even though charged total ($10,300) exceeds the max
    runCheckoutCoreMock.mockImplementation(async (opts: {
      amountCents: number;
      onOrderPaid: (
        orderId: number,
        orderNumber: string,
        details: { transactionId?: string; confirmedAmountCents?: number },
      ) => Promise<Record<string, unknown>>;
    }) => {
      const extra = await opts.onOrderPaid(1, "ORD-2", {
        transactionId: "txn-2",
        confirmedAmountCents: opts.amountCents,
      });
      return { type: "paid", orderNumber: "ORD-2", extra };
    });

    const outcome = await fundAdSpend({
      userId: 42,
      amountCents: 1_000_000,
      idempotencyKey: "key-2",
      paymentToken: "tok-2",
    });
    expect(outcome.type).toBe("paid");
    expect(runCheckoutCoreMock.mock.calls[0][0].amountCents).toBe(1_030_000);

    // Out-of-range entered amount still rejected
    const rejected = await fundAdSpend({
      userId: 42,
      amountCents: 99_999,
      idempotencyKey: "key-3",
      paymentToken: "tok-3",
    });
    expect(rejected.type).toBe("amount_out_of_range");
  });

  it("replay_paid returns the ORIGINAL stored amounts, not recomputed ones", async () => {
    const fundAdSpend = await loadService();

    // Simulate checkout-core replaying a stored success result whose extra
    // carries the original credited/fee/charged split.
    runCheckoutCoreMock.mockResolvedValue({
      type: "replay_paid",
      orderNumber: "ORD-R",
      status: "paid",
      extra: { creditedCents: 250_000, feeCents: 7_500, chargedCents: 257_500 },
    });

    // Client retries with a DIFFERENT amount on the same key — server must
    // still answer with the original charge split.
    const outcome = await fundAdSpend({
      userId: 42,
      amountCents: 500_000,
      idempotencyKey: "key-replay",
      paymentToken: "tok-r",
    });

    expect(outcome).toEqual({
      type: "replay_paid",
      orderNumber: "ORD-R",
      creditedCents: 250_000,
      feeCents: 7_500,
      chargedCents: 257_500,
    });
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("queues a receipt email with order number, deposit, fee, and total on paid", async () => {
    const fundAdSpend = await loadService();

    runCheckoutCoreMock.mockImplementation(async (opts: {
      amountCents: number;
      onOrderPaid: (
        orderId: number,
        orderNumber: string,
        details: { transactionId?: string; confirmedAmountCents?: number },
      ) => Promise<Record<string, unknown>>;
    }) => {
      const extra = await opts.onOrderPaid(1, "ORD-R1", {
        transactionId: "txn-r1",
        confirmedAmountCents: opts.amountCents,
      });
      return { type: "paid", orderNumber: "ORD-R1", extra };
    });

    const outcome = await fundAdSpend({
      userId: 42,
      amountCents: 250_000,
      idempotencyKey: "key-r1",
      paymentToken: "tok-r1",
    });
    expect(outcome.type).toBe("paid");
    await drainReceiptSend();

    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    const call = (queueEmailMock.mock.calls as unknown as unknown[][])[0]![0] as {
      templateSlug: string;
      to: string;
      userId: number;
      variables: Record<string, string>;
    };
    expect(call.templateSlug).toBe("ad_spend_deposit_receipt");
    expect(call.to).toBe("m@x.com");
    expect(call.userId).toBe(42);
    expect(call.variables).toMatchObject({
      order_number: "ORD-R1",
      deposit_amount: "2,500.00",
      card_fee: "75.00",
      total_charged: "2,575.00",
    });
  });

  it("does NOT email on replay_paid, declined, or reconciliation-needed outcomes", async () => {
    const fundAdSpend = await loadService();

    runCheckoutCoreMock.mockResolvedValueOnce({
      type: "replay_paid",
      orderNumber: "ORD-RP",
      extra: { creditedCents: 250_000, feeCents: 7_500, chargedCents: 257_500 },
    });
    await fundAdSpend({ userId: 42, amountCents: 250_000, idempotencyKey: "k1", paymentToken: "t" });

    runCheckoutCoreMock.mockResolvedValueOnce({
      type: "declined",
      orderNumber: "ORD-D",
      message: "declined",
      declineReason: "card_declined",
    });
    await fundAdSpend({ userId: 42, amountCents: 250_000, idempotencyKey: "k2", paymentToken: "t" });

    runCheckoutCoreMock.mockResolvedValueOnce({
      type: "paid_reconciliation_needed",
      orderNumber: "ORD-RN",
      transactionId: "txn-x",
    });
    await fundAdSpend({ userId: 42, amountCents: 250_000, idempotencyKey: "k3", paymentToken: "t" });

    await drainReceiptSend();
    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("refuses to credit when NMI confirms a different total than deposit + fee", async () => {
    const fundAdSpend = await loadService();

    runCheckoutCoreMock.mockImplementation(async (opts: {
      onOrderPaid: (
        orderId: number,
        orderNumber: string,
        details: { transactionId?: string; confirmedAmountCents?: number },
      ) => Promise<Record<string, unknown>>;
    }) => {
      try {
        await opts.onOrderPaid(1, "ORD-3", {
          transactionId: "txn-3",
          confirmedAmountCents: 250_000, // deposit only — missing the fee
        });
        return { type: "paid", orderNumber: "ORD-3", extra: {} };
      } catch {
        // checkout-core converts onOrderPaid failures into reconciliation
        return { type: "paid_reconciliation_needed", orderNumber: "ORD-3", transactionId: "txn-3" };
      }
    });

    const outcome = await fundAdSpend({
      userId: 42,
      amountCents: 250_000,
      idempotencyKey: "key-4",
      paymentToken: "tok-4",
    });

    expect(outcome.type).toBe("paid_reconciliation_needed");
    expect(valuesMock).not.toHaveBeenCalled();
  });
});
