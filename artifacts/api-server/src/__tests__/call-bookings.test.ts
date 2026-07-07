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
  productsTable,
  userProductsTable,
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

// Task #1631: duration must come from the calendar's configured
// slotDuration, NEVER from the (30-min) slot-grid spacing above — the mock
// below defaults every calendar to 30 min, and the dedicated duration-source
// tests override it per-calendar (e.g. 45) to prove the two are independent.
const DEFAULT_CALENDAR_DURATION_MINUTES = 30;
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
  getCalendarDurationMinutes: vi.fn(async (_calendarId: string) => 30),
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
  it("advances step 3->4 exactly once; repeat book returns the SAME booking without re-advancing", async () => {
    const memberId = await makeMember(3);
    const startTime = gridAlignedFutureTime(3);

    const first = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });

    expect(first.status).toBe(201);
    expect(first.body.onboardingAdvanced).toBe(true);
    const bookingId = first.body.booking.id;
    bookingIds.push(bookingId);

    const afterFirst = await onboardingStepOf(memberId);
    expect(afterFirst.step).toBe(4);

    const second = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: gridAlignedFutureTime(4).toISOString() });

    expect(second.status).toBe(200);
    expect(second.body.alreadyBooked).toBe(true);
    expect(second.body.booking.id).toBe(bookingId);

    const afterSecond = await onboardingStepOf(memberId);
    expect(afterSecond.step).toBe(4);

    const rows = await db
      .select({ id: callBookingsTable.id })
      .from(callBookingsTable)
      .where(eq(callBookingsTable.memberId, memberId));
    expect(rows.length).toBe(1);
  });
});

describe("availability responses expose the call duration (Task #1625)", () => {
  it("kickoff availability includes per-slot durationMinutes matching the booked call", async () => {
    const memberId = await makeMember(3);
    const startTime = gridAlignedFutureTime(2);
    const dateStr = startTime.toISOString().slice(0, 10);

    const avail = await request(app)
      .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
      .set("Cookie", authCookie(memberId));
    expect(avail.status).toBe(200);
    expect(avail.body.slots.length).toBeGreaterThan(0);
    const chosenSlot = avail.body.slots.find((s: { startTime: string }) => s.startTime === startTime.toISOString());
    expect(chosenSlot).toBeDefined();
    expect(typeof chosenSlot.durationMinutes).toBe("number");
    expect(chosenSlot.durationMinutes).toBeGreaterThan(0);

    const book = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: chosenSlot.coachId });
    expect(book.status).toBe(201);
    bookingIds.push(book.body.booking.id);
    expect(book.body.booking.durationMinutes).toBe(chosenSlot.durationMinutes);
  });

  it("partner availability includes durationMinutes matching the booked call", async () => {
    const memberId = await makeMember(5, true);
    await assignPartner(memberId, partnerId);
    const startTime = gridAlignedFutureTime(6);
    const dateStr = startTime.toISOString().slice(0, 10);

    const avail = await request(app)
      .get(`/api/onboarding/partner/availability?startDate=${dateStr}&endDate=${dateStr}`)
      .set("Cookie", authCookie(memberId));
    expect(avail.status).toBe(200);
    expect(typeof avail.body.durationMinutes).toBe("number");
    expect(avail.body.durationMinutes).toBeGreaterThan(0);

    const book = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(book.status).toBe(201);
    bookingIds.push(book.body.booking.id);
    expect(book.body.booking.durationMinutes).toBe(avail.body.durationMinutes);
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
    const memberId = await makeMember(4, false);
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

    // Booking AFTER the cutoff succeeds and advances onboarding step 4->5.
    // Use 2*SLOT_STEP_MS (60 min) after kickoff start so the new 30-min-gap
    // conflict rule doesn't block it: kickoff ends at kickoffAt+30min, the
    // partner slot starts at kickoffAt+60min → gap = 30min = exactly at the
    // boundary (allowed, not blocked).
    const afterCutoff = new Date(kickoffAt.getTime() + 2 * SLOT_STEP_MS);
    const firstBooking = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: afterCutoff.toISOString() });
    expect(firstBooking.status).toBe(201);
    expect(firstBooking.body.onboardingAdvanced).toBe(true);
    bookingIds.push(firstBooking.body.booking.id);

    const stepAfterFirst = await onboardingStepOf(memberId);
    expect(stepAfterFirst.step).toBe(5);

    // Now that the member has a non-canceled partner booking, the pre-kickoff
    // restriction lifts: a SECOND booking before the kickoff time succeeds,
    // and does NOT re-advance onboarding (already past step 4).
    const secondBooking = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: beforeCutoff.toISOString() });
    expect(secondBooking.status).toBe(201);
    expect(secondBooking.body.onboardingAdvanced).toBe(false);
    bookingIds.push(secondBooking.body.booking.id);

    const stepAfterSecond = await onboardingStepOf(memberId);
    expect(stepAfterSecond.step).toBe(5);
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

    // Cleared (not vi.spyOn-wrapped) — vi.spyOn on a property that is
    // ALREADY a vi.fn() (from the module factory below) replaces the
    // module's exported binding with a distinct wrapper object, and
    // mockRestore() does not reliably reinstate a working mock afterward.
    // Every other test in this file (and route.ts's own import) shares
    // these exact same vi.fn instances, so read/clear them in place instead.
    const freeSlotsSpy = ghlCoachingCalendar.getFreeSlots as unknown as ReturnType<typeof vi.fn>;
    const upsertContactSpy = ghlCoachingCalendar.upsertContact as unknown as ReturnType<typeof vi.fn>;
    const createAppointmentSpy = ghlCoachingCalendar.createAppointment as unknown as ReturnType<typeof vi.fn>;
    freeSlotsSpy.mockClear();
    upsertContactSpy.mockClear();
    createAppointmentSpy.mockClear();

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
      const memberId = await makeMember(3);
      const freeSlotsSpy = ghlCoachingCalendar.getFreeSlots as unknown as ReturnType<typeof vi.fn>;
      const createAppointmentSpy = ghlCoachingCalendar.createAppointment as unknown as ReturnType<typeof vi.fn>;
      freeSlotsSpy.mockClear();
      createAppointmentSpy.mockClear();

      const startTime = gridAlignedFutureTime(41);
      const booked = await request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTime.toISOString(), coachId: customKickoffCoachId });
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

  it("excludes an inactive kickoff coach from the merged availability pool and rejects booking against it", async () => {
    const [inactiveCoach] = await db
      .insert(kickoffCoachesTable)
      .values({
        displayName: "Inactive Roster Kickoff Coach",
        ghlCalendarId: `${TEST_TAG}-inactive-kickoff-cal`,
        isActive: false,
      })
      .returning({ id: kickoffCoachesTable.id });

    try {
      const memberId = await makeMember(3);
      const startTime = gridAlignedFutureTime(42);
      const dateStr = startTime.toISOString().slice(0, 10);

      const avail = await request(app)
        .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
        .set("Cookie", authCookie(memberId));
      expect(avail.status).toBe(200);
      expect(avail.body.coaches.some((c: { id: number }) => c.id === inactiveCoach.id)).toBe(false);
      expect(avail.body.slots.some((s: { coachId: number }) => s.coachId === inactiveCoach.id)).toBe(false);

      const forgedBook = await request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTime.toISOString(), coachId: inactiveCoach.id });
      expect(forgedBook.status).toBe(200);
      expect(forgedBook.body.setupPending).toBe(true);

      const booked = await request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
      expect(booked.status).toBe(201);
      expect(booked.body.booking.staffId).not.toBe(inactiveCoach.id);
      bookingIds.push(booked.body.booking.id);
    } finally {
      await db.delete(kickoffCoachesTable).where(eq(kickoffCoachesTable.id, inactiveCoach.id));
    }
  });
});

