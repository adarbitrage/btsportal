import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  kickoffCoachesTable,
  partnersTable,
  partnerAssignmentsTable,
  callBookingsTable,
} from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";

// Task #1591 Tier 2: native kickoff + partner call booking. This suite pins
// the behaviors most likely to regress silently:
//   - the partner 5/day (maxDailyCalls) cap actually filters availability AND
//     is enforced again on booking
//   - canceling a booking frees the cap it was occupying
//   - a member's FIRST partner call can't be scheduled before their kickoff
//     call, but that restriction lifts once they have one
//   - onboarding step 4->5 (kickoff) and 5->6 (partner) advance exactly once
//     and are no-op-safe on repeat bookings
//   - canceling a booking sets status "canceled", never "completed"
//
// getFreeSlots is mocked to a deterministic 30-minute grid (independent of
// the requested range) so slots computed during availability line up exactly
// with the narrow re-check window the book/reschedule handlers use.
const SLOT_STEP_MS = 30 * 60 * 1000;
function gridSlotsBetween(startMs: number, endMs: number): { startTime: string }[] {
  const firstGrid = Math.ceil(startMs / SLOT_STEP_MS) * SLOT_STEP_MS;
  const slots: { startTime: string }[] = [];
  for (let t = firstGrid; t <= endMs; t += SLOT_STEP_MS) {
    slots.push({ startTime: new Date(t).toISOString() });
  }
  return slots;
}
function gridAlignedFutureTime(daysAhead: number, hourOffset = 0): Date {
  const raw = Date.now() + daysAhead * 24 * 60 * 60 * 1000 + hourOffset;
  return new Date(Math.ceil(raw / SLOT_STEP_MS) * SLOT_STEP_MS);
}

vi.mock("../lib/ghl-coaching-calendar", () => ({
  getFreeSlots: vi.fn(async (_calendarId: string, startMs: number, endMs: number) =>
    gridSlotsBetween(startMs, endMs),
  ),
  upsertContact: vi.fn(async () => "contact_test"),
  createAppointment: vi.fn(async () => ({
    id: `appt_test_${Math.random().toString(36).slice(2)}`,
    meetLink: "https://meet.example.test/call",
  })),
  cancelAppointment: vi.fn(async () => undefined),
  COACHING_TIMEZONE: "America/Chicago",
  COACHING_LOCATION_ID: "loc_test",
}));

import { buildTestApp } from "./test-app";
import callBookingsRouter from "../routes/call-bookings";
import { generateAccessToken } from "../middleware/auth";
import * as ghlCoachingCalendar from "../lib/ghl-coaching-calendar";

const TEST_TAG = `call-bookings-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestApp>;
let kickoffCoachId = 0;
let partnerId = 0; // used for cap + cancel-frees-cap tests
let kickoffPartnerId = 0; // used for pre-kickoff-cutoff test (isolated day range)

const userIds: number[] = [];
const bookingIds: number[] = [];
const assignmentIds: number[] = [];

async function makeMember(step: number, complete = false): Promise<number> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 8)}@example.test`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Call Booking Member",
      passwordHash: await bcrypt.hash("irrelevant", 4),
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: complete,
      onboardingStep: step,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

function authCookie(userId: number): string[] {
  return [`access_token=${generateAccessToken(userId, `${userId}@example.test`)}`];
}

async function onboardingStepOf(userId: number): Promise<{ step: number; complete: boolean }> {
  const [row] = await db
    .select({ step: usersTable.onboardingStep, complete: usersTable.onboardingComplete })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return { step: row.step, complete: row.complete };
}

beforeAll(async () => {
  app = buildTestApp({ routers: [callBookingsRouter] });

  const [coach] = await db
    .insert(kickoffCoachesTable)
    .values({
      displayName: "Kickoff Coach Test",
      ghlCalendarId: `${TEST_TAG}-kickoff-cal`,
      isActive: true,
    })
    .returning({ id: kickoffCoachesTable.id });
  kickoffCoachId = coach.id;

  const [partner] = await db
    .insert(partnersTable)
    .values({
      displayName: "Cap Test Partner",
      ghlCalendarId: `${TEST_TAG}-partner-cal`,
      isActive: true,
      maxDailyCalls: 2,
    })
    .returning({ id: partnersTable.id });
  partnerId = partner.id;

  const [kickoffPartner] = await db
    .insert(partnersTable)
    .values({
      displayName: "Pre-Kickoff Test Partner",
      ghlCalendarId: `${TEST_TAG}-partner-cal-2`,
      isActive: true,
      maxDailyCalls: 5,
    })
    .returning({ id: partnersTable.id });
  kickoffPartnerId = kickoffPartner.id;
});

