import { db, productsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { chargeCardToken } from "./charge-service.js";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
} from "./checkout-idempotency.js";
import {
  createOrder,
  updateOrderStatus,
} from "../../storage/billing-orders-store.js";
import { logAuditEvent } from "../audit-log.js";
import { insertUserProductGrant } from "../external-grant-product.js";

export interface CheckoutParams {
  userId: number;
  productId: number;
  paymentToken: string;
  idempotencyKey: string;
}

export type CheckoutOutcome =
  | {
      type: "paid";
      orderNumber: string;
      status: "paid";
      grantedEntitlements?: string[];
      grantPending?: true;
    }
  | {
      type: "paid_reconciliation_needed";
      orderNumber: string;
      transactionId: string | null | undefined;
    }
  | { type: "declined"; message: string }
  | { type: "in_progress" }
  | { type: "conflict" }
  | { type: "invalid_product"; message: string }
  | { type: "user_not_found" }
  | {
      type: "replay_paid";
      orderNumber: string;
      status: "paid";
      grantedEntitlements?: string[];
      grantPending?: true;
    }
  | {
      type: "replay_reconciliation_needed";
      orderNumber: string;
    }
  | { type: "replay_declined"; message: string };

/**
 * Orchestrate a one-time native NMI checkout:
 *   validate → idempotency claim → create pending order → charge →
 *   on success: update order paid (authoritative — failure returns a distinct
 *   outcome) + grant entitlements via insertUserProductGrant (single source of
 *   truth shared with ThriveCart webhook) → complete idempotency key → return
 *   on decline: update order failed → complete idempotency key → return 402
 *
 * Money-safe: if the post-charge order-status write fails, a distinct
 * "paid_reconciliation_needed" outcome is returned and idempotency is
 * completed so replay never re-charges.  Idempotency completion failures
 * are logged prominently rather than silently swallowed.
 */
