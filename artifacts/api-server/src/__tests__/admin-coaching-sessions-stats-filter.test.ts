import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  sessionPackBookingsTable,
  sessionPackCoachesTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminCoachingSessionsRouter from "../routes/admin-coaching-sessions";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `pack-stats-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
const userIds: number[] = [];
const coachIds: number[] = [];
const bookingIds: number[] = [];

let memberAId: number;
let memberBId: number;
let memberBEmail: string;
let coach1Id: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const email = `${TAG}-${suffix}@example.test`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Member ${suffix}`,
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

async function insertCoach(suffix: string): Promise<number> {
  const [row] = await db
    .insert(sessionPackCoachesTable)
    .values({
      name: `Coach ${suffix}`,
      ghlCalendarId: `${TAG}-cal-${suffix}`,
      ghlLocationId: `${TAG}-loc`,
    })
    .returning({ id: sessionPackCoachesTable.id });
  coachIds.push(row.id);
  return row.id;
}

async function insertBooking(
  memberId: number,
  coachId: number,
  status: string,
): Promise<void> {
  const now = Date.now();
  const [row] = await db
    .insert(sessionPackBookingsTable)
    .values({
      memberId,
      coachId,
      ghlCalendarId: `${TAG}-cal`,
      scheduledAt: new Date(now + 86_400_000),
      endAt: new Date(now + 86_400_000 + 1_800_000),
      status,
    })
    .returning({ id: sessionPackBookingsTable.id });
  bookingIds.push(row.id);
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminCoachingSessionsRouter]);

  const adminId = await insertUser("super_admin", "admin");
  adminCookie = signCookie(adminId, `${TAG}-admin@example.test`);

  memberAId = await insertUser("member", "a");
  memberBId = await insertUser("member", "b");
  memberBEmail = `${TAG}-b@example.test`;

  coach1Id = await insertCoach("1");
  const coach2Id = await insertCoach("2");

  // Member A with coach 1: one booked, one completed.
  await insertBooking(memberAId, coach1Id, "booked");
  await insertBooking(memberAId, coach1Id, "completed");
  // Member B with coach 2: one cancelled, one no_show.
  await insertBooking(memberBId, coach2Id, "cancelled");
  await insertBooking(memberBId, coach2Id, "no_show");
});

afterAll(async () => {
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

describe("GET /api/admin/coaching/sessions — stats honour the same filters as rows", () => {
  it("returns global-but-test-scoped stats when filtering only to this test's members", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/sessions")
      .query({ q: TAG, limit: 200 })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.stats).toMatchObject({
      booked: 1,
      completed: 1,
      cancelled: 1,
      no_show: 1,
    });
  });

  it("scopes stats to a single coach when coachId is applied", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/sessions")
      .query({ coachId: coach1Id, limit: 200 })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.stats).toMatchObject({
      booked: 1,
      completed: 1,
      cancelled: 0,
      no_show: 0,
    });
  });

  it("scopes stats to a member-search query (join-dependent filter)", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/sessions")
      .query({ q: memberBEmail, limit: 200 })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.stats).toMatchObject({
      booked: 0,
      completed: 0,
      cancelled: 1,
      no_show: 1,
    });
  });

  it("scopes stats to a single status filter", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/sessions")
      .query({ status: "booked", q: TAG, limit: 200 })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.stats).toMatchObject({
      booked: 1,
      completed: 0,
      cancelled: 0,
      no_show: 0,
    });
  });
});
