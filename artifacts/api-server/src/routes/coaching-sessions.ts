import { Router, type IRouter } from "express";
import {
  db,
  pool,
  sessionPackCoachesTable,
  sessionPackBookingsTable,
  coachingCreditLedgerTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getCreditBalance, memberCreditLockKey } from "../lib/session-credits";
import {
  getFreeSlots,
  upsertContact,
  createAppointment,
  cancelAppointment,
  updateAppointment,
  addContactNote,
} from "../lib/ghl-coaching-calendar";

const router: IRouter = Router();

// Member-facing booking columns. Deliberately EXCLUDES coachNotes + actionItems,
// which are COACH/ADMIN-FACING ONLY and must never be returned to members. Use
// this for any `.returning()` whose response is sent to a member.
const MEMBER_BOOKING_COLUMNS = {
  id: sessionPackBookingsTable.id,
  memberId: sessionPackBookingsTable.memberId,
  coachId: sessionPackBookingsTable.coachId,
  ghlCalendarId: sessionPackBookingsTable.ghlCalendarId,
  ghlAppointmentId: sessionPackBookingsTable.ghlAppointmentId,
  ghlContactId: sessionPackBookingsTable.ghlContactId,
  scheduledAt: sessionPackBookingsTable.scheduledAt,
  endAt: sessionPackBookingsTable.endAt,
  durationMinutes: sessionPackBookingsTable.durationMinutes,
  meetLink: sessionPackBookingsTable.meetLink,
  status: sessionPackBookingsTable.status,
  title: sessionPackBookingsTable.title,
  discussionTopic: sessionPackBookingsTable.discussionTopic,
  outcomeAt: sessionPackBookingsTable.outcomeAt,
  createdAt: sessionPackBookingsTable.createdAt,
  updatedAt: sessionPackBookingsTable.updatedAt,
  cancelledAt: sessionPackBookingsTable.cancelledAt,
} as const;

// A session is a 1-hour call, but the coach's calendar is reserved for an extra
// 30-minute buffer afterwards. So a 1pm booking blocks 1:00–2:30pm on the
// coach's GHL calendar even though the call itself runs 1:00–2:00pm.
const CALL_DURATION_MINUTES = 60;
const BUFFER_MINUTES = 30;
const BLOCK_DURATION_MINUTES = CALL_DURATION_MINUTES + BUFFER_MINUTES;
// Sessions must be booked at least this far in advance.
const MIN_LEAD_TIME_MS = 60 * 60 * 1000; // 1 hour
// Cancelling at least this far ahead refunds the credit.
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
// Default availability lookahead when no explicit range is supplied.
const DEFAULT_LOOKAHEAD_DAYS = 14;

// Build an ISO string carrying the same zone offset as `reference`
// (GHL slot times look like 2026-06-17T14:30:00-05:00).
function isoWithMatchingOffset(date: Date, reference: string): string {
  const m = reference.match(/(Z|[+-]\d{2}:\d{2})$/);
  const offset = m ? m[0] : "Z";
  if (offset === "Z") {
    return date.toISOString().slice(0, 19) + "Z";
  }
  const sign = offset[0] === "-" ? -1 : 1;
  const oh = parseInt(offset.slice(1, 3), 10);
  const om = parseInt(offset.slice(4, 6), 10);
  const shifted = new Date(date.getTime() + sign * (oh * 60 + om) * 60000);
  return shifted.toISOString().slice(0, 19) + offset;
}

