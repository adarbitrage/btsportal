/**
 * Customer Ops refund orchestration service.
 *
 * Implements the full refund flow for BTS-native NMI orders:
 *   1. Load order (404 if missing)
 *   2. Validate amount
 *   3. Claim idempotency key (replay / in_progress / conflict guard)
 *   4. Already-refunded guard (no second gateway hit)
 *   5. Determine void vs refund via settlement query
 *   6. Execute gateway reversal
 *   7. Update order status
 *   8. Best-effort side effects (revoke grant, cancel subscription)
 *   9. Write audit row, complete idempotency, return structured result
 *
 * Every side effect after money moves is best-effort: it is logged and
 * reflected in the result but NEVER rolls back a completed refund.
 */

import { db, refundIdempotencyTable, btsOrdersTable, subscriptionsTable, userProductsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { refund as nmiRefund, voidTransaction, queryTransaction } from "./payments/nmi-gateway.js";
import { logAuditEvent } from "./audit-log.js";
import { queueBillingAlert } from "./billing-alerts.js";
import { timingSafeEqual } from "../middleware/ops-service-auth.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RefundRequest {
  orderNumber: string;
  idempotencyKey: string;
  /** Omit for full refund. Must be a positive integer in cents. */
  amountCents?: number;
  actor?: string;
  /**
   * Raw value of the `X-Refund-Approval` header, if present. Required (and
   * checked against BTS_OPS_REFUND_APPROVAL_KEY) when the effective refund
   * amount is at/above the approval threshold — see `checkRefundApproval`.
   */
  approvalHeader?: string;
}

export type RefundOutcome =
  | {
      outcome: "success";
      action: "void" | "refund";
      newStatus: "refunded" | "partial_refunded";
      gatewayTransactionId: string | undefined;
      partial: boolean;
      revoked?: boolean;
      subscriptionCanceled?: boolean;
    }
  | { outcome: "already_refunded"; orderStatus: string }
  | { outcome: "declined"; reason: string }
  | { outcome: "gateway_error"; reason: string }
  | { outcome: "replay"; result: RefundOutcome }
  | { outcome: "in_progress" }
  | { outcome: "conflict" }
  | { outcome: "not_found" }
  | { outcome: "invalid_amount"; reason: string }
  | { outcome: "approval_required" };

// ─── Approval gate ────────────────────────────────────────────────────────────

/** Default threshold ($1,000) above/at which a refund requires a second-factor approval header. */
const DEFAULT_APPROVAL_THRESHOLD_CENTS = 100_000;

function getApprovalThresholdCents(): number {
  const raw = process.env.BTS_APPROVER_REQUIRED_THRESHOLD_CENTS;
  if (!raw) return DEFAULT_APPROVAL_THRESHOLD_CENTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_APPROVAL_THRESHOLD_CENTS;
}

/**
 * Returns true if the refund is authorized to proceed: either the effective
 * refund amount is below the approver threshold, or a valid
 * `X-Refund-Approval` header was presented that matches
 * BTS_OPS_REFUND_APPROVAL_KEY (constant-time comparison).
 *
 * Fails CLOSED: an unset BTS_OPS_REFUND_APPROVAL_KEY, a missing header, or a
 * mismatched header all return false when the threshold is met. The
 * `actor` string on the request is never treated as authorization — it is
 * audit-trail metadata only.
 */
export function isRefundApproved(effectiveAmountCents: number, approvalHeader: string | undefined): boolean {
  const threshold = getApprovalThresholdCents();
  if (effectiveAmountCents < threshold) return true;

  const configured = process.env.BTS_OPS_REFUND_APPROVAL_KEY ?? "";
  // Reject an unset approval key before the timing-sensitive compare. This
  // branches only on server configuration, never on the presented header's
  // content, so it adds no secret-dependent timing signal.
  if (!configured) return false;
  return timingSafeEqual(configured, approvalHeader ?? "");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPgUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}

