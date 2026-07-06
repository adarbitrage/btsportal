import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
import { inArray, eq } from "drizzle-orm";

// Task #1714 step 4: each of the 6 booking-lifecycle emails (kickoff/partner
// x confirmation/reschedule/cancel) must fire exactly once per real event,
// carry the right staff person-block, and NEVER fire when the underlying GHL
// operation failed. Mirrors the mocking strategy used by
// scheduled-comms-call-booking-reminders.test.ts: mock CommunicationService +
// comms-dedup so this suite exercises only the call-bookings route wiring.
const { queueEmailMock, checkAndRecordSendMock, sentKeys } = vi.hoisted(() => {
  const sentKeys = new Set<string>();
  return {
    sentKeys,
    queueEmailMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
    checkAndRecordSendMock: vi.fn(async (sendKey: string, _channel: string) => {
      if (sentKeys.has(sendKey)) return "duplicate";
      sentKeys.add(sendKey);
      return "recorded";
    }),
  };
});

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
  },
}));

vi.mock("../lib/comms-dedup", () => ({
  checkAndRecordSend: checkAndRecordSendMock,
  wasSent: vi.fn(async () => false),
}));

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
  getCalendarDurationMinutes: vi.fn(async (_calendarId: string) => 30),
  COACHING_TIMEZONE: "America/Chicago",
  COACHING_LOCATION_ID: "loc_test",
}));

import { buildTestApp } from "./test-app";
import callBookingsRouter from "../routes/call-bookings";
import { generateAccessToken } from "../middleware/auth";
import * as ghlCoachingCalendar from "../lib/ghl-coaching-calendar";

