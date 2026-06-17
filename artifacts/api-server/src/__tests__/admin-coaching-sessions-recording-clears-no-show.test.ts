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

// Guards the data-derivation rule that the portal "Likely no-show" badge/shortcut
// depends on: once a recording is attached to a past, still-booked session the
// server must stop returning likelyNoShow=true for it. The portal tests only
// prove the UI round-trip (they mock the API), so this exercises the real
// set-recording route + the likelyNoShow derivation end to end against the DB.

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `pack-clns-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
const userIds: number[] = [];
const coachIds: number[] = [];
const bookingIds: number[] = [];

let memberId: number;
let coachId: number;

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

// A past, still-booked session whose ingest finished without finding a
// recording — the exact shape that derives likelyNoShow=true.
async function insertPastBookedNoRecording(hoursAgo: number): Promise<number> {
  const base = Date.now() - hoursAgo * 3_600_000;
  const [row] = await db
    .insert(sessionPackBookingsTable)
    .values({
      memberId,
      coachId,
      ghlCalendarId: `${TAG}-cal`,
      scheduledAt: new Date(base),
      endAt: new Date(base + 1_800_000),
      status: "booked",
      recordingUrl: null,
      recordingIngestStatus: "not_found",
    })
    .returning({ id: sessionPackBookingsTable.id });
  bookingIds.push(row.id);
  return row.id;
}

async function listRows() {
  const res = await request(app)
    .get("/api/admin/coaching/pack/sessions")
    .query({ q: TAG, limit: 200 })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  return res.body.bookings as Array<{ id: number; likelyNoShow: boolean }>;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminCoachingSessionsRouter]);

  const adminId = await insertUser("super_admin", "admin");
  adminCookie = signCookie(adminId, `${TAG}-admin@example.test`);

  memberId = await insertUser("member", "m");

  const [coach] = await db
    .insert(sessionPackCoachesTable)
    .values({
      name: `Coach ${TAG}`,
      ghlCalendarId: `${TAG}-cal`,
      ghlLocationId: `${TAG}-loc`,
    })
    .returning({ id: sessionPackCoachesTable.id });
  coachIds.push(coach.id);
  coachId = coach.id;
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

describe("attaching a recording clears the likely-no-show flag", () => {
  it("a past booked session with a recording is never flagged, while a comparable one without a recording still is", async () => {
    const attachId = await insertPastBookedNoRecording(48);
    const controlId = await insertPastBookedNoRecording(50);

    // Both start out flagged: past + still booked + ingest finished + no recording.
    const before = await listRows();
    expect(before.find((b) => b.id === attachId)?.likelyNoShow).toBe(true);
    expect(before.find((b) => b.id === controlId)?.likelyNoShow).toBe(true);

    // Attach a recording to one of them via the real set-recording route. The
    // route only attaches the link (status stays "booked"); the flag must clear
    // purely because a recording is now present.
    const patch = await request(app)
      .patch(`/api/admin/coaching/pack/sessions/${attachId}/recording`)
      .set("Cookie", adminCookie)
      .send({ recordingUrl: "https://drive.google.com/file/MANUAL_REC/view" });
    expect(patch.status).toBe(200);
    expect(patch.body.booking.recordingUrl).toBe(
      "https://drive.google.com/file/MANUAL_REC/view",
    );
    // Still booked — the route does not auto-complete.
    expect(patch.body.booking.status).toBe("booked");

    // The derived flag must now be false for the recorded session, and remain
    // true for the untouched control.
    const after = await listRows();
    expect(after.find((b) => b.id === attachId)?.likelyNoShow).toBe(false);
    expect(after.find((b) => b.id === controlId)?.likelyNoShow).toBe(true);
  });
});
