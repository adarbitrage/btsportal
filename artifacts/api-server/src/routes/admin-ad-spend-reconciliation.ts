/**
 * Admin ad-spend reconciliation — /api/admin/ad-spend/reconciliations
 *
 * Closes the loop the billing digest points at ("check the admin panel"):
 * lists stuck `paid_reconciliation_needed` wallet_topup deposits (read from
 * the checkout_idempotency JSONB result — the only durable trace of that
 * outcome; it is never persisted on bts_orders) and lets an admin resolve
 * one via the same `resolveAdSpendReconciliation` service the ops endpoint
 * wraps (idempotent ledger credit + exactly-once receipt email).
 */

import { Router, type Request, type Response } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, btsOrdersTable, checkoutIdempotencyTable, usersTable } from "@workspace/db";
import { requirePermission } from "../middleware/rbac";
import { resolveAdSpendReconciliation } from "../lib/payments/ad-spend-funding-service.js";

const router = Router();

// ─── GET /admin/ad-spend/reconciliations ─────────────────────────────────────
//
// Open = outcomeType 'paid_reconciliation_needed' AND no reconciliationResolvedAt
// (same predicate family as the billing digest's open-reconciliation count).
// `?includeResolved=1` also returns recently-resolved rows so the UI can show
// a resolved state instead of rows just vanishing.

router.get(
  "/admin/ad-spend/reconciliations",
  requirePermission("revenue:view"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const includeResolved = req.query.includeResolved === "1" || req.query.includeResolved === "true";

      const baseWhere = sql`${checkoutIdempotencyTable.result} ->> 'outcomeType' = 'paid_reconciliation_needed' AND ${btsOrdersTable.orderType} = 'wallet_topup'`;
      const where = includeResolved
        ? baseWhere
        : sql`${baseWhere} AND (${checkoutIdempotencyTable.result} ->> 'reconciliationResolvedAt') IS NULL`;

      const rows = await db
        .select({
          orderNumber: btsOrdersTable.orderNumber,
          chargedCents: btsOrdersTable.totalCents,
          currency: btsOrdersTable.currency,
          createdAt: btsOrdersTable.createdAt,
          userId: btsOrdersTable.userId,
          email: usersTable.email,
          name: usersTable.name,
          result: checkoutIdempotencyTable.result,
        })
        .from(checkoutIdempotencyTable)
        .innerJoin(btsOrdersTable, eq(checkoutIdempotencyTable.orderId, btsOrdersTable.id))
        .leftJoin(usersTable, eq(btsOrdersTable.userId, usersTable.id))
        .where(where)
        .orderBy(desc(btsOrdersTable.createdAt));

      const reconciliations = rows.map((row) => {
        const result = (row.result ?? {}) as Record<string, unknown>;
        const resolvedAt =
          typeof result.reconciliationResolvedAt === "string" ? result.reconciliationResolvedAt : null;
        return {
          orderNumber: row.orderNumber,
          chargedCents: row.chargedCents,
          currency: row.currency,
          createdAt: row.createdAt,
          userId: row.userId,
          email: row.email,
          name: row.name,
          transactionId: typeof result.transactionId === "string" ? result.transactionId : null,
          resolvedAt,
          resolvedBy:
            typeof result.reconciliationResolvedBy === "string" ? result.reconciliationResolvedBy : null,
          creditedCents: typeof result.creditedCents === "number" ? result.creditedCents : null,
        };
      });

      res.json({
        reconciliations,
        openCount: reconciliations.filter((r) => r.resolvedAt === null).length,
      });
    } catch (err) {
      console.error("[AdminAdSpendReconciliation] List error:", err);
      res.status(500).json({ error: "Failed to load open reconciliations" });
    }
  },
);

// ─── POST /admin/ad-spend/reconciliations/:orderNumber/resolve ───────────────

router.post<{ orderNumber: string }>(
  "/admin/ad-spend/reconciliations/:orderNumber/resolve",
  requirePermission("revenue:view"),
  async (req: Request<{ orderNumber: string }>, res: Response): Promise<void> => {
    const orderNumber = req.params.orderNumber ?? "";
    if (!orderNumber) {
      res.status(400).json({ error: "orderNumber is required" });
      return;
    }

    try {
      const actor = req.userEmail || (req.userId ? `admin:${req.userId}` : "admin-panel");
      const outcome = await resolveAdSpendReconciliation({ orderNumber, actor });

      switch (outcome.type) {
        case "resolved":
          res.json({
            outcome: "resolved",
            orderNumber: outcome.orderNumber,
            creditedCents: outcome.creditedCents,
            feeCents: outcome.feeCents,
            chargedCents: outcome.chargedCents,
            creditInserted: outcome.creditInserted,
          });
          return;
        case "already_resolved":
          res.status(409).json({ error: "This deposit was already reconciled — receipt not re-sent" });
          return;
        case "not_reconciliation_needed":
          res.status(409).json({ error: "Order is not in a reconciliation-needed state" });
          return;
        case "order_not_found":
          res.status(404).json({ error: "Ad-spend deposit order not found" });
          return;
        case "amount_underivable":
          res.status(422).json({ error: "Could not derive deposit amount from charged total" });
          return;
        case "user_not_found":
          res.status(422).json({ error: "Order has no linked user" });
          return;
        default: {
          const _exhaustive: never = outcome;
          res.status(500).json({ error: "Unexpected reconcile outcome" });
        }
      }
    } catch (err) {
      console.error("[AdminAdSpendReconciliation] Resolve error:", err);
      res.status(500).json({ error: "Failed to resolve reconciliation" });
    }
  },
);

export default router;