async function claimKey(
  idempotencyKey: string,
  orderNumber: string,
  amountCents: number | undefined,
): Promise<
  | { type: "claimed" }
  | { type: "replay"; result: RefundOutcome }
  | { type: "in_progress" }
  | { type: "conflict" }
> {
  try {
    await db.insert(refundIdempotencyTable).values({
      idempotencyKey,
      orderNumber,
      amountCents: amountCents ?? null,
      status: "in_progress",
    });
    return { type: "claimed" };
  } catch (err: unknown) {
    if (!isPgUniqueViolation(err)) throw err;
  }

  const [existing] = await db
    .select()
    .from(refundIdempotencyTable)
    .where(eq(refundIdempotencyTable.idempotencyKey, idempotencyKey))
    .limit(1);

  if (!existing) throw new Error("Refund idempotency row vanished between conflict and re-read");

  if (existing.orderNumber !== orderNumber || existing.amountCents !== (amountCents ?? null)) {
    return { type: "conflict" };
  }

  if (existing.status === "in_progress") return { type: "in_progress" };

  return { type: "replay", result: existing.result as RefundOutcome };
}

async function completeKey(
  idempotencyKey: string,
  result: RefundOutcome,
): Promise<void> {
  try {
    await db
      .update(refundIdempotencyTable)
      .set({ status: "completed", result, completedAt: new Date() })
      .where(eq(refundIdempotencyTable.idempotencyKey, idempotencyKey));
  } catch (err) {
    console.error(`[OpsRefund] WARNING: Failed to complete idempotency key "${idempotencyKey}":`, err);
  }
}

/** Revoke the active user_products grant sourced from this specific order. */
async function revokeOrderGrant(
  userId: number,
  productId: number,
  orderNumber: string,
): Promise<boolean> {
  const updated = await db
    .update(userProductsTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(userProductsTable.userId, userId),
        eq(userProductsTable.productId, productId),
        eq(userProductsTable.externalOrderId, orderNumber),
        eq(userProductsTable.status, "active"),
      ),
    )
    .returning({ id: userProductsTable.id });
  return updated.length > 0;
}

/** Immediately cancel a subscription: status=canceled, nullify next charge/retry, stamp canceled_at. */
async function cancelSubscription(subscriptionId: number): Promise<boolean> {
  const updated = await db
    .update(subscriptionsTable)
    .set({
      status: "canceled",
      nextChargeAt: null,
      nextRetryAt: null,
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, subscriptionId))
    .returning({ id: subscriptionsTable.id });
  return updated.length > 0;
}

