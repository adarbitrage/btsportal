import { Router, type IRouter } from "express";
import {
  db,
  pool,
  usersTable,
  partnersTable,
  partnerAssignmentsTable,
  callBookingsTable,
  kickoffCoachesTable,
} from "@workspace/db";
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
import { listKickoffCoachPool, loadKickoffCoachById, getMemberKickoffTier } from "../lib/kickoff-assignment";
import { getActiveAssignment } from "../lib/partner-assignment";
import { getPartnerDailyCounts, filterSlotsByDailyCap } from "../lib/partner-call-capacity";
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

// A single merged-pool slot, tagged with the coach that owns it (Task #1654).
// Calendars can differ per coach, so durationMinutes travels WITH the slot
// rather than as one top-level value.
interface KickoffPoolSlot {
  startTime: string;
  coachId: number;
  durationMinutes: number;
}

router.get("/onboarding/kickoff/availability", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const range = parseDateRange(req);
  if (!range) {
    res.status(400).json({ error: "Invalid date range" });
    return;
  }

  const tier = await getMemberKickoffTier(userId);
  const pool = await listKickoffCoachPool(tier);
  if (pool.length === 0) {
    // Task #1641: no active, calendar-configured coach for this member's
    // tier — e.g. LaunchPad before Neil's real calendar ID is entered. This
    // is a loud, explicit "still being set up" signal, never a silent empty
    // slot list, and NEVER a fallback to the other tier's coaches.
    res.json({ setupPending: true, coaches: [], slots: [] });
    return;
  }

  const cutoff = Date.now() + MIN_LEAD_TIME_MS;
  const results = await Promise.allSettled(
    pool.map(async (coach) => {
      const coachLocationId = coach.ghlLocationId ?? COACHING_LOCATION_ID;
      const [slots, durationMinutes] = await Promise.all([
        getFreeSlots(coach.ghlCalendarId, range.startMs, range.endMs, coachLocationId),
        getCalendarDurationMinutes(coach.ghlCalendarId, coachLocationId),
      ]);
      const usable: KickoffPoolSlot[] = slots
        .filter((s) => new Date(s.startTime).getTime() >= cutoff)
        .map((s) => ({ startTime: s.startTime, coachId: coach.id, durationMinutes }));
      return usable;
    }),
  );

  // Task #1654: one coach's fetch failing doesn't take down the whole grid —
  // the other coaches' slots still render. Only a TOTAL failure (every
  // coach's fetch rejected) surfaces the existing 502.
  const succeeded = results.filter(
    (r): r is PromiseFulfilledResult<KickoffPoolSlot[]> => r.status === "fulfilled",
  );
  if (succeeded.length === 0) {
    console.error(
      "[call-bookings] kickoff availability failed for every coach in the pool:",
      results.map((r) => (r.status === "rejected" ? r.reason : null)),
    );
    res.status(502).json({ error: "Could not load availability. Please try again." });
    return;
  }
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[call-bookings] kickoff availability failed for one coach in the pool:", r.reason);
    }
  }

  const merged = succeeded.flatMap((r) => r.value).sort((a, b) => {
    const t = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    return t !== 0 ? t : a.coachId - b.coachId;
  });

  res.json({
    coaches: pool.map((c) => ({ id: c.id, displayName: c.displayName, photoUrl: c.photoUrl, bio: c.bio })),
    slots: merged,
  });
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

  const { startTime, coachId } = req.body || {};
  if (typeof startTime !== "string" || Number.isNaN(Date.parse(startTime))) {
    res.status(400).json({ error: "Invalid start time" });
    return;
  }
  if (typeof coachId !== "number" || !Number.isInteger(coachId)) {
    res.status(400).json({ error: "Invalid coach" });
    return;
  }
  const scheduledAt = new Date(startTime);
  if (scheduledAt.getTime() < Date.now() + MIN_LEAD_TIME_MS) {
    res.status(400).json({ error: "Calls must be booked at least 1 hour in advance" });
    return;
  }

  const tier = await getMemberKickoffTier(userId);
  // Task #1654: the member now picks a specific coach's slot from the merged
  // grid — book against THAT coach, never re-run round robin here (which
  // could silently hand the booking to a different coach than the one whose
  // slot the member actually clicked). loadKickoffCoachById enforces
  // active + correct-tier so a forged cross-tier coachId is rejected.
  const coach = await loadKickoffCoachById(coachId, tier);
  if (!coach) {
    // Task #1641: same loud "still being set up" signal as the availability
    // endpoint — never fall back to the other tier's coaches. Also covers a
    // forged/cross-tier/inactive coachId, which should look the same to the
    // client as "no longer bookable".
    res.status(200).json({ setupPending: true });
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

// Task #1654: the daily-cap counting + filtering logic itself now lives in
// ../lib/partner-call-capacity.ts (getPartnerDailyCounts, filterSlotsByDailyCap)
// so the assignment-time soonest-slot probe in partner-assignment.ts can reuse
// the EXACT same cap enforcement — raw GHL free slots have no concept of the
// portal-side cap. This wrapper layers the member-specific "first partner
// call can't be before kickoff" cutoff on top, which only applies here.
async function filterPartnerSlots(
  memberId: number,
  partner: { id: number; maxDailyCalls: number },
  slots: FreeSlot[],
  startMs: number,
  endMs: number,
): Promise<FreeSlot[]> {
  const cutoff = await getKickoffCutoffForFirstPartnerCall(memberId);
  const capFiltered = await filterSlotsByDailyCap(partner.id, partner.maxDailyCalls, slots, startMs, endMs);

  return capFiltered.filter((s) => {
    const startMsSlot = new Date(s.startTime).getTime();
    if (cutoff && startMsSlot < cutoff.getTime()) return false;
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

// ---------------------------------------------------------------------------
// Persistent next-call panel — /call-bookings/next (Task #1688).
//
// Unlike /partner/me (partner-assignment-only, Task #1593) and
// /call-bookings/today (today-only), this is the single source of truth for
// "what's my next booked call" across BOTH call types (kickoff or partner) —
// a LaunchPad member with a booked kickoff call and NO partner assignment
// gets a result here even though /partner/me returns null for them. Staff
// display info is resolved from the right roster per staffType so the panel
// never has to special-case kickoff vs. partner display.
// ---------------------------------------------------------------------------

// Task #1696: returns EVERY upcoming booked call (chronological), not just
// the soonest one, so the sidebar can render one card per call (e.g. a
// 1-year member with both a kickoff call AND an accountability call booked
// at the same time sees two distinct cards instead of one panel that mixes
// the two people together).
router.get("/call-bookings/next", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const bookings = await db
    .select(MEMBER_CALL_BOOKING_COLUMNS)
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.memberId, userId),
        eq(callBookingsTable.status, "booked"),
        sql`${callBookingsTable.scheduledAt} >= now()`,
      ),
    )
    .orderBy(sql`${callBookingsTable.scheduledAt} asc`);

  const calls = await Promise.all(
    bookings.map(async (booking) => {
      let staff: { displayName: string; photoUrl: string | null } | null = null;
      if (booking.staffType === "kickoff_coach") {
        const [coach] = await db
          .select({ displayName: kickoffCoachesTable.displayName, photoUrl: kickoffCoachesTable.photoUrl })
          .from(kickoffCoachesTable)
          .where(eq(kickoffCoachesTable.id, booking.staffId));
        staff = coach ?? null;
      } else if (booking.staffType === "partner") {
        const [partner] = await db
          .select({ displayName: partnersTable.displayName, photoUrl: partnersTable.photoUrl })
          .from(partnersTable)
          .where(eq(partnersTable.id, booking.staffId));
        staff = partner ?? null;
      }

      return {
        type: booking.type,
        scheduledAt: booking.scheduledAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        meetingUrl: booking.meetingUrl,
        staff,
      };
    }),
  );

  res.json({ calls });
});

export default router;