describe("merged kickoff pool across multiple coaches (Task #1654)", () => {
  // Fetched fresh inside each test (never captured once at describe-collection
  // time): earlier tests in this file `vi.spyOn(ghlCoachingCalendar,
  // "getFreeSlots")` and restore it, which replaces the module's exported
  // property with a distinct object. A stale top-level `const` captured
  // before those tests run would silently diverge from whatever route.ts's
  // live import binding resolves to at request time.
  function freeSlots(): ReturnType<typeof vi.fn> {
    return ghlCoachingCalendar.getFreeSlots as unknown as ReturnType<typeof vi.fn>;
  }

  it("merges three coaches' mocked pools earliest-first and books the slot's owner", async () => {
    const otherActiveCoaches = await db
      .select({ id: kickoffCoachesTable.id })
      .from(kickoffCoachesTable)
      .where(and(eq(kickoffCoachesTable.isActive, true), ne(kickoffCoachesTable.id, kickoffCoachId)));
    const otherActiveCoachIds = otherActiveCoaches.map((c) => c.id);
    if (otherActiveCoachIds.length > 0) {
      await db.update(kickoffCoachesTable).set({ isActive: false }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
    }

    // Offsets must themselves be exact 30-minute-grid multiples — anything
    // else gets ceil-rounded by gridAlignedFutureTime and can silently
    // collide with a neighboring offset (e.g. +15min rounds up to the same
    // grid slot as +30min), making the "earliest-first" ordering ambiguous.
    const coachB_time = gridAlignedFutureTime(60);
    const coachC_time = gridAlignedFutureTime(60, 30 * 60 * 1000);
    const coachA_time = gridAlignedFutureTime(60, 60 * 60 * 1000);

    const [coachB] = await db
      .insert(kickoffCoachesTable)
      .values({ displayName: "Merge Coach B", ghlCalendarId: `${TEST_TAG}-merge-cal-b`, isActive: true })
      .returning({ id: kickoffCoachesTable.id });
    const [coachC] = await db
      .insert(kickoffCoachesTable)
      .values({ displayName: "Merge Coach C", ghlCalendarId: `${TEST_TAG}-merge-cal-c`, isActive: true })
      .returning({ id: kickoffCoachesTable.id });

    const prevImpl = freeSlots().getMockImplementation();
    // mockReset (not just mockImplementation) so any leftover queued
    // mockImplementationOnce() calls from earlier tests in this file don't
    // get consumed first and return stale/duplicated slot data here.
    freeSlots().mockReset();
    freeSlots().mockImplementation(async (calendarId: string) => {
      if (calendarId === `${TEST_TAG}-merge-cal-b`) return [{ startTime: coachB_time.toISOString() }];
      if (calendarId === `${TEST_TAG}-merge-cal-c`) return [{ startTime: coachC_time.toISOString() }];
      return [{ startTime: coachA_time.toISOString() }];
    });

    try {
      const memberId = await makeMember(3);
      const dateStr = coachB_time.toISOString().slice(0, 10);

      const avail = await request(app)
        .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
        .set("Cookie", authCookie(memberId));
      expect(avail.status).toBe(200);

      // Merged pool spans all three coaches (plus any real roster still
      // active — none here since we deactivated them above), sorted
      // earliest-first: B (coachB_time) < C (+15m) < A (+30m).
      const relevant = avail.body.slots.filter((s: { coachId: number }) =>
        [coachB.id, coachC.id, kickoffCoachId].includes(s.coachId),
      );
      expect(relevant.map((s: { coachId: number }) => s.coachId)).toEqual([coachB.id, coachC.id, kickoffCoachId]);
      expect(relevant[0].startTime).toBe(coachB_time.toISOString());

      const book = await request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: coachB_time.toISOString(), coachId: coachB.id });
      expect(book.status).toBe(201);
      expect(book.body.booking.staffId).toBe(coachB.id);
      bookingIds.push(book.body.booking.id);
    } finally {
      freeSlots().mockImplementation(prevImpl ?? (async () => []));
      await db.delete(kickoffCoachesTable).where(inArray(kickoffCoachesTable.id, [coachB.id, coachC.id]));
      if (otherActiveCoachIds.length > 0) {
        await db.update(kickoffCoachesTable).set({ isActive: true }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
      }
    }
  });

  it("still yields the other coaches' slots when one coach's fetch fails", async () => {
    const otherActiveCoaches = await db
      .select({ id: kickoffCoachesTable.id })
      .from(kickoffCoachesTable)
      .where(and(eq(kickoffCoachesTable.isActive, true), ne(kickoffCoachesTable.id, kickoffCoachId)));
    const otherActiveCoachIds = otherActiveCoaches.map((c) => c.id);
    if (otherActiveCoachIds.length > 0) {
      await db.update(kickoffCoachesTable).set({ isActive: false }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
    }

    const goodTime = gridAlignedFutureTime(61);

    const [failingCoach] = await db
      .insert(kickoffCoachesTable)
      .values({ displayName: "Failing Merge Coach", ghlCalendarId: `${TEST_TAG}-merge-cal-fail`, isActive: true })
      .returning({ id: kickoffCoachesTable.id });

    const prevImpl = freeSlots().getMockImplementation();
    freeSlots().mockReset();
    freeSlots().mockImplementation(async (calendarId: string) => {
      if (calendarId === `${TEST_TAG}-merge-cal-fail`) throw new Error("GHL unreachable for this coach");
      return [{ startTime: goodTime.toISOString() }];
    });

    try {
      const memberId = await makeMember(3);
      const dateStr = goodTime.toISOString().slice(0, 10);

      const avail = await request(app)
        .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
        .set("Cookie", authCookie(memberId));
      expect(avail.status).toBe(200);
      expect(avail.body.slots.some((s: { coachId: number }) => s.coachId === kickoffCoachId)).toBe(true);
      expect(avail.body.slots.some((s: { coachId: number }) => s.coachId === failingCoach.id)).toBe(false);
    } finally {
      freeSlots().mockImplementation(prevImpl ?? (async () => []));
      await db.delete(kickoffCoachesTable).where(eq(kickoffCoachesTable.id, failingCoach.id));
      if (otherActiveCoachIds.length > 0) {
        await db.update(kickoffCoachesTable).set({ isActive: true }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
      }
    }
  });
});

describe("kickoff call booking: concurrent double-submit produces a single booking", () => {
  it("returns the same booking for two simultaneous kickoff book requests from the same member", async () => {
    const memberId = await makeMember(3);
    const startTimeA = gridAlignedFutureTime(30);
    const startTimeB = gridAlignedFutureTime(31);

    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTimeA.toISOString(), coachId: kickoffCoachId }),
      request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTimeB.toISOString(), coachId: kickoffCoachId }),
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

describe("call duration comes from calendar config, never slot-grid spacing (Task #1631)", () => {
  // The mocked slot grid (SLOT_STEP_MS) is fixed at 30 minutes for every
  // calendar, on purpose — these tests configure a DIFFERENT slotDuration
  // (45 min) via getCalendarDurationMinutes and assert the booked
  // endAt/durationMinutes follow that config, not the 30-min grid spacing.
  const durationMock = ghlCoachingCalendar.getCalendarDurationMinutes as unknown as ReturnType<typeof vi.fn>;

  afterAll(() => {
    durationMock.mockImplementation(async () => DEFAULT_CALENDAR_DURATION_MINUTES);
  });

  it("kickoff booking uses the calendar's configured 45-minute slotDuration, not the 30-minute slot grid", async () => {
    // Task #1654: the merged pool now spans every active kickoff coach in
    // the tier (including the real seeded full-tier roster), so isolate to
    // just this suite's single fixture coach or the duration mock's queued
    // once-implementations (and the "which coach owns this slot" logic)
    // become non-deterministic across multiple real coaches.
    const otherActiveCoaches = await db
      .select({ id: kickoffCoachesTable.id })
      .from(kickoffCoachesTable)
      .where(and(eq(kickoffCoachesTable.isActive, true), ne(kickoffCoachesTable.id, kickoffCoachId)));
    const otherActiveCoachIds = otherActiveCoaches.map((c) => c.id);
    if (otherActiveCoachIds.length > 0) {
      await db.update(kickoffCoachesTable).set({ isActive: false }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
    }
    try {
      durationMock.mockImplementationOnce(async () => 45).mockImplementationOnce(async () => 45);
      const memberId = await makeMember(3);
      const startTime = gridAlignedFutureTime(50);

      const dateStr = startTime.toISOString().slice(0, 10);
      const avail = await request(app)
        .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
        .set("Cookie", authCookie(memberId));
      expect(avail.status).toBe(200);
      const chosenSlot = avail.body.slots.find(
        (s: { startTime: string }) => s.startTime === startTime.toISOString(),
      );
      expect(chosenSlot).toBeDefined();
      expect(chosenSlot.durationMinutes).toBe(45);

      const book = await request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTime.toISOString(), coachId: chosenSlot.coachId });
      expect(book.status).toBe(201);
      bookingIds.push(book.body.booking.id);
      expect(book.body.booking.durationMinutes).toBe(45);
      const expectedEndAt = new Date(startTime.getTime() + 45 * 60 * 1000).getTime();
      expect(new Date(book.body.booking.endAt).getTime()).toBe(expectedEndAt);
      // Sanity: the mocked slot grid itself is 30-minute spaced, proving the
      // 45-minute duration did NOT leak in from slot spacing.
      expect(SLOT_STEP_MS).toBe(30 * 60 * 1000);
    } finally {
      if (otherActiveCoachIds.length > 0) {
        await db.update(kickoffCoachesTable).set({ isActive: true }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
      }
    }
  });

  it("partner booking uses the calendar's own configured 30-minute slotDuration via the same generic mechanism (no special-casing)", async () => {
    // Only one call site (book) is exercised here — no availability call —
    // so exactly one queued mock implementation, or it leaks into the next test.
    durationMock.mockImplementationOnce(async () => 30);
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, partnerId);
    const startTime = gridAlignedFutureTime(51);

    const book = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(book.status).toBe(201);
    bookingIds.push(book.body.booking.id);
    expect(book.body.booking.durationMinutes).toBe(30);
    expect(durationMock).toHaveBeenCalled();
  });

  it("kickoff booking fails explicitly (502) when the calendar config fetch fails, with no silent 30-minute fallback", async () => {
    durationMock.mockImplementationOnce(async () => {
      throw new Error("GHL calendar config unreachable");
    });
    const memberId = await makeMember(3);
    const startTime = gridAlignedFutureTime(52);

    const book = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
    expect(book.status).toBe(502);

    const rows = await db
      .select({ id: callBookingsTable.id })
      .from(callBookingsTable)
      .where(and(eq(callBookingsTable.memberId, memberId), eq(callBookingsTable.type, "kickoff")));
    expect(rows.length).toBe(0);
  });

  it("kickoff availability fails explicitly (502) when the calendar config fetch fails for EVERY coach, with no silent 30-minute fallback", async () => {
    // Task #1654: one coach's fetch failing is now tolerated (the other
    // coaches' slots still render) — a TOTAL 502 only happens when every
    // coach in the pool fails, so isolate to this suite's single fixture
    // coach for this assertion.
    const otherActiveCoaches = await db
      .select({ id: kickoffCoachesTable.id })
      .from(kickoffCoachesTable)
      .where(and(eq(kickoffCoachesTable.isActive, true), ne(kickoffCoachesTable.id, kickoffCoachId)));
    const otherActiveCoachIds = otherActiveCoaches.map((c) => c.id);
    if (otherActiveCoachIds.length > 0) {
      await db.update(kickoffCoachesTable).set({ isActive: false }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
    }
    try {
      durationMock.mockImplementationOnce(async () => {
        throw new Error("GHL calendar config unreachable");
      });
      const memberId = await makeMember(3);
      const startTime = gridAlignedFutureTime(53);
      const dateStr = startTime.toISOString().slice(0, 10);

      const avail = await request(app)
        .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
        .set("Cookie", authCookie(memberId));
      expect(avail.status).toBe(502);
    } finally {
      if (otherActiveCoachIds.length > 0) {
        await db.update(kickoffCoachesTable).set({ isActive: true }).where(inArray(kickoffCoachesTable.id, otherActiveCoachIds));
      }
    }
  });
});

// Task #1641: kickoff-coach tiering. LaunchPad members must be routed ONLY
// to LaunchPad-tier coaches (Neil); everyone else keeps the existing
// full-tier round-robin. Cross-tier fallback and silent empty-slot responses
// are both explicitly forbidden by the task — a missing tier coach must
// surface as a loud `setupPending` state instead.
describe("kickoff-coach tiering (Task #1641)", () => {
  const PREFIX = `__kickoff_tier_test__${randomUUID().slice(0, 8)}`;
  let launchpadProductId: number;
  const userProductIds: number[] = [];
  const tierCoachIds: number[] = [];

  async function grantLaunchpad(memberId: number): Promise<void> {
    const [up] = await db
      .insert(userProductsTable)
      .values({ userId: memberId, productId: launchpadProductId, status: "active", expiresAt: null })
      .returning({ id: userProductsTable.id });
    userProductIds.push(up.id);
  }

  beforeAll(async () => {
    const [product] = await db
      .insert(productsTable)
      .values({
        slug: `${PREFIX}-launchpad`,
        name: "Kickoff Tier Test LaunchPad",
        type: "frontend",
        entitlementKeys: ["content:advanced"],
      })
      .returning({ id: productsTable.id });
    launchpadProductId = product.id;
  });

  afterAll(async () => {
    if (userProductIds.length > 0) {
      await db.delete(userProductsTable).where(inArray(userProductsTable.id, userProductIds));
    }
    await db.delete(productsTable).where(eq(productsTable.id, launchpadProductId));
    if (tierCoachIds.length > 0) {
      await db.delete(kickoffCoachesTable).where(inArray(kickoffCoachesTable.id, tierCoachIds));
    }
  });

  // Task #1655: Neil's real launchpad-tier roster row now carries a real,
  // armed GHL calendar ID (it used to be a null placeholder that
  // selectKickoffCoach/listKickoffCoachPool filtered out on its own). These
  // two tests need the launchpad pool scoped to just their own fixture
  // coach(es), so they deactivate every OTHER active launchpad-tier coach
  // (i.e. Neil) for their duration and restore it afterward — same pattern
  // used above for the full-tier "every coach fails" isolation test.
  async function deactivateOtherLaunchpadCoaches(): Promise<number[]> {
    const others = await db
      .select({ id: kickoffCoachesTable.id })
      .from(kickoffCoachesTable)
      .where(and(eq(kickoffCoachesTable.tier, "launchpad"), eq(kickoffCoachesTable.isActive, true)));
    const ids = others.map((c) => c.id);
    if (ids.length > 0) {
      await db.update(kickoffCoachesTable).set({ isActive: false }).where(inArray(kickoffCoachesTable.id, ids));
    }
    return ids;
  }

  async function reactivateLaunchpadCoaches(ids: number[]): Promise<void> {
    if (ids.length > 0) {
      await db.update(kickoffCoachesTable).set({ isActive: true }).where(inArray(kickoffCoachesTable.id, ids));
    }
  }

  it("routes a LaunchPad member only to a launchpad-tier coach, never the full-tier roster", async () => {
    const deactivatedIds = await deactivateOtherLaunchpadCoaches();
    const [launchpadCoach] = await db
      .insert(kickoffCoachesTable)
      .values({
        displayName: `${PREFIX}-launchpad-coach`,
        ghlCalendarId: `${TEST_TAG}-launchpad-cal`,
        isActive: true,
        tier: "launchpad",
      })
      .returning({ id: kickoffCoachesTable.id });

    try {
      const memberId = await makeMember(3);
      await grantLaunchpad(memberId);
      const startTime = gridAlignedFutureTime(60);
      const dateStr = startTime.toISOString().slice(0, 10);

      const avail = await request(app)
        .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
        .set("Cookie", authCookie(memberId));
      expect(avail.status).toBe(200);
      expect(avail.body.setupPending).toBeFalsy();
      expect(avail.body.coaches).toHaveLength(1);
      expect(avail.body.coaches[0].id).toBe(launchpadCoach.id);
      expect(avail.body.slots.every((s: { coachId: number }) => s.coachId === launchpadCoach.id)).toBe(true);

      const book = await request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTime.toISOString(), coachId: launchpadCoach.id });
      expect(book.status).toBe(201);
      bookingIds.push(book.body.booking.id);
      expect(book.body.booking.staffId).toBe(launchpadCoach.id);
    } finally {
      // Scoped to just this test — the next test relies on there being NO
      // launchpad-tier coach in the roster to prove the setupPending path.
      await db.delete(kickoffCoachesTable).where(eq(kickoffCoachesTable.id, launchpadCoach.id));
      await reactivateLaunchpadCoaches(deactivatedIds);
    }
  });

  it("returns setupPending (never a 404, never a fallback to full-tier coaches) when no launchpad-tier coach exists", async () => {
    // The default seeded/test roster is all tier "full" except Neil's real
    // launchpad row — deactivate it for this test so no launchpad-tier row
    // is bookable, proving the explicit setup-pending state.
    const deactivatedIds = await deactivateOtherLaunchpadCoaches();
    try {
      const memberId = await makeMember(3);
      await grantLaunchpad(memberId);
      const startTime = gridAlignedFutureTime(61);
      const dateStr = startTime.toISOString().slice(0, 10);

      const avail = await request(app)
        .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
        .set("Cookie", authCookie(memberId));
      expect(avail.status).toBe(200);
      expect(avail.body.setupPending).toBe(true);
      expect(avail.body.coaches).toEqual([]);
      expect(avail.body.slots).toEqual([]);

      const book = await request(app)
        .post("/api/onboarding/kickoff/book")
        .set("Cookie", authCookie(memberId))
        .send({ startTime: startTime.toISOString(), coachId: 99999999 });
      expect(book.status).toBe(200);
      expect(book.body.setupPending).toBe(true);

      const rows = await db
        .select({ id: callBookingsTable.id })
        .from(callBookingsTable)
        .where(and(eq(callBookingsTable.memberId, memberId), eq(callBookingsTable.type, "kickoff")));
      expect(rows.length).toBe(0);
    } finally {
      await reactivateLaunchpadCoaches(deactivatedIds);
    }
  });

  it("a full-tier (non-LaunchPad) member is never routed to a launchpad-tier coach even when one exists", async () => {
    const [launchpadCoach] = await db
      .insert(kickoffCoachesTable)
      .values({
        displayName: `${PREFIX}-launchpad-coach-2`,
        ghlCalendarId: `${TEST_TAG}-launchpad-cal-2`,
        isActive: true,
        tier: "launchpad",
      })
      .returning({ id: kickoffCoachesTable.id });
    tierCoachIds.push(launchpadCoach.id);

    const memberId = await makeMember(3); // no product grant -> "free" -> full tier
    const startTime = gridAlignedFutureTime(62);

    const book = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
    expect(book.status).toBe(201);
    bookingIds.push(book.body.booking.id);
    expect(book.body.booking.staffId).not.toBe(launchpadCoach.id);
  });
});

