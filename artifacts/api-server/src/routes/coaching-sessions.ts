import { Router, type IRouter } from "express";
import {
  db,
  pool,
  sessionPackCoachesTable,
  sessionPackBookingsTable,
  coachCallCalendarsTable,
  coachingCreditLedgerTable,
  usersTable,
} from "@workspace/db";
import { eq, and, ne, desc, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  getCreditBalance,
  memberCreditLockKey,
  coachBookingLockKey,
} from "../lib/session-credits";
import { fetchCalendarBusy, CalendarScopeError } from "../lib/google-oauth";
import { getAccessTokenForUser } from "../lib/coach-google-connections";
import { getUserEntitlements, hasMemberAccessBypass } from "../lib/entitlements";
import {
  getFreeSlots,
  upsertContact,
  createAppointment,
  cancelAppointment,
  updateAppointment,
  createAppointmentNote,
  createBlockSlot,
  deleteBlockSlot,
  listCalendarBusyEvents,
  getCalendarDurationMinutes,
  COACHING_TIMEZONE,
  COACHING_LOCATION_ID,
  type FreeSlot,
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
// Call types as stored in coach_call_calendars. Private coaching and the free
// 1-on-1 VA calls book against entirely separate per-coach calendars.
const PRIVATE_CALL_TYPE = "private_coaching";
const VA_CALL_TYPE = "one_on_one_va";
// 1-on-1 VA calls are a flat 30-minute block with NO trailing buffer, booked
// against the VA's own "one_on_one_va" calendar. They are FREE: no session
// credit is ever checked, spent, or refunded anywhere in the VA flow.
const VA_CALL_DURATION_MINUTES = 30;
const VA_BLOCK_DURATION_MINUTES = 30;
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

function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { firstName: "Member", lastName: "" };
  const parts = trimmed.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// ---------------------------------------------------------------------------
// Cross-company conflict arbitration
// ---------------------------------------------------------------------------

// Title written onto the Conflict (other-company) calendar for the mirrored
// busy block, so a human looking at that calendar knows where the hold came
// from. It is a block slot, not a member appointment — no PII is included.
const CONFLICT_BLOCK_TITLE = "BTS private coaching (cross-company hold)";
const VA_CONFLICT_BLOCK_TITLE = "BTS 1-on-1 VA call (cross-company hold)";

interface CalendarBinding {
  calendarId: string;
  locationId: string;
}

interface CoachCalendars {
  // Where this portal writes the real BTS appointment.
  booking: CalendarBinding;
  // The other company's calendar for the same coach, read for conflicts and
  // mirrored a busy block on every booking. Null when not configured, in which
  // case the flow behaves exactly as it did before cross-company arbitration.
  conflict: CalendarBinding | null;
}

// Resolve a coach's Booking + (optional) Conflict calendar bindings for a given
// call type from coach_call_calendars — the single source of truth for per-call
// -type calendars (the deprecated coaches.ghl* columns are no longer read here).
// Returns null when the coach has no active, calendar-configured row for that
// call type. Location falls back to the legacy single coaching location so a row
// with no explicit bookingLocationId keeps booking against Cherrington as before.
async function loadCoachCalendars(
  coachId: number,
  callType: string,
): Promise<CoachCalendars | null> {
  const [row] = await db
    .select({
      bookingCalendarId: coachCallCalendarsTable.bookingCalendarId,
      bookingLocationId: coachCallCalendarsTable.bookingLocationId,
      conflictCalendarId: coachCallCalendarsTable.conflictCalendarId,
      conflictLocationId: coachCallCalendarsTable.conflictLocationId,
    })
    .from(coachCallCalendarsTable)
    .where(
      and(
        eq(coachCallCalendarsTable.coachId, coachId),
        eq(coachCallCalendarsTable.callType, callType),
        eq(coachCallCalendarsTable.isActive, true),
      ),
    );
  if (!row || !row.bookingCalendarId) return null;
  return {
    booking: {
      calendarId: row.bookingCalendarId,
      locationId: row.bookingLocationId ?? COACHING_LOCATION_ID,
    },
    conflict: row.conflictCalendarId
      ? {
          calendarId: row.conflictCalendarId,
          locationId: row.conflictLocationId ?? COACHING_LOCATION_ID,
        }
      : null,
  };
}

// Free slots a coach is open for in BOTH companies. Availability always comes
// from the BTS Booking Calendar's free slots. When a Conflict Calendar is
// configured we additionally fetch that calendar's REAL events (appointments +
// blocks, cancelled excluded) and drop any booking slot whose interval overlaps
// a busy event — so only actual bookings in the other company block BTS times,
// and the conflict calendar's own availability schedule (which free-slots would
// bake in) is irrelevant. Overlap math uses the booking calendar's configured
// slot duration and absolute epoch instants, so it is robust to the two
// calendars reporting different zone offsets. Any conflict-calendar fetch
// failure propagates (fails loud) — we never silently show conflicted times as
// free.
//
// Busy events are fetched with the window widened on both sides so an event
// that merely straddles the queried range (e.g. a long appointment that started
// before startMs) still blocks overlapping slots.
const CONFLICT_EVENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
async function freeSlotsAcrossCalendars(
  cals: CoachCalendars,
  startMs: number,
  endMs: number,
): Promise<FreeSlot[]> {
  const bookingSlots = await getFreeSlots(
    cals.booking.calendarId,
    startMs,
    endMs,
    cals.booking.locationId,
  );
  if (!cals.conflict || bookingSlots.length === 0) return bookingSlots;
  const slotDurationMs =
    (await getCalendarDurationMinutes(cals.booking.calendarId, cals.booking.locationId)) * 60_000;
  const busy = await listCalendarBusyEvents(
    cals.conflict.calendarId,
    startMs - CONFLICT_EVENT_LOOKBACK_MS,
    endMs + slotDurationMs,
    cals.conflict.locationId,
  );
  if (busy.length === 0) return bookingSlots;
  return bookingSlots.filter((s) => {
    const slotStart = new Date(s.startTime).getTime();
    const slotEnd = slotStart + slotDurationMs;
    return !busy.some((b) => slotStart < b.endMs && slotEnd > b.startMs);
  });
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
    .where(
      and(
        eq(sessionPackCoachesTable.isActive, true),
        eq(sessionPackCoachesTable.doesPrivateCoaching, true),
        // VAs never appear in the private-coaching picker even if a future row
        // were mis-flagged: the picker is strategic-coach territory only.
        ne(sessionPackCoachesTable.type, "va"),
      ),
    )
    .orderBy(asc(sessionPackCoachesTable.sortOrder), asc(sessionPackCoachesTable.name));
  res.json(coaches);
});

