/**
 * Ad-spend deposit funding service.
 *
 * Accepts a member-chosen amount ($1,000–$10,000), charges it via the shared
 * NMI checkout core, and on success inserts one `funding` credit row into the
 * ad_spend_transactions ledger keyed by the NMI transaction id.
 *
 * This service does NOT grant entitlements, change a member's level, or appear
 * in any content-access, rank, or fulfillment registry — it is purely a wallet
 * top-up.
 */

import { eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  productsTable,
  adSpendTransactionsTable,
  btsOrdersTable,
  checkoutIdempotencyTable,
} from "@workspace/db";
import { logAuditEvent } from "../audit-log.js";
import { runCheckoutCore } from "./checkout-core.js";
import { cardFeeCents, chargedTotalCents } from "./ad-spend-fee.js";
import { peekIdempotencyKey } from "./checkout-idempotency.js";
import { getPaymentMethodForUser } from "../../storage/payment-methods-store.js";
import { CommunicationService } from "../communication-service.js";

export const AD_SPEND_FUNDING_SLUG = "ad-spend-funding";

const MIN_AMOUNT_CENTS = 100_000;
const MAX_AMOUNT_CENTS = 1_000_000;

export type AdSpendFundingOutcome =
  | { type: "paid"; orderNumber: string; creditedCents: number; feeCents: number; chargedCents: number }
  | {
      type: "replay_paid";
      orderNumber: string;
      creditedCents?: number;
      feeCents?: number;
      chargedCents?: number;
    }
  | { type: "paid_reconciliation_needed"; orderNumber: string; transactionId?: string }
  | { type: "replay_reconciliation_needed"; orderNumber: string }
  | { type: "declined"; message: string; orderNumber?: string; declineReason?: string }
  | { type: "replay_declined"; message: string; orderNumber?: string }
  | { type: "in_progress" }
  | { type: "conflict" }
  | { type: "amount_out_of_range"; message: string }
  | { type: "product_not_configured" }
  | { type: "user_not_found" }
  | { type: "payment_method_not_found" };

interface AdSpendFundingParams {
  userId: number;
  amountCents: number;
  idempotencyKey: string;
  paymentToken?: string;
  paymentMethodId?: number;
}