// Task #1688/#1696: the persistent sidebar "next call" panel must find ALL of
// a member's upcoming booked calls (chronological), across BOTH kickoff and
// partner types, independent of partner assignment — a LaunchPad member with
// a booked kickoff call and NO partner assignment must still get a result
// here, and a member with both a kickoff and partner call booked gets both.
describe("GET /call-bookings/next", () => {
  it("returns an empty list when the member has no upcoming booked call and no partner assignment", async () => {
    const memberId = await makeMember(6, true);

    const res = await request(app)
      .get("/api/call-bookings/next")
      .set("Cookie", authCookie(memberId));

    expect(res.status).toBe(200);
    expect(res.body.calls).toEqual([]);
  });

  it("returns an upcoming kickoff call for a member with no partner assignment (LaunchPad case)", async () => {
    const memberId = await makeMember(5, true);
    const scheduledAt = gridAlignedFutureTime(10);
    await seedPartnerBooking({
      memberId,
      pId: kickoffCoachId,
      scheduledAt,
      type: "kickoff",
    });

    const res = await request(app)
      .get("/api/call-bookings/next")
      .set("Cookie", authCookie(memberId));

    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].type).toBe("kickoff");
    expect(res.body.calls[0].staff.displayName).toBe("Kickoff Coach Test");
    expect(new Date(res.body.calls[0].scheduledAt).getTime()).toBe(scheduledAt.getTime());
  });

  it("returns an upcoming partner call for an assigned member", async () => {
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, partnerId);
    const scheduledAt = gridAlignedFutureTime(11);
    await seedPartnerBooking({
      memberId,
      pId: partnerId,
      scheduledAt,
      type: "partner",
    });

    const res = await request(app)
      .get("/api/call-bookings/next")
      .set("Cookie", authCookie(memberId));

    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].type).toBe("partner");
    expect(res.body.calls[0].staff.displayName).toBe("Cap Test Partner");
  });

  it("returns every upcoming call in chronological order and ignores past/canceled ones", async () => {
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, partnerId);
    const soon = gridAlignedFutureTime(3);
    const later = gridAlignedFutureTime(20);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await seedPartnerBooking({ memberId, pId: partnerId, scheduledAt: later, type: "partner" });
    await seedPartnerBooking({ memberId, pId: kickoffCoachId, scheduledAt: soon, type: "kickoff" });
    await seedPartnerBooking({ memberId, pId: partnerId, scheduledAt: past, type: "partner" });
    await seedPartnerBooking({
      memberId,
      pId: partnerId,
      scheduledAt: gridAlignedFutureTime(1),
      type: "partner",
      status: "canceled",
    });

    const res = await request(app)
      .get("/api/call-bookings/next")
      .set("Cookie", authCookie(memberId));

    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(2);
    expect(res.body.calls[0].type).toBe("kickoff");
    expect(new Date(res.body.calls[0].scheduledAt).getTime()).toBe(soon.getTime());
    expect(res.body.calls[1].type).toBe("partner");
    expect(new Date(res.body.calls[1].scheduledAt).getTime()).toBe(later.getTime());
  });

  it("does not leak internal GHL fields to the member-facing response", async () => {
    const memberId = await makeMember(6, true);
    await seedPartnerBooking({
      memberId,
      pId: kickoffCoachId,
      scheduledAt: gridAlignedFutureTime(15),
      type: "kickoff",
    });

    const res = await request(app)
      .get("/api/call-bookings/next")
      .set("Cookie", authCookie(memberId));

    expect(res.body.calls[0]).not.toHaveProperty("ghlCalendarId");
    expect(res.body.calls[0]).not.toHaveProperty("ghlAppointmentId");
  });
});

