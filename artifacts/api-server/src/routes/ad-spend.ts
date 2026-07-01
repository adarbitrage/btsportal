/**
 * Ad-spend funding routes.
 *
 * POST /ad-spend/fund    — charge a card and credit the ledger
 * GET  /ad-spend/balance — return the member's current ad-spend balance
 */

import { Router } from "express";
import { sendError, ErrorCodes } from "../lib/api-errors.js";
import { fundAdSpend, getAdSpendBalance } from "../lib/payments/ad-spend-funding-service.js";

const router = Router();

const MIN_AMOUNT_CENTS = 100_000;
const MAX_AMOUNT_CENTS = 1_000_000;

/**
 * GET /ad-spend/balance
 * Returns { balanceCents, balanceDisplay } for the authenticated member.
 */
router.get("/ad-spend/balance", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const balanceCents = await getAdSpendBalance(req.userId);
  const balanceDisplay = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(balanceCents / 100);

  res.json({ balanceCents, balanceDisplay });
});

/**
 * POST /ad-spend/fund
 * Body: { amountCents, idempotencyKey, paymentToken? | paymentMethodId? }
 */
router.post("/ad-spend/fund", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const body = req.body as Record<string, unknown>;

  const rawAmount = body.amountCents;
  const amountCents =
    typeof rawAmount === "number" && Number.isInteger(rawAmount) ? rawAmount : NaN;

  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  const rawToken = typeof body.paymentToken === "string" ? body.paymentToken.trim() : "";
  const rawMethodId = body.paymentMethodId;

  const hasToken = rawToken.length > 0;
  const hasMethodId = rawMethodId !== undefined && rawMethodId !== null;

  if (!Number.isInteger(amountCents) || isNaN(amountCents)) {
    sendError(res, 400, "INVALID_REQUEST", "amountCents must be an integer");
    return;
  }
  if (amountCents < MIN_AMOUNT_CENTS || amountCents > MAX_AMOUNT_CENTS) {
    sendError(
      res,
      400,
      "AMOUNT_OUT_OF_RANGE",
      `Amount must be between $1,000 and $10,000. Received $${(amountCents / 100).toFixed(2)}.`,
    );
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

  const outcome = await fundAdSpend({
    userId: req.userId,
    amountCents,
    idempotencyKey,
    ...(hasToken ? { paymentToken: rawToken } : {}),
    ...(paymentMethodId !== undefined ? { paymentMethodId } : {}),
  });

  switch (outcome.type) {
    case "paid":
      res.json({
        orderNumber: outcome.orderNumber,
        status: "paid",
        creditedCents: outcome.creditedCents,
      });
      return;

    case "replay_paid":
      res.json({ orderNumber: outcome.orderNumber, status: "paid" });
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
      sendError(res, 409, "IDEMPOTENCY_CONFLICT", "This idempotency key was used with a different request. Use a unique key per deposit.");
      return;

    case "amount_out_of_range":
      sendError(res, 400, "AMOUNT_OUT_OF_RANGE", outcome.message);
      return;

    case "product_not_configured":
      sendError(res, 503, "NOT_CONFIGURED", "Ad-spend funding is not available at this time");
      return;

    case "user_not_found":
      sendError(res, 400, "USER_NOT_FOUND", "Authenticated user not found");
      return;

    case "payment_method_not_found":
      sendError(res, 404, "NOT_FOUND", "Payment method not found");
      return;

    default: {
      const _exhaustive: never = outcome;
      sendError(res, 500, "INTERNAL_ERROR", "Unexpected funding outcome");
    }
  }
});

export default router;