export async function fundAdSpend(params: AdSpendFundingParams): Promise<AdSpendFundingOutcome> {
  const { userId, amountCents, idempotencyKey, paymentToken, paymentMethodId } = params;

  if (amountCents < MIN_AMOUNT_CENTS || amountCents > MAX_AMOUNT_CENTS) {
    return {
      type: "amount_out_of_range",
      message: `Amount must be between $1,000 and $10,000. Received $${(amountCents / 100).toFixed(2)}.`,
    };
  }

  const [product] = await db
    .select({ id: productsTable.id, currency: productsTable.currency })
    .from(productsTable)
    .where(eq(productsTable.slug, AD_SPEND_FUNDING_SLUG))
    .limit(1);

  if (!product) {
    console.error("[AdSpendFunding] anchor product not found — ensure boot seed ran");
    return { type: "product_not_configured" };
  }

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) return { type: "user_not_found" };

  const nameParts = (user.name ?? "").trim().split(" ");
  const firstName = nameParts[0] ?? undefined;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

  // Card deposits carry a 3% transaction fee: charge deposit + fee, credit deposit.
  const feeCents = cardFeeCents(amountCents);
  const chargedCents = chargedTotalCents(amountCents);

  const peek = await peekIdempotencyKey(idempotencyKey, userId, product.id);
  let resolvedVaultId: string | undefined;
  if (peek.type === "not_found") {
    if (paymentMethodId !== undefined) {
      const method = await getPaymentMethodForUser(paymentMethodId, userId);
      if (!method) return { type: "payment_method_not_found" };
      resolvedVaultId = method.vaultId;
    } else if (paymentToken === undefined) {
      return { type: "payment_method_not_found" };
    }
  }

  const coreResult = await runCheckoutCore({
    userId,
    productId: product.id,
    email: user.email,
    firstName,
    lastName,
    idempotencyKey,
    amountCents: chargedCents,
    currency: product.currency ?? "USD",
    orderType: "wallet_topup",
    grantEntitlements: false,
    entitlementKeys: [],
    durationDays: null,
    lineItemDescription: `Ad-Spend Funding Deposit ($${(amountCents / 100).toFixed(2)} credit + 3% card fee)`,
    ...(resolvedVaultId !== undefined ? { resolvedVaultId } : {}),
    ...(paymentToken !== undefined ? { paymentToken } : {}),
    onOrderPaid: async (_orderId, _orderNumber, chargeDetails) => {
      const confirmedCents = chargeDetails?.confirmedAmountCents;
      const transactionId = chargeDetails?.transactionId;

      if (!confirmedCents || !transactionId) {
        throw new Error(
          "NMI did not return a parseable confirmed amount or transaction id — " +
          "credit not written. Manual reconciliation required.",
        );
      }

      if (confirmedCents !== chargedCents) {
        throw new Error(
          `NMI confirmed $${(confirmedCents / 100).toFixed(2)} but expected charge was ` +
          `$${(chargedCents / 100).toFixed(2)} (deposit + 3% fee) — credit not written. ` +
          "Manual reconciliation required.",
        );
      }

      await db
        .insert(adSpendTransactionsTable)
        .values({
          userId,
          amountCents,
          type: "funding",
          source: "nmi",
          nmiTransactionId: transactionId ?? null,
          note:
            `Deposit via NMI checkout (order ${_orderNumber}) — card charged ` +
            `$${(chargedCents / 100).toFixed(2)} incl. $${(feeCents / 100).toFixed(2)} 3% card fee`,
        })
        .onConflictDoNothing();

      // Persisted into the idempotency result so replays return the
      // authoritative original amounts rather than client-side recomputation.
      return { creditedCents: amountCents, feeCents, chargedCents };
    },
  });

  switch (coreResult.type) {
    case "paid": {
      const creditedCents = coreResult.extra?.creditedCents as number | undefined;
      if (creditedCents === undefined) {
        // onOrderPaid throws when confirmedCents is missing, so this path
        // should never be reached; surface as reconciliation-needed to avoid
        // returning an inaccurate amount to the caller.
        return { type: "paid_reconciliation_needed", orderNumber: coreResult.orderNumber };
      }
      // Receipt email — fire-and-forget so a comms hiccup can never fail a
      // charge that already succeeded. Only the fresh `paid` outcome sends:
      // replays already emailed on the original attempt, and declined /
      // reconciliation-needed outcomes must not claim a credited deposit.
      void sendDepositReceiptEmail({
        userId,
        email: user.email,
        memberName: user.name ?? "there",
        orderNumber: coreResult.orderNumber,
        creditedCents,
        feeCents,
        chargedCents,
      });
      // Short SMS confirmation (Task #2049) — same fresh-paid-only rule as
      // the email, gated on smsOptIn AND billingSmsOptIn like the
      // purchase_confirmation SMS in webhook-handler.ts.
      void sendDepositReceiptSms({ userId, creditedCents, feeCents, chargedCents });
      return { type: "paid", orderNumber: coreResult.orderNumber, creditedCents, feeCents, chargedCents };
    }
    case "replay_paid": {
      // Original amounts ride the stored idempotency result (see onOrderPaid).
      const extra = coreResult.extra ?? {};
      const num = (v: unknown): number | undefined =>
        typeof v === "number" && Number.isFinite(v) ? v : undefined;
      const replayCredited = num(extra.creditedCents);
      const replayFee = num(extra.feeCents);
      const replayCharged = num(extra.chargedCents);
      return {
        type: "replay_paid",
        orderNumber: coreResult.orderNumber,
        ...(replayCredited !== undefined ? { creditedCents: replayCredited } : {}),
        ...(replayFee !== undefined ? { feeCents: replayFee } : {}),
        ...(replayCharged !== undefined ? { chargedCents: replayCharged } : {}),
      };
    }
    case "paid_reconciliation_needed":
      return {
        type: "paid_reconciliation_needed",
        orderNumber: coreResult.orderNumber,
        transactionId: coreResult.transactionId ?? undefined,
      };
    case "replay_reconciliation_needed":
      return {
        type: "replay_reconciliation_needed",
        orderNumber: coreResult.orderNumber,
      };
    case "declined":
      return {
        type: "declined",
        message: coreResult.message,
        orderNumber: coreResult.orderNumber,
        declineReason: coreResult.declineReason,
      };
    case "replay_declined":
      return {
        type: "replay_declined",
        message: coreResult.message,
        orderNumber: coreResult.orderNumber,
      };
    case "in_progress":
      return { type: "in_progress" };
    case "conflict":
      return { type: "conflict" };
    default: {
      const _exhaustive: never = coreResult;
      return { type: "product_not_configured" };
    }
  }
}

/** Format whole cents as a display string like "2,500.00". */
function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Queue the ad-spend deposit receipt email. Never throws — a comms failure
 * must not affect the payment outcome returned to the caller.
 */