// ===========================================================================
// Task #1723: member-level booking conflict guard (no overlapping own calls)
// ===========================================================================
// Rule: a candidate slot is blocked when its interval [start, start+duration]
// intersects or has a gap of < 30 minutes from any of the member's OTHER
// upcoming booked calls' intervals.  Tests cover:
//   - overlap excluded both directions (kickoff booked first / partner first)
//   - 29-min gap blocked, 31-min gap allowed (boundary)
//   - same-day non-overlapping allowed
//   - reschedule self-exclusion (re-picking own time never self-blocks)
//   - server rejection of a crafted conflicting booking (the server gate)
// ---------------------------------------------------------------------------

// 30-minute mock duration matches DEFAULT_CALENDAR_DURATION_MINUTES.
// Helper: returns a slot time N minutes after a reference, grid-aligned.
function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

describe("member conflict guard: offer-time filtering", () => {
  it("hides kickoff slots that conflict with an existing booked partner call", async () => {
    // Member has a partner call booked at T+50 days.  Kickoff slots that
    // overlap or come within 30 minutes of that call should be hidden.
    const memberId = await makeMember(3);
    const partnerCallStart = gridAlignedFutureTime(50);
    // Seed a partner booking for this member (staffId is partnerId — polymorphic, fine for seeding)
    await seedPartnerBooking({
      memberId,
      pId: partnerId,
      scheduledAt: partnerCallStart,
      type: "partner",
    });

    const dateStr = partnerCallStart.toISOString().slice(0, 10);
    const avail = await request(app)
      .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
      .set("Cookie", authCookie(memberId));
    expect(avail.status).toBe(200);

    // The slot AT the partner call's start time must be absent (direct overlap).
    const conflict = avail.body.slots.find(
      (s: { startTime: string }) => new Date(s.startTime).getTime() === partnerCallStart.getTime(),
    );
    expect(conflict).toBeUndefined();

    // A slot starting 29 minutes before the partner call ends (partner call
    // is 30 min so ends at T+30min) should also be absent — its 30-min
    // duration would overlap the partner call interval.
    const partnerCallEndMs = partnerCallStart.getTime() + DEFAULT_CALENDAR_DURATION_MINUTES * 60_000;
    // slot that starts 1 min before partner call end — overlaps
    const nearConflict = new Date(partnerCallEndMs - 60_000);
    const nearConflictSlot = avail.body.slots.find(
      (s: { startTime: string }) => new Date(s.startTime).getTime() === nearConflict.getTime(),
    );
    expect(nearConflictSlot).toBeUndefined();
  });

  it("hides partner slots that conflict with an existing booked kickoff call", async () => {
    const memberId = await makeMember(5, true);
    await assignPartner(memberId, partnerId);

    const kickoffStart = gridAlignedFutureTime(60);
    await seedPartnerBooking({
      memberId,
      pId: kickoffCoachId,
      scheduledAt: kickoffStart,
      type: "kickoff",
      staffType: "kickoff_coach",
    });

    const dateStr = kickoffStart.toISOString().slice(0, 10);
    const avail = await request(app)
      .get(`/api/onboarding/partner/availability?startDate=${dateStr}&endDate=${dateStr}`)
      .set("Cookie", authCookie(memberId));
    expect(avail.status).toBe(200);

    // The slot AT the kickoff start must be absent (direct overlap).
    const direct = avail.body.slots.find(
      (s: { startTime: string }) => new Date(s.startTime).getTime() === kickoffStart.getTime(),
    );
    expect(direct).toBeUndefined();
  });

  it("allows same-day non-overlapping slots (31+ min gap)", async () => {
    // The partner call ends at T+30min.  A slot starting at T+61min (31 min
    // after end) must NOT be blocked.
    const memberId = await makeMember(5, true);
    await assignPartner(memberId, partnerId);

    const partnerCallStart = gridAlignedFutureTime(70);
    await seedPartnerBooking({ memberId, pId: partnerId, scheduledAt: partnerCallStart, type: "partner" });

    // Slot 31 minutes after the partner call ends (call is 30 min → ends at T+30min)
    const safeSlotMs =
      partnerCallStart.getTime() +
      DEFAULT_CALENDAR_DURATION_MINUTES * 60_000 +
      31 * 60_000;
    const safeSlot = new Date(Math.ceil(safeSlotMs / SLOT_STEP_MS) * SLOT_STEP_MS);

    const dateStr = safeSlot.toISOString().slice(0, 10);
    const avail = await request(app)
      .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
      .set("Cookie", authCookie(memberId));
    expect(avail.status).toBe(200);

    const found = avail.body.slots.find(
      (s: { startTime: string }) => new Date(s.startTime).getTime() === safeSlot.getTime(),
    );
    expect(found).toBeDefined();
  });

  it("blocks a slot with a 29-minute gap but allows a slot with a 31-minute gap (buffer boundary)", async () => {
    // Kickoff call: 30-min duration at kickoffStart.
    // Ends at kickoffStart + 30min.
    // 29-min-gap slot starts at kickoffStart + 30min + 29min = kickoffStart + 59min  → BLOCKED
    // 31-min-gap slot starts at kickoffStart + 30min + 31min = kickoffStart + 61min  → ALLOWED
    const memberId = await makeMember(5, true);
    await assignPartner(memberId, kickoffPartnerId);

    const kickoffStart = gridAlignedFutureTime(80);
    await seedPartnerBooking({
      memberId,
      pId: kickoffCoachId,
      scheduledAt: kickoffStart,
      type: "kickoff",
      staffType: "kickoff_coach",
    });

    const durationMs = DEFAULT_CALENDAR_DURATION_MINUTES * 60_000;
    const kickoffEndMs = kickoffStart.getTime() + durationMs;
    const gap29Ms = kickoffEndMs + 29 * 60_000;
    const gap31Ms = kickoffEndMs + 31 * 60_000;

    // Use a date covering both candidates
    const dateStr = kickoffStart.toISOString().slice(0, 10);
    const avail = await request(app)
      .get(`/api/onboarding/partner/availability?startDate=${dateStr}&endDate=${dateStr}`)
      .set("Cookie", authCookie(memberId));
    expect(avail.status).toBe(200);

    const blocked = avail.body.slots.find(
      (s: { startTime: string }) => new Date(s.startTime).getTime() === gap29Ms,
    );
    expect(blocked).toBeUndefined();

    // Grid-align the 31-min slot (may not land exactly on a grid mark)
    const allowed31 = new Date(Math.ceil(gap31Ms / SLOT_STEP_MS) * SLOT_STEP_MS);
    const allowed = avail.body.slots.find(
      (s: { startTime: string }) =>
        new Date(s.startTime).getTime() >= allowed31.getTime() - 60_000 &&
        new Date(s.startTime).getTime() <= allowed31.getTime() + 60_000,
    );
    expect(allowed).toBeDefined();
  });

  it("reschedule excludeBookingId prevents the booking's own slot from being filtered", async () => {
    // Member has a kickoff call at T+90 days.  Without excludeBookingId,
    // that slot would appear conflicting against itself and be hidden from
    // the reschedule availability grid.  With excludeBookingId, it should
    // remain visible.
    const memberId = await makeMember(4);
    const kickoffStart = gridAlignedFutureTime(90);
    const bookingId = await seedPartnerBooking({
      memberId,
      pId: kickoffCoachId,
      scheduledAt: kickoffStart,
      type: "kickoff",
      staffType: "kickoff_coach",
    });

    const dateStr = kickoffStart.toISOString().slice(0, 10);

    // Without excludeBookingId: slot is hidden (conflicts with itself)
    const withoutExclude = await request(app)
      .get(`/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}`)
      .set("Cookie", authCookie(memberId));
    expect(withoutExclude.status).toBe(200);
    const hiddenSlot = withoutExclude.body.slots.find(
      (s: { startTime: string }) => new Date(s.startTime).getTime() === kickoffStart.getTime(),
    );
    expect(hiddenSlot).toBeUndefined();

    // With excludeBookingId: slot is visible again
    const withExclude = await request(app)
      .get(
        `/api/onboarding/kickoff/availability?startDate=${dateStr}&endDate=${dateStr}&excludeBookingId=${bookingId}`,
      )
      .set("Cookie", authCookie(memberId));
    expect(withExclude.status).toBe(200);
    const visibleSlot = withExclude.body.slots.find(
      (s: { startTime: string }) => new Date(s.startTime).getTime() === kickoffStart.getTime(),
    );
    expect(visibleSlot).toBeDefined();
  });
});