// ---------------------------------------------------------------------------
// VAs offering 1-on-1 calls (first name only)
// ---------------------------------------------------------------------------

// The roster of virtual assistants who offer free 1-on-1 VA calls. Separate from
// the private-coaching picker above. The member-facing VA booking pages (a
// dependent task) consume this; here we only expose the list.
router.get("/coaching/sessions/vas", async (_req, res): Promise<void> => {
  const vas = await db
    .select({
      id: sessionPackCoachesTable.id,
      name: sessionPackCoachesTable.name,
      bio: sessionPackCoachesTable.bio,
      photoUrl: sessionPackCoachesTable.photoUrl,
      sortOrder: sessionPackCoachesTable.sortOrder,
    })
    .from(sessionPackCoachesTable)
    .where(
      and(
        eq(sessionPackCoachesTable.isActive, true),
        eq(sessionPackCoachesTable.type, "va"),
        eq(sessionPackCoachesTable.doesOneOnOneVaCalls, true),
      ),
    )
    .orderBy(asc(sessionPackCoachesTable.sortOrder), asc(sessionPackCoachesTable.name));
  res.json(vas);
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
    .where(
      and(
        eq(sessionPackCoachesTable.id, coachId),
        eq(sessionPackCoachesTable.isActive, true),
        eq(sessionPackCoachesTable.doesPrivateCoaching, true),
      ),
    );
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

  const cals = await loadCoachCalendars(coachId, "private_coaching");
  if (!cals) {
    res.status(404).json({ error: "Coach not found" });
    return;
  }

  try {
    // When a Conflict Calendar is configured this only returns times the coach
    // is free in BOTH companies; otherwise it's the single-calendar free slots.
    const slots = await freeSlotsAcrossCalendars(cals, startMs, endMs);
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
// Calendar busy (member-facing conflict awareness)
// ---------------------------------------------------------------------------

// GET /coaching/sessions/coaches/:coachId/calendar-busy — the coach's external
// Google Calendar busy blocks for a [from, to) window, so the member booking
// flow can flag slots that clash with the coach's real calendar. Reuses the
// per-coach Google OAuth connection + free/busy endpoint, so members only ever
// see busy intervals — NEVER event titles, attendees, or any other detail.
// Always 200: when the coach has no live connection (or the calendar scope was
// never granted / OAuth isn't configured) we return { connected: false }.
router.get(
  "/coaching/sessions/coaches/:coachId/calendar-busy",
  async (req, res): Promise<void> => {
    const coachId = parseInt(req.params.coachId, 10);
    if (!Number.isInteger(coachId) || coachId <= 0) {
      res.status(400).json({ error: "Invalid coach id" });
      return;
    }

    const [coach] = await db
      .select({ userId: sessionPackCoachesTable.userId })
      .from(sessionPackCoachesTable)
      .where(
        and(
          eq(sessionPackCoachesTable.id, coachId),
          eq(sessionPackCoachesTable.isActive, true),
          eq(sessionPackCoachesTable.doesPrivateCoaching, true),
        ),
      );
    if (!coach) {
      res.status(404).json({ error: "Coach not found" });
      return;
    }
    // No linked portal account => no Google calendar to read.
    if (coach.userId === null) {
      res.json({ connected: false, busy: [] });
      return;
    }

    // Validate the [from, to) window and cap the span so a malformed/huge range
    // can't turn into an expensive free/busy query.
    const fromRaw = req.query.from;
    const toRaw = req.query.to;
    const fromDate = typeof fromRaw === "string" ? new Date(fromRaw) : null;
    const toDate = typeof toRaw === "string" ? new Date(toRaw) : null;
    if (
      !fromDate ||
      !toDate ||
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime()) ||
      fromDate.getTime() >= toDate.getTime()
    ) {
      res.status(400).json({ error: "Invalid from/to range" });
      return;
    }
    const MAX_WINDOW_MS = 70 * 24 * 60 * 60 * 1000; // generous month-grid cap
    if (toDate.getTime() - fromDate.getTime() > MAX_WINDOW_MS) {
      res.status(400).json({ error: "Range too large" });
      return;
    }

    const accessToken = await getAccessTokenForUser(coach.userId);
    if (!accessToken) {
      res.json({ connected: false, busy: [] });
      return;
    }

    try {
      const busy = await fetchCalendarBusy(
        accessToken,
        fromDate.toISOString(),
        toDate.toISOString(),
      );
      res.json({ connected: true, busy });
    } catch (err) {
      // An older connection without the calendar scope reads back as "not
      // connected" to the member — there's nothing they can do to reconnect a
      // coach's account, so we don't surface a reconnect prompt here.
      if (err instanceof CalendarScopeError) {
        res.json({ connected: false, busy: [] });
        return;
      }
      console.error("[coaching-sessions] calendar-busy failed:", err);
      res.status(502).json({ error: "Could not load coach availability." });
    }
  },
);

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
    .where(
      and(
        eq(sessionPackCoachesTable.id, coachId),
        eq(sessionPackCoachesTable.isActive, true),
        eq(sessionPackCoachesTable.doesPrivateCoaching, true),
      ),
    );
  const cals = await loadCoachCalendars(coachId, "private_coaching");
  if (!cals || !coach) {
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

  // Confirm the requested slot is genuinely open across BOTH companies. When a
  // Conflict Calendar is configured this rejects times taken in the other
  // company (a Cherrington booking or a manually-entered group call).
  const dayMs = scheduledAt.getTime();
  const freeSlots = await freeSlotsAcrossCalendars(cals, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000);
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
  let createdBlockEventId: string | null = null;
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    // Serialize booking writes against this coach FIRST (so two members can't
    // both pass the free-slot check and double-book the same instant), then
    // this member's credit lock. Consistent ordering avoids deadlocks.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${coachBookingLockKey(coachId)})`);
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${memberCreditLockKey(userId)})`);

    const balance = await getCreditBalance(userId, txDb);
    if (balance < 1) {
      await client.query("ROLLBACK");
      res.status(402).json({ error: "You have no session credits remaining", balance });
      return;
    }

    // Re-check both calendars under the coach lock: another booking (here or in
    // the other company) may have taken the slot since the pre-lock read.
    const recheck = await freeSlotsAcrossCalendars(cals, dayMs - 60_000, dayMs + 60_000);
    if (!recheck.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime())) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "That time slot is no longer available" });
      return;
    }

    // GHL is the calendar system of record; create the appointment first so a
    // DB failure can be compensated by cancelling it.
    const contactId = await upsertContact({
      email: member.email,
      ...splitName(member.name),
      locationId: cals.booking.locationId,
    });
    const title = `Private Coaching with ${coach.name}`;
    const appointment = await createAppointment({
      calendarId: cals.booking.calendarId,
      contactId,
      startTime,
      endTime: endTimeIso,
      title,
      locationId: cals.booking.locationId,
    });
    createdAppointmentId = appointment.id;

    // Mirror the hold onto the coach's Conflict (other-company) calendar so its
    // own booking widget treats the window as taken. Track the block's id so
    // cancel/reschedule can remove or move it.
    if (cals.conflict) {
      const block = await createBlockSlot({
        calendarId: cals.conflict.calendarId,
        locationId: cals.conflict.locationId,
        startTime,
        endTime: endTimeIso,
        title: CONFLICT_BLOCK_TITLE,
      });
      createdBlockEventId = block.id;
    }

    const [booking] = await txDb
      .insert(sessionPackBookingsTable)
      .values({
        memberId: userId,
        coachId,
        ghlCalendarId: cals.booking.calendarId,
        ghlLocationId: cals.booking.locationId,
        ghlAppointmentId: appointment.id,
        ghlContactId: contactId,
        conflictBlockEventId: createdBlockEventId,
        conflictGhlLocationId: cals.conflict?.locationId ?? null,
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

    // Write the member's topic into the GHL appointment's Internal Notes so the
    // coach sees it on the appointment detail view. The note is self-labeling
    // (coach + session time) because GHL also mirrors appointment notes onto the
    // linked contact, where multiple bookings would otherwise be ambiguous.
    // Fire-and-forget: never block the booking on a GHL note hiccup.
    if (discussionTopic) {
      const whenStr = scheduledAt.toLocaleString("en-US", {
        timeZone: COACHING_TIMEZONE,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      void createAppointmentNote(
        appointment.id,
        `Private Coaching with ${coach.name} — ${whenStr}\nWhat the member wants to discuss:\n${discussionTopic}`,
      ).catch((err) => {
        console.error("[coaching-sessions] discussion-topic appointment-note failed:", err);
      });
    }

    res.status(201).json({ booking, balance: balance - 1 });
  } catch (err) {
    await client.query("ROLLBACK");
    // Compensate: don't leave an orphan appointment on the coach's calendar.
    if (createdAppointmentId) {
      try {
        await cancelAppointment(createdAppointmentId, cals.booking.locationId);
      } catch (cancelErr) {
        console.error("[coaching-sessions] failed to roll back GHL appointment:", cancelErr);
      }
    }
    // ...and don't leave an orphan busy block on the Conflict calendar.
    if (createdBlockEventId && cals.conflict) {
      try {
        await deleteBlockSlot(createdBlockEventId, cals.conflict.locationId);
      } catch (blockErr) {
        console.error("[coaching-sessions] failed to roll back conflict block:", blockErr);
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

  const conditions = [
    eq(sessionPackBookingsTable.memberId, userId),
    // Private-coaching list only. Free 1-on-1 VA calls live under their own
    // /coaching/va-calls/mine endpoint and must never appear here (nor be
    // manageable via the credit-refunding private cancel/reschedule routes).
    ne(sessionPackCoachesTable.type, "va"),
  ];
  if (status) {
    conditions.push(eq(sessionPackBookingsTable.status, status));
  }

  const rows = await db
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
      // Recording-ingest outputs. Surfaced to the member ONLY on completed
      // sessions (gated below). coachNotes/actionItems + ingest bookkeeping
      // (recordingIngestStatus/At/Attempts) are deliberately NOT selected, so
      // they can never leak — see memory pack-booking-member-leak.
      recordingUrl: sessionPackBookingsTable.recordingUrl,
      summaryUrl: sessionPackBookingsTable.summaryUrl,
      transcriptUrl: sessionPackBookingsTable.transcriptUrl,
    })
    .from(sessionPackBookingsTable)
    .innerJoin(
      sessionPackCoachesTable,
      eq(sessionPackBookingsTable.coachId, sessionPackCoachesTable.id),
    )
    .where(and(...conditions))
    .orderBy(desc(sessionPackBookingsTable.scheduledAt));

  // The Meet recording + Gemini notes/transcript links only make sense after a
  // session has actually happened, so they are exposed exclusively on completed
  // sessions. For every other status the keys are stripped entirely.
  const bookings = rows.map(
    ({ recordingUrl, summaryUrl, transcriptUrl, ...rest }) =>
      rest.status === "completed"
        ? { ...rest, recordingUrl, summaryUrl, transcriptUrl }
        : rest,
  );

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

  // Private-coaching cancel only. A VA booking is FREE (no credit ledger), so a
  // >24h cancel here would wrongly refund a credit that was never spent. VA
  // calls must be cancelled via /coaching/va-calls/:id/cancel. Coach type is
  // immutable per booking, so this pre-check is race-free.
  const [guard] = await db
    .select({ type: sessionPackCoachesTable.type })
    .from(sessionPackBookingsTable)
    .innerJoin(
      sessionPackCoachesTable,
      eq(sessionPackBookingsTable.coachId, sessionPackCoachesTable.id),
    )
    .where(
      and(
        eq(sessionPackBookingsTable.id, bookingId),
        eq(sessionPackBookingsTable.memberId, userId),
      ),
    );
  if (!guard || guard.type === "va") {
    res.status(404).json({ error: "Session not found" });
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

    // Resolve the location(s) the GHL cancel + conflict-block delete must target.
    // Prefer the values persisted on the booking at booking time so an admin
    // remapping the coach's location later can't break cancellation of an
    // existing booking (the appointment/block live under the ORIGINAL location).
    // Fall back to the live coach row, then the legacy location, for rows created
    // before these columns existed.
    const [coach] = await txDb
      .select({
        ghlLocationId: sessionPackCoachesTable.ghlLocationId,
        conflictGhlLocationId: sessionPackCoachesTable.conflictGhlLocationId,
      })
      .from(sessionPackCoachesTable)
      .where(eq(sessionPackCoachesTable.id, booking.coachId));
    const bookingLocationId =
      booking.ghlLocationId ?? coach?.ghlLocationId ?? COACHING_LOCATION_ID;
    const conflictLocationId =
      booking.conflictGhlLocationId ?? coach?.conflictGhlLocationId ?? COACHING_LOCATION_ID;

    // Cancel on GHL inside the transaction; if it fails, roll back so the
    // booking stays 'booked' and no refund is recorded.
    if (booking.ghlAppointmentId) {
      try {
        await cancelAppointment(booking.ghlAppointmentId, bookingLocationId);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("[coaching-sessions] GHL cancel failed:", err);
        res.status(502).json({ error: "Could not cancel the session. Please try again." });
        return;
      }
    }

    // Remove the mirrored busy block from the coach's Conflict calendar so the
    // other company's widget frees the slot again. Best-effort: the appointment
    // is already cancelled in GHL above, so a failure here must NOT roll back the
    // cancellation (that would leave the booking "booked" in the DB with no GHL
    // appointment — a divergence). The worst case is a stale busy block that
    // conservatively over-blocks the other company's slot — never a double
    // booking — and can be cleared manually later.
    if (booking.conflictBlockEventId) {
      try {
        await deleteBlockSlot(booking.conflictBlockEventId, conflictLocationId);
      } catch (err) {
        console.error("[coaching-sessions] conflict-block delete failed (left stale):", err);
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

  // Load the booking + its coach (calendars) up front.
  const [existing] = await db
    .select({
      id: sessionPackBookingsTable.id,
      status: sessionPackBookingsTable.status,
      scheduledAt: sessionPackBookingsTable.scheduledAt,
      ghlAppointmentId: sessionPackBookingsTable.ghlAppointmentId,
      ghlCalendarId: sessionPackBookingsTable.ghlCalendarId,
      bookingGhlLocationId: sessionPackBookingsTable.ghlLocationId,
      conflictBlockEventId: sessionPackBookingsTable.conflictBlockEventId,
      bookingConflictGhlLocationId: sessionPackBookingsTable.conflictGhlLocationId,
      coachId: sessionPackBookingsTable.coachId,
      title: sessionPackBookingsTable.title,
      coachType: sessionPackCoachesTable.type,
    })
    .from(sessionPackBookingsTable)
    .innerJoin(
      sessionPackCoachesTable,
      eq(sessionPackBookingsTable.coachId, sessionPackCoachesTable.id),
    )
    .where(
      and(
        eq(sessionPackBookingsTable.id, bookingId),
        eq(sessionPackBookingsTable.memberId, userId),
      ),
    );
  // Private-coaching reschedule only — VA calls use the VA reschedule endpoint.
  if (!existing || existing.coachType === "va") {
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
  // Enforce the 24-hour policy: a session can only be rescheduled while it is
  // still at least 24 hours away. Inside the window the member must keep or
  // cancel it (cancelling that late uses the credit).
  if (existing.scheduledAt.getTime() - Date.now() < REFUND_WINDOW_MS) {
    res.status(409).json({
      error:
        "Sessions can only be rescheduled at least 24 hours before the scheduled time.",
    });
    return;
  }

  // Resolve the coach's Booking + Conflict calendar bindings (location-aware,
  // legacy-location fallback). The appointment moves on the Booking calendar;
  // the mirrored busy block moves on the Conflict calendar.
  const cals = await loadCoachCalendars(existing.coachId, "private_coaching");
  // The appointment already lives on a specific Booking calendar + location;
  // moving it must target THOSE, captured at booking time, so an admin remapping
  // the coach later can't make updateAppointment hit the wrong location-scoped
  // token. Fall back to the live coach row, then the legacy location.
  const bookingCalendarId = existing.ghlCalendarId ?? cals?.booking.calendarId;
  const bookingLocationId =
    existing.bookingGhlLocationId ?? cals?.booking.locationId ?? COACHING_LOCATION_ID;
  // The OLD conflict block lives under the location it was created with; delete
  // it there. The NEW block is created on the coach's CURRENT conflict calendar.
  const oldConflictLocationId =
    existing.bookingConflictGhlLocationId ?? cals?.conflict?.locationId ?? COACHING_LOCATION_ID;

  // Confirm the requested slot is genuinely open across BOTH companies.
  const dayMs = scheduledAt.getTime();
  const freeSlots = cals
    ? await freeSlotsAcrossCalendars(cals, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000)
    : await getFreeSlots(bookingCalendarId, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000, bookingLocationId);
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

    // Take the coach lock then the member's credit lock (same order as book) so
    // a reschedule can't race a concurrent booking or a cancel.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${coachBookingLockKey(existing.coachId)})`);
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

    // Re-check both calendars under the coach lock: the target slot may have
    // been taken (here or in the other company) since the pre-lock read.
    if (cals) {
      const recheck = await freeSlotsAcrossCalendars(cals, dayMs - 60_000, dayMs + 60_000);
      if (!recheck.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime())) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "That time slot is no longer available" });
        return;
      }
    }

    // Move the GHL appointment in place (same event id => credit-neutral). If
    // it fails, roll back so the booking keeps its original time.
    let meetLink: string | null = null;
    try {
      const updated = await updateAppointment({
        eventId: existing.ghlAppointmentId,
        calendarId: bookingCalendarId,
        startTime,
        endTime: endTimeIso,
        title: existing.title ?? undefined,
        locationId: bookingLocationId,
      });
      meetLink = updated.meetLink;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[coaching-sessions] GHL reschedule failed:", err);
      res.status(502).json({ error: "Could not reschedule the session. Please try again." });
      return;
    }

    // Move the mirrored busy block on the Conflict calendar: block slots have no
    // in-place move, so create the new hold then delete the old one. Best-effort:
    // the appointment was just moved in GHL above, so a block failure must NOT
    // roll back the (committed-below) reschedule — that would diverge the DB time
    // from the GHL appointment time. On failure we keep the previous block id so
    // the old hold lingers (a safe over-block at the old time) rather than
    // corrupting the booking truth.
    let newBlockEventId: string | null = existing.conflictBlockEventId;
    let newConflictLocationId: string | null = existing.bookingConflictGhlLocationId;
    if (cals?.conflict) {
      try {
        const block = await createBlockSlot({
          calendarId: cals.conflict.calendarId,
          locationId: cals.conflict.locationId,
          startTime,
          endTime: endTimeIso,
          title: CONFLICT_BLOCK_TITLE,
        });
        newBlockEventId = block.id;
        newConflictLocationId = cals.conflict.locationId;
        // Drop the old hold now that the new one exists, targeting the location
        // the OLD block was created under (may differ after a coach remap).
        if (existing.conflictBlockEventId) {
          try {
            await deleteBlockSlot(existing.conflictBlockEventId, oldConflictLocationId);
          } catch (err) {
            console.error("[coaching-sessions] failed to delete stale conflict block:", err);
          }
        }
      } catch (err) {
        console.error("[coaching-sessions] conflict-block move failed (kept old hold):", err);
      }
    }

    const [booking] = await txDb
      .update(sessionPackBookingsTable)
      .set({
        scheduledAt,
        endAt,
        conflictBlockEventId: newBlockEventId,
        conflictGhlLocationId: newConflictLocationId,
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

// ===========================================================================
// 1-on-1 VA calls (FREE, 30-minute) — /coaching/va-calls/*
//
// A parallel booking flow to private coaching, but: booked against each VA's own
// 30-minute "one_on_one_va" calendar, FREE (no session credit is ever checked,
// spent or refunded), and tier-gated to full-membership tiers via the
// coaching:group entitlement (admins/coaches bypass). It reuses the same GHL +
// advisory-lock machinery and the same session_pack_bookings table; VA bookings
// are distinguished from private coaching purely by the coach's type === "va".
// ===========================================================================

// Full-membership gate. coaching:group is present on exactly the 3-/6-month,
// 1-year and lifetime tiers (absent on launchpad + all frontend products), so it
// is the canonical full-membership key. Admins/coaches bypass via member access.
async function isVaCallEligible(userId: number): Promise<boolean> {
  if (await hasMemberAccessBypass(userId)) return true;
  const ents = await getUserEntitlements(userId);
  return ents.has("coaching:group");
}

// Load an active VA who offers 1-on-1 VA calls. Returns null otherwise so every
// VA route uniformly 404s a non-VA / non-opted-in coach id.
async function loadVaCoach(coachId: number) {
  const [va] = await db
    .select()
    .from(sessionPackCoachesTable)
    .where(
      and(
        eq(sessionPackCoachesTable.id, coachId),
        eq(sessionPackCoachesTable.isActive, true),
        eq(sessionPackCoachesTable.type, "va"),
        eq(sessionPackCoachesTable.doesOneOnOneVaCalls, true),
      ),
    );
  return va ?? null;
}

// ---------------------------------------------------------------------------
// VA availability
// ---------------------------------------------------------------------------

router.get("/coaching/va-calls/vas/:vaId/slots", async (req, res): Promise<void> => {
  if (!(await isVaCallEligible(req.userId!))) {
    res.status(403).json({ error: "Your membership doesn't include 1-on-1 VA calls." });
    return;
  }
  const vaId = parseInt(req.params.vaId, 10);
  if (!Number.isInteger(vaId) || vaId <= 0) {
    res.status(400).json({ error: "Invalid VA id" });
    return;
  }

  const va = await loadVaCoach(vaId);
  if (!va) {
    res.status(404).json({ error: "VA not found" });
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

  const cals = await loadCoachCalendars(vaId, VA_CALL_TYPE);
  if (!cals) {
    res.status(404).json({ error: "VA not found" });
    return;
  }

  try {
    const slots = await freeSlotsAcrossCalendars(cals, startMs, endMs);
    const cutoff = Date.now() + MIN_LEAD_TIME_MS;
    const usable = slots.filter((s) => new Date(s.startTime).getTime() >= cutoff);
    res.json({ coachId: vaId, slots: usable });
  } catch (err) {
    console.error("[coaching-sessions] VA free-slots failed:", err);
    res.status(502).json({ error: "Could not load availability. Please try again." });
  }
});

router.get(
  "/coaching/va-calls/vas/:vaId/calendar-busy",
  async (req, res): Promise<void> => {
    if (!(await isVaCallEligible(req.userId!))) {
      res.status(403).json({ error: "Your membership doesn't include 1-on-1 VA calls." });
      return;
    }
    const vaId = parseInt(req.params.vaId, 10);
    if (!Number.isInteger(vaId) || vaId <= 0) {
      res.status(400).json({ error: "Invalid VA id" });
      return;
    }

    const va = await loadVaCoach(vaId);
    if (!va) {
      res.status(404).json({ error: "VA not found" });
      return;
    }
    if (va.userId === null) {
      res.json({ connected: false, busy: [] });
      return;
    }

    const fromRaw = req.query.from;
    const toRaw = req.query.to;
    const fromDate = typeof fromRaw === "string" ? new Date(fromRaw) : null;
    const toDate = typeof toRaw === "string" ? new Date(toRaw) : null;
    if (
      !fromDate ||
      !toDate ||
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime()) ||
      fromDate.getTime() >= toDate.getTime()
    ) {
      res.status(400).json({ error: "Invalid from/to range" });
      return;
    }
    const MAX_WINDOW_MS = 70 * 24 * 60 * 60 * 1000;
    if (toDate.getTime() - fromDate.getTime() > MAX_WINDOW_MS) {
      res.status(400).json({ error: "Range too large" });
      return;
    }

    const accessToken = await getAccessTokenForUser(va.userId);
    if (!accessToken) {
      res.json({ connected: false, busy: [] });
      return;
    }

    try {
      const busy = await fetchCalendarBusy(
        accessToken,
        fromDate.toISOString(),
        toDate.toISOString(),
      );
      res.json({ connected: true, busy });
    } catch (err) {
      if (err instanceof CalendarScopeError) {
        res.json({ connected: false, busy: [] });
        return;
      }
      console.error("[coaching-sessions] VA calendar-busy failed:", err);
      res.status(502).json({ error: "Could not load VA availability." });
    }
  },
);

// ---------------------------------------------------------------------------
// VA book (FREE — no credit checked, spent, or refunded)
// ---------------------------------------------------------------------------

router.post("/coaching/va-calls/book", async (req, res): Promise<void> => {
  const userId = req.userId!;
  if (!(await isVaCallEligible(userId))) {
    res.status(403).json({ error: "Your membership doesn't include 1-on-1 VA calls." });
    return;
  }

  // Step-3 intake (typeOfRequest, concernArea, alreadyContacted, etc.) is sent
  // under `intake` for forward-compatibility but is intentionally NOT consumed
  // here yet — GHL wiring for it is deferred. Only discussionTopic flows to the
  // appointment note today.
  const { coachId: rawCoachId, startTime, discussionTopic: rawDiscussionTopic } = req.body || {};
  const coachId = typeof rawCoachId === "number" ? rawCoachId : parseInt(rawCoachId, 10);
  const discussionTopic =
    typeof rawDiscussionTopic === "string" && rawDiscussionTopic.trim()
      ? rawDiscussionTopic.trim().slice(0, 2000)
      : null;

  if (!Number.isInteger(coachId) || coachId <= 0) {
    res.status(400).json({ error: "Invalid VA id" });
    return;
  }
  if (typeof startTime !== "string" || Number.isNaN(Date.parse(startTime))) {
    res.status(400).json({ error: "Invalid start time" });
    return;
  }

  const scheduledAt = new Date(startTime);
  if (scheduledAt.getTime() < Date.now() + MIN_LEAD_TIME_MS) {
    res.status(400).json({ error: "Calls must be booked at least 1 hour in advance" });
    return;
  }

  const va = await loadVaCoach(coachId);
  const cals = await loadCoachCalendars(coachId, VA_CALL_TYPE);
  if (!va || !cals) {
    res.status(404).json({ error: "VA not found" });
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

  const dayMs = scheduledAt.getTime();
  const freeSlots = await freeSlotsAcrossCalendars(cals, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000);
  const slotOpen = freeSlots.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime());
  if (!slotOpen) {
    res.status(409).json({ error: "That time slot is no longer available" });
    return;
  }

  const endAt = new Date(scheduledAt.getTime() + VA_CALL_DURATION_MINUTES * 60000);
  // VA calls have no trailing buffer — the calendar block equals the call length.
  const blockEndAt = new Date(scheduledAt.getTime() + VA_BLOCK_DURATION_MINUTES * 60000);
  const endTimeIso = isoWithMatchingOffset(blockEndAt, startTime);

  const client = await pool.connect();
  let createdAppointmentId: string | null = null;
  let createdBlockEventId: string | null = null;
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    // Serialize booking writes against this VA so two members can't both pass the
    // free-slot check and double-book the same instant. No member credit lock:
    // VA calls are free, so there is no credit to serialize.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${coachBookingLockKey(coachId)})`);

    const recheck = await freeSlotsAcrossCalendars(cals, dayMs - 60_000, dayMs + 60_000);
    if (!recheck.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime())) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "That time slot is no longer available" });
      return;
    }

    const contactId = await upsertContact({
      email: member.email,
      ...splitName(member.name),
      locationId: cals.booking.locationId,
    });
    const title = `1-on-1 VA Call with ${va.name}`;
    const appointment = await createAppointment({
      calendarId: cals.booking.calendarId,
      contactId,
      startTime,
      endTime: endTimeIso,
      title,
      locationId: cals.booking.locationId,
    });
    createdAppointmentId = appointment.id;

    if (cals.conflict) {
      const block = await createBlockSlot({
        calendarId: cals.conflict.calendarId,
        locationId: cals.conflict.locationId,
        startTime,
        endTime: endTimeIso,
        title: VA_CONFLICT_BLOCK_TITLE,
      });
      createdBlockEventId = block.id;
    }

    const [booking] = await txDb
      .insert(sessionPackBookingsTable)
      .values({
        memberId: userId,
        coachId,
        ghlCalendarId: cals.booking.calendarId,
        ghlLocationId: cals.booking.locationId,
        ghlAppointmentId: appointment.id,
        ghlContactId: contactId,
        conflictBlockEventId: createdBlockEventId,
        conflictGhlLocationId: cals.conflict?.locationId ?? null,
        scheduledAt,
        endAt,
        durationMinutes: VA_CALL_DURATION_MINUTES,
        meetLink: appointment.meetLink,
        status: "booked",
        title,
        discussionTopic,
      })
      .returning(MEMBER_BOOKING_COLUMNS);

    // NO coachingCreditLedger insert: VA calls are free.

    await client.query("COMMIT");

    if (discussionTopic) {
      const whenStr = scheduledAt.toLocaleString("en-US", {
        timeZone: COACHING_TIMEZONE,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      void createAppointmentNote(
        appointment.id,
        `1-on-1 VA Call with ${va.name} — ${whenStr}\nWhat the member wants to discuss:\n${discussionTopic}`,
      ).catch((err) => {
        console.error("[coaching-sessions] VA discussion-topic appointment-note failed:", err);
      });
    }

    res.status(201).json({ booking });
  } catch (err) {
    await client.query("ROLLBACK");
    if (createdAppointmentId) {
      try {
        await cancelAppointment(createdAppointmentId, cals.booking.locationId);
      } catch (cancelErr) {
        console.error("[coaching-sessions] failed to roll back VA GHL appointment:", cancelErr);
      }
    }
    if (createdBlockEventId && cals.conflict) {
      try {
        await deleteBlockSlot(createdBlockEventId, cals.conflict.locationId);
      } catch (blockErr) {
        console.error("[coaching-sessions] failed to roll back VA conflict block:", blockErr);
      }
    }
    console.error("[coaching-sessions] VA booking failed:", err);
    res.status(500).json({ error: "Could not complete booking. Please try again." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// My VA calls
// ---------------------------------------------------------------------------

router.get("/coaching/va-calls/mine", async (req, res): Promise<void> => {
  const userId = req.userId!;
  if (!(await isVaCallEligible(userId))) {
    res.status(403).json({ error: "Your membership doesn't include 1-on-1 VA calls." });
    return;
  }
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const conditions = [
    eq(sessionPackBookingsTable.memberId, userId),
    // VA calls only. The coach's type is the single discriminator between VA
    // bookings and private-coaching bookings in the shared bookings table.
    eq(sessionPackCoachesTable.type, "va"),
  ];
  if (status) {
    conditions.push(eq(sessionPackBookingsTable.status, status));
  }

  // The member's own discussionTopic is safe to echo; coachNotes/actionItems +
  // ingest bookkeeping are deliberately NOT selected, so they can never leak
  // (see memory pack-booking-member-leak). Recording-ingest outputs ARE
  // selected, but surfaced only on completed calls (gated below).
  const rows = await db
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
      discussionTopic: sessionPackBookingsTable.discussionTopic,
      cancelledAt: sessionPackBookingsTable.cancelledAt,
      createdAt: sessionPackBookingsTable.createdAt,
      // Meet recording + Gemini notes/transcript, auto-linked by the shared
      // recording-ingest. Stripped below for every status but "completed".
      recordingUrl: sessionPackBookingsTable.recordingUrl,
      summaryUrl: sessionPackBookingsTable.summaryUrl,
      transcriptUrl: sessionPackBookingsTable.transcriptUrl,
    })
    .from(sessionPackBookingsTable)
    .innerJoin(
      sessionPackCoachesTable,
      eq(sessionPackBookingsTable.coachId, sessionPackCoachesTable.id),
    )
    .where(and(...conditions))
    .orderBy(desc(sessionPackBookingsTable.scheduledAt));

  // The recording + notes/transcript links only make sense after a call has
  // actually happened, so they are exposed exclusively on completed calls. For
  // every other status the keys are stripped entirely.
  const calls = rows.map(
    ({ recordingUrl, summaryUrl, transcriptUrl, ...rest }) =>
      rest.status === "completed"
        ? { ...rest, recordingUrl, summaryUrl, transcriptUrl }
        : rest,
  );

  res.json(calls);
});

// ---------------------------------------------------------------------------
// VA cancel (FREE — no refund ledger)
// ---------------------------------------------------------------------------

router.patch("/coaching/va-calls/:id/cancel", async (req, res): Promise<void> => {
  const userId = req.userId!;
  if (!(await isVaCallEligible(userId))) {
    res.status(403).json({ error: "Your membership doesn't include 1-on-1 VA calls." });
    return;
  }
  const bookingId = parseInt(req.params.id, 10);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    res.status(400).json({ error: "Invalid booking id" });
    return;
  }

  // Only operate on this member's VA bookings; a private-coaching id must 404
  // here so it can only be cancelled by the private endpoint. Coach type is
  // immutable per booking, so this pre-check is race-free.
  const [guard] = await db
    .select({ type: sessionPackCoachesTable.type })
    .from(sessionPackBookingsTable)
    .innerJoin(
      sessionPackCoachesTable,
      eq(sessionPackBookingsTable.coachId, sessionPackCoachesTable.id),
    )
    .where(
      and(
        eq(sessionPackBookingsTable.id, bookingId),
        eq(sessionPackBookingsTable.memberId, userId),
      ),
    );
  if (!guard || guard.type !== "va") {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    // Atomically claim the cancellation: only the request that flips
    // 'booked' -> 'cancelled' owns the GHL cancel. No credit lock needed.
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
      res.status(409).json({ error: "This call can no longer be cancelled" });
      return;
    }

    const booking = cancelled[0];

    const [coach] = await txDb
      .select({
        ghlLocationId: sessionPackCoachesTable.ghlLocationId,
        conflictGhlLocationId: sessionPackCoachesTable.conflictGhlLocationId,
      })
      .from(sessionPackCoachesTable)
      .where(eq(sessionPackCoachesTable.id, booking.coachId));
    const bookingLocationId =
      booking.ghlLocationId ?? coach?.ghlLocationId ?? COACHING_LOCATION_ID;
    const conflictLocationId =
      booking.conflictGhlLocationId ?? coach?.conflictGhlLocationId ?? COACHING_LOCATION_ID;

    if (booking.ghlAppointmentId) {
      try {
        await cancelAppointment(booking.ghlAppointmentId, bookingLocationId);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("[coaching-sessions] VA GHL cancel failed:", err);
        res.status(502).json({ error: "Could not cancel the call. Please try again." });
        return;
      }
    }

    if (booking.conflictBlockEventId) {
      try {
        await deleteBlockSlot(booking.conflictBlockEventId, conflictLocationId);
      } catch (err) {
        console.error("[coaching-sessions] VA conflict-block delete failed (left stale):", err);
      }
    }

    // NO refund ledger insert: VA calls are free.

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[coaching-sessions] VA cancel failed:", err);
    res.status(500).json({ error: "Could not cancel the call. Please try again." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// VA reschedule (FREE — same booking, new time; no 24h credit gate)
// ---------------------------------------------------------------------------

router.patch("/coaching/va-calls/:id/reschedule", async (req, res): Promise<void> => {
  const userId = req.userId!;
  if (!(await isVaCallEligible(userId))) {
    res.status(403).json({ error: "Your membership doesn't include 1-on-1 VA calls." });
    return;
  }
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
    res.status(400).json({ error: "Calls must be booked at least 1 hour in advance" });
    return;
  }

  const [existing] = await db
    .select({
      id: sessionPackBookingsTable.id,
      status: sessionPackBookingsTable.status,
      scheduledAt: sessionPackBookingsTable.scheduledAt,
      ghlAppointmentId: sessionPackBookingsTable.ghlAppointmentId,
      ghlCalendarId: sessionPackBookingsTable.ghlCalendarId,
      bookingGhlLocationId: sessionPackBookingsTable.ghlLocationId,
      conflictBlockEventId: sessionPackBookingsTable.conflictBlockEventId,
      bookingConflictGhlLocationId: sessionPackBookingsTable.conflictGhlLocationId,
      coachId: sessionPackBookingsTable.coachId,
      title: sessionPackBookingsTable.title,
      coachType: sessionPackCoachesTable.type,
    })
    .from(sessionPackBookingsTable)
    .innerJoin(
      sessionPackCoachesTable,
      eq(sessionPackBookingsTable.coachId, sessionPackCoachesTable.id),
    )
    .where(
      and(
        eq(sessionPackBookingsTable.id, bookingId),
        eq(sessionPackBookingsTable.memberId, userId),
      ),
    );
  // VA reschedule only — private bookings use the private reschedule endpoint.
  if (!existing || existing.coachType !== "va") {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (existing.status !== "booked") {
    res.status(409).json({ error: "This call can no longer be rescheduled" });
    return;
  }
  if (!existing.ghlAppointmentId) {
    res.status(409).json({ error: "This call cannot be rescheduled" });
    return;
  }
  // No 24-hour reschedule gate for VA calls: they are free, so there is no
  // credit at stake; a member may move a free call right up to the lead-time cutoff.

  const cals = await loadCoachCalendars(existing.coachId, VA_CALL_TYPE);
  const bookingCalendarId = existing.ghlCalendarId ?? cals?.booking.calendarId;
  const bookingLocationId =
    existing.bookingGhlLocationId ?? cals?.booking.locationId ?? COACHING_LOCATION_ID;
  const oldConflictLocationId =
    existing.bookingConflictGhlLocationId ?? cals?.conflict?.locationId ?? COACHING_LOCATION_ID;

  const dayMs = scheduledAt.getTime();
  const freeSlots = cals
    ? await freeSlotsAcrossCalendars(cals, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000)
    : await getFreeSlots(bookingCalendarId, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000, bookingLocationId);
  const slotOpen = freeSlots.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime());
  if (!slotOpen) {
    res.status(409).json({ error: "That time slot is no longer available" });
    return;
  }

  const endAt = new Date(scheduledAt.getTime() + VA_CALL_DURATION_MINUTES * 60000);
  const blockEndAt = new Date(scheduledAt.getTime() + VA_BLOCK_DURATION_MINUTES * 60000);
  const endTimeIso = isoWithMatchingOffset(blockEndAt, startTime);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${coachBookingLockKey(existing.coachId)})`);

    const [locked] = await txDb
      .select({ status: sessionPackBookingsTable.status })
      .from(sessionPackBookingsTable)
      .where(eq(sessionPackBookingsTable.id, bookingId));
    if (!locked || locked.status !== "booked") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "This call can no longer be rescheduled" });
      return;
    }

    if (cals) {
      const recheck = await freeSlotsAcrossCalendars(cals, dayMs - 60_000, dayMs + 60_000);
      if (!recheck.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime())) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "That time slot is no longer available" });
        return;
      }
    }

    let meetLink: string | null = null;
    try {
      const updated = await updateAppointment({
        eventId: existing.ghlAppointmentId,
        calendarId: bookingCalendarId,
        startTime,
        endTime: endTimeIso,
        title: existing.title ?? undefined,
        locationId: bookingLocationId,
      });
      meetLink = updated.meetLink;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[coaching-sessions] VA GHL reschedule failed:", err);
      res.status(502).json({ error: "Could not reschedule the call. Please try again." });
      return;
    }

    let newBlockEventId: string | null = existing.conflictBlockEventId;
    let newConflictLocationId: string | null = existing.bookingConflictGhlLocationId;
    if (cals?.conflict) {
      try {
        const block = await createBlockSlot({
          calendarId: cals.conflict.calendarId,
          locationId: cals.conflict.locationId,
          startTime,
          endTime: endTimeIso,
          title: VA_CONFLICT_BLOCK_TITLE,
        });
        newBlockEventId = block.id;
        newConflictLocationId = cals.conflict.locationId;
        if (existing.conflictBlockEventId) {
          try {
            await deleteBlockSlot(existing.conflictBlockEventId, oldConflictLocationId);
          } catch (err) {
            console.error("[coaching-sessions] failed to delete stale VA conflict block:", err);
          }
        }
      } catch (err) {
        console.error("[coaching-sessions] VA conflict-block move failed (kept old hold):", err);
      }
    }

    const [booking] = await txDb
      .update(sessionPackBookingsTable)
      .set({
        scheduledAt,
        endAt,
        conflictBlockEventId: newBlockEventId,
        conflictGhlLocationId: newConflictLocationId,
        ...(meetLink ? { meetLink } : {}),
      })
      .where(eq(sessionPackBookingsTable.id, bookingId))
      .returning(MEMBER_BOOKING_COLUMNS);

    await client.query("COMMIT");
    res.json({ ok: true, booking });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[coaching-sessions] VA reschedule failed:", err);
    res.status(500).json({ error: "Could not reschedule the call. Please try again." });
  } finally {
    client.release();
  }
});

export default router;
