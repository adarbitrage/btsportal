/**
 * Subscription service — orchestrates recurring subscribe + cancel.
 *
 * subscribe() ordering (critical for money-safety):
 *   1. Validate product (cheap read, no side effects).
 *   2. Load user (cheap read, no side effects).
 *   3. **Peek idempotency** — replays/in_progress/conflict short-circuit HERE,
 *      before any vault call or duplicate-subscription guard. This ensures a
 *      replay on an already-subscribed key returns the stored result instead of
 *      hitting the duplicate guard (409) or creating extra vault entries.
 *   4. Card resolution/vaulting (only for genuinely fresh attempts).
 *   5. Duplicate-subscription guard (only for genuinely fresh attempts).
 *   6. Shared checkout core (claim → order → charge → sub creation → grant).
 *
 * cancel(): sets cancel_at_period_end=true (non-destructive; access runs to period end).
 *
 * NOTE: No scheduled/recurring charges or dunning are built here (Tier 6.2).
 */

import { db, productsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runCheckoutCore, CheckoutCoreOutcome } from "./checkout-core.js";
import { peekIdempotencyKey } from "./checkout-idempotency.js";
import { storeCardToken } from "./charge-service.js";
import { getPaymentMethodForUser, insertPaymentMethod } from "../../storage/payment-methods-store.js";
import {
  createSubscription,
  cancelSubscriptionAtPeriodEnd,
  hasActiveSubscription,
  getSubscriptionForUser,
  linkOrderToSubscription,
  listSubscriptionsForUser,
  type SubscriptionRow,
  type SubscriptionWithProduct,
} from "../../storage/subscriptions-store.js";

export interface SubscribeParams {
  userId: number;
  productId: number;
  idempotencyKey: string;
  paymentToken?: string;
  paymentMethodId?: number;
}

