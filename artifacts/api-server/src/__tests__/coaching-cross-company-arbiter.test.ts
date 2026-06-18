import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  sessionPackBookingsTable,
  sessionPackCoachesTable,
  coachingCreditLedgerTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Cross-company coaching arbiter. A coach can be booked in two companies (the
// BTS portal + the legacy Cherrington GHL widget). To stop double-booking, a
// coach may be given a "Conflict calendar" (the other company's calendar). When
// set, the portal (1) only offers times the coach is free in BOTH companies and
// (2) mirrors every BTS booking as a busy block onto the Conflict calendar,
// removing it on cancel. With no Conflict calendar the flow behaves as before.

const ghl = vi.hoisted(() => {
  const freeSlotsByCalendar = new Map<string, string[]>();
  let blockSeq = 0;
  let apptSeq = 0;
  return {
    freeSlotsByCalendar,
    getFreeSlots: vi.fn(async (calendarId: string) =>
      (freeSlotsByCalendar.get(calendarId) ?? []).map((startTime) => ({ startTime })),
    ),
    upsertContact: vi.fn(async () => "contact_test"),
    createAppointment: vi.fn(async (input: { startTime: string; endTime: string }) => ({
      id: `appt_${++apptSeq}`,
      meetLink: "https://meet.google.com/arb-test",
      startTime: input.startTime,
      endTime: input.endTime,
      status: "confirmed",
    })),
    updateAppointment: vi.fn(async (input: { eventId: string; startTime: string; endTime: string }) => ({
      id: input.eventId,
      meetLink: "https://meet.google.com/arb-test",
      startTime: input.startTime,
      endTime: input.endTime,
      status: "confirmed",
    })),
    cancelAppointment: vi.fn(async () => undefined),
    createAppointmentNote: vi.fn(async () => undefined),
    createBlockSlot: vi.fn(async () => ({ id: `block_${++blockSeq}` })),
    deleteBlockSlot: vi.fn(async () => undefined),
  };
});

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));
vi.mock("../lib/ghl-coaching-calendar", () => ({
  COACHING_LOCATION_ID: "loc_legacy",
  COACHING_TIMEZONE: "America/New_York",
  getFreeSlots: ghl.getFreeSlots,
  upsertContact: ghl.upsertContact,
  createAppointment: ghl.createAppointment,
  updateAppointment: ghl.updateAppointment,
  cancelAppointment: ghl.cancelAppointment,
  createAppointmentNote: ghl.createAppointmentNote,
  createBlockSlot: ghl.createBlockSlot,
  deleteBlockSlot: ghl.deleteBlockSlot,
}));
// Google calendar-busy is a separate endpoint we don't exercise here; stub the
// modules so the router loads without pulling in the real Google clients.
vi.mock("../lib/google-oauth", () => ({
  fetchCalendarBusy: vi.fn(async () => []),
  CalendarScopeError: class CalendarScopeError extends Error {},
}));
vi.mock("../lib/coach-google-connections", () => ({
  getAccessTokenForUser: vi.fn(async () => null),
}));

import { buildTestAppWithRouters } from "./test-app";
import coachingSessionsRouter from "../routes/coaching-sessions";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `arbiter-${randomUUID().slice(0, 8)}`;

// Calendars for the two coaches under test.
const BTS_CAL = `${TAG}-bts-cal`;
const BTS_LOC = `${TAG}-bts-loc`;
const CONFLICT_CAL = `${TAG}-cher-cal`;
const CONFLICT_LOC = `${TAG}-cher-loc`;
const SOLO_CAL = `${TAG}-solo-cal`;
const SOLO_LOC = `${TAG}-solo-loc`;