// Surface the member's topic on the GHL appointment title itself so it shows
// directly on the calendar event. The DB `title` stays clean for the member; the
// full topic also lives in a coaching-sub-account contact note.
function buildGhlTitle(title: string, discussionTopic: string | null | undefined): string {
  const topic = discussionTopic?.trim();
  if (!topic) return title;
  const preview = topic.length > 60 ? `${topic.slice(0, 57)}…` : topic;
  return `${title} — ${preview}`;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { firstName: "Member", lastName: "" };
  const parts = trimmed.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

router.get("/coaching/sessions/balance", async (req, res): Promise<void> => {
  const balance = await getCreditBalance(req.userId!);
  res.json({ balance });
});

// ---------------------------------------------------------------------------
// Coaches (first name only)
// ---------------------------------------------------------------------------

router.get("/coaching/sessions/coaches", async (_req, res): Promise<void> => {
  const coaches = await db
    .select({
      id: sessionPackCoachesTable.id,
      name: sessionPackCoachesTable.name,
      bio: sessionPackCoachesTable.bio,
      photoUrl: sessionPackCoachesTable.photoUrl,
      sortOrder: sessionPackCoachesTable.sortOrder,
    })
    .from(sessionPackCoachesTable)
    .where(eq(sessionPackCoachesTable.isActive, true))
    .orderBy(asc(sessionPackCoachesTable.sortOrder), asc(sessionPackCoachesTable.name));
  res.json(coaches);
});

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

router.get("/coaching/sessions/coaches/:coachId/slots", async (req, res): Promise<void> => {
  const coachId = parseInt(req.params.coachId, 10);
  if (!Number.isInteger(coachId) || coachId <= 0) {
    res.status(400).json({ error: "Invalid coach id" });
    return;
  }

  const [coach] = await db
    .select()
    .from(sessionPackCoachesTable)
    .where(and(eq(sessionPackCoachesTable.id, coachId), eq(sessionPackCoachesTable.isActive, true)));
  if (!coach) {
    res.status(404).json({ error: "Coach not found" });
    return;
  }

  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;

  let startMs: number;
  let endMs: number;
  if (startDate) {
    startMs = Date.parse(`${startDate}T00:00:00Z`);
  } else {
    startMs = Date.now();
  }
  if (endDate) {
    endMs = Date.parse(`${endDate}T23:59:59Z`);
  } else {
    endMs = startMs + DEFAULT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  }
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    res.status(400).json({ error: "Invalid date range" });
    return;
  }

  try {
    const slots = await getFreeSlots(coach.ghlCalendarId, startMs, endMs);
    // Never surface slots inside the lead-time window. Half-hour starts (e.g.
    // 1:30pm) are allowed — each call is a 1-hour block and GHL's free-slots +
    // the 30-min appointment buffer already keep bookings spaced correctly.
    const cutoff = Date.now() + MIN_LEAD_TIME_MS;
    const usable = slots.filter((s) => new Date(s.startTime).getTime() >= cutoff);
    res.json({ coachId, slots: usable });
  } catch (err) {
    console.error("[coaching-sessions] free-slots failed:", err);
    res.status(502).json({ error: "Could not load availability. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------

router.post("/coaching/sessions/book", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { coachId: rawCoachId, startTime, discussionTopic: rawDiscussionTopic } = req.body || {};
  const coachId = typeof rawCoachId === "number" ? rawCoachId : parseInt(rawCoachId, 10);
  const discussionTopic =
    typeof rawDiscussionTopic === "string" && rawDiscussionTopic.trim()
      ? rawDiscussionTopic.trim().slice(0, 2000)
      : null;

  if (!Number.isInteger(coachId) || coachId <= 0) {
    res.status(400).json({ error: "Invalid coach id" });
    return;
  }
  if (typeof startTime !== "string" || Number.isNaN(Date.parse(startTime))) {
    res.status(400).json({ error: "Invalid start time" });
    return;
  }

  const scheduledAt = new Date(startTime);
  if (scheduledAt.getTime() < Date.now() + MIN_LEAD_TIME_MS) {
    res.status(400).json({ error: "Sessions must be booked at least 1 hour in advance" });
    return;
  }

  const [coach] = await db
    .select()
    .from(sessionPackCoachesTable)
    .where(and(eq(sessionPackCoachesTable.id, coachId), eq(sessionPackCoachesTable.isActive, true)));
  if (!coach) {
    res.status(404).json({ error: "Coach not found" });
    return;
  }

  const [member] = await db
    .select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  // Confirm the requested slot is genuinely open on the coach's calendar.
  const dayMs = scheduledAt.getTime();
  const freeSlots = await getFreeSlots(coach.ghlCalendarId, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000);
  const slotOpen = freeSlots.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime());
  if (!slotOpen) {
    res.status(409).json({ error: "That time slot is no longer available" });
    return;
  }

  const endAt = new Date(scheduledAt.getTime() + CALL_DURATION_MINUTES * 60000);
  // Reserve the call plus the buffer on the coach's calendar.
  const blockEndAt = new Date(scheduledAt.getTime() + BLOCK_DURATION_MINUTES * 60000);
  const endTimeIso = isoWithMatchingOffset(blockEndAt, startTime);

  const client = await pool.connect();
  let createdAppointmentId: string | null = null;
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    // Serialize this member's booking attempts so credit can't be double-spent.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${memberCreditLockKey(userId)})`);

    const balance = await getCreditBalance(userId, txDb);
    if (balance < 1) {
      await client.query("ROLLBACK");
      res.status(402).json({ error: "You have no session credits remaining", balance });
      return;
    }

    // GHL is the calendar system of record; create the appointment first so a
    // DB failure can be compensated by cancelling it.
    const contactId = await upsertContact({
      email: member.email,
      ...splitName(member.name),
    });
    const title = `1-on-1 Coaching with ${coach.name}`;
    const appointment = await createAppointment({
      calendarId: coach.ghlCalendarId,
      contactId,
      startTime,
      endTime: endTimeIso,
      title: buildGhlTitle(title, discussionTopic),
    });
    createdAppointmentId = appointment.id;

    const [booking] = await txDb
      .insert(sessionPackBookingsTable)
      .values({
        memberId: userId,
        coachId,
        ghlCalendarId: coach.ghlCalendarId,
        ghlAppointmentId: appointment.id,
        ghlContactId: contactId,
        scheduledAt,
        endAt,
        durationMinutes: CALL_DURATION_MINUTES,
        meetLink: appointment.meetLink,
        status: "booked",
        title,
        discussionTopic,
      })
      .returning(MEMBER_BOOKING_COLUMNS);

    await txDb.insert(coachingCreditLedgerTable).values({
      memberId: userId,
      delta: -1,
      reason: "booking",
      bookingId: booking.id,
    });

    await client.query("COMMIT");

    // Mirror the member's topic onto the GHL contact in the COACHING sub-account
    // (same location as the appointment) so the coach sees the full text on the
    // contact tied to this booking. Fire-and-forget: never block the booking.
    if (discussionTopic) {
      const whenStr = scheduledAt.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
      void addContactNote(
        contactId,
        `1-on-1 coaching booked — ${coach.name} — ${whenStr}\n\nWhat the member wants to discuss on the call:\n${discussionTopic}`,
      ).catch((err) => {
        console.error("[coaching-sessions] discussion-topic contact-note failed:", err);
      });
    }

    res.status(201).json({ booking, balance: balance - 1 });
  } catch (err) {
    await client.query("ROLLBACK");
    // Compensate: don't leave an orphan appointment on the coach's calendar.
    if (createdAppointmentId) {
      try {
        await cancelAppointment(createdAppointmentId);
      } catch (cancelErr) {
        console.error("[coaching-sessions] failed to roll back GHL appointment:", cancelErr);
      }
    }
    console.error("[coaching-sessions] booking failed:", err);
    res.status(500).json({ error: "Could not complete booking. Please try again." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// My sessions
// ---------------------------------------------------------------------------

router.get("/coaching/sessions/mine", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const conditions = [eq(sessionPackBookingsTable.memberId, userId)];
  if (status) {
    conditions.push(eq(sessionPackBookingsTable.status, status));
  }

  const bookings = await db
    .select({
      id: sessionPackBookingsTable.id,
      coachId: sessionPackBookingsTable.coachId,
      coachName: sessionPackCoachesTable.name,
      coachPhotoUrl: sessionPackCoachesTable.photoUrl,
      scheduledAt: sessionPackBookingsTable.scheduledAt,
      endAt: sessionPackBookingsTable.endAt,
      durationMinutes: sessionPackBookingsTable.durationMinutes,
      meetLink: sessionPackBookingsTable.meetLink,
      status: sessionPackBookingsTable.status,
      title: sessionPackBookingsTable.title,
      cancelledAt: sessionPackBookingsTable.cancelledAt,
      createdAt: sessionPackBookingsTable.createdAt,
    })
    .from(sessionPackBookingsTable)
    .innerJoin(
      sessionPackCoachesTable,
      eq(sessionPackBookingsTable.coachId, sessionPackCoachesTable.id),
    )
    .where(and(...conditions))
    .orderBy(desc(sessionPackBookingsTable.scheduledAt));

  res.json(bookings);
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

router.patch("/coaching/sessions/:id/cancel", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const bookingId = parseInt(req.params.id, 10);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    res.status(400).json({ error: "Invalid booking id" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    // Serialize this member's credit mutations so two concurrent cancels of the
    // same booking can't both refund. Shares the booking lock key.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${memberCreditLockKey(userId)})`);

    // Atomically claim the cancellation: only the request that actually flips
    // 'booked' -> 'cancelled' (rowCount === 1) owns the GHL cancel + refund.
    const cancelled = await txDb
      .update(sessionPackBookingsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(
        and(
          eq(sessionPackBookingsTable.id, bookingId),
          eq(sessionPackBookingsTable.memberId, userId),
          eq(sessionPackBookingsTable.status, "booked"),
        ),
      )
      .returning();

    if (cancelled.length === 0) {
      await client.query("ROLLBACK");
      // Distinguish "not yours / doesn't exist" from "already cancelled".
      const [existing] = await db
        .select({ id: sessionPackBookingsTable.id })
        .from(sessionPackBookingsTable)
        .where(
          and(
            eq(sessionPackBookingsTable.id, bookingId),
            eq(sessionPackBookingsTable.memberId, userId),
          ),
        );
      if (!existing) {
        res.status(404).json({ error: "Session not found" });
      } else {
        res.status(409).json({ error: "This session can no longer be cancelled" });
      }
      return;
    }

    const booking = cancelled[0];
    const refund = booking.scheduledAt.getTime() - Date.now() >= REFUND_WINDOW_MS;

    // Cancel on GHL inside the transaction; if it fails, roll back so the
    // booking stays 'booked' and no refund is recorded.
    if (booking.ghlAppointmentId) {
      try {
        await cancelAppointment(booking.ghlAppointmentId);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("[coaching-sessions] GHL cancel failed:", err);
        res.status(502).json({ error: "Could not cancel the session. Please try again." });
        return;
      }
    }

    if (refund) {
      await txDb.insert(coachingCreditLedgerTable).values({
        memberId: userId,
        delta: 1,
        reason: "cancel_refund",
        bookingId,
      });
    }

    await client.query("COMMIT");

    const balance = await getCreditBalance(userId);
    res.json({ ok: true, refunded: refund, balance });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[coaching-sessions] cancel failed:", err);
    res.status(500).json({ error: "Could not cancel the session. Please try again." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Reschedule (credit-neutral: same booking, same spent credit, new time)
// ---------------------------------------------------------------------------

router.patch("/coaching/sessions/:id/reschedule", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const bookingId = parseInt(req.params.id, 10);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    res.status(400).json({ error: "Invalid booking id" });
    return;
  }

  const { startTime } = req.body || {};
  if (typeof startTime !== "string" || Number.isNaN(Date.parse(startTime))) {
    res.status(400).json({ error: "Invalid start time" });
    return;
  }

  const scheduledAt = new Date(startTime);
  if (scheduledAt.getTime() < Date.now() + MIN_LEAD_TIME_MS) {
    res.status(400).json({ error: "Sessions must be booked at least 1 hour in advance" });
    return;
  }

  // Load the booking + its coach (calendar) up front.
  const [existing] = await db
    .select({
      id: sessionPackBookingsTable.id,
      status: sessionPackBookingsTable.status,
      ghlAppointmentId: sessionPackBookingsTable.ghlAppointmentId,
      ghlCalendarId: sessionPackBookingsTable.ghlCalendarId,
      coachId: sessionPackBookingsTable.coachId,
      title: sessionPackBookingsTable.title,
      discussionTopic: sessionPackBookingsTable.discussionTopic,
    })
    .from(sessionPackBookingsTable)
    .where(
      and(
        eq(sessionPackBookingsTable.id, bookingId),
        eq(sessionPackBookingsTable.memberId, userId),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (existing.status !== "booked") {
    res.status(409).json({ error: "This session can no longer be rescheduled" });
    return;
  }
  if (!existing.ghlAppointmentId) {
    res.status(409).json({ error: "This session cannot be rescheduled" });
    return;
  }

  // Confirm the requested slot is genuinely open on the coach's calendar.
  const dayMs = scheduledAt.getTime();
  const freeSlots = await getFreeSlots(existing.ghlCalendarId, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000);
  const slotOpen = freeSlots.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime());
  if (!slotOpen) {
    res.status(409).json({ error: "That time slot is no longer available" });
    return;
  }

  const endAt = new Date(scheduledAt.getTime() + CALL_DURATION_MINUTES * 60000);
  // Reserve the call plus the buffer on the coach's calendar.
  const blockEndAt = new Date(scheduledAt.getTime() + BLOCK_DURATION_MINUTES * 60000);
  const endTimeIso = isoWithMatchingOffset(blockEndAt, startTime);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    // Share the member's credit lock so a reschedule can't race a cancel.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${memberCreditLockKey(userId)})`);

    // Re-assert the booking is still reschedulable inside the lock.
    const [locked] = await txDb
      .select({ status: sessionPackBookingsTable.status })
      .from(sessionPackBookingsTable)
      .where(eq(sessionPackBookingsTable.id, bookingId));
    if (!locked || locked.status !== "booked") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "This session can no longer be rescheduled" });
      return;
    }

    // Move the GHL appointment in place (same event id => credit-neutral). If
    // it fails, roll back so the booking keeps its original time.
    let meetLink: string | null = null;
    try {
      const updated = await updateAppointment({
        eventId: existing.ghlAppointmentId,
        calendarId: existing.ghlCalendarId,
        startTime,
        endTime: endTimeIso,
        title: existing.title
          ? buildGhlTitle(existing.title, existing.discussionTopic)
          : undefined,
      });
      meetLink = updated.meetLink;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[coaching-sessions] GHL reschedule failed:", err);
      res.status(502).json({ error: "Could not reschedule the session. Please try again." });
      return;
    }

    const [booking] = await txDb
      .update(sessionPackBookingsTable)
      .set({
        scheduledAt,
        endAt,
        ...(meetLink ? { meetLink } : {}),
      })
      .where(eq(sessionPackBookingsTable.id, bookingId))
      .returning(MEMBER_BOOKING_COLUMNS);

    await client.query("COMMIT");
    res.json({ ok: true, booking });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[coaching-sessions] reschedule failed:", err);
    res.status(500).json({ error: "Could not reschedule the session. Please try again." });
  } finally {
    client.release();
  }
});

export default router;