afterAll(async () => {
  // Delete by memberId (not just tracked bookingIds) so a booking created
  // moments before a failed assertion (and never pushed to bookingIds) still
  // gets cleaned up rather than leaving an orphaned FK reference.
  if (userIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.memberId, userIds));
  } else if (bookingIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.id, bookingIds));
  }
  if (assignmentIds.length > 0) {
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.id, assignmentIds));
  }
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  await db.delete(kickoffCoachesTable).where(eq(kickoffCoachesTable.id, kickoffCoachId));
  await db.delete(partnersTable).where(inArray(partnersTable.id, [partnerId, kickoffPartnerId]));
});

async function assignPartner(memberId: number, pId: number): Promise<void> {
  const [row] = await db
    .insert(partnerAssignmentsTable)
    .values({ memberId, partnerId: pId, status: "active" })
    .returning({ id: partnerAssignmentsTable.id });
  assignmentIds.push(row.id);
}

async function seedPartnerBooking(opts: {
  memberId: number;
  pId: number;
  scheduledAt: Date;
  type: "partner" | "kickoff";
  staffType?: "partner" | "kickoff_coach";
  status?: string;
}): Promise<number> {
  const staffType = opts.staffType ?? (opts.type === "kickoff" ? "kickoff_coach" : "partner");
  const [row] = await db
    .insert(callBookingsTable)
    .values({
      memberId: opts.memberId,
      staffType,
      staffId: opts.pId,
      type: opts.type,
      ghlCalendarId: `${TEST_TAG}-seed-cal`,
      ghlAppointmentId: `${TEST_TAG}-seed-appt-${randomUUID().slice(0, 8)}`,
      scheduledAt: opts.scheduledAt,
      endAt: new Date(opts.scheduledAt.getTime() + 30 * 60 * 1000),
      durationMinutes: 30,
      status: opts.status ?? "booked",
    })
    .returning({ id: callBookingsTable.id });
  bookingIds.push(row.id);
  return row.id;
}

describe("kickoff call booking: step idempotency", () => {
  it("advances step 4->5 exactly once; repeat book returns the SAME booking without re-advancing", async () => {
    const memberId = await makeMember(4);
    const startTime = gridAlignedFutureTime(3);

    const first = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });

    expect(first.status).toBe(201);
    expect(first.body.onboardingAdvanced).toBe(true);
    const bookingId = first.body.booking.id;
    bookingIds.push(bookingId);

    const afterFirst = await onboardingStepOf(memberId);
    expect(afterFirst.step).toBe(5);

    const second = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: gridAlignedFutureTime(4).toISOString() });

    expect(second.status).toBe(200);
    expect(second.body.alreadyBooked).toBe(true);
    expect(second.body.booking.id).toBe(bookingId);

    const afterSecond = await onboardingStepOf(memberId);
    expect(afterSecond.step).toBe(5);

    const rows = await db
      .select({ id: callBookingsTable.id })
      .from(callBookingsTable)
      .where(eq(callBookingsTable.memberId, memberId));
    expect(rows.length).toBe(1);
  });
});

