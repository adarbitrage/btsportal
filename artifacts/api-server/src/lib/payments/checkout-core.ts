/**
 * Shared checkout core — claim → pending order → charge → on-success record+grant /
 * decline→402 / post-charge→reconciliation.
 *
 * Both one-time checkout and recurring subscribe use this core. The caller is
 * responsible for all pre-core validation (product type, user lookup, card
 * ownership/vaulting, duplicate-subscription guard) and for resolving exactly
 * one of `paymentToken` or `resolvedVaultId` before calling.
 *
 * The `onOrderPaid` callback is invoked after the order row is marked `paid`
 * and before entitlements are granted. It may return extra fields (e.g.
 * `subscriptionId`) to include in the idempotency result and caller response.
 * If it throws, the charge has already moved money → `paid_reconciliation_needed`.
 */

import { randomUUID } from "crypto";
import { chargeCardToken, chargeStoredVault } from "./charge-service.js";
import {
  peekIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
} from "./checkout-idempotency.js";
import { createOrder, updateOrderStatus } from "../../storage/billing-orders-store.js";
import { logAuditEvent } from "../audit-log.js";
import { insertUserProductGrant } from "../external-grant-product.js";

export type CoreOrderType =
  | "one_time"
  | "recurring_initial"
  | "recurring_renewal"
  | "wallet_topup";

export interface CheckoutCoreOptions {
  userId: number;
  productId: number;
  email: string;
  firstName?: string;
  lastName?: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  orderType: CoreOrderType;
  /**
   * Optional subscription this order belongs to. Threaded into `createOrder`
   * so the bts_orders row carries subscription_id at insert time (used by the
   * recurring_renewal path so even a declined renewal order is linkable).
   * Leave undefined for the initial subscribe path (the subscription row does
   * not exist yet — it is linked from `onOrderPaid`).
   */
  subscriptionId?: number;
  /** Whether to grant product entitlements on success (false for wallet_topup). */
  grantEntitlements: boolean;
  entitlementKeys: string[];
  durationDays: number | null;
  /**
   * Human-readable line item description stored in bts_order_items.description.
   * Typically the product name. Null when not provided.
   */
  lineItemDescription?: string;
  /** Exactly one of these must be set. */
  paymentToken?: string;
  resolvedVaultId?: string;
  /**
   * Called after the order is marked `paid` and before the entitlement grant.
   * Return extra key/value pairs to merge into the idempotency result and the
   * caller's returned outcome. May throw — if it does, the outcome becomes
   * `paid_reconciliation_needed` (money already moved).
   */
  onOrderPaid?: (orderId: number, orderNumber: string) => Promise<Record<string, unknown>>;
}

export type CheckoutCoreOutcome =
  | {
      type: "paid";
      orderNumber: string;
      status: "paid";
      grantedEntitlements?: string[];
      grantPending?: true;
      extra?: Record<string, unknown>;
    }
  | {
      type: "paid_reconciliation_needed";
      orderNumber: string;
      transactionId: string | null | undefined;
    }
  | { type: "declined"; message: string; orderNumber?: string; declineReason?: string }
  | { type: "in_progress" }
  | { type: "conflict" }
  | {
      type: "replay_paid";
      orderNumber: string;
      status: "paid";
      grantedEntitlements?: string[];
      grantPending?: true;
      extra?: Record<string, unknown>;
    }
  | {
      type: "replay_reconciliation_needed";
      orderNumber: string;
    }
  | { type: "replay_declined"; message: string; orderNumber?: string; declineReason?: string };

async function safeComplete(
  key: string,
  orderId: number | null,
  result: Record<string, unknown>,
): Promise<void> {
  try {
    await completeIdempotencyKey(key, orderId, result);
  } catch (err) {
    console.error(
      `[CheckoutCore] WARNING: Failed to complete idempotency key "${key}". ` +
      "Duplicate charges may occur on retry.",
      err,
    );
  }
}

