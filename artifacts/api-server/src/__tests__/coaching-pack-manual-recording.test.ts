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
import { eq, inArray } from "drizzle-orm";

// Coaches/admins can manually attach recording / summary / transcript links to
// a pack booking when auto-matching missed. The moment any link is set by hand
// the booking's ingest status flips to "manual" so the auto-ingest pass (which
// only selects rows in the "pending" state) never clobbers the hand-entered
// links. Clearing every link reverts the status to "pending".

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));
vi.mock("../lib/ghl-coaching-calendar", () => ({
  cancelAppointment: vi.fn(async () => undefined),
  COACHING_LOCATION_ID: "loc_test",
}));
vi.mock("../lib/coaching-notes", () => ({
  normalizeActionItems: (x: unknown) => x ?? [],
  syncBookingCoachingToGHL: vi.fn(async () => undefined),
}));

import { buildTestAppWithRouters } from "./test-app";
import adminCoachingSessionsRouter from "../routes/admin-coaching-sessions";
import coachDashboardRouter from "../routes/coach-dashboard";
import { MAX_INGEST_ATTEMPTS } from "../lib/coaching-recording-ingest";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `pack-manual-rec-${randomUUID().slice(0, 8)}`;
const REC_URL = "https://drive.google.com/file/MANUAL_REC/view";
const SUM_URL = "https://docs.google.com/document/MANUAL_SUM/edit";

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let coachCookie: string;
let memberCookie: string;
const userIds: number[] = [];
const coachIds: number[] = [];
const bookingIds: number[] = [];

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