describe("partner call booking: 5/day cap filtering + cap freed on cancel", () => {
  it("excludes a fully-booked day from availability, rejects a booking attempt on it, then frees the cap on cancel", async () => {
    const fillerMemberId = await makeMember(5, true);
    const memberId = await makeMember(5, true);
    await assignPartner(memberId, partnerId);

    const capDay = gridAlignedFutureTime(5);
    const slotA = capDay;
    const slotB = new Date(capDay.getTime() + SLOT_STEP_MS);

    const fillerBookingIdA = await seedPartnerBooking({
      memberId: fillerMemberId,
      pId: partnerId,
      scheduledAt: slotA,
      type: "partner",
    });
    await seedPartnerBooking({
      memberId: fillerMemberId,
      pId: partnerId,
      scheduledAt: slotB,
      type: "partner",
    });

    const dateStr = capDay.toISOString().slice(0, 10);
    const avail = await request(app)
      .get(`/api/onboarding/partner/availability?startDate=${dateStr}&endDate=${dateStr}`)
      .set("Cookie", authCookie(memberId));
    expect(avail.status).toBe(200);
    const cappedDayKey = capDay.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const slotsOnCapDay = avail.body.slots.filter(
      (s: { startTime: string }) =>
        new Date(s.startTime).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) === cappedDayKey,
    );
    expect(slotsOnCapDay.length).toBe(0);

    const bookAttempt = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: new Date(capDay.getTime() + 2 * SLOT_STEP_MS).toISOString() });
    expect(bookAttempt.status).toBe(409);

    // Cancel one of the filler bookings (frees a slot in the cap) — owner
    // must cancel their own booking.
    const cancelRes = await request(app)
      .patch(`/api/onboarding/partner/${fillerBookingIdA}/cancel`)
      .set("Cookie", authCookie(fillerMemberId));
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.booking.status).toBe("canceled");
    expect(cancelRes.body.booking.status).not.toBe("completed");
    expect(cancelRes.body.booking.cancelledAt).toBeTruthy();

    const availAfterCancel = await request(app)
      .get(`/api/onboarding/partner/availability?startDate=${dateStr}&endDate=${dateStr}`)
      .set("Cookie", authCookie(memberId));
    const slotsAfterCancel = availAfterCancel.body.slots.filter(
      (s: { startTime: string }) =>
        new Date(s.startTime).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) === cappedDayKey,
    );
    expect(slotsAfterCancel.length).toBeGreaterThan(0);

    const bookAfterCancel = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: new Date(capDay.getTime() + 2 * SLOT_STEP_MS).toISOString() });
    expect(bookAfterCancel.status).toBe(201);
    bookingIds.push(bookAfterCancel.body.booking.id);
  });
});

describe("partner call booking: pre-kickoff filtering on the first booking only", () => {
  it("hides slots before the kickoff call for a member's first partner booking, then lifts the restriction", async () => {
    const memberId = await makeMember(5, false);
    await assignPartner(memberId, kickoffPartnerId);

    const kickoffAt = gridAlignedFutureTime(10);
    await seedPartnerBooking({
      memberId,
      pId: kickoffCoachId,
      scheduledAt: kickoffAt,
      type: "kickoff",
      staffType: "kickoff_coach",
    });

    const rangeStart = gridAlignedFutureTime(3);
    const rangeEnd = gridAlignedFutureTime(12);
    const avail = await request(app)
      .get(
        `/api/onboarding/partner/availability?startDate=${rangeStart.toISOString().slice(0, 10)}&endDate=${rangeEnd
          .toISOString()
          .slice(0, 10)}`,
      )
      .set("Cookie", authCookie(memberId));
    expect(avail.status).toBe(200);
    expect(avail.body.slots.length).toBeGreaterThan(0);
    for (const s of avail.body.slots as { startTime: string }[]) {
      expect(new Date(s.startTime).getTime()).toBeGreaterThanOrEqual(kickoffAt.getTime());
    }

    // Booking BEFORE the kickoff cutoff is rejected for this first call.
    const beforeCutoff = gridAlignedFutureTime(6);
    const rejected = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: beforeCutoff.toISOString() });
    expect(rejected.status).toBe(409);

    // Booking AFTER the cutoff succeeds and advances onboarding step 5->6.
    const afterCutoff = new Date(kickoffAt.getTime() + SLOT_STEP_MS);
    const firstBooking = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: afterCutoff.toISOString() });
    expect(firstBooking.status).toBe(201);
    expect(firstBooking.body.onboardingAdvanced).toBe(true);
    bookingIds.push(firstBooking.body.booking.id);

    const stepAfterFirst = await onboardingStepOf(memberId);
    expect(stepAfterFirst.step).toBe(6);

    // Now that the member has a non-canceled partner booking, the pre-kickoff
    // restriction lifts: a SECOND booking before the kickoff time succeeds,
    // and does NOT re-advance onboarding (already past step 5).
    const secondBooking = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: beforeCutoff.toISOString() });
    expect(secondBooking.status).toBe(201);
    expect(secondBooking.body.onboardingAdvanced).toBe(false);
    bookingIds.push(secondBooking.body.booking.id);

    const stepAfterSecond = await onboardingStepOf(memberId);
    expect(stepAfterSecond.step).toBe(6);
  });
});

