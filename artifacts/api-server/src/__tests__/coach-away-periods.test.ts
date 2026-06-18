import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, coachesTable, coachAwayPeriodsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminCoachesRouter from "../routes/admin-coaches";
import coachingRouter from "../routes/coaching";
import coachingSessionsRouter from "../routes/coaching-sessions";
import { coachingDateString } from "../lib/coach-availability";

// Proves the "coach away" feature: an admin (on a coach's behalf) marks a date
// range away; while that range covers today the coach drops out of the member
// "Your Coaches" group grid AND the private-coaching roster, then reappears
// once it's removed / passes. Date-driven, no cron.

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `coach-away-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let memberCookie = "";
let seededAdminId = 0;
let seededMemberId = 0;
let coachId = 0;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  app = buildTestAppWithRouters([
    adminCoachesRouter,
    coachingRouter,
    coachingSessionsRouter,
  ]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-admin@example.test`,
      name: "Away Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededAdminId = admin.id;
  adminCookie = signCookie(admin.id, admin.email);

  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-member@example.test`,
      name: "Plain Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededMemberId = member.id;
  memberCookie = signCookie(member.id, member.email);

  // A coach who does BOTH group calls and private coaching, so a single away
  // period should hide them from both member surfaces.
  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `${TAG} Coach`,
      bio: "Bio",
      specialties: "Specialty",
      doesGroupCalls: true,
      doesPrivateCoaching: true,
      isActive: true,
    })
    .returning({ id: coachesTable.id });
  coachId = coach.id;
});

afterAll(async () => {
  await db.delete(coachAwayPeriodsTable).where(eq(coachAwayPeriodsTable.coachId, coachId));
  if (coachId) {
    await db.delete(coachesTable).where(eq(coachesTable.id, coachId));
  }
  const userIds = [seededAdminId, seededMemberId].filter(Boolean);
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

async function groupGridHasCoach(): Promise<boolean> {
  const res = await request(app).get("/api/coaches").set("Cookie", memberCookie);
  expect(res.status).toBe(200);
  return res.body.some((c: { id: number }) => c.id === coachId);
}

async function privateRosterHasCoach(): Promise<boolean> {
  const res = await request(app)
    .get("/api/coaching/sessions/coaches")
    .set("Cookie", memberCookie);
  expect(res.status).toBe(200);
  return res.body.some((c: { id: number }) => c.id === coachId);
}

describe("coach away periods", () => {
  it("shows the coach on both member surfaces when not away", async () => {
    expect(await groupGridHasCoach()).toBe(true);
    expect(await privateRosterHasCoach()).toBe(true);
  });

  it("rejects an away period from a non-admin member", async () => {
    const today = coachingDateString();
    const res = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/away`)
      .set("Cookie", memberCookie)
      .send({ startDate: today, endDate: today });
    expect(res.status).toBe(403);
  });

  it("validates the away date range", async () => {
    const today = coachingDateString();
    const bad = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/away`)
      .set("Cookie", adminCookie)
      .send({ startDate: "2026-13-40", endDate: today });
    expect(bad.status).toBe(400);

    const reversed = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/away`)
      .set("Cookie", adminCookie)
      .send({ startDate: shiftDate(today, 5), endDate: shiftDate(today, 2) });
    expect(reversed.status).toBe(400);

    const past = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/away`)
      .set("Cookie", adminCookie)
      .send({ startDate: shiftDate(today, -10), endDate: shiftDate(today, -5) });
    expect(past.status).toBe(400);
  });

  it("404s an away period for a non-existent coach", async () => {
    const today = coachingDateString();
    const res = await request(app)
      .post(`/api/admin/coaching/coaches/99999999/away`)
      .set("Cookie", adminCookie)
      .send({ startDate: today, endDate: today });
    expect(res.status).toBe(404);
  });

  it("keeps a future away period from hiding the coach but surfaces it to admins", async () => {
    const today = coachingDateString();
    const create = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/away`)
      .set("Cookie", adminCookie)
      .send({
        startDate: shiftDate(today, 10),
        endDate: shiftDate(today, 15),
        reason: "Future trip",
      });
    expect(create.status).toBe(201);
    expect(create.body.isActive).toBe(false);
    const futureId = create.body.id as number;

    // Coach is NOT away today, so still visible on both surfaces.
    expect(await groupGridHasCoach()).toBe(true);
    expect(await privateRosterHasCoach()).toBe(true);

    // Admin list surfaces the upcoming period.
    const list = await request(app)
      .get("/api/admin/coaching/coaches")
      .set("Cookie", adminCookie);
    expect(list.status).toBe(200);
    const found = list.body.coaches.find((c: { id: number }) => c.id === coachId);
    expect(found.awayPeriods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: futureId, isActive: false, reason: "Future trip" }),
      ]),
    );

    await db.delete(coachAwayPeriodsTable).where(eq(coachAwayPeriodsTable.id, futureId));
  });

  it("hides the coach from both surfaces during an active away period, then restores", async () => {
    const today = coachingDateString();
    const create = await request(app)
      .post(`/api/admin/coaching/coaches/${coachId}/away`)
      .set("Cookie", adminCookie)
      .send({ startDate: shiftDate(today, -1), endDate: shiftDate(today, 1) });
    expect(create.status).toBe(201);
    expect(create.body.isActive).toBe(true);
    const awayId = create.body.id as number;

    // Now away today → gone from both member surfaces.
    expect(await groupGridHasCoach()).toBe(false);
    expect(await privateRosterHasCoach()).toBe(false);

    // Slots + booking also reject the away coach.
    const slots = await request(app)
      .get(`/api/coaching/sessions/coaches/${coachId}/slots`)
      .set("Cookie", memberCookie);
    expect(slots.status).toBe(404);

    // Removing the period restores the coach immediately.
    const del = await request(app)
      .delete(`/api/admin/coaching/coaches/${coachId}/away/${awayId}`)
      .set("Cookie", adminCookie);
    expect(del.status).toBe(200);

    expect(await groupGridHasCoach()).toBe(true);
    expect(await privateRosterHasCoach()).toBe(true);
  });

  it("404s removing an away period that does not belong to the coach", async () => {
    const del = await request(app)
      .delete(`/api/admin/coaching/coaches/${coachId}/away/99999999`)
      .set("Cookie", adminCookie);
    expect(del.status).toBe(404);
  });
});