function extractReplayExtra(r: Record<string, unknown>): Record<string, unknown> {
  const known = new Set([
    "outcomeType", "status", "orderNumber", "transactionId",
    "grantedEntitlements", "grantPending", "message",
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (!known.has(k)) extra[k] = v;
  }
  return extra;
}

export async function runCheckoutCore(
  opts: CheckoutCoreOptions,
): Promise<CheckoutCoreOutcome> {
  const {
    userId, productId, idempotencyKey,
    email, firstName, lastName,
    amountCents, currency, orderType, subscriptionId,
    grantEntitlements, entitlementKeys, durationDays,
    lineItemDescription,
    paymentToken, resolvedVaultId,
    onOrderPaid,
  } = opts;

  // ── Idempotency peek ────────────────────────────────────────────────────────
  const peek = await peekIdempotencyKey(idempotencyKey, userId, productId);

  if (peek.type === "in_progress") return { type: "in_progress" };
  if (peek.type === "conflict") return { type: "conflict" };
  if (peek.type === "replay") {
    const r = peek.result as Record<string, unknown>;
    const outcomeType = r.outcomeType as string | undefined;
    if (peek.wasSuccess) {
      if (outcomeType === "paid_reconciliation_needed") {
        return { type: "replay_reconciliation_needed", orderNumber: r.orderNumber as string };
      }
      return {
        type: "replay_paid",
        orderNumber: r.orderNumber as string,
        status: "paid",
        grantedEntitlements: r.grantedEntitlements as string[] | undefined,
        ...(r.grantPending ? { grantPending: true as const } : {}),
        extra: extractReplayExtra(r),
      };
    } else {
      return {
        type: "replay_declined",
        message: (r.message as string) ?? "Card declined",
        orderNumber: r.orderNumber as string | undefined,
        declineReason: (r.message as string | undefined),
      };
    }
  }

  // ── Claim ───────────────────────────────────────────────────────────────────
  const claim = await claimIdempotencyKey(idempotencyKey, userId, productId);

  if (claim.type === "in_progress") return { type: "in_progress" };
  if (claim.type === "conflict") return { type: "conflict" };
  if (claim.type === "replay") {
    const r = claim.result as Record<string, unknown>;
    const outcomeType = r.outcomeType as string | undefined;
    if (claim.wasSuccess) {
      if (outcomeType === "paid_reconciliation_needed") {
        return { type: "replay_reconciliation_needed", orderNumber: r.orderNumber as string };
      }
      return {
        type: "replay_paid",
        orderNumber: r.orderNumber as string,
        status: "paid",
        grantedEntitlements: r.grantedEntitlements as string[] | undefined,
        ...(r.grantPending ? { grantPending: true as const } : {}),
        extra: extractReplayExtra(r),
      };
    } else {
      return {
        type: "replay_declined",
        message: (r.message as string) ?? "Card declined",
        orderNumber: r.orderNumber as string | undefined,
        declineReason: (r.message as string | undefined),
      };
    }
  }

  // ── Create pending order ────────────────────────────────────────────────────
  const orderNumber = `NMI-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  const order = await createOrder({
    orderNumber,
    userId,
    email,
    totalCents: amountCents,
    currency,
    orderType,
    subscriptionId,
    lineItems: [
      {
        productId,
        description: lineItemDescription ?? null,
        unitPriceCents: amountCents,
        quantity: 1,
      },
    ],
  });

  // ── Charge ──────────────────────────────────────────────────────────────────
  type ChargeResult = Awaited<ReturnType<typeof chargeCardToken>>;
  let chargeResult: ChargeResult;
  try {
    if (resolvedVaultId !== undefined) {
      chargeResult = await chargeStoredVault({
        amountCents,
        customerVaultId: resolvedVaultId,
        orderId: orderNumber,
        email,
      });
    } else {
      chargeResult = await chargeCardToken({
        amountCents,
        paymentToken: paymentToken!,
        orderId: orderNumber,
        email,
        firstName,
        lastName,
      });
    }
  } catch (err) {
    await updateOrderStatus(order.id, {
      status: "failed",
      metadata: { gatewayError: String(err) },
    }).catch((e) =>
      console.error(`[CheckoutCore] Failed to mark order ${orderNumber} failed after gateway error:`, e),
    );
    await safeComplete(idempotencyKey, order.id, {
      outcomeType: "declined", status: "failed",
      message: "Gateway error", orderNumber,
    });
    logAuditEvent({
      actorId: userId,
      actionType: "billing.checkout.gateway_error",
      entityType: "bts_order",
      entityId: String(order.id),
      description: `Checkout gateway error for order ${orderNumber}`,
      metadata: { productId, orderNumber, error: String(err) },
    });
    return {
      type: "declined",
      message: "Payment gateway error — please try again",
      orderNumber,
      declineReason: "Payment gateway error",
    };
  }

  // ── Decline ─────────────────────────────────────────────────────────────────
  if (!chargeResult.success) {
    await updateOrderStatus(order.id, {
      status: "failed",
      metadata: { gatewayResponseText: chargeResult.responseText },
    }).catch((e) =>
      console.error(`[CheckoutCore] Failed to mark order ${orderNumber} failed after decline:`, e),
    );
    await safeComplete(idempotencyKey, order.id, {
      outcomeType: "declined", status: "failed",
      message: chargeResult.responseText, orderNumber,
    });
    logAuditEvent({
      actorId: userId,
      actionType: "billing.checkout.declined",
      entityType: "bts_order",
      entityId: String(order.id),
      description: `Card declined for order ${orderNumber}: ${chargeResult.responseText}`,
      metadata: { productId, orderNumber, responseText: chargeResult.responseText },
    });
    return {
      type: "declined",
      message: "Your card was declined. Please check your card details and try again.",
      orderNumber,
      declineReason: chargeResult.responseText,
    };
  }

  // ── CHARGE SUCCEEDED — money moved ─────────────────────────────────────────

  try {
    await updateOrderStatus(order.id, {
      status: "paid",
      gatewayTransactionId: chargeResult.transactionId ?? null,
    });
  } catch (persistErr) {
    const reconResult: Record<string, unknown> = {
      outcomeType: "paid_reconciliation_needed",
      status: "paid_reconciliation_needed",
      orderNumber,
      transactionId: chargeResult.transactionId,
    };
    await safeComplete(idempotencyKey, order.id, reconResult);
    console.error(
      `[CheckoutCore] ALERT: Order ${orderNumber} charged (txn=${chargeResult.transactionId}) ` +
      `but DB status update failed. Manual reconciliation required.`,
      persistErr,
    );
    return { type: "paid_reconciliation_needed", orderNumber, transactionId: chargeResult.transactionId };
  }

  // ── onOrderPaid callback (e.g. create subscription row) ───────────────────
  let callbackExtra: Record<string, unknown> = {};
  if (onOrderPaid) {
    try {
      callbackExtra = await onOrderPaid(order.id, orderNumber);
    } catch (callbackErr) {
      const reconResult: Record<string, unknown> = {
        outcomeType: "paid_reconciliation_needed",
        status: "paid_reconciliation_needed",
        orderNumber,
        transactionId: chargeResult.transactionId,
      };
      await safeComplete(idempotencyKey, order.id, reconResult);
      console.error(
        `[CheckoutCore] ALERT: Order ${orderNumber} paid but post-charge callback failed. ` +
        `Manual reconciliation required.`,
        callbackErr,
      );
      return { type: "paid_reconciliation_needed", orderNumber, transactionId: chargeResult.transactionId };
    }
  }

  // ── Grant entitlements ─────────────────────────────────────────────────────
  let grantedEntitlements: string[] | undefined;
  let grantPending = false;

  if (grantEntitlements) {
    try {
      await insertUserProductGrant({
        userId,
        productId,
        externalSource: "nmi",
        externalOrderId: orderNumber,
        durationDays: durationDays ?? null,
      });
      grantedEntitlements = entitlementKeys;
    } catch (err) {
      grantPending = true;
      await updateOrderStatus(order.id, {
        status: "paid",
        gatewayTransactionId: chargeResult.transactionId ?? null,
        metadata: { grantError: String(err), grantPending: true },
      }).catch(() => {});
      console.error(
        `[CheckoutCore] ALERT: Grant failed for order ${orderNumber} ` +
        `(userId=${userId} productId=${productId}). ` +
        `Charge succeeded (txn=${chargeResult.transactionId}). Manual grant required.`,
        err,
      );
    }
  }

  const successResult: Record<string, unknown> = {
    outcomeType: "paid",
    status: "paid",
    orderNumber,
    transactionId: chargeResult.transactionId,
    grantedEntitlements,
    grantPending,
    ...callbackExtra,
  };
  await safeComplete(idempotencyKey, order.id, successResult);

  logAuditEvent({
    actorId: userId,
    actionType: "billing.checkout.paid",
    entityType: "bts_order",
    entityId: String(order.id),
    description: `Checkout paid for order ${orderNumber}`,
    metadata: { productId, orderNumber, transactionId: chargeResult.transactionId, grantPending },
  });

  return {
    type: "paid",
    orderNumber,
    status: "paid",
    grantedEntitlements,
    ...(grantPending ? { grantPending: true as const } : {}),
    ...(Object.keys(callbackExtra).length > 0 ? { extra: callbackExtra } : {}),
  };
}
