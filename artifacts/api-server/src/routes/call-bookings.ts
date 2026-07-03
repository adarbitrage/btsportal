import { Router, type IRouter } from "express";
import { db, pool, usersTable, partnersTable, partnerAssignmentsTable, callBookingsTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  getFreeSlots,
  upsertContact,
  createAppointment,
  cancelAppointment,
  getCalendarDurationMinutes,
  COACHING_TIMEZONE,
  COACHING_LOCATION_ID,
  type FreeSlot,
} from "../lib/ghl-coaching-calendar";
import { selectKickoffCoach } from "../lib/kickoff-assignment";
import { getActiveAssignment } from "../lib/partner-assignment";
import {
  advanceOnboardingAfterKickoffBooked,
  advanceOnboardingAfterPartnerCallBooked,
} from "../lib/onboarding-advancement";

const router: IRouter = Router();

// ===========================================================================
// Native kickoff + partner call booking (Task #1591, Tier 2). Adapts the
// session-pack booking pattern (advisory lock -> GHL createAppointment ->
// local record) to the two onboarding call types. Neither call type is
// credit-metered — no session-credit ledger interaction anywhere here.
// `call_bookings` is the single store of record; state is never re-derived
// from GHL.
// ===========================================================================

// Task #1631: call durations are NEVER hardcoded — they always come from the
// GHL calendar's own configured `slotDuration` (see getCalendarDurationMinutes),
// fetched fresh (short-cached) per booking/availability call. Kickoff and
// partner calendars can be configured with different durations; there is no
// special-casing here, just the same calendar-config read for both.
const MIN_LEAD_TIME_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_LOOKAHEAD_DAYS = 14;

// Member-facing projection. Excludes ghl_contact_id (internal) and
// ghl_location_id (internal) — follows the MEMBER_BOOKING_COLUMNS lesson from
// session-pack bookings even though call_bookings has no staff-only fields.
const MEMBER_CALL_BOOKING_COLUMNS = {
  id: callBookingsTable.id,
  memberId: callBookingsTable.memberId,
  staffType: callBookingsTable.staffType,
  staffId: callBookingsTable.staffId,
  type: callBookingsTable.type,
  ghlAppointmentId: callBookingsTable.ghlAppointmentId,
  scheduledAt: callBookingsTable.scheduledAt,
  endAt: callBookingsTable.endAt,
  durationMinutes: callBookingsTable.durationMinutes,
  meetingUrl: callBookingsTable.meetingUrl,
  status: callBookingsTable.status,
  createdAt: callBookingsTable.createdAt,
  updatedAt: callBookingsTable.updatedAt,
  cancelledAt: callBookingsTable.cancelledAt,
} as const;

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash;
}

// Separate advisory-lock namespaces per staff type so a kickoff-coach lock
// and a partner lock can never collide with each other or with the
// session-pack/VA coach locks in session-credits.ts.
function kickoffCoachLockKey(coachId: number): number {
  return Math.abs(hashCode(`kickoff-coach-booking:${coachId}`));
}
function partnerBookingLockKey(partnerId: number): number {
  return Math.abs(hashCode(`partner-booking:${partnerId}`));
}
// Member-scoped lock for kickoff booking, taken alongside the coach lock, so
// two concurrent requests from the SAME member can never both pass the
// "no existing kickoff booking" pre-check and create duplicate bookings.
function kickoffMemberLockKey(memberId: number): number {
  return Math.abs(hashCode(`kickoff-member-booking:${memberId}`));
}

function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { firstName: "Member", lastName: "" };
  const parts = trimmed.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

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

// Calendar-day key in the coaching timezone (YYYY-MM-DD), used to group slots
// and count bookings per partner-day for the 5/day cap.
function dayKeyInTz(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: COACHING_TIMEZONE });
}

