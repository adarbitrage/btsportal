import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import { getPublicTokenizationKey, storeCardToken, removeVaultCustomer } from "../lib/payments/charge-service.js";
import { processCheckout } from "../lib/payments/checkout-service.js";
import { processSubscribe, processCancel, listUserSubscriptions } from "../lib/payments/subscription-service.js";
import { sendError, ErrorCodes } from "../lib/api-errors.js";
import {
  insertPaymentMethod,
  listPaymentMethods,
  getPaymentMethodForUser,
  setDefaultPaymentMethod,
  deletePaymentMethodRow,
} from "../storage/payment-methods-store.js";
import { isPaymentMethodPinnedToActiveSubscription } from "../storage/subscriptions-store.js";
import {
  billingUserLimiter,
  billingIpLimiter,
  billingDeclineBreakerCheck,
} from "../middleware/billing-rate-limit.js";
import { recordFreshDecline } from "../lib/billing-decline-tracker.js";
import { queueBillingAlert } from "../lib/billing-alerts.js";

const router = Router();

/**
 * Strip separator characters — spaces, hyphens, dots, and Unicode general-
 * category "Separator" characters — from a token string before PAN detection.
 * This prevents a 16-digit card number broken up with dots or Unicode spaces
 * (e.g. "4111.1111.1111.1111" or "4111\u20021111\u20021111\u20021111") from
 * slipping past the digit-run check.  The PAN is never persisted regardless.
 */
function stripSeparators(value: string): string {
  return value.replace(/[\s\-.\p{Z}]/gu, "");
}

function containsPan(value: string): boolean {
  return /\d{12,}/.test(stripSeparators(value));
}

const KNOWN_BRANDS = new Set([
  "visa", "mastercard", "amex", "american express", "discover",
  "jcb", "diners", "diners club", "unionpay", "maestro", "unknown",
]);

function isValidBrand(value: string): boolean {
  return KNOWN_BRANDS.has(value.toLowerCase());
}

router.get("/billing/tokenization-key", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const tokenizationKey = getPublicTokenizationKey();
  if (!tokenizationKey) {
    sendError(
      res,
      503,
      "BILLING_NOT_CONFIGURED",
      "BTS_NMI_TOKENIZATION_KEY is not configured. Contact the platform team to set up NMI billing.",
    );
    return;
  }

  res.json({ tokenizationKey });
});

router.get("/billing/product/:id", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const productId = parseInt(req.params.id, 10);
  if (!Number.isInteger(productId) || productId <= 0) {
    sendError(res, 400, "INVALID_REQUEST", "productId must be a positive integer");
    return;
  }

  const [product] = await db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      slug: productsTable.slug,
      priceCents: productsTable.priceCents,
      isNativeNmi: productsTable.isNativeNmi,
      billingType: productsTable.billingType,
      entitlementKeys: productsTable.entitlementKeys,
    })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  if (!product.isNativeNmi) {
    res.status(400).json({ error: "Product is not available for native checkout" });
    return;
  }

  res.json(product);
});

// ── Saved-card management ─────────────────────────────────────────────────────

/**
 * POST /api/billing/payment-methods
 * Save a card to the NMI Customer Vault.
 * Body: { paymentToken, last4, brand, expMonth, expYear, setDefault? }
 * vault_id is stored server-side; it is NEVER returned to the client.
 */