describe("member conflict guard: server-side gate on booking", () => {
  it("rejects a crafted partner book that directly overlaps an existing kickoff call (409 + conflict message)", async () => {
    // Early pre-check in partner/book fires BEFORE offer-time filter, so
    // a crafted direct request returns the conflict-specific message.
    const memberId = await makeMember(4);
    await assignPartner(memberId, kickoffPartnerId);

    const kickoffStart = gridAlignedFutureTime(100);
    await seedPartnerBooking({
      memberId,
      pId: kickoffCoachId,
      scheduledAt: kickoffStart,
      type: "kickoff",
      staffType: "kickoff_coach",
    });

    // Attempt to book a partner call AT the exact same time as the kickoff.
    const attempt = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: kickoffStart.toISOString() });
    expect(attempt.status).toBe(409);
    expect(attempt.body.error).toMatch(/conflicts/i);
  });

  it("rejects a crafted kickoff book that directly overlaps an existing partner call (409)", async () => {
    // Offer-time filter excludes the conflicting slot; result is still 409.
    const memberId = await makeMember(3);

    const partnerStart = gridAlignedFutureTime(110);
    await seedPartnerBooking({ memberId, pId: partnerId, scheduledAt: partnerStart, type: "partner" });

    const attempt = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: partnerStart.toISOString(), coachId: kickoffCoachId });
    expect(attempt.status).toBe(409);
  });

  it("rejects a partner reschedule that would conflict with the member's other booked call (409)", async () => {
    // Layout (all grid-aligned, 30-min mock duration):
    //   partnerStart      = T+120d           (the existing partner booking)
    //   kickoffStart      = T+120d + 60min   (30-min gap from partner end = boundary = allowed initially)
    //   conflictingTarget = T+120d + 30min   (0-min gap before kickoff start = blocked)
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, kickoffPartnerId);

    const partnerStart = gridAlignedFutureTime(120);
    const partnerBook = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: partnerStart.toISOString() });
    expect(partnerBook.status).toBe(201);
    const partnerBookingId = partnerBook.body.booking.id;
    bookingIds.push(partnerBookingId);

    // Kickoff at partnerStart + 2*SLOT_STEP_MS (60min later) — non-conflicting
    // with the original partner slot (30-min gap = boundary = allowed).
    const kickoffStart = new Date(partnerStart.getTime() + 2 * SLOT_STEP_MS);
    await seedPartnerBooking({
      memberId,
      pId: kickoffCoachId,
      scheduledAt: kickoffStart,
      type: "kickoff",
      staffType: "kickoff_coach",
    });

    // Try to reschedule the partner call to partnerStart+SLOT_STEP_MS
    // (= kickoffStart - 30min = 0 gap → blocked).  This IS a grid-aligned
    // slot so the raw GHL recheck finds it, and the in-transaction conflict
    // gate fires with the correct 409 + "conflicts" message.
    const conflictingTarget = new Date(partnerStart.getTime() + SLOT_STEP_MS);
    const reschedule = await request(app)
      .patch(`/api/onboarding/partner/${partnerBookingId}/reschedule`)
      .set("Cookie", authCookie(memberId))
      .send({ startTime: conflictingTarget.toISOString() });
    expect(reschedule.status).toBe(409);
    expect(reschedule.body.error).toMatch(/conflicts/i);
  });

  it("allows a partner reschedule to the same time slot (self-exclusion)", async () => {
    const memberId = await makeMember(6, true);
    await assignPartner(memberId, kickoffPartnerId);

    // Member books a kickoff call (anchor conflict if self-exclusion is broken).
    const kickoffStart = gridAlignedFutureTime(130);
    await seedPartnerBooking({
      memberId,
      pId: kickoffCoachId,
      scheduledAt: kickoffStart,
      type: "kickoff",
      staffType: "kickoff_coach",
    });

    // Book a partner call 2 hours after the kickoff (non-conflicting).
    const partnerStart = minutesAfter(kickoffStart, DEFAULT_CALENDAR_DURATION_MINUTES + 90);
    const partnerBook = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: partnerStart.toISOString() });
    expect(partnerBook.status).toBe(201);
    const partnerBookingId = partnerBook.body.booking.id;
    bookingIds.push(partnerBookingId);

    // Reschedule to the SAME time slot — self-exclusion means this is NOT a
    // conflict and must succeed (status 200).
    const reschedule = await request(app)
      .patch(`/api/onboarding/partner/${partnerBookingId}/reschedule`)
      .set("Cookie", authCookie(memberId))
      .send({ startTime: partnerStart.toISOString() });
    expect(reschedule.status).toBe(200);
    bookingIds.push(reschedule.body.booking.id);
  });
});
