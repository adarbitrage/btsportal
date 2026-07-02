import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  partnersTable,
  partnerAssignmentsTable,
  partnerNotesTable,
  callBookingsTable,
  sequenceEnrollmentsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import partnerDashboardRouter from "../routes/partner-dashboard";
import { markPartnerCallDone } from "../lib/partner-call-completion";
import { ONBOARDING_STEP } from "../lib/onboarding-advancement";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `partner-dash-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededPartnerIds: number[] = [];
const seededBookingIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(role: string, suffix: string, extra: Partial<typeof usersTable.$inferInsert> = {}): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      ...extra,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, cookie: signCookie(row.id, email) };
}

async function insertPartner(suffix: string, userId?: number): Promise<number> {
  const [row] = await db
    .insert(partnersTable)
    .values({ displayName: `Partner ${suffix} ${TEST_TAG}`, isActive: true, userId: userId ?? null })
    .returning({ id: partnersTable.id });
  seededPartnerIds.push(row.id);
  return row.id;
}

async function insertBooking(memberId: number, partnerId: number, opts: { scheduledAt?: Date; status?: string } = {}): Promise<number> {
  const scheduledAt = opts.scheduledAt ?? new Date();
  const [row] = await db
    .insert(callBookingsTable)
    .values({
      memberId,
      staffType: "partner",
      staffId: partnerId,
      type: "partner",
      ghlCalendarId: `test-cal-${TEST_TAG}`,
      scheduledAt,
      endAt: new Date(scheduledAt.getTime() + 30 * 60000),
      durationMinutes: 30,
      status: opts.status ?? "booked",
    })
    .returning({ id: callBookingsTable.id });
  seededBookingIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([partnerDashboardRouter]);
});

afterAll(async () => {
  if (seededBookingIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.id, seededBookingIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(partnerNotesTable).where(inArray(partnerNotesTable.memberId, seededUserIds));
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.memberId, seededUserIds));
  }
  if (seededPartnerIds.length > 0) {
    await db.delete(partnersTable).where(inArray(partnersTable.id, seededPartnerIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(sequenceEnrollmentsTable).where(inArray(sequenceEnrollmentsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /api/partner/dashboard/roster", () => {
  it("returns only the resolved partner's own active mentees", async () => {
    const partnerUser = await seedUser("partner", "roster-partner");
    const partnerId = await insertPartner("roster", partnerUser.id);
    const mentee = await seedUser("member", "roster-mentee");
    const otherPartner = await insertPartner("roster-other");
    const otherMentee = await seedUser("member", "roster-other-mentee");

    await db.insert(partnerAssignmentsTable).values([
      { memberId: mentee.id, partnerId, status: "active", cadencePerWeek: 2 },
      { memberId: otherMentee.id, partnerId: otherPartner, status: "active" },
    ]);

    const res = await request(app).get("/api/partner/dashboard/roster").set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(200);
    const memberIds = res.body.mentees.map((m: { member_id: number }) => m.member_id);
    expect(memberIds).toContain(mentee.id);
    expect(memberIds).not.toContain(otherMentee.id);
  });

  it("rejects a plain member", async () => {
    const member = await seedUser("member", "roster-plain-member");
    const res = await request(app).get("/api/partner/dashboard/roster").set("Cookie", member.cookie);
    expect(res.status).toBe(403);
  });

  it("requires ?partnerId= for an admin with partners:view and 400s without it", async () => {
    const admin = await seedUser("admin", "roster-admin");
    const res = await request(app).get("/api/partner/dashboard/roster").set("Cookie", admin.cookie);
    expect(res.status).toBe(400);
  });

  it("lets an admin with partners:view see any partner's roster via ?partnerId=", async () => {
    const admin = await seedUser("admin", "roster-admin-view");
    const partnerUser = await seedUser("partner", "roster-admin-target-partner");
    const partnerId = await insertPartner("admin-target", partnerUser.id);
    const mentee = await seedUser("member", "roster-admin-target-mentee");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active" });

    const res = await request(app)
      .get(`/api/partner/dashboard/roster?partnerId=${partnerId}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    const memberIds = res.body.mentees.map((m: { member_id: number }) => m.member_id);
    expect(memberIds).toContain(mentee.id);
  });

  it("reports days since last completed call and consecutive no-shows", async () => {
    const partnerUser = await seedUser("partner", "roster-noshow-partner");
    const partnerId = await insertPartner("roster-noshow", partnerUser.id);
    const mentee = await seedUser("member", "roster-noshow-mentee");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active" });

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await insertBooking(mentee.id, partnerId, { scheduledAt: fiveDaysAgo, status: "completed" });
    await insertBooking(mentee.id, partnerId, {
      scheduledAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      status: "no_show",
    });
    await insertBooking(mentee.id, partnerId, {
      scheduledAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      status: "no_show",
    });

    const res = await request(app).get("/api/partner/dashboard/roster").set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(200);
    const row = res.body.mentees.find((m: { member_id: number }) => m.member_id === mentee.id);
    expect(row).toBeDefined();
    expect(row.consecutive_no_shows).toBe(2);
    expect(row.days_since_last_completed_call).toBeGreaterThanOrEqual(4);
    expect(row.last_completed_call_at).toBeTruthy();
  });

  it("reports zero consecutive no-shows once the most recent call is completed", async () => {
    const partnerUser = await seedUser("partner", "roster-noshow-reset-partner");
    const partnerId = await insertPartner("roster-noshow-reset", partnerUser.id);
    const mentee = await seedUser("member", "roster-noshow-reset-mentee");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active" });

    await insertBooking(mentee.id, partnerId, {
      scheduledAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      status: "no_show",
    });
    await insertBooking(mentee.id, partnerId, {
      scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      status: "completed",
    });

    const res = await request(app).get("/api/partner/dashboard/roster").set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(200);
    const row = res.body.mentees.find((m: { member_id: number }) => m.member_id === mentee.id);
    expect(row.consecutive_no_shows).toBe(0);
  });
});