describe("partner call cancel never marks a booking completed", () => {
  it("sets status to canceled (not completed) and stamps cancelledAt", async () => {
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, kickoffPartnerId);

    const startTime = gridAlignedFutureTime(20);
    const booked = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    bookingIds.push(bookingId);

    const cancel = await request(app)
      .patch(`/api/onboarding/partner/${bookingId}/cancel`)
      .set("Cookie", authCookie(memberId));
    expect(cancel.status).toBe(200);
    expect(cancel.body.booking.status).toBe("canceled");
    expect(cancel.body.booking.status).not.toBe("completed");
    expect(cancel.body.booking.cancelledAt).toBeTruthy();

    // A canceled booking can't be canceled again via this endpoint.
    const secondCancel = await request(app)
      .patch(`/api/onboarding/partner/${bookingId}/cancel`)
      .set("Cookie", authCookie(memberId));
    expect(secondCancel.status).toBe(400);
  });
});

describe("partner call cancel/reschedule fail closed on GHL errors", () => {
  it("leaves the local booking status unchanged when the GHL cancel call fails", async () => {
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, kickoffPartnerId);

    const startTime = gridAlignedFutureTime(21);
    const booked = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    bookingIds.push(bookingId);

    const cancelSpy = vi
      .spyOn(ghlCoachingCalendar, "cancelAppointment")
      .mockRejectedValueOnce(new Error("GHL unreachable"));
    try {
      const cancelRes = await request(app)
        .patch(`/api/onboarding/partner/${bookingId}/cancel`)
        .set("Cookie", authCookie(memberId));
      expect(cancelRes.status).toBe(502);
    } finally {
      cancelSpy.mockRestore();
    }

    const [row] = await db
      .select({ status: callBookingsTable.status, cancelledAt: callBookingsTable.cancelledAt })
      .from(callBookingsTable)
      .where(eq(callBookingsTable.id, bookingId));
    expect(row.status).toBe("booked");
    expect(row.cancelledAt).toBeNull();

    // Cancel succeeds normally once GHL is reachable again.
    const cancelRetry = await request(app)
      .patch(`/api/onboarding/partner/${bookingId}/cancel`)
      .set("Cookie", authCookie(memberId));
    expect(cancelRetry.status).toBe(200);
    expect(cancelRetry.body.booking.status).toBe("canceled");
  });

  it("leaves the local booking unchanged (still pointing at the old appointment) when canceling the old GHL appointment fails during reschedule", async () => {
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, kickoffPartnerId);

    const startTime = gridAlignedFutureTime(22);
    const booked = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    const originalAppointmentId = booked.body.booking.ghlAppointmentId;
    bookingIds.push(bookingId);

    const cancelSpy = vi
      .spyOn(ghlCoachingCalendar, "cancelAppointment")
      .mockRejectedValueOnce(new Error("GHL unreachable"));
    const createSpy = vi.spyOn(ghlCoachingCalendar, "createAppointment");
    const createCallsBefore = createSpy.mock.calls.length;
    try {
      const rescheduleRes = await request(app)
        .patch(`/api/onboarding/partner/${bookingId}/reschedule`)
        .set("Cookie", authCookie(memberId))
        .send({ startTime: new Date(startTime.getTime() + SLOT_STEP_MS).toISOString() });
      expect(rescheduleRes.status).toBe(502);
    } finally {
      cancelSpy.mockRestore();
    }
    // No new GHL appointment should have been created once the old-appointment
    // cancel failed — otherwise a duplicate real appointment is left dangling.
    expect(createSpy.mock.calls.length).toBe(createCallsBefore);

    const [row] = await db
      .select({ scheduledAt: callBookingsTable.scheduledAt, ghlAppointmentId: callBookingsTable.ghlAppointmentId })
      .from(callBookingsTable)
      .where(eq(callBookingsTable.id, bookingId));
    expect(row.scheduledAt.getTime()).toBe(startTime.getTime());
    expect(row.ghlAppointmentId).toBe(originalAppointmentId);
  });
});

describe("partner call cancel falls back to COACHING_LOCATION_ID when the stored booking has no location", () => {
  it("uses COACHING_LOCATION_ID for the GHL cancel call when callBookings.ghlLocationId is null", async () => {
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, kickoffPartnerId);

    const startTime = gridAlignedFutureTime(43);
    const booked = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    bookingIds.push(bookingId);

    // Simulate a legacy/edge-case row that never captured a location (the
    // column is nullable on call_bookings, unlike partners/kickoff_coaches
    // which default to the coaching location).
    await db.update(callBookingsTable).set({ ghlLocationId: null }).where(eq(callBookingsTable.id, bookingId));

    const cancelSpy = vi.spyOn(ghlCoachingCalendar, "cancelAppointment");
    const cancelRes = await request(app)
      .patch(`/api/onboarding/partner/${bookingId}/cancel`)
      .set("Cookie", authCookie(memberId));
    expect(cancelRes.status).toBe(200);
    expect(cancelSpy).toHaveBeenCalledWith(expect.any(String), "loc_test");
  });
});