export async function processCheckout(params: CheckoutParams): Promise<CheckoutOutcome> {
  const { userId, productId, paymentToken, idempotencyKey } = params;

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);

  if (!product) {
    return { type: "invalid_product", message: "Product not found" };
  }
  if (!product.isNativeNmi) {
    return { type: "invalid_product", message: "Product is not available for native checkout" };
  }
  if (product.billingType !== "one_time") {
    return { type: "invalid_product", message: "Only one-time products can be purchased via this endpoint" };
  }
  if (product.priceCents == null || product.priceCents <= 0) {
    return { type: "invalid_product", message: "Product price is not configured" };
  }

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    return { type: "user_not_found" };
  }

  const nameParts = (user.name ?? "").trim().split(" ");
  const firstName = nameParts[0] ?? undefined;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

  const claim = await claimIdempotencyKey(idempotencyKey, userId, productId);

  if (claim.type === "in_progress") {
    return { type: "in_progress" };
  }
  if (claim.type === "conflict") {
    return { type: "conflict" };
  }
  if (claim.type === "replay") {
    const r = claim.result as Record<string, unknown>;
    if (claim.wasSuccess) {
      // Distinguish between a clean paid replay and a reconciliation-needed replay
      if ((r.outcomeType as string) === "paid_reconciliation_needed") {
        return {
          type: "replay_reconciliation_needed",
          orderNumber: r.orderNumber as string,
        };
      }
      return {
        type: "replay_paid",
        orderNumber: r.orderNumber as string,
        status: "paid",
        grantedEntitlements: r.grantedEntitlements as string[] | undefined,
        ...(r.grantPending ? { grantPending: true as const } : {}),
      };
    } else {
      return {
        type: "replay_declined",
        message: (r.message as string) ?? "Card declined",
      };
    }
  }

  const orderNumber = `NMI-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const orderType = product.itemType === "wallet_topup" ? "wallet_topup" as const : "one_time" as const;

  const order = await createOrder({
    orderNumber,
    userId,
    email: user.email,
    totalCents: product.priceCents,
    currency: product.currency ?? "USD",
    orderType,
    lineItems: [
      {
        productId: product.id,
        description: product.name,
        unitPriceCents: product.priceCents,
        quantity: 1,
      },
    ],
  });

  let chargeResult: Awaited<ReturnType<typeof chargeCardToken>>;
  try {
    chargeResult = await chargeCardToken({
      amountCents: product.priceCents,
      paymentToken,
      orderId: orderNumber,
      email: user.email,
      firstName,
      lastName,
    });
  } catch (err) {
    // Pre-charge: no money moved. Best-effort status update + idempotency.
    await updateOrderStatus(order.id, {
      status: "failed",
      metadata: { gatewayError: String(err) },
    }).catch((e) => console.error(`[Checkout] Failed to mark order ${orderNumber} failed after gateway error:`, e));
    await safeCompleteIdempotencyKey(idempotencyKey, order.id, {
      outcomeType: "declined", status: "failed", message: "Gateway error", orderNumber,
    });
    logAuditEvent({
      actorId: userId,
      actionType: "billing.checkout.gateway_error",
      entityType: "bts_order",
      entityId: String(order.id),
      description: `Checkout gateway error for order ${orderNumber}`,
      metadata: { productId, orderNumber, error: String(err) },
    });
    return { type: "declined", message: "Payment gateway error — please try again" };
  }

  if (!chargeResult.success) {
    // Declined: no money moved. Best-effort status update + idempotency.
    await updateOrderStatus(order.id, {
      status: "failed",
      metadata: { gatewayResponseText: chargeResult.responseText },
    }).catch((e) => console.error(`[Checkout] Failed to mark order ${orderNumber} failed after decline:`, e));
    await safeCompleteIdempotencyKey(idempotencyKey, order.id, {
      outcomeType: "declined", status: "failed", message: chargeResult.responseText, orderNumber,
    });
    logAuditEvent({
      actorId: userId,
      actionType: "billing.checkout.declined",
      entityType: "bts_order",
      entityId: String(order.id),
      description: `Card declined for order ${orderNumber}: ${chargeResult.responseText}`,
      metadata: { productId, orderNumber, responseText: chargeResult.responseText },
    });
    return { type: "declined", message: "Your card was declined. Please check your card details and try again." };
  }

  // ── CHARGE SUCCEEDED — money moved. Every subsequent write is authoritative. ──

  try {
    await updateOrderStatus(order.id, {
      status: "paid",
      gatewayTransactionId: chargeResult.transactionId ?? null,
    });
  } catch (persistErr) {
    // DB update failed after a real charge. Complete idempotency with the paid
    // result so replays never re-charge, then surface a distinct outcome so the
    // caller knows reconciliation is needed.
    const reconResult: Record<string, unknown> = {
      outcomeType: "paid_reconciliation_needed",
      status: "paid_reconciliation_needed",
      orderNumber,
      transactionId: chargeResult.transactionId,
    };
    await safeCompleteIdempotencyKey(idempotencyKey, order.id, reconResult);
    console.error(
      `[Checkout] ALERT: Order ${orderNumber} charged (txn=${chargeResult.transactionId}) but DB status update failed. ` +
      `Order row remains pending. Manual reconciliation required.`,
      persistErr,
    );
    return {
      type: "paid_reconciliation_needed",
      orderNumber,
      transactionId: chargeResult.transactionId,
    };
  }

  let grantedEntitlements: string[] | undefined;
  let grantPending = false;

  if (product.itemType !== "wallet_topup") {
    try {
      const entitlementKeys = Array.isArray(product.entitlementKeys)
        ? (product.entitlementKeys as string[])
        : [];
      await insertUserProductGrant({
        userId,
        productId: product.id,
        externalSource: "nmi",
        externalOrderId: orderNumber,
        durationDays: product.durationDays ?? null,
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
        `[Checkout] ALERT: Grant failed for order ${orderNumber} (userId=${userId} productId=${product.id}). ` +
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
  };
  await safeCompleteIdempotencyKey(idempotencyKey, order.id, successResult);

  logAuditEvent({
    actorId: userId,
    actionType: "billing.checkout.paid",
    entityType: "bts_order",
    entityId: String(order.id),
    description: `Checkout paid for order ${orderNumber} (product: ${product.name})`,
    metadata: { productId, orderNumber, transactionId: chargeResult.transactionId, grantPending },
  });

  return {
    type: "paid",
    orderNumber,
    status: "paid",
    grantedEntitlements,
    ...(grantPending ? { grantPending: true as const } : {}),
  };
}

/**
 * Complete an idempotency key, logging a prominent error if the write fails
 * rather than silently swallowing it.  A failed complete leaves the key
 * in_progress, which causes future retries to 409 instead of replaying — ops
 * must manually clear the row if this fires.
 */
async function safeCompleteIdempotencyKey(
  idempotencyKey: string,
  orderId: number,
  result: Record<string, unknown>,
): Promise<void> {
  try {
    await completeIdempotencyKey(idempotencyKey, orderId, result);
  } catch (err) {
    console.error(
      `[Checkout] ALERT: Failed to complete idempotency key "${idempotencyKey}" for order ${orderId}. ` +
      `Key will remain in_progress — future retries will 409. Manual cleanup required.`,
      err,
    );
  }
}