router.post("/billing/payment-methods", billingUserLimiter, billingIpLimiter, billingDeclineBreakerCheck(), async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const body = req.body as Record<string, unknown>;
  const paymentToken = typeof body.paymentToken === "string" ? body.paymentToken.trim() : "";
  const last4 = typeof body.last4 === "string" ? body.last4.trim() : "";
  const brand = typeof body.brand === "string" ? body.brand.trim() : "";
  const expMonth = typeof body.expMonth === "number" ? body.expMonth : NaN;
  const expYear = typeof body.expYear === "number" ? body.expYear : NaN;

  if (!paymentToken) {
    sendError(res, 400, "INVALID_REQUEST", "paymentToken is required");
    return;
  }
  if (containsPan(paymentToken)) {
    sendError(res, 400, "INVALID_REQUEST", "Storing raw card numbers is not permitted");
    return;
  }
  if (!last4 || !/^\d{4}$/.test(last4)) {
    sendError(res, 400, "INVALID_REQUEST", "last4 must be exactly 4 digits");
    return;
  }
  if (!brand) {
    sendError(res, 400, "INVALID_REQUEST", "brand is required");
    return;
  }
  if (!isValidBrand(brand)) {
    sendError(res, 400, "INVALID_REQUEST", "brand must be a known card network (e.g. Visa, Mastercard, Amex)");
    return;
  }
  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) {
    sendError(res, 400, "INVALID_REQUEST", "expMonth must be an integer between 1 and 12");
    return;
  }
  if (!Number.isInteger(expYear) || expYear < 2000) {
    sendError(res, 400, "INVALID_REQUEST", "expYear must be a valid 4-digit year");
    return;
  }

  let vaultResult: Awaited<ReturnType<typeof storeCardToken>>;
  try {
    vaultResult = await storeCardToken({ paymentToken, email: "" });
  } catch (err) {
    sendError(res, 502, "GATEWAY_ERROR", "Failed to communicate with payment gateway");
    return;
  }

  if (!vaultResult.success || !vaultResult.customerVaultId) {
    sendError(res, 402, "VAULT_ERROR", vaultResult.responseText || "Failed to save card to vault");
    return;
  }

  const saved = await insertPaymentMethod({
    userId: req.userId,
    vaultId: vaultResult.customerVaultId,
    last4,
    brand,
    expMonth,
    expYear,
  });

  res.status(201).json(saved);
});

/**
 * GET /api/billing/payment-methods
 * List the authenticated user's saved cards (masked display fields only).
 * vault_id is NEVER included.
 */
router.get("/billing/payment-methods", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const methods = await listPaymentMethods(req.userId);
  res.json({ paymentMethods: methods });
});

/**
 * POST /api/billing/payment-methods/:id/default
 * Set a saved card as the user's default. Returns 404 if the card does not
 * belong to the authenticated user.
 */
router.post("/billing/payment-methods/:id/default", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const id = parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    sendError(res, 400, "INVALID_REQUEST", "Invalid payment method id");
    return;
  }

  const ok = await setDefaultPaymentMethod(id, req.userId);
  if (!ok) {
    sendError(res, 404, "NOT_FOUND", "Payment method not found");
    return;
  }

  res.json({ success: true });
});

/**
 * DELETE /api/billing/payment-methods/:id
 * Remove a saved card. Before deleting, guards against cards that fund an
 * active or past_due subscription (→ 409). Deletes from NMI vault first;
 * if that fails the row is NOT removed and the error is surfaced to the caller.
 * Returns 404 if the card does not belong to the authenticated user.
 */
router.delete("/billing/payment-methods/:id", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const id = parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    sendError(res, 400, "INVALID_REQUEST", "Invalid payment method id");
    return;
  }

  const method = await getPaymentMethodForUser(id, req.userId);
  if (!method) {
    sendError(res, 404, "NOT_FOUND", "Payment method not found");
    return;
  }

  // Guard: if this card funds an active/past_due subscription, block removal.
  // Do this BEFORE any vault call so the vault is never touched in this case.
  const isPinned = await isPaymentMethodPinnedToActiveSubscription(id);
  if (isPinned) {
    sendError(
      res,
      409,
      "CARD_FUNDS_ACTIVE_SUBSCRIPTION",
      "This card funds an active subscription; cancel it or change its card first",
    );
    return;
  }

  let vaultDeleteResult: Awaited<ReturnType<typeof removeVaultCustomer>>;
  try {
    vaultDeleteResult = await removeVaultCustomer({ customerVaultId: method.vaultId });
  } catch (err) {
    sendError(res, 502, "GATEWAY_ERROR", "Failed to remove card from payment vault — card was not deleted");
    return;
  }

  if (!vaultDeleteResult.success) {
    sendError(
      res,
      502,
      "VAULT_DELETE_FAILED",
      `Failed to remove card from payment vault: ${vaultDeleteResult.responseText}. Card was not deleted.`,
    );
    return;
  }

  await deletePaymentMethodRow(id, req.userId);

  res.json({ success: true });
});

