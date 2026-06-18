import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  coachesTable,
  coachingCallsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Coach-facing Group Coaching surface: a coach lists their OWN upcoming weekly
// group-call dates and reversibly soft-cancels/un-cancels a single date. An
// admin with coaching:view (no coach record) manages every coach's schedule.
// Ownership is enforced server-side: a coach cannot touch another coach's call.

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import coachDashboardRouter from "../routes/coach-dashboard";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `coach-group-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let coachACookie: string;
let coachBCookie: string;
let unlinkedCoachCookie: string;

const userIds: number[] = [];
const coachIds: number[] = [];
const callIds: number[] = [];

let coachAId: number;
let coachBId: number;
let coachACallId: number;
let coachACancelledCallId: number;
let coachBCallId: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${suffix}@example.test`,
      name: `User ${suffix}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

async function insertCoach(name: string, userId: number | null): Promise<number> {
  const [row] = await db
    .insert(coachesTable)
    .values({
      name,
      ghlCalendarId: `${TAG}-${name}-cal`,
      ghlLocationId: `${TAG}-loc`,
      userId,
    })
    .returning({ id: coachesTable.id });
  coachIds.push(row.id);
  return row.id;
}

async function insertCall(
  coachId: number,
  hoursFromNow: number,
  cancelled = false,
): Promise<number> {
  const scheduledAt = new Date(Date.now() + hoursFromNow * 3_600_000);
  const [row] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} weekly`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId,
      scheduledAt,
      durationMinutes: 60,
      requiredEntitlement: "coaching:group",
      cancelledAt: cancelled ? new Date() : null,
    })
    .returning({ id: coachingCallsTable.id });
  callIds.push(row.id);
  return row.id;
}

let adminId: number;

beforeAll(async () => {
  app = buildTestAppWithRouters([coachDashboardRouter]);

  adminId = await insertUser("super_admin", "admin");
  adminCookie = signCookie(adminId, `${TAG}-admin@example.test`);

  const coachAUserId = await insertUser("coach", "coachA");
  coachACookie = signCookie(coachAUserId, `${TAG}-coachA@example.test`);

  const coachBUserId = await insertUser("coach", "coachB");
  coachBCookie = signCookie(coachBUserId, `${TAG}-coachB@example.test`);

  const unlinkedUserId = await insertUser("coach", "unlinked");
  unlinkedCoachCookie = signCookie(unlinkedUserId, `${TAG}-unlinked@example.test`);

  coachAId = await insertCoach("CoachA", coachAUserId);
  coachBId = await insertCoach("CoachB", coachBUserId);

  // CoachA: one active upcoming, one cancelled upcoming, plus a past call that
  // must never appear. CoachB: one active upcoming (used for ownership checks).
  coachACallId = await insertCall(coachAId, 24);
  coachACancelledCallId = await insertCall(coachAId, 48, true);
  await insertCall(coachAId, -24); // past — excluded
  coachBCallId = await insertCall(coachBId, 24);
});

afterAll(async () => {
  if (callIds.length) await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, callIds));
  if (coachIds.length) await db.delete(coachesTable).where(inArray(coachesTable.id, coachIds));
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
});