function parseDateRange(req: { query: Record<string, unknown> }): { startMs: number; endMs: number } | null {
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
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

// ---------------------------------------------------------------------------
// Kickoff calls — /onboarding/kickoff/*
// ---------------------------------------------------------------------------

router.get("/onboarding/kickoff/availability", async (req, res): Promise<void> => {
  const range = parseDateRange(req);
  if (!range) {
    res.status(400).json({ error: "Invalid date range" });
    return;
  }

  const coach = await selectKickoffCoach();
  if (!coach) {
    res.status(404).json({ error: "No kickoff coaches are available right now." });
    return;
  }

  try {
    const coachLocationId = coach.ghlLocationId ?? COACHING_LOCATION_ID;
    const [slots, durationMinutes] = await Promise.all([
      getFreeSlots(coach.ghlCalendarId, range.startMs, range.endMs, coachLocationId),
      getCalendarDurationMinutes(coach.ghlCalendarId, coachLocationId),
    ]);
    const cutoff = Date.now() + MIN_LEAD_TIME_MS;
    const usable = slots.filter((s) => new Date(s.startTime).getTime() >= cutoff);
    res.json({
      coach: {
        id: coach.id,
        displayName: coach.displayName,
        photoUrl: coach.photoUrl,
        bio: coach.bio,
      },
      slots: usable,
      durationMinutes,
    });
  } catch (err) {
    console.error("[call-bookings] kickoff availability failed:", err);
    res.status(502).json({ error: "Could not load availability. Please try again." });
  }
});

router.get("/onboarding/kickoff/mine", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const [booking] = await db
    .select(MEMBER_CALL_BOOKING_COLUMNS)
    .from(callBookingsTable)
    .where(and(eq(callBookingsTable.memberId, userId), eq(callBookingsTable.type, "kickoff")))
    .orderBy(sql`${callBookingsTable.createdAt} desc`)
    .limit(1);
  res.json({ booking: booking ?? null });
});