describe("GET /api/partner/dashboard/today", () => {
  it("returns only today's calls for the resolved partner", async () => {
    const partnerUser = await seedUser("partner", "today-partner");
    const partnerId = await insertPartner("today", partnerUser.id);
    const mentee = await seedUser("member", "today-mentee");
    await insertBooking(mentee.id, partnerId, { scheduledAt: new Date() });

    const otherPartnerUser = await seedUser("partner", "today-other-partner");
    const otherPartnerId = await insertPartner("today-other", otherPartnerUser.id);
    const otherMentee = await seedUser("member", "today-other-mentee");
    await insertBooking(otherMentee.id, otherPartnerId, { scheduledAt: new Date() });

    const res = await request(app).get("/api/partner/dashboard/today").set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(200);
    const memberIds = res.body.calls.map((c: { member_id: number }) => c.member_id);
    expect(memberIds).toContain(mentee.id);
    expect(memberIds).not.toContain(otherMentee.id);
  });
});

describe("GET /api/partner/dashboard/mentee/:memberId", () => {
  it("404s when the mentee is not assigned to the resolved partner", async () => {
    const partnerUser = await seedUser("partner", "detail-partner");
    await insertPartner("detail", partnerUser.id);
    const unassignedMentee = await seedUser("member", "detail-unassigned");

    const res = await request(app)
      .get(`/api/partner/dashboard/mentee/${unassignedMentee.id}`)
      .set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(404);
  });

  it("returns notes, cadence, and calls for an assigned mentee", async () => {
    const partnerUser = await seedUser("partner", "detail-partner-2");
    const partnerId = await insertPartner("detail-2", partnerUser.id);
    const mentee = await seedUser("member", "detail-mentee-2");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active", cadencePerWeek: 3 });
    await db.insert(partnerNotesTable).values({ memberId: mentee.id, authorPartnerId: partnerId, body: "Doing great", isConcern: false });
    await insertBooking(mentee.id, partnerId);

    const res = await request(app)
      .get(`/api/partner/dashboard/mentee/${mentee.id}`)
      .set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(200);
    expect(res.body.cadence_per_week).toBe(3);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].body).toBe("Doing great");
    expect(res.body.calls).toHaveLength(1);
  });

  it("includes days-since-last-completed-call and consecutive-no-show metrics", async () => {
    const partnerUser = await seedUser("partner", "detail-metrics-partner");
    const partnerId = await insertPartner("detail-metrics", partnerUser.id);
    const mentee = await seedUser("member", "detail-metrics-mentee");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active" });

    await insertBooking(mentee.id, partnerId, {
      scheduledAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      status: "completed",
    });
    await insertBooking(mentee.id, partnerId, {
      scheduledAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      status: "no_show",
    });

    const res = await request(app)
      .get(`/api/partner/dashboard/mentee/${mentee.id}`)
      .set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(200);
    expect(res.body.consecutive_no_shows).toBe(1);
    expect(res.body.days_since_last_completed_call).toBeGreaterThanOrEqual(9);
    expect(res.body.last_completed_call_at).toBeTruthy();
  });
});

