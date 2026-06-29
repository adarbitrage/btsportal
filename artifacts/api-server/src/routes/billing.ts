import { Router } from "express";
import { getPublicTokenizationKey } from "../lib/payments/charge-service.js";
import { processCheckout } from "../lib/payments/checkout-service.js";
import { sendError, ErrorCodes } from "../lib/api-errors.js";

const router = Router();

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

router.post("/billing/checkout", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const body = req.body as Record<string, unknown>;
  const productId = typeof body.productId === "number" ? body.productId : null;
  const paymentToken = typeof body.paymentToken === "string" ? body.paymentToken.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!productId || !Number.isInteger(productId) || productId <= 0) {
    sendError(res, 400, "INVALID_REQUEST", "productId must be a positive integer");
    return;
  }
  if (!paymentToken) {
    sendError(res, 400, "INVALID_REQUEST", "paymentToken is required");
    return;
  }
  if (!idempotencyKey || idempotencyKey.length > 256) {
    sendError(res, 400, "INVALID_REQUEST", "idempotencyKey is required and must be at most 256 characters");
    return;
  }

  const outcome = await processCheckout({
    userId: req.userId,
    productId,
    paymentToken,
    idempotencyKey,
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

    default: {
      const _exhaustive: never = outcome;
      sendError(res, 500, "INTERNAL_ERROR", "Unexpected checkout outcome");
    }
  }
});

export default router;