// ── Checkout ──────────────────────────────────────────────────────────────────

/**
 * POST /api/billing/checkout
 * Accepts either { paymentToken } (Collect.js token) or { paymentMethodId }
 * (saved card id). Exactly one must be supplied.
 */
router.post("/billing/checkout", billingUserLimiter, billingIpLimiter, billingDeclineBreakerCheck(), async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const body = req.body as Record<string, unknown>;
  const productId = typeof body.productId === "number" ? body.productId : null;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  const rawToken = typeof body.paymentToken === "string" ? body.paymentToken.trim() : "";
  const rawMethodId = body.paymentMethodId;

  const hasToken = rawToken.length > 0;
  const hasMethodId = rawMethodId !== undefined && rawMethodId !== null;

  if (!productId || !Number.isInteger(productId) || productId <= 0) {
    sendError(res, 400, "INVALID_REQUEST", "productId must be a positive integer");
    return;
  }
  if (!idempotencyKey || idempotencyKey.length > 256) {
    sendError(res, 400, "INVALID_REQUEST", "idempotencyKey is required and must be at most 256 characters");
    return;
  }
  if (!hasToken && !hasMethodId) {
    sendError(res, 400, "INVALID_REQUEST", "Provide either paymentToken or paymentMethodId");
    return;
  }
  if (hasToken && hasMethodId) {
    sendError(res, 400, "INVALID_REQUEST", "Provide either paymentToken or paymentMethodId, not both");
    return;
  }

  let paymentMethodId: number | undefined;
  if (hasMethodId) {
    const parsed = Number(rawMethodId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      sendError(res, 400, "INVALID_REQUEST", "paymentMethodId must be a positive integer");
      return;
    }
    paymentMethodId = parsed;
  }

  const outcome = await processCheckout({
    userId: req.userId,
    productId,
    idempotencyKey,
    ...(hasToken ? { paymentToken: rawToken } : {}),
    ...(paymentMethodId !== undefined ? { paymentMethodId } : {}),
  });

  switch (outcome.type) {
    case "paid":
    case "replay_paid":
      res.json({
        orderNumber: outcome.orderNumber,
        status: "paid",
        ...(outcome.grantedEntitlements !== undefined
          ? { grantedEntitlements: outcome.grantedEntitlements }
          : {}),
        ...(outcome.grantPending ? { grantPending: true } : {}),
      });
      return;

    case "paid_reconciliation_needed":
    case "replay_reconciliation_needed":
      res.status(202).json({
        orderNumber: outcome.orderNumber,
        status: "paid",
        reconciling: true,
      });
      return;

    case "declined": {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      recordFreshDecline(req.userId, ip).then(({ trippedUser, trippedIp }) => {
        if (trippedUser || trippedIp) {
          const dim = trippedUser ? "user" : "ip";
          const label = trippedUser ? String(req.userId) : ip;
          queueBillingAlert({
            type: "circuit_breaker_tripped",
            dimension: dim,
            dimensionLabel: label,
            declineCount: Number(process.env.BILLING_DECLINE_MAX ?? 5),
            windowSeconds: Number(process.env.BILLING_DECLINE_WINDOW_SECONDS ?? 900),
            cooldownSeconds: Number(process.env.BILLING_DECLINE_COOLDOWN_SECONDS ?? 3600),
          });
        }
      }).catch(() => {});
      res.status(402).json({ error: outcome.message });
      return;
    }

    case "replay_declined":
      res.status(402).json({ error: outcome.message });
      return;

    case "in_progress":
      sendError(res, 409, "IDEMPOTENCY_IN_PROGRESS", "This payment is already being processed. Please wait and retry.");
      return;

    case "conflict":
      sendError(res, 409, "IDEMPOTENCY_CONFLICT", "This idempotency key was used with a different product. Use a unique key per checkout.");
      return;

    case "invalid_product":
      sendError(res, 400, "INVALID_PRODUCT", outcome.message);
      return;

    case "user_not_found":
      sendError(res, 400, "USER_NOT_FOUND", "Authenticated user not found");
      return;

    case "payment_method_not_found":
      sendError(res, 404, "NOT_FOUND", "Payment method not found");
      return;

    default: {
      const _exhaustive: never = outcome;
      sendError(res, 500, "INTERNAL_ERROR", "Unexpected checkout outcome");
    }
  }
});

