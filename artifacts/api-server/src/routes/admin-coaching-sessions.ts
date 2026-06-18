import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  pool,
  coachingCreditLedgerTable,
  sessionPackBookingsTable,
  sessionPackCoachesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, or, asc, desc, ilike, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { requirePermission } from "../middleware/rbac";
import { getCreditBalance, memberCreditLockKey } from "../lib/session-credits";
import { cancelAppointment } from "../lib/ghl-coaching-calendar";
import {
  queryPackBookings,
  parseManualRecordingLinks,
  resolveManualRecordingFields,
} from "../lib/pack-bookings";
import { normalizeActionItems, syncBookingCoachingToGHL } from "../lib/coaching-notes";
import type { SessionPackBooking } from "@workspace/db";

const router: IRouter = Router();

/**
 * After a booking's notes/action items change, mirror them to the member's GHL
 * contact card. Best-effort/fire-and-forget — never blocks or fails the save.
 */
async function mirrorBookingToGHL(booking: SessionPackBooking): Promise<void> {
  try {
    const [coach] = await db
      .select({ name: sessionPackCoachesTable.name })
      .from(sessionPackCoachesTable)
      .where(eq(sessionPackCoachesTable.id, booking.coachId));
    syncBookingCoachingToGHL({
      memberId: booking.memberId,
      coachName: coach?.name ?? null,
      scheduledAt: booking.scheduledAt,
      coachNotes: booking.coachNotes,
      actionItems: booking.actionItems,
    });
  } catch (err) {
    console.error("[admin-coaching-sessions] GHL mirror lookup failed:", err);
  }
}

function parseId(value: unknown): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(typeof str === "string" ? str : "", 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function firstString(value: unknown): string | undefined {
  const str = Array.isArray(value) ? value[0] : value;
  return typeof str === "string" && str.trim() ? str.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Grant (or deduct) session credits for a member.
// ---------------------------------------------------------------------------

router.post(
  "/admin/coaching/pack/session-credits/grant",
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
      reason: amount > 0 ? "admin_grant" : "adjustment",
      note,
      createdByUserId: req.userId!,
    });

    const balance = await getCreditBalance(memberId);
    res.status(201).json({ memberId, balance });
  },
);

// ---------------------------------------------------------------------------
// Inspect a member's balance, ledger, and bookings.
// ---------------------------------------------------------------------------

