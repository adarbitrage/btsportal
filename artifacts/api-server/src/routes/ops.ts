/**
 * Customer Ops API — /api/ops
 *
 * Service-to-service endpoints (no member auth). All routes require the
 * OPS_API_KEY shared secret in `Authorization: Bearer <key>`.
 *
 * Endpoints:
 *   GET  /api/ops/customers/:email/orders   — orders by email (read)
 *   GET  /api/ops/customers/:email          — aggregate customer view (read)
 *   POST /api/ops/orders/:orderNumber/refund — refund (write)
 *   POST /api/ops/orders/:orderNumber/access — grant/revoke access (write)
 */

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  btsOrdersTable,
  btsOrderItemsTable,
  subscriptionsTable,
  userProductsTable,
  usersTable,
  productsTable,
} from "@workspace/db";
import { requireOpsServiceAuth } from "../middleware/ops-service-auth.js";
import { processRefund } from "../lib/ops-refund-service.js";
import { insertUserProductGrant } from "../lib/external-grant-product.js";
import { logAuditEvent } from "../lib/audit-log.js";
import { sendError } from "../lib/api-errors.js";

const router = Router();

router.use("/ops", requireOpsServiceAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function refundableAmountCents(order: {
  totalCents: number;
  status: string;
}): number {
  if (order.status === "refunded") return 0;
  return order.totalCents;
}

function formatOrder(
  order: typeof btsOrdersTable.$inferSelect,
): Record<string, unknown> {
  return {
    order_number: order.orderNumber,
    status: order.status,
    order_type: order.orderType,
    total_cents: order.totalCents,
    currency: order.currency,
    refundable_amount_cents: refundableAmountCents(order),
    gateway_transaction_id: order.gatewayTransactionId,
    subscription_id: order.subscriptionId,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  };
}

// ─── GET /api/ops/customers/:email/orders ─────────────────────────────────────

router.get("/ops/customers/:email/orders", async (req, res): Promise<void> => {
  const email = decodeURIComponent(req.params.email ?? "").toLowerCase().trim();
  if (!email) {
    sendError(res, 400, "INVALID_REQUEST", "email is required");
    return;
  }

  const orders = await db
    .select()
    .from(btsOrdersTable)
    .where(eq(btsOrdersTable.email, email))
    .orderBy(btsOrdersTable.createdAt);

  res.json({ email, orders: orders.map(formatOrder) });
});

// ─── GET /api/ops/customers/:email ────────────────────────────────────────────

router.get("/ops/customers/:email", async (req, res): Promise<void> => {
  const email = decodeURIComponent(req.params.email ?? "").toLowerCase().trim();
  if (!email) {
    sendError(res, 400, "INVALID_REQUEST", "email is required");
    return;
  }

  const orders = await db
    .select()
    .from(btsOrdersTable)
    .where(eq(btsOrdersTable.email, email))
    .orderBy(btsOrdersTable.createdAt);

  const userId = orders.find((o) => o.userId !== null)?.userId ?? null;

  const subscriptions = userId !== null
    ? await db
        .select({
          id: subscriptionsTable.id,
          status: subscriptionsTable.status,
          productId: subscriptionsTable.productId,
          interval: subscriptionsTable.interval,
          amountCents: subscriptionsTable.amountCents,
          currency: subscriptionsTable.currency,
          currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
          nextChargeAt: subscriptionsTable.nextChargeAt,
          cancelAtPeriodEnd: subscriptionsTable.cancelAtPeriodEnd,
          canceledAt: subscriptionsTable.canceledAt,
        })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
    : [];

  const totalOrders = orders.length;
  const totalSpentCents = orders
    .filter((o) => o.status === "paid" || o.status === "partial_refunded")
    .reduce((sum, o) => sum + o.totalCents, 0);

  res.json({
    email,
    user_id: userId,
    total_orders: totalOrders,
    total_spent_cents: totalSpentCents,
    orders: orders.map(formatOrder),
    subscriptions,
  });
});

// ─── POST /api/ops/orders/:orderNumber/refund ─────────────────────────────────

router.post("/ops/orders/:orderNumber/refund", async (req, res): Promise<void> => {
  const orderNumber = req.params.orderNumber ?? "";
  if (!orderNumber) {
    sendError(res, 400, "INVALID_REQUEST", "orderNumber is required");
    return;
  }

  const body = req.body as Record<string, unknown>;
  const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 256) {
    sendError(res, 400, "INVALID_REQUEST", "idempotency_key is required (max 256 chars)");
    return;
  }

  const rawAmount = body.amount_cents;
  let amountCents: number | undefined;
  if (rawAmount !== undefined && rawAmount !== null) {
    const parsed = Number(rawAmount);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      sendError(res, 400, "INVALID_AMOUNT", "amount_cents must be a finite integer");
      return;
    }
    if (parsed <= 0) {
      sendError(res, 400, "INVALID_AMOUNT", "amount_cents must be positive");
      return;
    }
    amountCents = parsed;
  }

  const actor = typeof body.actor === "string" ? body.actor : undefined;

  const outcome = await processRefund({ orderNumber, idempotencyKey, amountCents, actor });

  switch (outcome.outcome) {
    case "success":
      res.json(outcome);
      return;

    case "replay":
      res.json(outcome.result);
      return;

    case "already_refunded":
      res.status(409).json({
        error: "Order is already refunded",
        order_status: outcome.orderStatus,
      });
      return;

    case "declined":
      res.status(402).json({ error: "Gateway declined", reason: outcome.reason });
      return;

    case "gateway_error":
      res.status(502).json({ error: "Gateway error", reason: outcome.reason });
      return;

    case "in_progress":
      sendError(res, 409, "IDEMPOTENCY_IN_PROGRESS", "This refund is already in progress. Wait and retry.");
      return;

    case "conflict":
      sendError(res, 409, "IDEMPOTENCY_CONFLICT", "idempotency_key was used with a different order or amount");
      return;

    case "not_found":
      res.status(404).json({ error: "Order not found" });
      return;

    case "invalid_amount":
      res.status(400).json({ error: "Invalid amount", reason: outcome.reason });
      return;

    default: {
      const _exhaustive: never = outcome;
      sendError(res, 500, "INTERNAL_ERROR", "Unexpected refund outcome");
    }
  }
});

