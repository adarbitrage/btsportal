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
import { db, usersTable, productsTable, adSpendTransactionsTable } from "@workspace/db";
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