const TAG = `call-bookings-lifecycle-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestApp>;
let kickoffCoachId = 0;
let partnerId = 0;

const userIds: number[] = [];
const assignmentIds: number[] = [];

async function makeMember(): Promise<number> {
  const email = `${TAG}-${randomUUID().slice(0, 8)}@example.test`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Lifecycle Email Member",
      passwordHash: await bcrypt.hash("irrelevant", 4),
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      onboardingStep: 6,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

function authCookie(userId: number): string[] {
  return [`access_token=${generateAccessToken(userId, `${userId}@example.test`)}`];
}

async function assignPartner(memberId: number): Promise<void> {
  const [row] = await db
    .insert(partnerAssignmentsTable)
    .values({ memberId, partnerId, status: "active" })
    .returning({ id: partnerAssignmentsTable.id });
  assignmentIds.push(row.id);
}

function emailCallsFor(templateSlug: string) {
  return queueEmailMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as { templateSlug: string };
    return arg.templateSlug === templateSlug;
  });
}

// Every lifecycle email fires via `void sendCallBookingLifecycleEmail(...)`
// AFTER the route already sent its response — real (non-mocked) DB queries
// for the member/coach lookups run in that fire-and-forget tail, so a bare
// `setTimeout(r, 0)` flush can resolve the test assertion before those
// queries land, causing intermittent false negatives. Poll instead of
// assuming a single macrotask tick is always enough.
async function waitForEmailCount(templateSlug: string, expectedAtLeast: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (emailCallsFor(templateSlug).length < expectedAtLeast) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeAll(async () => {
  app = buildTestApp({ routers: [callBookingsRouter] });

  const [coach] = await db
    .insert(kickoffCoachesTable)
    .values({
      displayName: "Lifecycle Kickoff Coach",
      photoUrl: "https://cdn.example.test/coach.png",
      bio: "Been coaching for years.",
      ghlCalendarId: `${TAG}-kickoff-cal`,
      isActive: true,
    })
    .returning({ id: kickoffCoachesTable.id });
  kickoffCoachId = coach.id;

  const [partner] = await db
    .insert(partnersTable)
    .values({
      displayName: "Lifecycle Partner",
      photoUrl: "https://cdn.example.test/partner.png",
      bio: "Great accountability partner.",
      ghlCalendarId: `${TAG}-partner-cal`,
      isActive: true,
      maxDailyCalls: 5,
    })
    .returning({ id: partnersTable.id });
  partnerId = partner.id;
});

afterAll(async () => {
  if (userIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.memberId, userIds));
  }
  if (assignmentIds.length > 0) {
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.id, assignmentIds));
  }
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  await db.delete(kickoffCoachesTable).where(eq(kickoffCoachesTable.id, kickoffCoachId));
  await db.delete(partnersTable).where(eq(partnersTable.id, partnerId));
});

beforeEach(() => {
  queueEmailMock.mockClear();
  checkAndRecordSendMock.mockClear();
  sentKeys.clear();
});

describe("kickoff_call_confirmation email", () => {
  it("sends exactly once on booking, with the coach's person-block + meeting link", async () => {
    const memberId = await makeMember();
    const startTime = gridAlignedFutureTime(5);

    const res = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
    expect(res.status).toBe(201);

    // Fire-and-forget: poll instead of a bare tick, since the tail is real
    // (unmocked) DB queries.
    await waitForEmailCount("kickoff_call_confirmation", 1);

    const calls = emailCallsFor("kickoff_call_confirmation");
    expect(calls.length).toBe(1);
    const [args] = calls[0] as [{ to: string; variables: Record<string, string> }];
    expect(args.variables.person_block_html).toContain("Lifecycle Kickoff Coach");
    expect(args.variables.person_block_html).toContain("https://cdn.example.test/coach.png");
    expect(args.variables.meeting_url).toBe("https://meet.example.test/call");
  });

  it("does not send a duplicate confirmation when the idempotent re-book returns the existing booking", async () => {
    const memberId = await makeMember();
    const startTime = gridAlignedFutureTime(6);

    const first = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
    expect(first.status).toBe(201);
    await waitForEmailCount("kickoff_call_confirmation", 1);

    const second = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
    expect(second.status).toBe(200);
    expect(second.body.alreadyBooked).toBe(true);
    await new Promise((r) => setTimeout(r, 50));

    expect(emailCallsFor("kickoff_call_confirmation").length).toBe(1);
  });

  it("sends nothing when the GHL appointment creation fails", async () => {
    const memberId = await makeMember();
    const startTime = gridAlignedFutureTime(7);

    const createMock = ghlCoachingCalendar.createAppointment as unknown as ReturnType<typeof vi.fn>;
    createMock.mockRejectedValueOnce(new Error("GHL unreachable"));
    const res = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
    expect(res.status).toBe(500);
    await new Promise((r) => setTimeout(r, 50));

    expect(emailCallsFor("kickoff_call_confirmation").length).toBe(0);
  });
});

describe("kickoff_call_reschedule / kickoff_call_cancel emails", () => {
  it("sends kickoff_call_reschedule once with both previous and new datetime labels, and again on a SECOND real reschedule", async () => {
    const memberId = await makeMember();
    const startTime = gridAlignedFutureTime(12);

    const booked = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    await waitForEmailCount("kickoff_call_confirmation", 1);
    queueEmailMock.mockClear();

    const newStart = new Date(startTime.getTime() + SLOT_STEP_MS);
    const rescheduled = await request(app)
      .patch(`/api/onboarding/kickoff/${bookingId}/reschedule`)
      .set("Cookie", authCookie(memberId))
      .send({ startTime: newStart.toISOString() });
    expect(rescheduled.status).toBe(200);
    await waitForEmailCount("kickoff_call_reschedule", 1);

    const firstCalls = emailCallsFor("kickoff_call_reschedule");
    expect(firstCalls.length).toBe(1);
    const [firstArgs] = firstCalls[0] as [{ variables: Record<string, string> }];
    expect(firstArgs.variables.previous_datetime_label).toBeTruthy();
    expect(firstArgs.variables.new_datetime_label).toBeTruthy();
    expect(firstArgs.variables.previous_datetime_label).not.toBe(firstArgs.variables.new_datetime_label);
    expect(firstArgs.variables.person_block_html).toContain("Lifecycle Kickoff Coach");

    // A SECOND, different reschedule of the same booking must also send —
    // the dedup key must discriminate by the new scheduledAt instant, not
    // just by bookingId, or this second real event would be silently
    // swallowed as a "duplicate" of the first.
    queueEmailMock.mockClear();
    const secondNewStart = new Date(newStart.getTime() + SLOT_STEP_MS);
    const rescheduledAgain = await request(app)
      .patch(`/api/onboarding/kickoff/${bookingId}/reschedule`)
      .set("Cookie", authCookie(memberId))
      .send({ startTime: secondNewStart.toISOString() });
    expect(rescheduledAgain.status).toBe(200);
    await waitForEmailCount("kickoff_call_reschedule", 1);

    expect(emailCallsFor("kickoff_call_reschedule").length).toBe(1);
  });

  it("does not send kickoff_call_reschedule when the GHL reschedule fails", async () => {
    const memberId = await makeMember();
    const startTime = gridAlignedFutureTime(13);

    const booked = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    await waitForEmailCount("kickoff_call_confirmation", 1);
    queueEmailMock.mockClear();

    const cancelMock = ghlCoachingCalendar.cancelAppointment as unknown as ReturnType<typeof vi.fn>;
    cancelMock.mockRejectedValueOnce(new Error("GHL unreachable"));
    const res = await request(app)
      .patch(`/api/onboarding/kickoff/${bookingId}/reschedule`)
      .set("Cookie", authCookie(memberId))
      .send({ startTime: new Date(startTime.getTime() + SLOT_STEP_MS).toISOString() });
    expect(res.status).toBe(502);
    await new Promise((r) => setTimeout(r, 50));

    expect(emailCallsFor("kickoff_call_reschedule").length).toBe(0);
  });

  it("sends kickoff_call_cancel once on cancel, and nothing when the GHL cancel fails", async () => {
    const memberId = await makeMember();
    const startTime = gridAlignedFutureTime(14);

    const booked = await request(app)
      .post("/api/onboarding/kickoff/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString(), coachId: kickoffCoachId });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    await waitForEmailCount("kickoff_call_confirmation", 1);
    queueEmailMock.mockClear();

    const cancelMock = ghlCoachingCalendar.cancelAppointment as unknown as ReturnType<typeof vi.fn>;
    cancelMock.mockRejectedValueOnce(new Error("GHL unreachable"));
    const failedCancel = await request(app)
      .patch(`/api/onboarding/kickoff/${bookingId}/cancel`)
      .set("Cookie", authCookie(memberId));
    expect(failedCancel.status).toBe(502);
    await new Promise((r) => setTimeout(r, 50));
    expect(emailCallsFor("kickoff_call_cancel").length).toBe(0);

    const okCancel = await request(app)
      .patch(`/api/onboarding/kickoff/${bookingId}/cancel`)
      .set("Cookie", authCookie(memberId));
    expect(okCancel.status).toBe(200);
    await waitForEmailCount("kickoff_call_cancel", 1);

    const calls = emailCallsFor("kickoff_call_cancel");
    expect(calls.length).toBe(1);
    const [args] = calls[0] as [{ variables: Record<string, string> }];
    expect(args.variables.person_block_html).toContain("Lifecycle Kickoff Coach");
  });
});

describe("partner_call_confirmation / reschedule / cancel emails", () => {
  it("sends partner_call_confirmation once on booking with the partner's person-block", async () => {
    const memberId = await makeMember();
    await assignPartner(memberId);
    const startTime = gridAlignedFutureTime(8);

    const res = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(res.status).toBe(201);
    await waitForEmailCount("partner_call_confirmation", 1);

    const calls = emailCallsFor("partner_call_confirmation");
    expect(calls.length).toBe(1);
    const [args] = calls[0] as [{ variables: Record<string, string> }];
    expect(args.variables.person_block_html).toContain("Lifecycle Partner");
    expect(args.variables.meeting_url).toBe("https://meet.example.test/call");
  });

  it("sends partner_call_reschedule once with both previous and new datetime labels", async () => {
    const memberId = await makeMember();
    await assignPartner(memberId);
    const startTime = gridAlignedFutureTime(9);

    const booked = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    await waitForEmailCount("partner_call_confirmation", 1);
    queueEmailMock.mockClear();

    const newStart = new Date(startTime.getTime() + SLOT_STEP_MS);
    const rescheduled = await request(app)
      .patch(`/api/onboarding/partner/${bookingId}/reschedule`)
      .set("Cookie", authCookie(memberId))
      .send({ startTime: newStart.toISOString() });
    expect(rescheduled.status).toBe(200);
    await waitForEmailCount("partner_call_reschedule", 1);

    const calls = emailCallsFor("partner_call_reschedule");
    expect(calls.length).toBe(1);
    const [args] = calls[0] as [{ variables: Record<string, string> }];
    expect(args.variables.previous_datetime_label).toBeTruthy();
    expect(args.variables.new_datetime_label).toBeTruthy();
    expect(args.variables.previous_datetime_label).not.toBe(args.variables.new_datetime_label);
  });

  it("does not send partner_call_reschedule when the GHL reschedule fails", async () => {
    const memberId = await makeMember();
    await assignPartner(memberId);
    const startTime = gridAlignedFutureTime(10);

    const booked = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    await waitForEmailCount("partner_call_confirmation", 1);
    queueEmailMock.mockClear();

    const cancelMock = ghlCoachingCalendar.cancelAppointment as unknown as ReturnType<typeof vi.fn>;
    cancelMock.mockRejectedValueOnce(new Error("GHL unreachable"));
    const res = await request(app)
      .patch(`/api/onboarding/partner/${bookingId}/reschedule`)
      .set("Cookie", authCookie(memberId))
      .send({ startTime: new Date(startTime.getTime() + SLOT_STEP_MS).toISOString() });
    expect(res.status).toBe(502);
    await new Promise((r) => setTimeout(r, 50));

    expect(emailCallsFor("partner_call_reschedule").length).toBe(0);
  });

  it("sends partner_call_cancel once on cancel, and nothing when the GHL cancel fails", async () => {
    const memberId = await makeMember();
    await assignPartner(memberId);
    const startTime = gridAlignedFutureTime(11);

    const booked = await request(app)
      .post("/api/onboarding/partner/book")
      .set("Cookie", authCookie(memberId))
      .send({ startTime: startTime.toISOString() });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.booking.id;
    await waitForEmailCount("partner_call_confirmation", 1);
    queueEmailMock.mockClear();

    const cancelMock = ghlCoachingCalendar.cancelAppointment as unknown as ReturnType<typeof vi.fn>;
    cancelMock.mockRejectedValueOnce(new Error("GHL unreachable"));
    const failedCancel = await request(app)
      .patch(`/api/onboarding/partner/${bookingId}/cancel`)
      .set("Cookie", authCookie(memberId));
    expect(failedCancel.status).toBe(502);
    await new Promise((r) => setTimeout(r, 50));
    expect(emailCallsFor("partner_call_cancel").length).toBe(0);

    const okCancel = await request(app)
      .patch(`/api/onboarding/partner/${bookingId}/cancel`)
      .set("Cookie", authCookie(memberId));
    expect(okCancel.status).toBe(200);
    await waitForEmailCount("partner_call_cancel", 1);

    const calls = emailCallsFor("partner_call_cancel");
    expect(calls.length).toBe(1);
    const [args] = calls[0] as [{ variables: Record<string, string> }];
    expect(args.variables.person_block_html).toContain("Lifecycle Partner");
  });
});