async function insertBooking(
  memberId: number,
  coachId: number,
  attempts = 0,
): Promise<number> {
  const now = Date.now();
  const [row] = await db
    .insert(sessionPackBookingsTable)
    .values({
      memberId,
      coachId,
      ghlCalendarId: `${TAG}-cal`,
      scheduledAt: new Date(now - 86_400_000),
      endAt: new Date(now - 86_400_000 + 3_600_000),
      status: "completed",
      title: "Strategy call",
      recordingIngestStatus: "not_found",
      recordingIngestAttempts: attempts,
    })
    .returning({ id: sessionPackBookingsTable.id });
  bookingIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([
    adminCoachingSessionsRouter,
    coachDashboardRouter,
  ]);

  const adminId = await insertUser("super_admin", "admin");
  adminCookie = signCookie(adminId, `${TAG}-admin@example.test`);

  const coachUserId = await insertUser("coach", "coach");
  coachCookie = signCookie(coachUserId, `${TAG}-coach@example.test`);

  const memberId = await insertUser("member", "member");
  memberCookie = signCookie(memberId, `${TAG}-member@example.test`);

  const [coach] = await db
    .insert(sessionPackCoachesTable)
    .values({
      name: "Manual rec coach",
      ghlCalendarId: `${TAG}-cal`,
      ghlLocationId: `${TAG}-loc`,
    })
    .returning({ id: sessionPackCoachesTable.id });
  coachIds.push(coach.id);

  // booking[0] starts at the retry cap so the clear-test can prove attempts reset.
  await insertBooking(memberId, coach.id, MAX_INGEST_ATTEMPTS);
  await insertBooking(memberId, coach.id);
  await insertBooking(memberId, coach.id);
  // booking[3]: capped, for the coach clear-all parity test.
  await insertBooking(memberId, coach.id, MAX_INGEST_ATTEMPTS);
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

async function readStatus(id: number) {
  const [row] = await db
    .select({
      recordingUrl: sessionPackBookingsTable.recordingUrl,
      summaryUrl: sessionPackBookingsTable.summaryUrl,
      transcriptUrl: sessionPackBookingsTable.transcriptUrl,
      recordingIngestStatus: sessionPackBookingsTable.recordingIngestStatus,
      recordingIngestAttempts: sessionPackBookingsTable.recordingIngestAttempts,
    })
    .from(sessionPackBookingsTable)
    .where(eq(sessionPackBookingsTable.id, id));
  return row;
}

describe("admin manual recording attach", () => {
  it("PATCH /admin/coaching/pack/sessions/:id/recording sets links and flips status to manual", async () => {
    const id = bookingIds[0];
    const res = await request(app)
      .patch(`/api/admin/coaching/pack/sessions/${id}/recording`)
      .set("Cookie", adminCookie)
      .send({ recordingUrl: REC_URL, summaryUrl: SUM_URL });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.booking.recordingUrl).toBe(REC_URL);
    expect(res.body.booking.recordingIngestStatus).toBe("manual");

    const row = await readStatus(id);
    expect(row.recordingUrl).toBe(REC_URL);
    expect(row.summaryUrl).toBe(SUM_URL);
    expect(row.recordingIngestStatus).toBe("manual");
  });

  it("clearing all links reverts status to pending so auto-ingest can resume", async () => {
    const id = bookingIds[0];
    const res = await request(app)
      .patch(`/api/admin/coaching/pack/sessions/${id}/recording`)
      .set("Cookie", adminCookie)
      .send({ recordingUrl: "", summaryUrl: "", transcriptUrl: "" });

    expect(res.status).toBe(200);
    expect(res.body.booking.recordingIngestStatus).toBe("pending");
    // booking[0] was seeded at the retry cap; clearing must reset attempts so
    // the pending-only auto-ingest pass (attempts < MAX) becomes eligible again.
    expect(res.body.booking.recordingIngestAttempts).toBe(0);

    const row = await readStatus(id);
    expect(row.recordingUrl).toBeNull();
    expect(row.summaryUrl).toBeNull();
    expect(row.recordingIngestStatus).toBe("pending");
    expect(row.recordingIngestAttempts).toBe(0);
  });

  it("rejects a non-http(s) URL", async () => {
    const id = bookingIds[0];
    const res = await request(app)
      .patch(`/api/admin/coaching/pack/sessions/${id}/recording`)
      .set("Cookie", adminCookie)
      .send({ recordingUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty payload (no fields provided)", async () => {
    const id = bookingIds[0];
    const res = await request(app)
      .patch(`/api/admin/coaching/pack/sessions/${id}/recording`)
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("404s for an unknown booking", async () => {
    const res = await request(app)
      .patch(`/api/admin/coaching/pack/sessions/99999999/recording`)
      .set("Cookie", adminCookie)
      .send({ recordingUrl: REC_URL });
    expect(res.status).toBe(404);
  });

  it("forbids a member", async () => {
    const id = bookingIds[1];
    const res = await request(app)
      .patch(`/api/admin/coaching/pack/sessions/${id}/recording`)
      .set("Cookie", memberCookie)
      .send({ recordingUrl: REC_URL });
    expect(res.status).toBe(403);
  });
});

describe("coach manual recording attach", () => {
  it("PATCH /coach/dashboard/pack/sessions/:id/recording sets links and flips status to manual", async () => {
    const id = bookingIds[2];
    const res = await request(app)
      .patch(`/api/coach/dashboard/pack/sessions/${id}/recording`)
      .set("Cookie", coachCookie)
      .send({ recordingUrl: REC_URL });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.booking.recordingIngestStatus).toBe("manual");

    const row = await readStatus(id);
    expect(row.recordingUrl).toBe(REC_URL);
    expect(row.recordingIngestStatus).toBe("manual");
  });

  it("clearing all links reverts status to pending and resets attempts", async () => {
    const id = bookingIds[3];
    // First attach a link (capped, not_found -> manual).
    const setRes = await request(app)
      .patch(`/api/coach/dashboard/pack/sessions/${id}/recording`)
      .set("Cookie", coachCookie)
      .send({ recordingUrl: REC_URL });
    expect(setRes.status).toBe(200);
    expect(setRes.body.booking.recordingIngestStatus).toBe("manual");

    // Then clear everything -> pending + attempts reset so auto-ingest resumes.
    const clearRes = await request(app)
      .patch(`/api/coach/dashboard/pack/sessions/${id}/recording`)
      .set("Cookie", coachCookie)
      .send({ recordingUrl: "", summaryUrl: "", transcriptUrl: "" });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.booking.recordingIngestStatus).toBe("pending");
    expect(clearRes.body.booking.recordingIngestAttempts).toBe(0);

    const row = await readStatus(id);
    expect(row.recordingUrl).toBeNull();
    expect(row.recordingIngestStatus).toBe("pending");
    expect(row.recordingIngestAttempts).toBe(0);
  });

  it("forbids a member", async () => {
    const id = bookingIds[2];
    const res = await request(app)
      .patch(`/api/coach/dashboard/pack/sessions/${id}/recording`)
      .set("Cookie", memberCookie)
      .send({ recordingUrl: REC_URL });
    expect(res.status).toBe(403);
  });
});