router.get(
  "/admin/coaching/pack/session-credits/:memberId",
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

// ---------------------------------------------------------------------------
// Member credit lookup by email/name (for the admin credit granter picker).
// ---------------------------------------------------------------------------

router.get(
  "/admin/coaching/pack/members/search",
  requirePermission("coaching:view"),
  async (req: Request, res: Response): Promise<void> => {
    const q = firstString(req.query.q);
    if (!q || q.length < 2) {
      res.json([]);
      return;
    }
    const like = `%${q}%`;
    const members = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(or(ilike(usersTable.name, like), ilike(usersTable.email, like)))
      .orderBy(asc(usersTable.name))
      .limit(20);
    res.json(members);
  },
);

// ---------------------------------------------------------------------------
// All bookings (filters + member/coach join + status stats).
// ---------------------------------------------------------------------------

router.get(
  "/admin/coaching/pack/sessions",
  requirePermission("coaching:view"),
  async (req: Request, res: Response): Promise<void> => {
    const limitRaw = parseInt(firstString(req.query.limit) ?? "50", 10);
    const offsetRaw = parseInt(firstString(req.query.offset) ?? "0", 10);

    const result = await queryPackBookings({
      status: firstString(req.query.status),
      coachId: parseId(req.query.coachId as string | undefined) ?? undefined,
      q: firstString(req.query.q),
      from: firstString(req.query.from),
      to: firstString(req.query.to),
      likelyNoShow: firstString(req.query.likelyNoShow) === "true",
      limit: Number.isInteger(limitRaw) ? limitRaw : undefined,
      offset: Number.isInteger(offsetRaw) ? offsetRaw : undefined,
    });

    res.json(result);
  },
);

// ---------------------------------------------------------------------------
// Admin cancel a booking (optional credit refund).
// ---------------------------------------------------------------------------

router.patch(
  "/admin/coaching/pack/sessions/:id/cancel",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const bookingId = parseId(req.params.id);
    if (!bookingId) {
      res.status(400).json({ error: "Invalid booking id" });
      return;
    }
    const refund = req.body?.refund !== false; // default: refund the credit

    const [existing] = await db
      .select({ memberId: sessionPackBookingsTable.memberId })
      .from(sessionPackBookingsTable)
      .where(eq(sessionPackBookingsTable.id, bookingId));
    if (!existing) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const memberId = existing.memberId;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const txDb = drizzle(client);
      await txDb.execute(sql`SELECT pg_advisory_xact_lock(${memberCreditLockKey(memberId)})`);

      const cancelled = await txDb
        .update(sessionPackBookingsTable)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(
          and(
            eq(sessionPackBookingsTable.id, bookingId),
            eq(sessionPackBookingsTable.status, "booked"),
          ),
        )
        .returning();

      if (cancelled.length === 0) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "This session can no longer be cancelled" });
        return;
      }

      const booking = cancelled[0];
      if (booking.ghlAppointmentId) {
        try {
          await cancelAppointment(booking.ghlAppointmentId);
        } catch (err) {
          await client.query("ROLLBACK");
          console.error("[admin-coaching-sessions] GHL cancel failed:", err);
          res.status(502).json({ error: "Could not cancel the session on the calendar. Please try again." });
          return;
        }
      }

      if (refund) {
        await txDb
          .insert(coachingCreditLedgerTable)
          .values({
            memberId,
            delta: 1,
            reason: "admin_cancel_refund",
            bookingId,
            createdByUserId: req.userId!,
          })
          .onConflictDoNothing();
      }

      await client.query("COMMIT");
      const balance = await getCreditBalance(memberId);
      res.json({ ok: true, refunded: refund, balance });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[admin-coaching-sessions] admin cancel failed:", err);
      res.status(500).json({ error: "Could not cancel the session. Please try again." });
    } finally {
      client.release();
    }
  },
);

// ---------------------------------------------------------------------------
// Mark a booking completed (with optional coach notes).
// ---------------------------------------------------------------------------

router.patch(
  "/admin/coaching/pack/sessions/:id/complete",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const bookingId = parseId(req.params.id);
    if (!bookingId) {
      res.status(400).json({ error: "Invalid booking id" });
      return;
    }
    const coachNotes = typeof req.body?.coachNotes === "string" ? req.body.coachNotes.trim() || null : undefined;
    const actionItems =
      req.body?.actionItems !== undefined ? normalizeActionItems(req.body.actionItems) : undefined;

    const updated = await db
      .update(sessionPackBookingsTable)
      .set({
        status: "completed",
        outcomeAt: new Date(),
        ...(coachNotes !== undefined ? { coachNotes } : {}),
        ...(actionItems !== undefined ? { actionItems } : {}),
      })
      .where(
        and(
          eq(sessionPackBookingsTable.id, bookingId),
          eq(sessionPackBookingsTable.status, "booked"),
        ),
      )
      .returning();

    if (updated.length === 0) {
      const [exists] = await db
        .select({ id: sessionPackBookingsTable.id })
        .from(sessionPackBookingsTable)
        .where(eq(sessionPackBookingsTable.id, bookingId));
      res
        .status(exists ? 409 : 404)
        .json({ error: exists ? "Only a booked session can be completed" : "Session not found" });
      return;
    }
    await mirrorBookingToGHL(updated[0]);
    res.json({ ok: true, booking: updated[0] });
  },
);

// ---------------------------------------------------------------------------
// Mark a booking no-show (with optional credit return + coach notes).
// ---------------------------------------------------------------------------