async function sendDepositReceiptEmail(params: {
  userId: number;
  email: string;
  memberName: string;
  orderNumber: string;
  creditedCents: number;
  feeCents: number;
  chargedCents: number;
}): Promise<void> {
  const { userId, email, memberName, orderNumber, creditedCents, feeCents, chargedCents } = params;
  try {
    // New balance is best-effort: if the read fails, send the receipt
    // without the balance line rather than dropping the receipt.
    let balanceBlockHtml = "";
    let balanceLineText = "";
    try {
      const balanceCents = await getAdSpendBalance(userId);
      const display = formatCents(balanceCents);
      balanceBlockHtml =
        `<p>Your new ad-spend balance is <strong>$${display}</strong>.</p>`;
      balanceLineText = `New ad-spend balance: $${display}\n`;
    } catch (err) {
      console.error("[AdSpendFunding] balance read for receipt email failed:", err);
    }

    await CommunicationService.queueEmail({
      templateSlug: "ad_spend_deposit_receipt",
      to: email,
      userId,
      variables: {
        member_name: memberName,
        order_number: orderNumber,
        deposit_amount: formatCents(creditedCents),
        card_fee: formatCents(feeCents),
        total_charged: formatCents(chargedCents),
        balance_block_html: balanceBlockHtml,
        balance_line_text: balanceLineText,
      },
    });
  } catch (err) {
    console.error("[AdSpendFunding] deposit receipt email failed:", err);
  }
}

export type AdSpendReconcileOutcome =
  | {
      type: "resolved";
      orderNumber: string;
      creditedCents: number;
      feeCents: number;
      chargedCents: number;
      creditInserted: boolean;
    }
  | { type: "already_resolved"; orderNumber: string }
  | { type: "not_reconciliation_needed"; orderNumber: string }
  | { type: "order_not_found" }
  | { type: "amount_underivable"; orderNumber: string }
  | { type: "user_not_found"; orderNumber: string };

/**
 * Queue the ad-spend deposit receipt SMS. Sent only on the fresh `paid`
 * outcome, gated on the member's master smsOptIn AND billingSmsOptIn (the
 * same gate as the purchase_confirmation SMS). Never throws — a comms
 * failure must not affect the payment outcome returned to the caller.
 */