describe("POST /api/partner/dashboard/mentee/:memberId/notes", () => {
  it("lets the assigned partner add a note, optionally flagged as a concern", async () => {
    const partnerUser = await seedUser("partner", "notes-partner");
    const partnerId = await insertPartner("notes", partnerUser.id);
    const mentee = await seedUser("member", "notes-mentee");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active" });

    const res = await request(app)
      .post(`/api/partner/dashboard/mentee/${mentee.id}/notes`)
      .set("Cookie", partnerUser.cookie)
      .send({ body: "Missed two calls in a row", isConcern: true });

    expect(res.status).toBe(201);
    expect(res.body.is_concern).toBe(true);

    const rows = await db.select().from(partnerNotesTable).where(eq(partnerNotesTable.memberId, mentee.id));
    expect(rows).toHaveLength(1);
  });

  it("blocks an admin with partners:view from writing a note", async () => {
    const admin = await seedUser("admin", "notes-admin");
    const partnerUser = await seedUser("partner", "notes-admin-target-partner");
    const partnerId = await insertPartner("notes-admin-target", partnerUser.id);
    const mentee = await seedUser("member", "notes-admin-target-mentee");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active" });

    const res = await request(app)
      .post(`/api/partner/dashboard/mentee/${mentee.id}/notes?partnerId=${partnerId}`)
      .set("Cookie", admin.cookie)
      .send({ body: "Should not be allowed" });
    expect(res.status).toBe(403);
  });

  it("rejects an empty note body", async () => {
    const partnerUser = await seedUser("partner", "notes-empty-partner");
    const partnerId = await insertPartner("notes-empty", partnerUser.id);
    const mentee = await seedUser("member", "notes-empty-mentee");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active" });

    const res = await request(app)
      .post(`/api/partner/dashboard/mentee/${mentee.id}/notes`)
      .set("Cookie", partnerUser.cookie)
      .send({ body: "   " });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/partner/dashboard/mentee/:memberId/cadence", () => {
  it("sets and clears the weekly cadence for an assigned mentee", async () => {
    const partnerUser = await seedUser("partner", "cadence-partner");
    const partnerId = await insertPartner("cadence", partnerUser.id);
    const mentee = await seedUser("member", "cadence-mentee");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active" });

    const setRes = await request(app)
      .patch(`/api/partner/dashboard/mentee/${mentee.id}/cadence`)
      .set("Cookie", partnerUser.cookie)
      .send({ cadencePerWeek: 5 });
    expect(setRes.status).toBe(200);
    expect(setRes.body.cadence_per_week).toBe(5);

    const clearRes = await request(app)
      .patch(`/api/partner/dashboard/mentee/${mentee.id}/cadence`)
      .set("Cookie", partnerUser.cookie)
      .send({ cadencePerWeek: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.cadence_per_week).toBeNull();
  });

  it("rejects an out-of-range cadence", async () => {
    const partnerUser = await seedUser("partner", "cadence-oor-partner");
    const partnerId = await insertPartner("cadence-oor", partnerUser.id);
    const mentee = await seedUser("member", "cadence-oor-mentee");
    await db.insert(partnerAssignmentsTable).values({ memberId: mentee.id, partnerId, status: "active" });

    const res = await request(app)
      .patch(`/api/partner/dashboard/mentee/${mentee.id}/cadence`)
      .set("Cookie", partnerUser.cookie)
      .send({ cadencePerWeek: 10 });
    expect(res.status).toBe(400);
  });

  it("404s for a mentee not on this partner's roster", async () => {
    const partnerUser = await seedUser("partner", "cadence-unassigned-partner");
    await insertPartner("cadence-unassigned", partnerUser.id);
    const mentee = await seedUser("member", "cadence-unassigned-mentee");

    const res = await request(app)
      .patch(`/api/partner/dashboard/mentee/${mentee.id}/cadence`)
      .set("Cookie", partnerUser.cookie)
      .send({ cadencePerWeek: 2 });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/partner/dashboard/calls/:id/mark-done", () => {
  it("flips a booked call to completed via the route", async () => {
    const partnerUser = await seedUser("partner", "markdone-partner");
    const partnerId = await insertPartner("markdone", partnerUser.id);
    const mentee = await seedUser("member", "markdone-mentee");
    const bookingId = await insertBooking(mentee.id, partnerId, { scheduledAt: new Date(Date.now() - 3600_000) });

    const res = await request(app)
      .post(`/api/partner/dashboard/calls/${bookingId}/mark-done`)
      .set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);

    const [row] = await db.select().from(callBookingsTable).where(eq(callBookingsTable.id, bookingId));
    expect(row.status).toBe("completed");
  });

  it("404s when the call belongs to a different partner", async () => {
    const partnerUser = await seedUser("partner", "markdone-wrong-partner");
    await insertPartner("markdone-wrong", partnerUser.id);
    const otherPartnerUser = await seedUser("partner", "markdone-owner-partner");
    const ownerPartnerId = await insertPartner("markdone-owner", otherPartnerUser.id);
    const mentee = await seedUser("member", "markdone-owner-mentee");
    const bookingId = await insertBooking(mentee.id, ownerPartnerId);

    const res = await request(app)
      .post(`/api/partner/dashboard/calls/${bookingId}/mark-done`)
      .set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(404);
  });

  it("409s when the call is already completed (not re-flippable through the route)", async () => {
    const partnerUser = await seedUser("partner", "markdone-already-partner");
    const partnerId = await insertPartner("markdone-already", partnerUser.id);
    const mentee = await seedUser("member", "markdone-already-mentee");
    const bookingId = await insertBooking(mentee.id, partnerId, { status: "completed" });

    const res = await request(app)
      .post(`/api/partner/dashboard/calls/${bookingId}/mark-done`)
      .set("Cookie", partnerUser.cookie);
    expect(res.status).toBe(409);
  });

  it("blocks an admin with partners:view from marking a call done", async () => {
    const admin = await seedUser("admin", "markdone-admin");
    const partnerUser = await seedUser("partner", "markdone-admin-target-partner");
    const partnerId = await insertPartner("markdone-admin-target", partnerUser.id);
    const mentee = await seedUser("member", "markdone-admin-target-mentee");
    const bookingId = await insertBooking(mentee.id, partnerId);

    const res = await request(app)
      .post(`/api/partner/dashboard/calls/${bookingId}/mark-done?partnerId=${partnerId}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(403);
  });
});

describe("markPartnerCallDone (shared helper)", () => {
  it("is a no-op when called twice for the same booking (idempotent)", async () => {
    const partnerId = await insertPartner("helper-idempotent");
    const mentee = await seedUser("member", "helper-idempotent-mentee");
    const bookingId = await insertBooking(mentee.id, partnerId);

    const first = await markPartnerCallDone(bookingId);
    expect(first.updated).toBe(true);

    const second = await markPartnerCallDone(bookingId);
    expect(second.updated).toBe(false);
    expect(second.onboardingAdvanced).toBe(false);
  });

  it("is a no-op for a non-partner booking type", async () => {
    const partnerId = await insertPartner("helper-nontype");
    const mentee = await seedUser("member", "helper-nontype-mentee");
    const [row] = await db
      .insert(callBookingsTable)
      .values({
        memberId: mentee.id,
        staffType: "kickoff_coach",
        staffId: partnerId,
        type: "kickoff",
        ghlCalendarId: `test-cal-${TEST_TAG}-kickoff`,
        scheduledAt: new Date(),
        endAt: new Date(Date.now() + 30 * 60000),
        status: "booked",
      })
      .returning({ id: callBookingsTable.id });
    seededBookingIds.push(row.id);

    const result = await markPartnerCallDone(row.id);
    expect(result.updated).toBe(false);
  });

  it("advances onboarding on the member's first completed partner call", async () => {
    const partnerId = await insertPartner("helper-onboarding");
    const mentee = await seedUser("member", "helper-onboarding-mentee", {
      onboardingStep: ONBOARDING_STEP.PARTNER_CALL_COMPLETED,
      onboardingComplete: false,
    });
    const bookingId = await insertBooking(mentee.id, partnerId);

    const result = await markPartnerCallDone(bookingId);
    expect(result.updated).toBe(true);
    expect(result.onboardingAdvanced).toBe(true);

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, mentee.id));
    expect(row.onboardingComplete).toBe(true);
  });

  it("does not double-advance onboarding on a member's second completed call", async () => {
    const partnerId = await insertPartner("helper-second-call");
    const mentee = await seedUser("member", "helper-second-call-mentee", {
      onboardingStep: ONBOARDING_STEP.PARTNER_CALL_COMPLETED,
      onboardingComplete: false,
    });
    const firstBookingId = await insertBooking(mentee.id, partnerId, { scheduledAt: new Date(Date.now() - 7 * 24 * 3600_000) });
    await markPartnerCallDone(firstBookingId);

    const secondBookingId = await insertBooking(mentee.id, partnerId);
    const result = await markPartnerCallDone(secondBookingId);
    expect(result.updated).toBe(true);
    expect(result.onboardingAdvanced).toBe(false);
  });
});
