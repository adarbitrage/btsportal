import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import { getPublicTokenizationKey, storeCardToken, removeVaultCustomer } from "../lib/payments/charge-service.js";
import { processCheckout } from "../lib/payments/checkout-service.js";
import { sendError, ErrorCodes } from "../lib/api-errors.js";
import {
  insertPaymentMethod,
  listPaymentMethods,
  getPaymentMethodForUser,
  setDefaultPaymentMethod,
  deletePaymentMethodRow,
} from "../storage/payment-methods-store.js";

const router = Router();

const DIGIT_RUN_PATTERN = /\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d/;

function containsPan(value: string): boolean {
  return DIGIT_RUN_PATTERN.test(value);
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
router.post("/billing/payment-methods", async (req, res): Promise<void> => {
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
 * Remove a saved card. Deletes from NMI vault first; if that fails the row is
 * NOT removed and the error is surfaced to the caller.
 * Returns 404 if the card does not belong to the authenticated user.
 *
 * TODO (Tier 6): Before deleting, check whether this card is attached to an
 * active recurring subscription and block the removal if so.
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
router.post("/billing/checkout", async (req, res): Promise<void> => {
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

    case "declined":
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

export default router;