router.patch(
  "/admin/coaching/pack/sessions/:id/no-show",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const bookingId = parseId(req.params.id);
    if (!bookingId) {
      res.status(400).json({ error: "Invalid booking id" });
      return;
    }
    const returnCredit = req.body?.returnCredit === true;
    const coachNotes = typeof req.body?.coachNotes === "string" ? req.body.coachNotes.trim() || null : undefined;
    const actionItems =
      req.body?.actionItems !== undefined ? normalizeActionItems(req.body.actionItems) : undefined;

    const [existing] = await db
      .select({ memberId: sessionPackBookingsTable.memberId, status: sessionPackBookingsTable.status })
      .from(sessionPackBookingsTable)
      .where(eq(sessionPackBookingsTable.id, bookingId));
    if (!existing) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const memberId = existing.memberId;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const txDb = drizzle(client);
      await txDb.execute(sql`SELECT pg_advisory_xact_lock(${memberCreditLockKey(memberId)})`);

      const updated = await txDb
        .update(sessionPackBookingsTable)
        .set({
          status: "no_show",
          outcomeAt: new Date(),
          ...(coachNotes !== undefined ? { coachNotes } : {}),
          ...(actionItems !== undefined ? { actionItems } : {}),
        })
        .where(
          and(
            eq(sessionPackBookingsTable.id, bookingId),
            eq(sessionPackBookingsTable.status, "booked"),
          ),
        )
        .returning();

      if (updated.length === 0) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Only a booked session can be marked no-show" });
        return;
      }

      if (returnCredit) {
        await txDb
          .insert(coachingCreditLedgerTable)
          .values({
            memberId,
            delta: 1,
            reason: "no_show_refund",
            bookingId,
            createdByUserId: req.userId!,
          })
          .onConflictDoNothing();
      }

      await client.query("COMMIT");
      await mirrorBookingToGHL(updated[0]);
      const balance = await getCreditBalance(memberId);
      res.json({ ok: true, creditReturned: returnCredit, balance, booking: updated[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[admin-coaching-sessions] no-show failed:", err);
      res.status(500).json({ error: "Could not update the session. Please try again." });
    } finally {
      client.release();
    }
  },
);

// ---------------------------------------------------------------------------
// Update coach notes only (any status).
// ---------------------------------------------------------------------------

router.patch(
  "/admin/coaching/pack/sessions/:id/notes",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const bookingId = parseId(req.params.id);
    if (!bookingId) {
      res.status(400).json({ error: "Invalid booking id" });
      return;
    }
    const hasNotes = typeof req.body?.coachNotes === "string";
    const hasActionItems = req.body?.actionItems !== undefined;
    if (!hasNotes && !hasActionItems) {
      res.status(400).json({ error: "coachNotes or actionItems is required" });
      return;
    }
    const set: Partial<typeof sessionPackBookingsTable.$inferInsert> = {};
    if (hasNotes) set.coachNotes = req.body.coachNotes.trim() || null;
    if (hasActionItems) set.actionItems = normalizeActionItems(req.body.actionItems);

    const updated = await db
      .update(sessionPackBookingsTable)
      .set(set)
      .where(eq(sessionPackBookingsTable.id, bookingId))
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await mirrorBookingToGHL(updated[0]);
    res.json({ ok: true, booking: updated[0] });
  },
);

// ---------------------------------------------------------------------------
// Manually attach (or clear) the recording / summary / transcript links when
// auto-matching missed. Flips the ingest status to "manual" so the next ingest
// pass never overwrites the hand-entered links. COACH/ADMIN-FACING ONLY.
// ---------------------------------------------------------------------------

router.patch(
  "/admin/coaching/pack/sessions/:id/recording",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const bookingId = parseId(req.params.id);
    if (!bookingId) {
      res.status(400).json({ error: "Invalid booking id" });
      return;
    }
    const parsed = parseManualRecordingLinks(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const [existing] = await db
      .select({
        recordingUrl: sessionPackBookingsTable.recordingUrl,
        summaryUrl: sessionPackBookingsTable.summaryUrl,
        transcriptUrl: sessionPackBookingsTable.transcriptUrl,
      })
      .from(sessionPackBookingsTable)
      .where(eq(sessionPackBookingsTable.id, bookingId));
    if (!existing) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const [booking] = await db
      .update(sessionPackBookingsTable)
      .set({
        ...parsed.links,
        ...resolveManualRecordingFields(existing, parsed.links),
        recordingIngestAt: new Date(),
      })
      .where(eq(sessionPackBookingsTable.id, bookingId))
      .returning();
    res.json({ ok: true, booking });
  },
);

export default router;
