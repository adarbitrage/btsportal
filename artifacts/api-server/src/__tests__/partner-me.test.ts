import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  partnersTable,
  partnerAssignmentsTable,
  callBookingsTable,
} from "@workspace/db";
import { buildTestApp } from "./test-app";
import { generateAccessToken } from "../middleware/auth";
import callBookingsRouter from "../routes/call-bookings";

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

const TEST_TAG = `partner-me-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestApp>;
let partnerId = 0;

const userIds: number[] = [];
const bookingIds: number[] = [];
const assignmentIds: number[] = [];

function authCookie(userId: number): string[] {
  return [`access_token=${generateAccessToken(userId, `${userId}@example.test`)}`];
}

async function makeMember(): Promise<number> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 8)}@example.test`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Partner Panel Member",
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

async function assignPartner(memberId: number, cadencePerWeek: number | null = 1): Promise<number> {
  const [row] = await db
    .insert(partnerAssignmentsTable)
    .values({ memberId, partnerId, status: "active", cadencePerWeek: cadencePerWeek ?? undefined })
    .returning({ id: partnerAssignmentsTable.id });
  assignmentIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestApp({ routers: [callBookingsRouter] });

  const [partner] = await db
    .insert(partnersTable)
    .values({
      displayName: "Panel Test Partner",
      bio: "Here to help you stay on track.",
      photoUrl: null,
      ghlCalendarId: `${TEST_TAG}-cal`,
      isActive: true,
      maxDailyCalls: 5,
    })
    .returning({ id: partnersTable.id });
  partnerId = partner.id;
});

afterAll(async () => {
  if (bookingIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.id, bookingIds));
  }
  if (assignmentIds.length > 0) {
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.id, assignmentIds));
  }
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  await db.delete(partnersTable).where(eq(partnersTable.id, partnerId));
});

describe("GET /api/partner/me", () => {
  it("returns assignment: null for a member with no active partner assignment", async () => {
    const memberId = await makeMember();

    const res = await request(app).get("/api/partner/me").set("Cookie", authCookie(memberId));

    expect(res.status).toBe(200);
    expect(res.body.assignment).toBeNull();
  });

  it("returns partner info, cadence, next call, and completed count for an assigned member", async () => {
    const memberId = await makeMember();
    await assignPartner(memberId, 2);

    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const [completedBooking] = await db
      .insert(callBookingsTable)
      .values({
        memberId,
        staffType: "partner",
        staffId: partnerId,
        type: "partner",
        ghlCalendarId: `${TEST_TAG}-cal`,
        ghlAppointmentId: `${TEST_TAG}-appt-completed`,
        scheduledAt: past,
        endAt: new Date(past.getTime() + 30 * 60 * 1000),
        durationMinutes: 30,
        status: "completed",
      })
      .returning({ id: callBookingsTable.id });
    bookingIds.push(completedBooking.id);

    const [upcomingBooking] = await db
      .insert(callBookingsTable)
      .values({
        memberId,
        staffType: "partner",
        staffId: partnerId,
        type: "partner",
        ghlCalendarId: `${TEST_TAG}-cal`,
        ghlAppointmentId: `${TEST_TAG}-appt-upcoming`,
        scheduledAt: future,
        endAt: new Date(future.getTime() + 30 * 60 * 1000),
        durationMinutes: 30,
        status: "booked",
        meetingUrl: "https://meet.example.test/partner-call",
      })
      .returning({ id: callBookingsTable.id });
    bookingIds.push(upcomingBooking.id);

    const res = await request(app).get("/api/partner/me").set("Cookie", authCookie(memberId));

    expect(res.status).toBe(200);
    expect(res.body.assignment).toBeTruthy();
    expect(res.body.assignment.partner.displayName).toBe("Panel Test Partner");
    expect(res.body.assignment.partner.bio).toBe("Here to help you stay on track.");
    expect(res.body.assignment.cadencePerWeek).toBe(2);
    expect(res.body.assignment.completedCallCount).toBe(1);
    expect(res.body.assignment.nextCall).toBeTruthy();
    expect(res.body.assignment.nextCall.meetingUrl).toBe("https://meet.example.test/partner-call");
    expect(new Date(res.body.assignment.nextCall.scheduledAt).getTime()).toBe(future.getTime());
  });

  it("returns nextCall: null when the assigned member has no upcoming booked call", async () => {
    const memberId = await makeMember();
    await assignPartner(memberId, 1);

    const res = await request(app).get("/api/partner/me").set("Cookie", authCookie(memberId));

    expect(res.status).toBe(200);
    expect(res.body.assignment).toBeTruthy();
    expect(res.body.assignment.nextCall).toBeNull();
    expect(res.body.assignment.completedCallCount).toBe(0);
  });

  it("returns assignment: null once the active assignment has ended", async () => {
    const memberId = await makeMember();
    const assignmentId = await assignPartner(memberId, 1);
    await db
      .update(partnerAssignmentsTable)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(partnerAssignmentsTable.id, assignmentId));

    const res = await request(app).get("/api/partner/me").set("Cookie", authCookie(memberId));

    expect(res.status).toBe(200);
    expect(res.body.assignment).toBeNull();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/partner/me");
    expect(res.status).toBe(401);
  });
});