describe("per-row GHL location plumbing (Task #1611)", () => {
  // These calendars live in a different GHL sub-account than the shared
  // COACHING_LOCATION_ID ("loc_test" in this suite's mock) — every GHL call
  // for a row that has its own ghlLocationId must use THAT location, never
  // the coaching-location fallback, or a real token minted for the wrong
  // location would 401 in production.
  const CUSTOM_LOCATION_ID = "loc_bts_custom";
  let customPartnerId = 0;
  let customKickoffCoachId = 0;

  beforeAll(async () => {
    const [partner] = await db
      .insert(partnersTable)
      .values({
        displayName: "Custom Location Partner",
        ghlCalendarId: `${TEST_TAG}-custom-partner-cal`,
        ghlLocationId: CUSTOM_LOCATION_ID,
        isActive: true,
        maxDailyCalls: 5,
      })
      .returning({ id: partnersTable.id });
    customPartnerId = partner.id;

    const [coach] = await db
      .insert(kickoffCoachesTable)
      .values({
        displayName: "Custom Location Kickoff Coach",
        ghlCalendarId: `${TEST_TAG}-custom-kickoff-cal`,
        ghlLocationId: CUSTOM_LOCATION_ID,
        isActive: true,
      })
      .returning({ id: kickoffCoachesTable.id });
    customKickoffCoachId = coach.id;
  });

  afterAll(async () => {
    // Assignments referencing these rows are cleaned up by the outer afterAll
    // via assignmentIds, but that runs AFTER this nested afterAll — delete
    // any assignment rows referencing them first so the FK doesn't block us.
    await db.delete(partnerAssignmentsTable).where(eq(partnerAssignmentsTable.partnerId, customPartnerId));
    await db.delete(partnersTable).where(eq(partnersTable.id, customPartnerId));
    await db.delete(kickoffCoachesTable).where(eq(kickoffCoachesTable.id, customKickoffCoachId));
  });

  it("passes the partner's own ghlLocationId (not the coaching default) to getFreeSlots, upsertContact, and createAppointment on booking", async () => {
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, customPartnerId);

    const freeSlotsSpy = vi.spyOn(ghlCoachingCalendar, "getFreeSlots");
    const upsertContactSpy = vi.spyOn(ghlCoachingCalendar, "upsertContact");
    const createAppointmentSpy = vi.spyOn(ghlCoachingCalendar, "createAppointment");

    const startTime = gridAlignedFutureTime(40);
    const booked = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(booked.status).toBe(201);
    bookingIds.push(booked.body.booking.id);

    // ghl_location_id is an internal-only column (excluded from
    // MEMBER_CALL_BOOKING_COLUMNS) — verify it landed via a direct DB read.
    const [storedBooking] = await db
      .select({ ghlLocationId: callBookingsTable.ghlLocationId })
      .from(callBookingsTable)
      .where(eq(callBookingsTable.id, booked.body.booking.id));
    expect(storedBooking.ghlLocationId).toBe(CUSTOM_LOCATION_ID);
    for (const call of freeSlotsSpy.mock.calls) {
      expect(call[3]).toBe(CUSTOM_LOCATION_ID);
    }
    expect(upsertContactSpy).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: CUSTOM_LOCATION_ID }),
    );
    expect(createAppointmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: CUSTOM_LOCATION_ID }),
    );
  });

  it("passes the kickoff coach's own ghlLocationId (not the coaching default) to getFreeSlots and createAppointment on booking", async () => {
    // Force round-robin selection onto the custom-location coach by
    // deactivating every OTHER active kickoff coach (both this suite's test
    // fixture and the real seeded roster rows) for the duration of this test
    // — selectKickoffCoach() picks the least-booked ACTIVE coach.
    const otherActiveCoaches = await db
      .select({ id: kickoffCoachesTable.id })
      .from(kickoffCoachesTable)
      .where(and(eq(kickoffCoachesTable.isActive, true), ne(kickoffCoachesTable.id, customKickoffCoachId)));
    const otherActiveCoachIds = otherActiveCoaches.map((c) => c.id);
    if (otherActiveCoachIds.length > 0) {
      await db.update(kickoffCoachesTable).set({ isActive: false }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
    }
    try {
      const memberId = await makeMember(4);
      const freeSlotsSpy = vi.spyOn(ghlCoachingCalendar, "getFreeSlots");
      const createAppointmentSpy = vi.spyOn(ghlCoachingCalendar, "createAppointment");

      const startTime = gridAlignedFutureTime(41);
      const booked = await request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTime.toISOString() });
      expect(booked.status).toBe(201);
      bookingIds.push(booked.body.booking.id);

      const [storedBooking] = await db
        .select({ ghlLocationId: callBookingsTable.ghlLocationId })
        .from(callBookingsTable)
        .where(eq(callBookingsTable.id, booked.body.booking.id));
      expect(storedBooking.ghlLocationId).toBe(CUSTOM_LOCATION_ID);
      for (const call of freeSlotsSpy.mock.calls) {
        expect(call[3]).toBe(CUSTOM_LOCATION_ID);
      }
      expect(createAppointmentSpy).toHaveBeenCalledWith(
        expect.objectContaining({ locationId: CUSTOM_LOCATION_ID }),
      );
    } finally {
      if (otherActiveCoachIds.length > 0) {
        await db.update(kickoffCoachesTable).set({ isActive: true }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
      }
    }
  });
});