export type SubscribeOutcome =
  | {
      type: "subscribed";
      subscriptionId: number;
      orderNumber: string;
      status: "active";
      nextChargeAt: Date;
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
  | {
      type: "replay_subscribed";
      subscriptionId: number;
      orderNumber: string;
      status: "active";
      nextChargeAt?: Date;
      grantedEntitlements?: string[];
      grantPending?: true;
    }
  | { type: "replay_reconciliation_needed"; orderNumber: string }
  | { type: "replay_declined"; message: string }
  | { type: "invalid_product"; message: string }
  | { type: "user_not_found" }
  | { type: "payment_method_not_found" }
  | { type: "vault_error"; message: string }
  | { type: "duplicate_subscription" };

function addInterval(start: Date, interval: "monthly" | "yearly"): Date {
  const end = new Date(start);
  if (interval === "monthly") {
    end.setMonth(end.getMonth() + 1);
  } else {
    end.setFullYear(end.getFullYear() + 1);
  }
  return end;
}

export async function processSubscribe(params: SubscribeParams): Promise<SubscribeOutcome> {
  const { userId, productId, idempotencyKey } = params;

  // ── 1. Validate product (cheap read, safe before idempotency peek) ─────────
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
  if (product.billingType !== "recurring") {
    return { type: "invalid_product", message: "Only recurring products can be subscribed via this endpoint" };
  }
  if (!product.recurringInterval || !["monthly", "yearly"].includes(product.recurringInterval)) {
    return { type: "invalid_product", message: "Product recurring_interval is not configured" };
  }
  if (product.priceCents == null || product.priceCents <= 0) {
    return { type: "invalid_product", message: "Product price is not configured" };
  }

  const interval = product.recurringInterval as "monthly" | "yearly";
  const amountCents = product.priceCents;
  const entitlementKeys = Array.isArray(product.entitlementKeys)
    ? (product.entitlementKeys as string[])
    : [];

  // ── 2. Load user (cheap read, safe before idempotency peek) ───────────────
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

  // ── 3. Idempotency peek — BEFORE any vault call or duplicate guard ─────────
  // A replay on an already-completed key must return the stored result
  // immediately, never hitting the duplicate-subscription guard (which would
  // return 409 and mask the real outcome) or the vault (which would create
  // an extra payment_methods row on retries with a paymentToken).
  const peek = await peekIdempotencyKey(idempotencyKey, userId, productId);

  if (peek.type === "in_progress") {
    return { type: "in_progress" };
  }
  if (peek.type === "conflict") {
    return { type: "conflict" };
  }
  if (peek.type === "replay") {
    const r = peek.result as Record<string, unknown>;
    const outcomeType = r.outcomeType as string | undefined;
    if (peek.wasSuccess) {
      if (outcomeType === "paid_reconciliation_needed") {
        return { type: "replay_reconciliation_needed", orderNumber: r.orderNumber as string };
      }
      const nextChargeAtRaw = r.nextChargeAt;
      const grantedEntitlements = r.grantedEntitlements as string[] | undefined;
      const grantPending = r.grantPending as boolean | undefined;
      return {
        type: "replay_subscribed",
        subscriptionId: r.subscriptionId as number,
        orderNumber: r.orderNumber as string,
        status: "active",
        ...(nextChargeAtRaw !== undefined
          ? { nextChargeAt: new Date(nextChargeAtRaw as string) }
          : {}),
        ...(grantedEntitlements !== undefined ? { grantedEntitlements } : {}),
        ...(grantPending ? { grantPending: true as const } : {}),
      };
    }
    return { type: "replay_declined", message: (r.message as string) ?? "Card declined" };
  }

  // ── 4. Resolve + pin the card (fresh attempts only) ───────────────────────
  let resolvedVaultId: string | undefined;
  let pinnedPaymentMethodId: number | undefined;

  if (params.paymentMethodId !== undefined) {
    const method = await getPaymentMethodForUser(params.paymentMethodId, userId);
    if (!method) {
      return { type: "payment_method_not_found" };
    }
    resolvedVaultId = method.vaultId;
    pinnedPaymentMethodId = method.id;
  } else if (params.paymentToken !== undefined) {
    let vaultResult: Awaited<ReturnType<typeof storeCardToken>>;
    try {
      vaultResult = await storeCardToken({
        paymentToken: params.paymentToken,
        email: user.email,
        firstName,
        lastName,
      });
    } catch {
      return { type: "vault_error", message: "Failed to communicate with payment gateway" };
    }
    if (!vaultResult.success || !vaultResult.customerVaultId) {
      return {
        type: "vault_error",
        message: vaultResult.responseText || "Failed to save card to vault",
      };
    }
    resolvedVaultId = vaultResult.customerVaultId;
    const inserted = await insertPaymentMethod({
      userId,
      vaultId: vaultResult.customerVaultId,
      last4: "0000",
      brand: "unknown",
      expMonth: 1,
      expYear: 9999,
    });
    pinnedPaymentMethodId = inserted.id;
  }

  if (resolvedVaultId === undefined || pinnedPaymentMethodId === undefined) {
    return { type: "invalid_product", message: "No payment source provided" };
  }

  // ── 5. Duplicate-subscription guard (fresh attempts only) ─────────────────
  const alreadyHas = await hasActiveSubscription(userId, productId);
  if (alreadyHas) {
    return { type: "duplicate_subscription" };
  }

  // ── 6. Shared checkout core ────────────────────────────────────────────────
  const pinnedPmId = pinnedPaymentMethodId;
  const capturedInterval = interval;

  const coreResult = await runCheckoutCore({
    userId,
    productId,
    email: user.email,
    firstName,
    lastName,
    idempotencyKey,
    amountCents,
    currency: product.currency ?? "USD",
    orderType: "recurring_initial",
    grantEntitlements: true,
    entitlementKeys,
    durationDays: product.durationDays ?? null,
    lineItemDescription: product.name,
    resolvedVaultId,
    onOrderPaid: async (orderId, _orderNumber) => {
      const now = new Date();
      const periodStart = now;
      const periodEnd_ = addInterval(now, capturedInterval);
      const sub = await createSubscription({
        userId,
        productId,
        paymentMethodId: pinnedPmId,
        interval: capturedInterval,
        amountCents,
        currency: product.currency ?? "USD",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd_,
        nextChargeAt: periodEnd_,
      });
      await linkOrderToSubscription(orderId, sub.id);
      return { subscriptionId: sub.id, nextChargeAt: periodEnd_.toISOString() };
    },
  });

  return mapCoreToSubscribeOutcome(coreResult);
}

function mapCoreToSubscribeOutcome(result: CheckoutCoreOutcome): SubscribeOutcome {
  switch (result.type) {
    case "paid":
      return {
        type: "subscribed",
        subscriptionId: result.extra?.subscriptionId as number,
        orderNumber: result.orderNumber,
        status: "active",
        nextChargeAt: new Date(result.extra?.nextChargeAt as string),
        grantedEntitlements: result.grantedEntitlements,
        ...(result.grantPending ? { grantPending: true as const } : {}),
      };
    case "paid_reconciliation_needed":
      return {
        type: "paid_reconciliation_needed",
        orderNumber: result.orderNumber,
        transactionId: result.transactionId,
      };
    case "declined":
      return { type: "declined", message: result.message };
    case "in_progress":
      return { type: "in_progress" };
    case "conflict":
      return { type: "conflict" };
    case "replay_paid":
      return {
        type: "replay_subscribed",
        subscriptionId: result.extra?.subscriptionId as number,
        orderNumber: result.orderNumber,
        status: "active",
        ...(result.extra?.nextChargeAt !== undefined
          ? { nextChargeAt: new Date(result.extra.nextChargeAt as string) }
          : {}),
        grantedEntitlements: result.grantedEntitlements,
        ...(result.grantPending ? { grantPending: true as const } : {}),
      };
    case "replay_reconciliation_needed":
      return { type: "replay_reconciliation_needed", orderNumber: result.orderNumber };
    case "replay_declined":
      return { type: "replay_declined", message: result.message };
    default: {
      const _: never = result;
      throw new Error("Unexpected core outcome");
    }
  }
}

export async function processCancel(
  subscriptionId: number,
  userId: number,
): Promise<SubscriptionRow | null> {
  return cancelSubscriptionAtPeriodEnd(subscriptionId, userId);
}

export async function listUserSubscriptions(userId: number): Promise<SubscriptionWithProduct[]> {
  return listSubscriptionsForUser(userId);
}

export async function getSubscription(
  id: number,
  userId: number,
): Promise<SubscriptionRow | null> {
  return getSubscriptionForUser(id, userId);
}