describe("Coach Group Coaching endpoints", () => {
  it("lists only the signed-in coach's own upcoming group calls (cancelled flagged, past excluded)", async () => {
    const res = await request(app)
      .get("/api/coach/group-calls")
      .set("Cookie", coachACookie);
    expect(res.status).toBe(200);
    expect(res.body.coachId).toBe(coachAId);
    const ids: number[] = res.body.calls.map((c: { id: number }) => c.id);
    expect(ids).toContain(coachACallId);
    expect(ids).toContain(coachACancelledCallId);
    expect(ids).not.toContain(coachBCallId); // not this coach's
    // No past occurrence leaks in.
    expect(res.body.calls.length).toBe(2);
    const cancelled = res.body.calls.find((c: { id: number }) => c.id === coachACancelledCallId);
    expect(cancelled.cancelled).toBe(true);
    const active = res.body.calls.find((c: { id: number }) => c.id === coachACallId);
    expect(active.cancelled).toBe(false);
  });

  it("returns every coach's calls for an admin with coaching:view (coachId null)", async () => {
    const res = await request(app)
      .get("/api/coach/group-calls")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.coachId).toBeNull();
    const ids: number[] = res.body.calls.map((c: { id: number }) => c.id);
    expect(ids).toContain(coachACallId);
    expect(ids).toContain(coachBCallId);
  });

  it("still returns every coach's calls for an admin who ALSO has a linked coach row", async () => {
    // An admin (coaching:view) must never be scoped to their own coachId, even
    // if a coach record happens to be linked to their user — they manage the
    // whole schedule. Link a coach row to the admin user, then assert the admin
    // still sees all coaches' calls with coachId reported as null.
    const adminCoachId = await insertCoach("AdminCoach", adminId);
    const adminOwnCallId = await insertCall(adminCoachId, 24);

    const res = await request(app)
      .get("/api/coach/group-calls")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.coachId).toBeNull();
    const ids: number[] = res.body.calls.map((c: { id: number }) => c.id);
    expect(ids).toContain(coachACallId);
    expect(ids).toContain(coachBCallId);
    expect(ids).toContain(adminOwnCallId);
  });

  it("returns an empty list for a coach with no linked coach record", async () => {
    const res = await request(app)
      .get("/api/coach/group-calls")
      .set("Cookie", unlinkedCoachCookie);
    expect(res.status).toBe(200);
    expect(res.body.coachId).toBeNull();
    expect(res.body.calls).toEqual([]);
  });

  it("lets a coach soft-cancel and then restore their own call (reversible)", async () => {
    const cancel = await request(app)
      .post(`/api/coach/group-calls/${coachACallId}/cancel`)
      .set("Cookie", coachACookie);
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelled).toBe(true);

    const [afterCancel] = await db
      .select({ cancelledAt: coachingCallsTable.cancelledAt, cancelledBy: coachingCallsTable.cancelledBy })
      .from(coachingCallsTable)
      .where(eq(coachingCallsTable.id, coachACallId));
    expect(afterCancel.cancelledAt).not.toBeNull();
    expect(afterCancel.cancelledBy).not.toBeNull();

    const restore = await request(app)
      .post(`/api/coach/group-calls/${coachACallId}/restore`)
      .set("Cookie", coachACookie);
    expect(restore.status).toBe(200);
    expect(restore.body.cancelled).toBe(false);

    const [afterRestore] = await db
      .select({ cancelledAt: coachingCallsTable.cancelledAt, cancelledBy: coachingCallsTable.cancelledBy })
      .from(coachingCallsTable)
      .where(eq(coachingCallsTable.id, coachACallId));
    expect(afterRestore.cancelledAt).toBeNull();
    expect(afterRestore.cancelledBy).toBeNull();
  });

  it("forbids a coach from cancelling another coach's call", async () => {
    const res = await request(app)
      .post(`/api/coach/group-calls/${coachBCallId}/cancel`)
      .set("Cookie", coachACookie);
    expect(res.status).toBe(403);

    const [row] = await db
      .select({ cancelledAt: coachingCallsTable.cancelledAt })
      .from(coachingCallsTable)
      .where(eq(coachingCallsTable.id, coachBCallId));
    expect(row.cancelledAt).toBeNull();
  });

  it("lets an admin cancel any coach's call", async () => {
    const res = await request(app)
      .post(`/api/coach/group-calls/${coachBCallId}/cancel`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
    // restore it so other assertions stay clean
    await request(app)
      .post(`/api/coach/group-calls/${coachBCallId}/restore`)
      .set("Cookie", adminCookie);
  });

  it("404s when the call does not exist", async () => {
    const res = await request(app)
      .post(`/api/coach/group-calls/999999999/cancel`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });
});