// ── Subscriptions ─────────────────────────────────────────────────────────────

/**
 * POST /api/billing/subscribe
 * Start a recurring subscription. Validates the product is recurring + native NMI,
 * vaults/pins a card, guards against duplicate subs, charges the initial period,
 * creates the subscription row, grants entitlements.
 *
 * Body: { productId, idempotencyKey, paymentToken? | paymentMethodId? }
 * Exactly one card source must be supplied. Amount is server-authoritative.
 */
router.post("/billing/subscribe", billingUserLimiter, billingIpLimiter, billingDeclineBreakerCheck(), async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const body = req.body as Record<string, unknown>;
  const productId = typeof body.productId === "number" ? body.productId : null;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  const rawToken = typeof body.paymentToken === "string" ? body.paymentToken.trim() : "";
  const rawMethodId = body.paymentMethodId;

  const hasToken = rawToken.length > 0;
  const hasMethodId = rawMethodId !== undefined && rawMethodId !== null;

  if (!productId || !Number.isInteger(productId) || productId <= 0) {
    sendError(res, 400, "INVALID_REQUEST", "productId must be a positive integer");
    return;
  }
  if (!idempotencyKey || idempotencyKey.length > 256) {
    sendError(res, 400, "INVALID_REQUEST", "idempotencyKey is required and must be at most 256 characters");
    return;
  }
  if (!hasToken && !hasMethodId) {
    sendError(res, 400, "INVALID_REQUEST", "Provide either paymentToken or paymentMethodId");
    return;
  }
  if (hasToken && hasMethodId) {
    sendError(res, 400, "INVALID_REQUEST", "Provide either paymentToken or paymentMethodId, not both");
    return;
  }

  let paymentMethodId: number | undefined;
  if (hasMethodId) {
    const parsed = Number(rawMethodId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      sendError(res, 400, "INVALID_REQUEST", "paymentMethodId must be a positive integer");
      return;
    }
    paymentMethodId = parsed;
  }

  const outcome = await processSubscribe({
    userId: req.userId,
    productId,
    idempotencyKey,
    ...(hasToken ? { paymentToken: rawToken } : {}),
    ...(paymentMethodId !== undefined ? { paymentMethodId } : {}),
  });

  switch (outcome.type) {
    case "subscribed":
      res.json({
        subscriptionId: outcome.subscriptionId,
        orderNumber: outcome.orderNumber,
        status: "active",
        nextChargeAt: outcome.nextChargeAt,
        ...(outcome.grantedEntitlements !== undefined
          ? { grantedEntitlements: outcome.grantedEntitlements }
          : {}),
        ...(outcome.grantPending ? { grantPending: true } : {}),
      });
      return;

    case "replay_subscribed":
      res.json({
        subscriptionId: outcome.subscriptionId,
        orderNumber: outcome.orderNumber,
        status: "active",
        ...(outcome.nextChargeAt !== undefined ? { nextChargeAt: outcome.nextChargeAt } : {}),
        ...(outcome.grantedEntitlements !== undefined
          ? { grantedEntitlements: outcome.grantedEntitlements }
          : {}),
        ...(outcome.grantPending ? { grantPending: true } : {}),
      });
      return;

    case "paid_reconciliation_needed":
    case "replay_reconciliation_needed":
      res.status(202).json({
        orderNumber: outcome.orderNumber,
        status: "active",
        reconciling: true,
      });
      return;

    case "declined": {
      const ip2 = req.ip || req.socket?.remoteAddress || "unknown";
      recordFreshDecline(req.userId, ip2).then(({ trippedUser, trippedIp }) => {
        if (trippedUser || trippedIp) {
          const dim = trippedUser ? "user" : "ip";
          const label = trippedUser ? String(req.userId) : ip2;
          queueBillingAlert({
            type: "circuit_breaker_tripped",
            dimension: dim,
            dimensionLabel: label,
            declineCount: Number(process.env.BILLING_DECLINE_MAX ?? 5),
            windowSeconds: Number(process.env.BILLING_DECLINE_WINDOW_SECONDS ?? 900),
            cooldownSeconds: Number(process.env.BILLING_DECLINE_COOLDOWN_SECONDS ?? 3600),
          });
        }
      }).catch(() => {});
      res.status(402).json({ error: outcome.message });
      return;
    }

    case "replay_declined":
      res.status(402).json({ error: outcome.message });
      return;

    case "in_progress":
      sendError(res, 409, "IDEMPOTENCY_IN_PROGRESS", "This payment is already being processed. Please wait and retry.");
      return;

    case "conflict":
      sendError(res, 409, "IDEMPOTENCY_CONFLICT", "This idempotency key was used with a different product. Use a unique key per checkout.");
      return;

    case "duplicate_subscription":
      sendError(res, 409, "DUPLICATE_SUBSCRIPTION", "You already have an active subscription to this product");
      return;

    case "invalid_product":
      sendError(res, 400, "INVALID_PRODUCT", outcome.message);
      return;

    case "user_not_found":
      sendError(res, 400, "USER_NOT_FOUND", "Authenticated user not found");
      return;

    case "payment_method_not_found":
      sendError(res, 404, "NOT_FOUND", "Payment method not found");
      return;

    case "vault_error":
      sendError(res, 502, "VAULT_ERROR", outcome.message);
      return;

    default: {
      const _exhaustive: never = outcome;
      sendError(res, 500, "INTERNAL_ERROR", "Unexpected subscribe outcome");
    }
  }
});