async function sendDepositReceiptSms(params: {
  userId: number;
  creditedCents: number;
  feeCents: number;
  chargedCents: number;
}): Promise<void> {
  const { userId, creditedCents, feeCents, chargedCents } = params;
  try {
    const [smsUser] = await db
      .select({
        phone: usersTable.phone,
        smsOptIn: usersTable.smsOptIn,
        billingSmsOptIn: usersTable.billingSmsOptIn,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!smsUser?.phone || !smsUser.smsOptIn || !smsUser.billingSmsOptIn) return;

    await CommunicationService.queueSms({
      templateSlug: "ad_spend_deposit_receipt",
      to: smsUser.phone,
      userId,
      variables: {
        deposit_amount: formatCents(creditedCents),
        card_fee: formatCents(feeCents),
        total_charged: formatCents(chargedCents),
      },
    });
  } catch (err) {
    console.error("[AdSpendFunding] deposit receipt SMS failed:", err);
  }
}

/**
 * Read a member's current ad-spend balance (SUM of all ledger rows).
 * Returns 0 for members with no rows.
 */
export async function getAdSpendBalance(userId: number): Promise<number> {
  const [row] = await db
    .select({ balance: sql<string>`COALESCE(SUM(amount_cents), 0)` })
    .from(adSpendTransactionsTable)
    .where(eq(adSpendTransactionsTable.userId, userId));

  return parseInt(row?.balance ?? "0", 10);
}

/**
 * Derive the deposit (credited) amount from the total charged to the card
 * (deposit + 3% fee, fee rounded half-up). Searches a ±2¢ window around the
 * naive inverse to absorb rounding; returns undefined when no deposit amount
 * reproduces the charged total exactly.
 */
function depositCentsFromChargedTotal(chargedCents: number): number | undefined {
  const approx = Math.round(chargedCents / 1.03);
  for (let candidate = approx - 2; candidate <= approx + 2; candidate++) {
    if (candidate > 0 && chargedTotalCents(candidate) === chargedCents) return candidate;
  }
  return undefined;
}

/**
 * Resolve a stuck `paid_reconciliation_needed` ad-spend deposit.
 *
 * Money already moved on the original charge; this completes the two steps
 * that failed or were never confirmed:
 *   1. Writes the `funding` credit row into the ad-spend ledger (idempotent —
 *      the partial unique index on nmi_transaction_id absorbs the case where
 *      the original onOrderPaid callback DID write the credit before failing).
 *   2. Queues the `ad_spend_deposit_receipt` email with the reconciled
 *      amounts — exactly once, guarded by a conditional JSONB update on the
 *      idempotency row (first resolver wins; re-runs return already_resolved).
 *
 * Fresh `paid` deposits never enter this path (their stored outcomeType is
 * "paid"), so the receipt they already received is never duplicated.
 */
export async function resolveAdSpendReconciliation(params: {
  orderNumber: string;
  actor?: string;
}): Promise<AdSpendReconcileOutcome> {
  const { orderNumber, actor } = params;

  const [order] = await db
    .select()
    .from(btsOrdersTable)
    .where(eq(btsOrdersTable.orderNumber, orderNumber))
    .limit(1);

  if (!order || order.orderType !== "wallet_topup") return { type: "order_not_found" };

  const [idem] = await db
    .select()
    .from(checkoutIdempotencyTable)
    .where(eq(checkoutIdempotencyTable.orderId, order.id))
    .limit(1);

  const storedResult = (idem?.result ?? null) as Record<string, unknown> | null;
  if (!idem || storedResult?.outcomeType !== "paid_reconciliation_needed") {
    return { type: "not_reconciliation_needed", orderNumber };
  }
  if (storedResult.reconciliationResolvedAt !== undefined) {
    return { type: "already_resolved", orderNumber };
  }

  const chargedCents = order.totalCents;
  const creditedCents = depositCentsFromChargedTotal(chargedCents);
  if (creditedCents === undefined) return { type: "amount_underivable", orderNumber };
  const feeCents = chargedCents - creditedCents;

  if (!order.userId) return { type: "user_not_found", orderNumber };
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, order.userId))
    .limit(1);
  if (!user) return { type: "user_not_found", orderNumber };

  const transactionId =
    typeof storedResult.transactionId === "string" && storedResult.transactionId
      ? storedResult.transactionId
      : (order.gatewayTransactionId ?? null);

  // Claim + credit write in ONE transaction. The conditional JSONB update is
  // the first-resolver-wins guard (concurrent re-runs can never double-send
  // the receipt or double-credit); running the ledger insert in the same
  // transaction means a failed insert rolls the claim back too, so a
  // transient DB error can never strand the deposit as falsely "resolved" —
  // a retry starts clean.
  const resolvedAt = new Date().toISOString();
  const txOutcome = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(checkoutIdempotencyTable)
      .set({
        result: sql`${checkoutIdempotencyTable.result} || ${JSON.stringify({
          reconciliationResolvedAt: resolvedAt,
          reconciliationResolvedBy: actor ?? null,
          creditedCents,
          feeCents,
          chargedCents,
        })}::jsonb`,
      })
      .where(
        sql`${checkoutIdempotencyTable.id} = ${idem.id} AND (${checkoutIdempotencyTable.result} ->> 'reconciliationResolvedAt') IS NULL`,
      )
      .returning({ id: checkoutIdempotencyTable.id });

    if (claimed.length === 0) return { alreadyResolved: true as const, creditInserted: false };

    // Write the ledger credit. onConflictDoNothing on the nmi_transaction_id
    // partial unique index absorbs the "credit was actually written before the
    // original attempt failed" case. When NMI never returned a transaction id,
    // the resolution claim above is the sole (sufficient) duplicate guard.
    const inserted = await tx
      .insert(adSpendTransactionsTable)
      .values({
        userId: user.id,
        amountCents: creditedCents,
        type: "funding",
        source: "nmi",
        nmiTransactionId: transactionId,
        note:
          `Deposit via NMI checkout (order ${orderNumber}) — manually reconciled` +
          `${actor ? ` by ${actor}` : ""} — card charged ` +
          `$${(chargedCents / 100).toFixed(2)} incl. $${(feeCents / 100).toFixed(2)} 3% card fee`,
      })
      .onConflictDoNothing()
      .returning({ id: adSpendTransactionsTable.id });

    return { alreadyResolved: false as const, creditInserted: inserted.length > 0 };
  });

  if (txOutcome.alreadyResolved) return { type: "already_resolved", orderNumber };

  logAuditEvent({
    actorId: user.id,
    actionType: "billing.ad_spend.reconciliation_resolved",
    entityType: "bts_order",
    entityId: String(order.id),
    description: `Ad-spend deposit reconciliation resolved for order ${orderNumber}`,
    metadata: {
      orderNumber,
      creditedCents,
      feeCents,
      chargedCents,
      creditInserted: txOutcome.creditInserted,
      transactionId,
      actor: actor ?? null,
    },
  });

  // Receipt email — awaited but never throws (sendDepositReceiptEmail
  // swallows comms failures), so a comms hiccup can't fail the resolution.
  await sendDepositReceiptEmail({
    userId: user.id,
    email: user.email,
    memberName: user.name ?? "there",
    orderNumber,
    creditedCents,
    feeCents,
    chargedCents,
  });

  return {
    type: "resolved",
    orderNumber,
    creditedCents,
    feeCents,
    chargedCents,
    creditInserted: txOutcome.creditInserted,
  };
}