// Three candidate slots ~14 days out (well past the 1-hour lead-time cutoff).
const base = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
base.setUTCMinutes(0, 0, 0);
const T1 = new Date(base.getTime()).toISOString();
const T2 = new Date(base.getTime() + 60 * 60 * 1000).toISOString();
const T3 = new Date(base.getTime() + 2 * 60 * 60 * 1000).toISOString();

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie: string;
let memberId: number;
let conflictCoachId: number;
let soloCoachId: number;
const userIds: number[] = [];
const coachIds: number[] = [];
const bookingIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function grantCredit(): Promise<void> {
  await db.insert(coachingCreditLedgerTable).values({
    memberId,
    delta: 1,
    reason: "admin_grant",
  });
}

beforeAll(async () => {
  app = buildTestAppWithRouters([coachingSessionsRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-member@example.test`,
      name: "Arb Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  memberId = member.id;
  userIds.push(member.id);
  memberCookie = signCookie(member.id, `${TAG}-member@example.test`);

  const [conflictCoach] = await db
    .insert(sessionPackCoachesTable)
    .values({
      name: "Cross-company coach",
      isActive: true,
      doesPrivateCoaching: true,
      ghlCalendarId: BTS_CAL,
      ghlLocationId: BTS_LOC,
      conflictGhlCalendarId: CONFLICT_CAL,
      conflictGhlLocationId: CONFLICT_LOC,
    })
    .returning({ id: sessionPackCoachesTable.id });
  conflictCoachId = conflictCoach.id;
  coachIds.push(conflictCoach.id);

  const [soloCoach] = await db
    .insert(sessionPackCoachesTable)
    .values({
      name: "Single-company coach",
      isActive: true,
      doesPrivateCoaching: true,
      ghlCalendarId: SOLO_CAL,
      ghlLocationId: SOLO_LOC,
    })
    .returning({ id: sessionPackCoachesTable.id });
  soloCoachId = soloCoach.id;
  coachIds.push(soloCoach.id);
});

afterAll(async () => {
  if (bookingIds.length > 0) {
    await db
      .delete(coachingCreditLedgerTable)
      .where(inArray(coachingCreditLedgerTable.bookingId, bookingIds));
  }
  await db.delete(coachingCreditLedgerTable).where(eq(coachingCreditLedgerTable.memberId, memberId));
  if (bookingIds.length > 0) {
    await db
      .delete(sessionPackBookingsTable)
      .where(inArray(sessionPackBookingsTable.id, bookingIds));
  }
  if (coachIds.length > 0) {
    await db
      .delete(sessionPackCoachesTable)
      .where(inArray(sessionPackCoachesTable.id, coachIds));
  }
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  ghl.freeSlotsByCalendar.clear();
});

async function readBlockEventId(bookingId: number): Promise<string | null> {
  const [row] = await db
    .select({ conflictBlockEventId: sessionPackBookingsTable.conflictBlockEventId })
    .from(sessionPackBookingsTable)
    .where(eq(sessionPackBookingsTable.id, bookingId));
  return row?.conflictBlockEventId ?? null;
}

describe("cross-company arbiter — slot intersection", () => {
  it("only offers times the coach is free in BOTH companies", async () => {
    ghl.freeSlotsByCalendar.set(BTS_CAL, [T1, T2, T3]);
    ghl.freeSlotsByCalendar.set(CONFLICT_CAL, [T2, T3]); // T1 taken in the other company

    const res = await request(app)
      .get(`/api/coaching/sessions/coaches/${conflictCoachId}/slots`)
      .set("Cookie", memberCookie);

    expect(res.status).toBe(200);
    const starts = (res.body.slots as { startTime: string }[]).map((s) => s.startTime);
    expect(starts).toEqual([T2, T3]);
    expect(starts).not.toContain(T1);
  });

  it("returns single-calendar slots unchanged when no conflict calendar is set", async () => {
    ghl.freeSlotsByCalendar.set(SOLO_CAL, [T1, T2]);

    const res = await request(app)
      .get(`/api/coaching/sessions/coaches/${soloCoachId}/slots`)
      .set("Cookie", memberCookie);

    expect(res.status).toBe(200);
    const starts = (res.body.slots as { startTime: string }[]).map((s) => s.startTime);
    expect(starts).toEqual([T1, T2]);
    // The conflict calendar is never read for a coach without one.
    expect(ghl.getFreeSlots).not.toHaveBeenCalledWith(
      CONFLICT_CAL,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("cross-company arbiter — booking mirrors a conflict block", () => {
  it("writes a busy block onto the conflict calendar and stores its id", async () => {
    ghl.freeSlotsByCalendar.set(BTS_CAL, [T2]);
    ghl.freeSlotsByCalendar.set(CONFLICT_CAL, [T2]);
    await grantCredit();

    const res = await request(app)
      .post("/api/coaching/sessions/book")
      .set("Cookie", memberCookie)
      .send({ coachId: conflictCoachId, startTime: T2 });

    expect(res.status).toBe(201);
    bookingIds.push(res.body.booking.id);

    // Appointment booked on the BTS calendar/location...
    expect(ghl.createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: BTS_CAL, locationId: BTS_LOC, startTime: T2 }),
    );
    // ...and a busy block mirrored onto the conflict calendar/location.
    expect(ghl.createBlockSlot).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: CONFLICT_CAL, locationId: CONFLICT_LOC, startTime: T2 }),
    );

    const stored = await readBlockEventId(res.body.booking.id);
    expect(stored).toMatch(/^block_/);
  });

  it("does NOT create a block for a coach with no conflict calendar", async () => {
    ghl.freeSlotsByCalendar.set(SOLO_CAL, [T3]);
    await grantCredit();

    const res = await request(app)
      .post("/api/coaching/sessions/book")
      .set("Cookie", memberCookie)
      .send({ coachId: soloCoachId, startTime: T3 });

    expect(res.status).toBe(201);
    bookingIds.push(res.body.booking.id);

    expect(ghl.createBlockSlot).not.toHaveBeenCalled();
    const stored = await readBlockEventId(res.body.booking.id);
    expect(stored).toBeNull();
  });
});

describe("cross-company arbiter — cancel removes the conflict block", () => {
  it("deletes the mirrored block from the conflict calendar on cancel", async () => {
    ghl.freeSlotsByCalendar.set(BTS_CAL, [T2]);
    ghl.freeSlotsByCalendar.set(CONFLICT_CAL, [T2]);
    await grantCredit();

    const bookRes = await request(app)
      .post("/api/coaching/sessions/book")
      .set("Cookie", memberCookie)
      .send({ coachId: conflictCoachId, startTime: T2 });
    expect(bookRes.status).toBe(201);
    const bookingId = bookRes.body.booking.id;
    bookingIds.push(bookingId);
    const blockId = await readBlockEventId(bookingId);
    expect(blockId).toBeTruthy();

    const cancelRes = await request(app)
      .patch(`/api/coaching/sessions/${bookingId}/cancel`)
      .set("Cookie", memberCookie);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.ok).toBe(true);
    expect(ghl.cancelAppointment).toHaveBeenCalledTimes(1);
    expect(ghl.deleteBlockSlot).toHaveBeenCalledWith(blockId, CONFLICT_LOC);
  });

  it("still cancels (no divergence) when the conflict-block delete fails", async () => {
    ghl.freeSlotsByCalendar.set(BTS_CAL, [T2]);
    ghl.freeSlotsByCalendar.set(CONFLICT_CAL, [T2]);
    await grantCredit();

    const bookRes = await request(app)
      .post("/api/coaching/sessions/book")
      .set("Cookie", memberCookie)
      .send({ coachId: conflictCoachId, startTime: T2 });
    expect(bookRes.status).toBe(201);
    const bookingId = bookRes.body.booking.id;
    bookingIds.push(bookingId);

    // The appointment cancel succeeds but the mirror-block delete throws. The
    // cancellation must still commit — the GHL appointment is already gone, so
    // rolling back here would leave the DB "booked" with no appointment.
    ghl.deleteBlockSlot.mockRejectedValueOnce(new Error("GHL down"));

    const cancelRes = await request(app)
      .patch(`/api/coaching/sessions/${bookingId}/cancel`)
      .set("Cookie", memberCookie);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.ok).toBe(true);
    expect(ghl.cancelAppointment).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select({ status: sessionPackBookingsTable.status })
      .from(sessionPackBookingsTable)
      .where(eq(sessionPackBookingsTable.id, bookingId));
    expect(row.status).toBe("cancelled");
  });
});

describe("cross-company arbiter — reschedule moves the conflict block", () => {
  it("moves the block to the new time and persists the new id", async () => {
    ghl.freeSlotsByCalendar.set(BTS_CAL, [T1, T3]);
    ghl.freeSlotsByCalendar.set(CONFLICT_CAL, [T1, T3]);
    await grantCredit();

    const bookRes = await request(app)
      .post("/api/coaching/sessions/book")
      .set("Cookie", memberCookie)
      .send({ coachId: conflictCoachId, startTime: T1 });
    expect(bookRes.status).toBe(201);
    const bookingId = bookRes.body.booking.id;
    bookingIds.push(bookingId);
    const oldBlockId = await readBlockEventId(bookingId);

    const res = await request(app)
      .patch(`/api/coaching/sessions/${bookingId}/reschedule`)
      .set("Cookie", memberCookie)
      .send({ startTime: T3 });

    expect(res.status).toBe(200);
    expect(ghl.updateAppointment).toHaveBeenCalledTimes(1);
    // New hold created on the conflict calendar, old hold removed.
    expect(ghl.createBlockSlot).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: CONFLICT_CAL, locationId: CONFLICT_LOC, startTime: T3 }),
    );
    expect(ghl.deleteBlockSlot).toHaveBeenCalledWith(oldBlockId, CONFLICT_LOC);

    const newBlockId = await readBlockEventId(bookingId);
    expect(newBlockId).toMatch(/^block_/);
    expect(newBlockId).not.toBe(oldBlockId);

    // Restore so the booking can be cleaned up; cancel for tidiness.
    await request(app)
      .patch(`/api/coaching/sessions/${bookingId}/cancel`)
      .set("Cookie", memberCookie);
  });

  it("still reschedules (no divergence) when the new block create fails, keeping the old hold", async () => {
    ghl.freeSlotsByCalendar.set(BTS_CAL, [T1, T3]);
    ghl.freeSlotsByCalendar.set(CONFLICT_CAL, [T1, T3]);
    await grantCredit();

    const bookRes = await request(app)
      .post("/api/coaching/sessions/book")
      .set("Cookie", memberCookie)
      .send({ coachId: conflictCoachId, startTime: T1 });
    expect(bookRes.status).toBe(201);
    const bookingId = bookRes.body.booking.id;
    bookingIds.push(bookingId);
    const oldBlockId = await readBlockEventId(bookingId);

    // The appointment moves in GHL but the new mirror-block create throws. The
    // reschedule must still commit (DB time tracks the moved appointment) and
    // keep the old block id rather than rolling back to a divergent state.
    ghl.createBlockSlot.mockRejectedValueOnce(new Error("GHL down"));

    const res = await request(app)
      .patch(`/api/coaching/sessions/${bookingId}/reschedule`)
      .set("Cookie", memberCookie)
      .send({ startTime: T3 });

    expect(res.status).toBe(200);
    expect(ghl.updateAppointment).toHaveBeenCalledTimes(1);
    // Old hold left in place (not deleted) since the new one was never created.
    expect(ghl.deleteBlockSlot).not.toHaveBeenCalled();

    const [row] = await db
      .select({
        scheduledAt: sessionPackBookingsTable.scheduledAt,
        conflictBlockEventId: sessionPackBookingsTable.conflictBlockEventId,
      })
      .from(sessionPackBookingsTable)
      .where(eq(sessionPackBookingsTable.id, bookingId));
    expect(row.scheduledAt.getTime()).toBe(new Date(T3).getTime());
    expect(row.conflictBlockEventId).toBe(oldBlockId);

    await request(app)
      .patch(`/api/coaching/sessions/${bookingId}/cancel`)
      .set("Cookie", memberCookie);
  });
});