/**
 * GET /api/billing/subscriptions
 * List the current user's subscriptions. Never exposes vault_id.
 */
router.get("/billing/subscriptions", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const subs = await listUserSubscriptions(req.userId);

  res.json({
    subscriptions: subs.map((s) => ({
      id: s.id,
      status: s.status,
      interval: s.interval,
      amountCents: s.amountCents,
      currency: s.currency,
      currentPeriodEnd: s.currentPeriodEnd,
      nextChargeAt: s.nextChargeAt,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      canceledAt: s.canceledAt,
      createdAt: s.createdAt,
      product: s.product,
    })),
  });
});

/**
 * POST /api/billing/subscriptions/:id/cancel
 * Set cancel_at_period_end=true. Does NOT revoke access immediately; access
 * runs to current_period_end. Returns 404 if the subscription is not owned
 * by the authenticated user.
 */
router.post("/billing/subscriptions/:id/cancel", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const id = parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    sendError(res, 400, "INVALID_REQUEST", "Invalid subscription id");
    return;
  }

  const updated = await processCancel(id, req.userId);
  if (!updated) {
    sendError(res, 404, "NOT_FOUND", "Subscription not found");
    return;
  }

  res.json({
    id: updated.id,
    status: updated.status,
    cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
    canceledAt: updated.canceledAt,
    currentPeriodEnd: updated.currentPeriodEnd,
    nextChargeAt: updated.nextChargeAt,
  });
});

export default router;