// ─── POST /api/ops/orders/:orderNumber/access ─────────────────────────────────

router.post("/ops/orders/:orderNumber/access", async (req, res): Promise<void> => {
  const orderNumber = req.params.orderNumber ?? "";
  if (!orderNumber) {
    sendError(res, 400, "INVALID_REQUEST", "orderNumber is required");
    return;
  }

  const body = req.body as Record<string, unknown>;
  const action = body.action;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const actor = typeof body.actor === "string" ? body.actor.trim() : "";

  if (action !== "grant" && action !== "revoke") {
    sendError(res, 400, "INVALID_REQUEST", "action must be 'grant' or 'revoke'");
    return;
  }

  const [order] = await db
    .select()
    .from(btsOrdersTable)
    .where(eq(btsOrdersTable.orderNumber, orderNumber))
    .limit(1);

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (!order.userId) {
    res.status(422).json({ error: "Order has no linked user" });
    return;
  }

  const [item] = await db
    .select({ productId: btsOrderItemsTable.productId })
    .from(btsOrderItemsTable)
    .where(eq(btsOrderItemsTable.orderId, order.id))
    .limit(1);

  if (!item?.productId) {
    res.status(422).json({ error: "Order has no product line item" });
    return;
  }

  const [product] = await db
    .select({ id: productsTable.id, durationDays: productsTable.durationDays })
    .from(productsTable)
    .where(eq(productsTable.id, item.productId))
    .limit(1);

  let accessResult: Record<string, unknown>;

  if (action === "grant") {
    const result = await insertUserProductGrant({
      userId: order.userId,
      productId: item.productId,
      externalSource: "nmi",
      externalOrderId: orderNumber,
      durationDays: product?.durationDays ?? null,
    });
    accessResult = { action: "grant", alreadyGranted: result.alreadyGranted };
  } else {
    const updated = await db
      .update(userProductsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(
        and(
          eq(userProductsTable.userId, order.userId),
          eq(userProductsTable.productId, item.productId),
          eq(userProductsTable.externalOrderId, orderNumber),
          eq(userProductsTable.status, "active"),
        ),
      )
      .returning({ id: userProductsTable.id });
    accessResult = { action: "revoke", revoked: updated.length > 0 };
  }

  logAuditEvent({
    actorEmail: actor || undefined,
    actionType: `billing.ops.access.${action}`,
    entityType: "bts_order",
    entityId: String(order.id),
    description: `Ops ${action} access for order ${orderNumber}${reason ? `: ${reason}` : ""}`,
    metadata: { orderNumber, action, reason, actor, ...accessResult },
  });

  res.json({ order_number: orderNumber, ...accessResult });
});

export default router;