/** Revoke the active grant for a subscription's product (any source — matches subscription product/user). */
async function revokeSubscriptionGrant(userId: number, productId: number): Promise<boolean> {
  const updated = await db
    .update(userProductsTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(userProductsTable.userId, userId),
        eq(userProductsTable.productId, productId),
        eq(userProductsTable.status, "active"),
      ),
    )
    .returning({ id: userProductsTable.id });
  return updated.length > 0;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function processRefund(req: RefundRequest): Promise<RefundOutcome> {
  const { orderNumber, idempotencyKey, actor } = req;

  // ── Load order ────────────────────────────────────────────────────────────
  const [order] = await db
    .select()
    .from(btsOrdersTable)
    .where(eq(btsOrdersTable.orderNumber, orderNumber))
    .limit(1);

  if (!order) return { outcome: "not_found" };

  // ── Validate amount ───────────────────────────────────────────────────────
  let amountCents: number | undefined = req.amountCents;
  const isPartial = amountCents !== undefined && amountCents < order.totalCents;

  if (amountCents !== undefined) {
    if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents)) {
      return { outcome: "invalid_amount", reason: "amountCents must be a finite integer" };
    }
    if (amountCents <= 0) {
      return { outcome: "invalid_amount", reason: "amountCents must be positive" };
    }
    if (amountCents > order.totalCents) {
      return { outcome: "invalid_amount", reason: "amountCents exceeds order total" };
    }
    if (amountCents === order.totalCents) {
      amountCents = undefined;
    }
  }

  const partial = amountCents !== undefined;

  // ── Approval gate (runs BEFORE any idempotency claim or money movement) ───
  const effectiveAmountCents = amountCents ?? order.totalCents;
  if (!isRefundApproved(effectiveAmountCents, req.approvalHeader)) {
    return { outcome: "approval_required" };
  }

  // ── Claim idempotency key ────────────────────────────────────────────────
  const claim = await claimKey(idempotencyKey, orderNumber, amountCents);
  if (claim.type === "in_progress") return { outcome: "in_progress" };
  if (claim.type === "conflict") return { outcome: "conflict" };
  if (claim.type === "replay") return { outcome: "replay", result: claim.result };

  // ── Already-refunded guard (no second gateway hit) ────────────────────────
  if (order.status === "refunded" || order.status === "partial_refunded") {
    const alreadyResult: RefundOutcome = { outcome: "already_refunded", orderStatus: order.status };
    await completeKey(idempotencyKey, alreadyResult);
    return alreadyResult;
  }

  if (order.status !== "paid") {
    const notRefundable: RefundOutcome = { outcome: "already_refunded", orderStatus: order.status };
    await completeKey(idempotencyKey, notRefundable);
    return notRefundable;
  }

  const originalTransactionId = order.gatewayTransactionId;
  if (!originalTransactionId) {
    const noTxn: RefundOutcome = { outcome: "gateway_error", reason: "Order has no gateway transaction ID" };
    await completeKey(idempotencyKey, noTxn);
    return noTxn;
  }

  // ── Determine void vs refund via settlement query (full refunds only) ────
  let action: "void" | "refund" = "refund";
  if (!partial) {
    try {
      const queryResult = await queryTransaction({ orderId: orderNumber });
      if (queryResult.condition === "pendingsettlement" || queryResult.condition === "pending") {
        action = "void";
      }
    } catch (err) {
      console.error(`[OpsRefund] Settlement query failed for ${orderNumber}, defaulting to refund:`, err);
    }
  }

  // ── Execute gateway reversal ──────────────────────────────────────────────
  let gatewayResult: Awaited<ReturnType<typeof nmiRefund>>;
  try {
    if (action === "void") {
      gatewayResult = await voidTransaction({ transactionId: originalTransactionId });
    } else {
      gatewayResult = await nmiRefund({
        transactionId: originalTransactionId,
        ...(partial ? { amountCents } : {}),
      });
    }
  } catch (err) {
    const errResult: RefundOutcome = { outcome: "gateway_error", reason: String(err) };
    await completeKey(idempotencyKey, errResult);
    try {
      await logAuditEvent({
        actorEmail: actor,
        actionType: "billing.ops.refund.gateway_error",
        entityType: "bts_order",
        entityId: String(order.id),
        description: `Ops refund gateway error for order ${orderNumber}`,
        metadata: { orderNumber, action, error: String(err) },
      });
    } catch (auditErr) {
      console.error(`[OpsRefund] Audit write failed for gateway-error outcome on order ${orderNumber}:`, auditErr);
    }
    return errResult;
  }

  if (!gatewayResult.success) {
    const declineResult: RefundOutcome = {
      outcome: "declined",
      reason: gatewayResult.responseText || "Gateway declined",
    };
    await completeKey(idempotencyKey, declineResult);
    try {
      await logAuditEvent({
        actorEmail: actor,
        actionType: "billing.ops.refund.declined",
        entityType: "bts_order",
        entityId: String(order.id),
        description: `Ops refund declined for order ${orderNumber}: ${gatewayResult.responseText}`,
        metadata: { orderNumber, action, responseText: gatewayResult.responseText },
      });
    } catch (auditErr) {
      console.error(`[OpsRefund] Audit write failed for declined outcome on order ${orderNumber}:`, auditErr);
    }
    return declineResult;
  }

  // ── REVERSAL SUCCEEDED — money moved ────────────────────────────────────

  const newStatus = partial ? "partial_refunded" : "refunded";
  const refundTxnId = gatewayResult.transactionId;
  const metadataUpdate: Record<string, unknown> = {
    ...(action === "void"
      ? { void_transaction_id: refundTxnId }
      : { refund_transaction_id: refundTxnId }),
    refunded_at: new Date().toISOString(),
  };

  try {
    await db
      .update(btsOrdersTable)
      .set({
        status: newStatus,
        updatedAt: new Date(),
        metadata: metadataUpdate,
      })
      .where(eq(btsOrdersTable.id, order.id));
  } catch (err) {
    console.error(`[OpsRefund] ALERT: Order ${orderNumber} reversed (txn=${refundTxnId}) but DB update failed:`, err);
  }

  // ── Best-effort side effects (full refunds only) ──────────────────────────
  let revoked: boolean | undefined;
  let subscriptionCanceled: boolean | undefined;

  if (!partial) {
    const productId = await getOrderProductId(order.id);

    if (productId !== null && order.userId !== null) {
      try {
        revoked = await revokeOrderGrant(order.userId, productId, orderNumber);
      } catch (err) {
        console.error(`[OpsRefund] Grant revoke failed for order ${orderNumber}:`, err);
        revoked = false;
        queueBillingAlert({
          type: "refund_side_effect_failed",
          orderNumber,
          refundTxnId,
          failedSideEffect: "grant revoke",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (order.subscriptionId !== null) {
      try {
        const canceled = await cancelSubscription(order.subscriptionId);
        subscriptionCanceled = canceled;
        if (canceled && productId !== null && order.userId !== null) {
          try {
            await revokeSubscriptionGrant(order.userId, productId);
          } catch (err) {
            console.error(`[OpsRefund] Sub grant revoke failed for sub ${order.subscriptionId}:`, err);
            queueBillingAlert({
              type: "refund_side_effect_failed",
              orderNumber,
              refundTxnId,
              failedSideEffect: "subscription grant revoke",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        console.error(`[OpsRefund] Subscription cancel failed for sub ${order.subscriptionId}:`, err);
        subscriptionCanceled = false;
        queueBillingAlert({
          type: "refund_side_effect_failed",
          orderNumber,
          refundTxnId,
          failedSideEffect: "subscription cancel",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ── Audit + complete ──────────────────────────────────────────────────────
  const successResult: RefundOutcome = {
    outcome: "success",
    action,
    newStatus,
    gatewayTransactionId: refundTxnId,
    partial,
    ...(revoked !== undefined ? { revoked } : {}),
    ...(subscriptionCanceled !== undefined ? { subscriptionCanceled } : {}),
  };

  await completeKey(idempotencyKey, successResult);

  // The refund already succeeded (money moved, order status flipped, side
  // effects applied above). A failure writing the audit row must NEVER turn
  // this into a false failure for an action that already completed — log it
  // loudly instead and still return the success result.
  try {
    await logAuditEvent({
      actorEmail: actor,
      actionType: "billing.ops.refund.success",
      entityType: "bts_order",
      entityId: String(order.id),
      description: `Ops ${action} ${partial ? "partial " : ""}refund for order ${orderNumber}: ${newStatus}`,
      metadata: {
        orderNumber,
        action,
        newStatus,
        gatewayTransactionId: refundTxnId,
        partial,
        revoked,
        subscriptionCanceled,
      },
    });
  } catch (auditErr) {
    console.error(
      `[OpsRefund] ALERT: Audit write failed for COMPLETED refund on order ${orderNumber} (txn=${refundTxnId}):`,
      auditErr,
    );
  }

  return successResult;
}

async function getOrderProductId(orderId: number): Promise<number | null> {
  const { btsOrderItemsTable } = await import("@workspace/db");
  const [item] = await db
    .select({ productId: btsOrderItemsTable.productId })
    .from(btsOrderItemsTable)
    .where(eq(btsOrderItemsTable.orderId, orderId))
    .limit(1);
  return item?.productId ?? null;
}
