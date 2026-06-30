import { db, productsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getPaymentMethodForUser } from "../../storage/payment-methods-store.js";
import { runCheckoutCore } from "./checkout-core.js";

export interface CheckoutParams {
  userId: number;
  productId: number;
  idempotencyKey: string;
  paymentToken?: string;
  paymentMethodId?: number;
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
  | { type: "payment_method_not_found" }
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
 * Orchestrate a one-time native NMI checkout.
 *
 * Delegates to the shared checkout core after product/user validation and
 * saved-card ownership resolution. One-time behavior is identical to the
 * previous implementation — the only change is that the charge+idempotency
 * logic now lives in checkout-core.ts so that the recurring subscribe path
 * can reuse it without duplication.
 *
 * Accepts either a fresh paymentToken (Collect.js token) or a paymentMethodId
 * (saved card via NMI Customer Vault). Exactly one must be supplied — the
 * caller (route handler) is responsible for enforcing this before calling.
 */
export async function processCheckout(params: CheckoutParams): Promise<CheckoutOutcome> {
  const { userId, productId, idempotencyKey } = params;

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

  // ── Idempotency peek happens inside the core, but saved-card ownership must
  // be checked AFTER the peek (so a replay can replay even if the card was
  // deleted). The core does the peek internally, so we replicate the pre-peek
  // guard here: only do the ownership lookup for fresh attempts.
  // To preserve the existing "peek before ownership check" ordering, we use
  // the same peekIdempotencyKey + then ownership + then core (which will
  // peek again internally — the second peek is cheap and always returns
  // the same result since no writes happened between them).
  // ──
  // In practice: if the peek says "not_found", we do the ownership check.
  // If the peek says anything else, the core will handle it (replay/in_progress/conflict).
  // We import peek here so the ownership skip works correctly.
  const { peekIdempotencyKey } = await import("./checkout-idempotency.js");
  const peek = await peekIdempotencyKey(idempotencyKey, userId, productId);

  let resolvedVaultId: string | undefined;
  if (peek.type === "not_found" && params.paymentMethodId !== undefined) {
    const method = await getPaymentMethodForUser(params.paymentMethodId, userId);
    if (!method) {
      return { type: "payment_method_not_found" };
    }
    resolvedVaultId = method.vaultId;
  } else if (peek.type === "not_found" && params.paymentToken === undefined) {
    return { type: "payment_method_not_found" };
  }

  const orderType = product.itemType === "wallet_topup" ? "wallet_topup" as const : "one_time" as const;
  const entitlementKeys = Array.isArray(product.entitlementKeys)
    ? (product.entitlementKeys as string[])
    : [];

  const coreResult = await runCheckoutCore({
    userId,
    productId,
    email: user.email,
    firstName,
    lastName,
    idempotencyKey,
    amountCents: product.priceCents,
    currency: product.currency ?? "USD",
    orderType,
    grantEntitlements: product.itemType !== "wallet_topup",
    entitlementKeys,
    durationDays: product.durationDays ?? null,
    lineItemDescription: product.name,
    ...(resolvedVaultId !== undefined ? { resolvedVaultId } : {}),
    ...(params.paymentToken !== undefined ? { paymentToken: params.paymentToken } : {}),
  });

  // Map core outcomes to the CheckoutOutcome type (drop the `extra` field
  // that one-time checkout never needs).
  switch (coreResult.type) {
    case "paid":
      return {
        type: "paid",
        orderNumber: coreResult.orderNumber,
        status: "paid",
        grantedEntitlements: coreResult.grantedEntitlements,
        ...(coreResult.grantPending ? { grantPending: true as const } : {}),
      };
    case "paid_reconciliation_needed":
      return coreResult;
    case "declined":
      return coreResult;
    case "in_progress":
      return coreResult;
    case "conflict":
      return coreResult;
    case "replay_paid":
      return {
        type: "replay_paid",
        orderNumber: coreResult.orderNumber,
        status: "paid",
        grantedEntitlements: coreResult.grantedEntitlements,
        ...(coreResult.grantPending ? { grantPending: true as const } : {}),
      };
    case "replay_reconciliation_needed":
      return coreResult;
    case "replay_declined":
      return coreResult;
    default: {
      const _exhaustive: never = coreResult;
      throw new Error("Unexpected core outcome");
    }
  }
}
