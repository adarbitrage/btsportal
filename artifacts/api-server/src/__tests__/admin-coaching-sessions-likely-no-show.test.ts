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
const TAG = `pack-lns-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
const userIds: number[] = [];
const coachIds: number[] = [];
const bookingIds: number[] = [];

let memberId: number;
let coachId: number;
let flaggedBookingId: number;

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

interface BookingOpts {
  status: string;
  /** Whole-hours offset of the session window relative to now (negative = past). */
  hoursFromNow: number;
  recordingUrl?: string | null;
  recordingIngestStatus?: string;
}

async function insertBooking(opts: BookingOpts): Promise<number> {
  const base = Date.now() + opts.hoursFromNow * 3_600_000;
  const [row] = await db
    .insert(sessionPackBookingsTable)
    .values({
      memberId,
      coachId,
      ghlCalendarId: `${TAG}-cal`,
      scheduledAt: new Date(base),
      endAt: new Date(base + 1_800_000),
      status: opts.status,
      recordingUrl: opts.recordingUrl ?? null,
      ...(opts.recordingIngestStatus
        ? { recordingIngestStatus: opts.recordingIngestStatus }
        : {}),
    })
    .returning({ id: sessionPackBookingsTable.id });
  bookingIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminCoachingSessionsRouter]);

  const adminId = await insertUser("super_admin", "admin");
  adminCookie = signCookie(adminId, `${TAG}-admin@example.test`);

  memberId = await insertUser("member", "m");
  coachId = await insertCoach("1");

  // The one row that satisfies the derived "likely no-show" predicate:
  // past + still booked + no recording + ingest finished (not "pending").
  flaggedBookingId = await insertBooking({
    status: "booked",
    hoursFromNow: -48,
    recordingUrl: null,
    recordingIngestStatus: "not_found",
  });

  // Negative cases — each breaks exactly one clause of the predicate:
  // future booked session (endAt not in the past).
  await insertBooking({
    status: "booked",
    hoursFromNow: 48,
    recordingUrl: null,
    recordingIngestStatus: "not_found",
  });
  // past booked session, but a recording was found.
  await insertBooking({
    status: "booked",
    hoursFromNow: -50,
    recordingUrl: "https://example.test/rec.mp4",
    recordingIngestStatus: "found",
  });
  // past booked session, but ingest is still pending (not finished looking).
  await insertBooking({
    status: "booked",
    hoursFromNow: -52,
    recordingUrl: null,
    recordingIngestStatus: "pending",
  });
  // past session that already has a resolved outcome (not "booked").
  await insertBooking({
    status: "no_show",
    hoursFromNow: -54,
    recordingUrl: null,
    recordingIngestStatus: "not_found",
  });
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

describe("GET /api/admin/coaching/pack/sessions — likely-no-show filter & stat", () => {
  it("likelyNoShow=true returns only the flagged row", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/pack/sessions")
      .query({ q: TAG, likelyNoShow: "true", limit: 200 })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0].id).toBe(flaggedBookingId);
    expect(res.body.bookings[0].likelyNoShow).toBe(true);
  });

  it("derives likelyNoShow per-row in the unfiltered list", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/pack/sessions")
      .query({ q: TAG, limit: 200 })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    const flagged = res.body.bookings.filter(
      (b: { likelyNoShow: boolean }) => b.likelyNoShow === true,
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].id).toBe(flaggedBookingId);
  });

  it("stats.likely_no_show is populated and independent of the status filter", async () => {
    const unfiltered = await request(app)
      .get("/api/admin/coaching/pack/sessions")
      .query({ q: TAG, limit: 200 })
      .set("Cookie", adminCookie);
    expect(unfiltered.status).toBe(200);
    expect(unfiltered.body.stats.likely_no_show).toBe(1);

    // Filtering to a status that excludes the flagged (booked) row must NOT
    // zero out the likely_no_show count — it stays visible for review.
    const noShowOnly = await request(app)
      .get("/api/admin/coaching/pack/sessions")
      .query({ q: TAG, status: "no_show", limit: 200 })
      .set("Cookie", adminCookie);
    expect(noShowOnly.status).toBe(200);
    expect(noShowOnly.body.total).toBe(1);
    expect(noShowOnly.body.stats.likely_no_show).toBe(1);

    // Likewise applying likelyNoShow=true narrows the rows but the stat count
    // stays stable (ignores its own filter).
    const flaggedOnly = await request(app)
      .get("/api/admin/coaching/pack/sessions")
      .query({ q: TAG, likelyNoShow: "true", limit: 200 })
      .set("Cookie", adminCookie);
    expect(flaggedOnly.status).toBe(200);
    expect(flaggedOnly.body.stats.likely_no_show).toBe(1);
  });
});
