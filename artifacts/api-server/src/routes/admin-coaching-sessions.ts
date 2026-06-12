import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  coachingCreditLedgerTable,
  sessionPackBookingsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { getCreditBalance } from "../lib/session-credits";

const router: IRouter = Router();

function parseId(value: string | string[] | undefined): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(str ?? "", 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

// Grant (or deduct) session credits for a member. Until the purchase/checkout
// flow ships, this is how members get credits to spend on 1-on-1 sessions.
router.post(
  "/admin/coaching/session-credits/grant",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const memberId = parseId(req.body?.memberId);
    const amount =
      typeof req.body?.amount === "number" ? req.body.amount : parseInt(req.body?.amount, 10);
    const note = typeof req.body?.note === "string" ? req.body.note.trim() || null : null;

    if (!memberId) {
      res.status(400).json({ error: "Invalid member id" });
      return;
    }
    if (!Number.isInteger(amount) || amount === 0) {
      res.status(400).json({ error: "Amount must be a non-zero integer" });
      return;
    }

    const [member] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, memberId));
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    await db.insert(coachingCreditLedgerTable).values({
      memberId,
      delta: amount,
      reason: "admin_grant",
      note,
      createdByUserId: req.userId!,
    });

    const balance = await getCreditBalance(memberId);
    res.status(201).json({ memberId, balance });
  },
);

// Inspect a member's balance, ledger, and bookings.
router.get(
  "/admin/coaching/session-credits/:memberId",
  requirePermission("coaching:view"),
  async (req: Request, res: Response): Promise<void> => {
    const memberId = parseId(req.params.memberId);
    if (!memberId) {
      res.status(400).json({ error: "Invalid member id" });
      return;
    }

    const [member] = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, memberId));
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    const [balance, ledger, bookings] = await Promise.all([
      getCreditBalance(memberId),
      db
        .select()
        .from(coachingCreditLedgerTable)
        .where(eq(coachingCreditLedgerTable.memberId, memberId))
        .orderBy(desc(coachingCreditLedgerTable.createdAt)),
      db
        .select()
        .from(sessionPackBookingsTable)
        .where(eq(sessionPackBookingsTable.memberId, memberId))
        .orderBy(desc(sessionPackBookingsTable.scheduledAt)),
    ]);

    res.json({ member, balance, ledger, bookings });
  },
);

export default router;