router.post("/onboarding/kickoff/book", async (req, res): Promise<void> => {
  const userId = req.userId!;

  // Idempotency: if a non-canceled kickoff booking already exists, hand it
  // back instead of creating a duplicate (safe against double-submits/retries
  // — mirrors the no-op-safe philosophy of the advancement functions).
  const [existing] = await db
    .select(MEMBER_CALL_BOOKING_COLUMNS)
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.memberId, userId),
        eq(callBookingsTable.type, "kickoff"),
        ne(callBookingsTable.status, "canceled"),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(200).json({ booking: existing, alreadyBooked: true });
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

  const coach = await selectKickoffCoach();
  if (!coach) {
    res.status(404).json({ error: "No kickoff coaches are available right now." });
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

  const coachLocationId = coach.ghlLocationId ?? COACHING_LOCATION_ID;
  const dayMs = scheduledAt.getTime();
  const freeSlots = await getFreeSlots(coach.ghlCalendarId, dayMs - 60_000, dayMs + 60_000, coachLocationId);
  const slotOpen = freeSlots.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime());
  if (!slotOpen) {
    res.status(409).json({ error: "That time slot is no longer available" });
    return;
  }

  let durationMinutes: number;
  try {
    durationMinutes = await getCalendarDurationMinutes(coach.ghlCalendarId, coachLocationId);
  } catch (err) {
    console.error("[call-bookings] failed to load kickoff calendar duration:", err);
    res.status(502).json({ error: "Could not load calendar configuration. Please try again." });
    return;
  }
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60000);
  const endTimeIso = isoWithMatchingOffset(endAt, startTime);

  const client = await pool.connect();
  let createdAppointmentId: string | null = null;
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);
    // Lock on both the coach (serializes against other members booking the
    // same coach slot) and the member (serializes concurrent double-submits
    // from the SAME member so the re-check below is race-free).
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${kickoffCoachLockKey(coach.id)})`);
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${kickoffMemberLockKey(userId)})`);

    const [existingInTx] = await txDb
      .select(MEMBER_CALL_BOOKING_COLUMNS)
      .from(callBookingsTable)
      .where(
        and(
          eq(callBookingsTable.memberId, userId),
          eq(callBookingsTable.type, "kickoff"),
          ne(callBookingsTable.status, "canceled"),
        ),
      )
      .limit(1);
    if (existingInTx) {
      await client.query("ROLLBACK");
      res.status(200).json({ booking: existingInTx, alreadyBooked: true });
      return;
    }

    const recheck = await getFreeSlots(coach.ghlCalendarId, dayMs - 60_000, dayMs + 60_000, coachLocationId);
    if (!recheck.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime())) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "That time slot is no longer available" });
      return;
    }

    const contactId = await upsertContact({
      email: member.email,
      ...splitName(member.name),
      locationId: coachLocationId,
    });
    const title = `Kickoff Call with ${coach.displayName}`;
    const appointment = await createAppointment({
      calendarId: coach.ghlCalendarId,
      contactId,
      startTime,
      endTime: endTimeIso,
      title,
      locationId: coachLocationId,
    });
    createdAppointmentId = appointment.id;

    const [booking] = await txDb
      .insert(callBookingsTable)
      .values({
        memberId: userId,
        staffType: "kickoff_coach",
        staffId: coach.id,
        type: "kickoff",
        ghlCalendarId: coach.ghlCalendarId,
        ghlLocationId: coachLocationId,
        ghlAppointmentId: appointment.id,
        ghlContactId: contactId,
        scheduledAt,
        endAt,
        durationMinutes,
        meetingUrl: appointment.meetLink,
        status: "booked",
      })
      .returning(MEMBER_CALL_BOOKING_COLUMNS);

    await client.query("COMMIT");

    const advanced = await advanceOnboardingAfterKickoffBooked(userId);
    res.status(201).json({ booking, onboardingAdvanced: advanced });
  } catch (err) {
    await client.query("ROLLBACK");
    if (createdAppointmentId) {
      try {
        await cancelAppointment(createdAppointmentId, coach.ghlLocationId ?? COACHING_LOCATION_ID);
      } catch (cancelErr) {
        console.error("[call-bookings] failed to roll back kickoff GHL appointment:", cancelErr);
      }
    }
    console.error("[call-bookings] kickoff booking failed:", err);
    res.status(500).json({ error: "Could not complete booking. Please try again." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Partner calls — /onboarding/partner/*
// ---------------------------------------------------------------------------

async function loadAssignedPartner(memberId: number) {
  const assignment = await getActiveAssignment(memberId);
  if (!assignment) return null;
  const [partner] = await db
    .select({
      id: partnersTable.id,
      displayName: partnersTable.displayName,
      photoUrl: partnersTable.photoUrl,
      bio: partnersTable.bio,
      isActive: partnersTable.isActive,
      maxDailyCalls: partnersTable.maxDailyCalls,
      ghlCalendarId: partnersTable.ghlCalendarId,
      ghlLocationId: partnersTable.ghlLocationId,
    })
    .from(partnersTable)
    .where(eq(partnersTable.id, assignment.partnerId));
  return partner ?? null;
}

// A member's first partner call is filtered to not start before their kickoff
// call's scheduled time. "First" = no existing non-canceled partner booking —
// a canceled first attempt still counts as "hasn't had a partner call yet".
async function getKickoffCutoffForFirstPartnerCall(memberId: number): Promise<Date | null> {
  const [existingPartnerCall] = await db
    .select({ id: callBookingsTable.id })
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.memberId, memberId),
        eq(callBookingsTable.type, "partner"),
        ne(callBookingsTable.status, "canceled"),
      ),
    )
    .limit(1);
  if (existingPartnerCall) return null; // not the first booking — no cutoff

  const [kickoff] = await db
    .select({ scheduledAt: callBookingsTable.scheduledAt })
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.memberId, memberId),
        eq(callBookingsTable.type, "kickoff"),
        ne(callBookingsTable.status, "canceled"),
      ),
    )
    .orderBy(sql`${callBookingsTable.scheduledAt} desc`)
    .limit(1);
  return kickoff?.scheduledAt ?? null;
}

// Non-canceled partner-call counts per day (coaching-timezone date key) for
// this partner, used to enforce the 5/day (maxDailyCalls) cap.
async function getPartnerDailyCounts(partnerId: number, startMs: number, endMs: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ scheduledAt: callBookingsTable.scheduledAt })
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.staffId, partnerId),
        eq(callBookingsTable.staffType, "partner"),
        eq(callBookingsTable.type, "partner"),
        ne(callBookingsTable.status, "canceled"),
        sql`${callBookingsTable.scheduledAt} >= to_timestamp(${startMs / 1000})`,
        sql`${callBookingsTable.scheduledAt} <= to_timestamp(${endMs / 1000})`,
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = dayKeyInTz(row.scheduledAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function filterPartnerSlots(
  memberId: number,
  partner: { id: number; maxDailyCalls: number },
  slots: FreeSlot[],
  startMs: number,
  endMs: number,
): Promise<FreeSlot[]> {
  const cutoff = await getKickoffCutoffForFirstPartnerCall(memberId);
  const dailyCounts = await getPartnerDailyCounts(partner.id, startMs, endMs);
  const leadCutoffMs = Date.now() + MIN_LEAD_TIME_MS;

  return slots.filter((s) => {
    const start = new Date(s.startTime);
    const startMsSlot = start.getTime();
    if (startMsSlot < leadCutoffMs) return false;
    if (cutoff && startMsSlot < cutoff.getTime()) return false;
    const dayKey = dayKeyInTz(start);
    const countForDay = dailyCounts.get(dayKey) ?? 0;
    if (countForDay >= partner.maxDailyCalls) return false;
    return true;
  });
}

router.get("/onboarding/partner/info", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const partner = await loadAssignedPartner(userId);
  if (!partner) {
    res.json({ partner: null });
    return;
  }
  res.json({
    partner: {
      id: partner.id,
      displayName: partner.displayName,
      photoUrl: partner.photoUrl,
      bio: partner.bio,
    },
  });
});

router.get("/onboarding/partner/availability", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const range = parseDateRange(req);
  if (!range) {
    res.status(400).json({ error: "Invalid date range" });
    return;
  }

  const partner = await loadAssignedPartner(userId);
  if (!partner || !partner.isActive) {
    res.status(404).json({ error: "You don't have an accountability partner assigned yet." });
    return;
  }
  if (!partner.ghlCalendarId) {
    res.json({ partnerId: partner.id, slots: [], durationMinutes: null });
    return;
  }

  try {
    const partnerLocationId = partner.ghlLocationId ?? COACHING_LOCATION_ID;
    const [slots, durationMinutes] = await Promise.all([
      getFreeSlots(partner.ghlCalendarId, range.startMs, range.endMs, partnerLocationId),
      getCalendarDurationMinutes(partner.ghlCalendarId, partnerLocationId),
    ]);
    const filtered = await filterPartnerSlots(userId, partner, slots, range.startMs, range.endMs);
    res.json({ partnerId: partner.id, slots: filtered, durationMinutes });
  } catch (err) {
    console.error("[call-bookings] partner availability failed:", err);
    res.status(502).json({ error: "Could not load availability. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// Accountability partner panel — /partner/me (Task #1593). Member-safe
// summary for the persistent dashboard panel: only present once a member has
// an ACTIVE assignment (empty for unassigned members, e.g. still onboarding
// or below the eligible product tier). No coach-only fields are exposed —
// mirrors the loadAssignedPartner() projection used by the onboarding
// partner routes above.
// ---------------------------------------------------------------------------

router.get("/partner/me", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const assignment = await getActiveAssignment(userId);
  if (!assignment) {
    res.json({ assignment: null });
    return;
  }

  const partner = await loadAssignedPartner(userId);
  if (!partner) {
    res.json({ assignment: null });
    return;
  }

  const [assignmentRow] = await db
    .select({ cadencePerWeek: partnerAssignmentsTable.cadencePerWeek })
    .from(partnerAssignmentsTable)
    .where(eq(partnerAssignmentsTable.id, assignment.id));

  const [nextCall] = await db
    .select({ scheduledAt: callBookingsTable.scheduledAt, meetingUrl: callBookingsTable.meetingUrl })
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.memberId, userId),
        eq(callBookingsTable.type, "partner"),
        eq(callBookingsTable.status, "booked"),
        sql`${callBookingsTable.scheduledAt} >= now()`,
      ),
    )
    .orderBy(sql`${callBookingsTable.scheduledAt} asc`)
    .limit(1);

  const [completedRow] = await db
    .select({ completedCallCount: sql<number>`count(*)` })
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.memberId, userId),
        eq(callBookingsTable.type, "partner"),
        eq(callBookingsTable.status, "completed"),
      ),
    );

  res.json({
    assignment: {
      partner: {
        id: partner.id,
        displayName: partner.displayName,
        photoUrl: partner.photoUrl,
        bio: partner.bio,
      },
      cadencePerWeek: assignmentRow?.cadencePerWeek ?? null,
      nextCall: nextCall
        ? { scheduledAt: nextCall.scheduledAt.toISOString(), meetingUrl: nextCall.meetingUrl }
        : null,
      completedCallCount: Number(completedRow?.completedCallCount ?? 0),
    },
  });
});

router.get("/onboarding/partner/mine", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const bookings = await db
    .select(MEMBER_CALL_BOOKING_COLUMNS)
    .from(callBookingsTable)
    .where(and(eq(callBookingsTable.memberId, userId), eq(callBookingsTable.type, "partner")))
    .orderBy(sql`${callBookingsTable.scheduledAt} desc`);
  res.json({ bookings });
});

router.post("/onboarding/partner/book", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { startTime } = req.body || {};
  if (typeof startTime !== "string" || Number.isNaN(Date.parse(startTime))) {
    res.status(400).json({ error: "Invalid start time" });
    return;
  }
  const scheduledAt = new Date(startTime);

  const partner = await loadAssignedPartner(userId);
  if (!partner || !partner.isActive || !partner.ghlCalendarId) {
    res.status(404).json({ error: "You don't have a bookable accountability partner right now." });
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

  const partnerLocationId = partner.ghlLocationId ?? COACHING_LOCATION_ID;
  const dayMs = scheduledAt.getTime();
  const rawSlots = await getFreeSlots(partner.ghlCalendarId, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000, partnerLocationId);
  const filtered = await filterPartnerSlots(userId, partner, rawSlots, dayMs - 60_000, dayMs + 24 * 60 * 60 * 1000);
  const slotOpen = filtered.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime());
  if (!slotOpen) {
    res.status(409).json({ error: "That time slot is no longer available" });
    return;
  }

  let durationMinutes: number;
  try {
    durationMinutes = await getCalendarDurationMinutes(partner.ghlCalendarId, partnerLocationId);
  } catch (err) {
    console.error("[call-bookings] failed to load partner calendar duration:", err);
    res.status(502).json({ error: "Could not load calendar configuration. Please try again." });
    return;
  }
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60000);
  const endTimeIso = isoWithMatchingOffset(endAt, startTime);

  const client = await pool.connect();
  let createdAppointmentId: string | null = null;
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);
    // Serialize against this partner so two members can't both pass the
    // cap/slot check and race past the 5/day cap.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${partnerBookingLockKey(partner.id)})`);

    const dailyCounts = await getPartnerDailyCounts(partner.id, dayMs - 24 * 60 * 60 * 1000, dayMs + 24 * 60 * 60 * 1000);
    const dayKey = dayKeyInTz(scheduledAt);
    if ((dailyCounts.get(dayKey) ?? 0) >= partner.maxDailyCalls) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "This partner is fully booked that day. Please pick another day." });
      return;
    }
    const cutoff = await getKickoffCutoffForFirstPartnerCall(userId);
    if (cutoff && scheduledAt.getTime() < cutoff.getTime()) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Your first partner call can't be before your kickoff call." });
      return;
    }
    const recheck = await getFreeSlots(partner.ghlCalendarId, dayMs - 60_000, dayMs + 60_000, partnerLocationId);
    if (!recheck.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime())) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "That time slot is no longer available" });
      return;
    }

    const contactId = await upsertContact({
      email: member.email,
      ...splitName(member.name),
      locationId: partnerLocationId,
    });
    const title = `Accountability Call with ${partner.displayName}`;
    const appointment = await createAppointment({
      calendarId: partner.ghlCalendarId,
      contactId,
      startTime,
      endTime: endTimeIso,
      title,
      locationId: partnerLocationId,
    });
    createdAppointmentId = appointment.id;

    const [booking] = await txDb
      .insert(callBookingsTable)
      .values({
        memberId: userId,
        staffType: "partner",
        staffId: partner.id,
        type: "partner",
        ghlCalendarId: partner.ghlCalendarId,
        ghlLocationId: partnerLocationId,
        ghlAppointmentId: appointment.id,
        ghlContactId: contactId,
        scheduledAt,
        endAt,
        durationMinutes,
        meetingUrl: appointment.meetLink,
        status: "booked",
      })
      .returning(MEMBER_CALL_BOOKING_COLUMNS);

    await client.query("COMMIT");

    const advanced = await advanceOnboardingAfterPartnerCallBooked(userId);
    res.status(201).json({ booking, onboardingAdvanced: advanced });
  } catch (err) {
    await client.query("ROLLBACK");
    if (createdAppointmentId) {
      try {
        await cancelAppointment(createdAppointmentId, partner.ghlLocationId ?? COACHING_LOCATION_ID);
      } catch (cancelErr) {
        console.error("[call-bookings] failed to roll back partner GHL appointment:", cancelErr);
      }
    }
    console.error("[call-bookings] partner booking failed:", err);
    res.status(500).json({ error: "Could not complete booking. Please try again." });
  } finally {
    client.release();
  }
});

async function loadOwnPartnerBooking(userId: number, bookingId: number) {
  const [booking] = await db
    .select()
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.id, bookingId),
        eq(callBookingsTable.memberId, userId),
        eq(callBookingsTable.type, "partner"),
      ),
    );
  return booking ?? null;
}

router.patch("/onboarding/partner/:id/reschedule", async (req, res): Promise<void> => {
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

  const existing = await loadOwnPartnerBooking(userId, bookingId);
  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  if (existing.status !== "booked") {
    res.status(400).json({ error: "Only booked calls can be rescheduled" });
    return;
  }

  const partner = await loadAssignedPartner(userId);
  if (!partner || partner.id !== existing.staffId || !partner.ghlCalendarId) {
    res.status(409).json({ error: "This booking's partner is no longer bookable." });
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

  const partnerLocationId = partner.ghlLocationId ?? COACHING_LOCATION_ID;
  const dayMs = scheduledAt.getTime();
  const client = await pool.connect();
  let newAppointmentId: string | null = null;
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${partnerBookingLockKey(partner.id)})`);

    // Re-check cap/pre-kickoff filters excluding the booking being moved, so
    // moving a call to a different slot the same day doesn't double-count it.
    const dailyCounts = await getPartnerDailyCounts(partner.id, dayMs - 24 * 60 * 60 * 1000, dayMs + 24 * 60 * 60 * 1000);
    const dayKey = dayKeyInTz(scheduledAt);
    const oldDayKey = dayKeyInTz(existing.scheduledAt);
    const effectiveCount = (dailyCounts.get(dayKey) ?? 0) - (oldDayKey === dayKey ? 1 : 0);
    if (effectiveCount >= partner.maxDailyCalls) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "This partner is fully booked that day. Please pick another day." });
      return;
    }
    const recheck = await getFreeSlots(partner.ghlCalendarId, dayMs - 60_000, dayMs + 60_000, partnerLocationId);
    if (!recheck.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime())) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "That time slot is no longer available" });
      return;
    }

    const durationMinutes = await getCalendarDurationMinutes(partner.ghlCalendarId, partnerLocationId);
    const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60000);
    const endTimeIso = isoWithMatchingOffset(endAt, startTime);

    // Reschedule = cancel the old GHL appointment, then create a fresh one
    // (per task spec), rather than an in-place GHL update. Fail closed if the
    // old appointment can't be canceled: proceeding would create a second
    // real GHL appointment while the old one is still live.
    if (existing.ghlAppointmentId) {
      try {
        await cancelAppointment(existing.ghlAppointmentId, existing.ghlLocationId ?? COACHING_LOCATION_ID);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("[call-bookings] failed to cancel old partner appointment during reschedule:", err);
        res.status(502).json({ error: "Could not reschedule with the calendar provider. Please try again." });
        return;
      }
    }
    const contactId =
      existing.ghlContactId ??
      (await upsertContact({ email: member.email, ...splitName(member.name), locationId: partnerLocationId }));
    const appointment = await createAppointment({
      calendarId: partner.ghlCalendarId,
      contactId,
      startTime,
      endTime: endTimeIso,
      title: `Accountability Call with ${partner.displayName}`,
      locationId: partnerLocationId,
    });
    newAppointmentId = appointment.id;

    const [booking] = await txDb
      .update(callBookingsTable)
      .set({
        scheduledAt,
        endAt,
        durationMinutes,
        ghlLocationId: partnerLocationId,
        ghlAppointmentId: appointment.id,
        meetingUrl: appointment.meetLink,
      })
      .where(eq(callBookingsTable.id, bookingId))
      .returning(MEMBER_CALL_BOOKING_COLUMNS);

    await client.query("COMMIT");
    res.json({ booking });
  } catch (err) {
    await client.query("ROLLBACK");
    if (newAppointmentId) {
      try {
        await cancelAppointment(newAppointmentId, partner.ghlLocationId ?? COACHING_LOCATION_ID);
      } catch (cancelErr) {
        console.error("[call-bookings] failed to roll back rescheduled partner appointment:", cancelErr);
      }
    }
    console.error("[call-bookings] partner reschedule failed:", err);
    res.status(500).json({ error: "Could not reschedule the call. Please try again." });
  } finally {
    client.release();
  }
});

router.patch("/onboarding/partner/:id/cancel", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const bookingId = parseInt(req.params.id, 10);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    res.status(400).json({ error: "Invalid booking id" });
    return;
  }

  const existing = await loadOwnPartnerBooking(userId, bookingId);
  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  if (existing.status !== "booked") {
    res.status(400).json({ error: "Only booked calls can be canceled" });
    return;
  }

  if (existing.ghlAppointmentId) {
    try {
      await cancelAppointment(existing.ghlAppointmentId, existing.ghlLocationId ?? COACHING_LOCATION_ID);
    } catch (err) {
      // Fail closed: if GHL cancel fails, the appointment may still be
      // active there, so the local row must stay "booked" to avoid a
      // local/GHL desync (portal showing canceled + cap freed while the
      // real appointment persists). No local mutation on this path.
      console.error("[call-bookings] failed to cancel partner GHL appointment:", err);
      res.status(502).json({ error: "Could not cancel the call with the calendar provider. Please try again." });
      return;
    }
  }

  // Canceling frees the daily cap automatically: getPartnerDailyCounts only
  // counts status <> 'canceled' rows, so this row stops counting the instant
  // its status flips here.
  const [booking] = await db
    .update(callBookingsTable)
    .set({ status: "canceled", cancelledAt: new Date() })
    .where(eq(callBookingsTable.id, bookingId))
    .returning(MEMBER_CALL_BOOKING_COLUMNS);
  res.json({ booking });
});

// ---------------------------------------------------------------------------
// Call-day banner — /call-bookings/today
// ---------------------------------------------------------------------------

router.get("/call-bookings/today", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const now = new Date();
  const todayKey = dayKeyInTz(now);

  const bookings = await db
    .select(MEMBER_CALL_BOOKING_COLUMNS)
    .from(callBookingsTable)
    .where(and(eq(callBookingsTable.memberId, userId), eq(callBookingsTable.status, "booked")))
    .orderBy(sql`${callBookingsTable.scheduledAt} asc`);

  const todays = bookings.filter((b) => dayKeyInTz(b.scheduledAt) === todayKey);
  res.json({ booking: todays[0] ?? null });
});

export default router;
