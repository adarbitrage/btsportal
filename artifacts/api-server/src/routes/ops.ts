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
 *
 * Hardening on top of the shared-secret auth:
 *   - Refunds at/above BTS_APPROVER_REQUIRED_THRESHOLD_CENTS additionally
 *     require a valid `X-Refund-Approval` header (checked against
 *     BTS_OPS_REFUND_APPROVAL_KEY, constant-time). See ops-refund-service.ts.
 *     The `actor` field in the request body is audit-trail metadata only —
 *     it is never treated as authorization.
 *   - All ops routes are rate-limited (per key-fingerprint + per IP) via
 *     ops-rate-limit.ts, fail-closed-soft if Redis is unavailable.
 *   - Audit-log writes are always wrapped so a logging failure never turns
 *     an already-completed refund/grant/revoke into a false failure.
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
import {
  findOnboardingRepairCandidates,
  repairOnboardingCandidates,
} from "../lib/onboarding-grant-repair.js";
import { logAuditEvent } from "../lib/audit-log.js";
import { sendError } from "../lib/api-errors.js";
import {
  opsWriteKeyLimiter,
  opsWriteIpLimiter,
  opsReadKeyLimiter,
  opsReadIpLimiter,
} from "../middleware/ops-rate-limit.js";

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

// NOTE: rate limiters are passed with an explicit `<{ email: string }>` (etc)
// generic on each route below. Express 5's route-string param-literal
// inference for `req.params` only fires when every passed handler shares the
// exact same params type; mixing the generic `RequestHandler` type of the
// rate limiters with an un-annotated async handler silently widens every
// `req.params.*` access on the actual route body to `string | string[]`.
// Pinning the generic here keeps that inference correct.
router.get<{ email: string }>("/ops/customers/:email/orders", opsReadKeyLimiter, opsReadIpLimiter, async (req, res): Promise<void> => {
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

router.get<{ email: string }>("/ops/customers/:email", opsReadKeyLimiter, opsReadIpLimiter, async (req, res): Promise<void> => {
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

router.post<{ orderNumber: string }>("/ops/orders/:orderNumber/refund", opsWriteKeyLimiter, opsWriteIpLimiter, async (req, res): Promise<void> => {
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

  // Raw header value only — never logged, never echoed in any response body.
  const rawApproval = req.headers["x-refund-approval"];
  const approvalHeader = typeof rawApproval === "string" ? rawApproval : undefined;

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

  const outcome = await processRefund({ orderNumber, idempotencyKey, amountCents, actor, approvalHeader });

  switch (outcome.outcome) {
    case "success":
      res.json(outcome);
      return;

    case "approval_required":
      // Deliberately generic: no threshold, no key, no header value in the
      // response body or logs.
      sendError(res, 403, "OPS_APPROVAL_REQUIRED", "This refund requires a valid approval header");
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

router.post<{ orderNumber: string }>("/ops/orders/:orderNumber/access", opsWriteKeyLimiter, opsWriteIpLimiter, async (req, res): Promise<void> => {
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

  // The access grant/revoke DB mutation above already succeeded. An audit
  // write failure must not turn this into a false failure for a completed
  // action — log loudly and still return success.
  try {
    await logAuditEvent({
      actorEmail: actor || undefined,
      actionType: `billing.ops.access.${action}`,
      entityType: "bts_order",
      entityId: String(order.id),
      description: `Ops ${action} access for order ${orderNumber}${reason ? `: ${reason}` : ""}`,
      metadata: { orderNumber, action, reason, actor, ...accessResult },
    });
  } catch (auditErr) {
    console.error(
      `[OpsAccess] ALERT: Audit write failed for COMPLETED ${action} on order ${orderNumber}:`,
      auditErr,
    );
  }

  res.json({ order_number: orderNumber, ...accessResult });
});

// ─── POST /api/ops/onboarding/repair-admin-grants ─────────────────────────────
//
// Repair mechanism for the two production probe members (Task #1658) — and
// any other historical victim — whose admin/manual-upgrade product grant
// bypassed the shared `insertUserProductGrant` seam before this task wired
// both call sites through it. NOT a boot hook, NOT auto-run: an operator
// must explicitly POST here after publish.
//
//   - Default (no `confirm`, or `confirm: false`) — dry-run. Reports exactly
//     what WOULD change (target member emails, persisted vs resolved
//     variant, whether a partner assignment would fire) without writing
//     anything. Also reports (read-only) the full set of other members with
//     the same symptom, split grandfathered vs not, so the owner can decide
//     whether the repair should extend beyond the two known probes.
//   - `confirm: true` — idempotently re-runs the exact post-grant hooks
//     (`maybeForceOnboardingReentry` + partner assignment where warranted)
//     for every non-grandfathered candidate. `grandfathered=true` rows are
//     ALWAYS skipped for onboarding-state changes, per this task's guardrail
//     (their missing partner assignments belong to the separate
//     partner-backfill effort).
router.post("/ops/onboarding/repair-admin-grants", opsWriteKeyLimiter, opsWriteIpLimiter, async (req, res): Promise<void> => {
  const confirm = req.body?.confirm === true;

  const candidates = await findOnboardingRepairCandidates();
  const actionable = candidates.filter((c) => !c.grandfathered);
  const grandfatheredSkipped = candidates.filter((c) => c.grandfathered);

  const summarize = (c: (typeof candidates)[number]) => ({
    userId: c.userId,
    email: c.email,
    persistedVariant: c.persistedVariant,
    resolvedVariant: c.resolvedVariant,
    onboardingCompleteBefore: c.onboardingCompleteBefore,
    wouldAssignPartner: c.wouldAssignPartner,
  });

  if (!confirm) {
    res.json({
      dryRun: true,
      repairCandidateCount: actionable.length,
      repairCandidates: actionable.map(summarize),
      grandfatheredSkippedCount: grandfatheredSkipped.length,
      grandfatheredSkipped: grandfatheredSkipped.map(summarize),
    });
    return;
  }

  const outcomes = await repairOnboardingCandidates(actionable);

  try {
    await logAuditEvent({
      actionType: "billing.ops.onboarding.repair_admin_grants",
      entityType: "system",
      entityId: "onboarding-grant-repair",
      description: `Repaired onboarding re-entry for ${outcomes.length} member(s) whose grant bypassed the seam`,
      metadata: {
        repairedCount: outcomes.length,
        repaired: outcomes,
        grandfatheredSkippedCount: grandfatheredSkipped.length,
      },
    });
  } catch (auditErr) {
    console.error(
      "[OpsOnboardingRepair] ALERT: Audit write failed for COMPLETED repair run:",
      auditErr,
    );
  }

  res.json({
    dryRun: false,
    repairedCount: outcomes.length,
    repaired: outcomes,
    grandfatheredSkippedCount: grandfatheredSkipped.length,
    grandfatheredSkipped: grandfatheredSkipped.map(summarize),
  });
});

export default router;