describe("inactive partner/kickoff coach roster rows are excluded", () => {
  it("excludes an inactive partner from availability lookup (loadAssignedPartner requires isActive)", async () => {
    const [inactivePartner] = await db
      .insert(partnersTable)
      .values({
        displayName: "Inactive Roster Partner",
        ghlCalendarId: null,
        isActive: false,
        maxDailyCalls: 5,
      })
      .returning({ id: partnersTable.id });

    try {
      const memberId = await makeMember(6, true);
      await assignPartner(memberId, inactivePartner.id);

      const avail = await request(app)
        .get("/api/onboarding/partner/availability")
        .set("Cookie", authCookie(memberId));
      expect(avail.status).toBe(404);
    } finally {
      await db.delete(partnerAssignmentsTable).where(eq(partnerAssignmentsTable.partnerId, inactivePartner.id));
      await db.delete(partnersTable).where(eq(partnersTable.id, inactivePartner.id));
    }
  });

  it("excludes an inactive kickoff coach from round-robin selection", async () => {
    const [inactiveCoach] = await db
      .insert(kickoffCoachesTable)
      .values({
        displayName: "Inactive Roster Kickoff Coach",
        ghlCalendarId: `${TEST_TAG}-inactive-kickoff-cal`,
        isActive: false,
      })
      .returning({ id: kickoffCoachesTable.id });

    try {
      const memberId = await makeMember(4);
      const startTime = gridAlignedFutureTime(42);
      const booked = await request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTime.toISOString() });
      expect(booked.status).toBe(201);
      expect(booked.body.booking.staffId).not.toBe(inactiveCoach.id);
      bookingIds.push(booked.body.booking.id);
    } finally {
      await db.delete(kickoffCoachesTable).where(eq(kickoffCoachesTable.id, inactiveCoach.id));
    }
  });
});

describe("kickoff call booking: concurrent double-submit produces a single booking", () => {
  it("returns the same booking for two simultaneous kickoff book requests from the same member", async () => {
    const memberId = await makeMember(4);
    const startTimeA = gridAlignedFutureTime(30);
    const startTimeB = gridAlignedFutureTime(31);

    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTimeA.toISOString() }),
      request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTimeB.toISOString() }),
    ]);

    expect([resA.status, resB.status].sort()).toEqual([200, 201]);
    const winner = resA.status === 201 ? resA : resB;
    const loser = resA.status === 201 ? resB : resA;
    expect(loser.body.alreadyBooked).toBe(true);
    expect(loser.body.booking.id).toBe(winner.body.booking.id);
    bookingIds.push(winner.body.booking.id);

    const rows = await db
      .select({ id: callBookingsTable.id })
      .from(callBookingsTable)
      .where(and(eq(callBookingsTable.memberId, memberId), eq(callBookingsTable.type, "kickoff")));
    expect(rows.length).toBe(1);
  });
});
