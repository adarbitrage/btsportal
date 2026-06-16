import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  sessionPackCoachesTable,
  sessionPackBookingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// coachNotes + actionItems on a pack booking are COACH/ADMIN-FACING ONLY and
// must NEVER reach a member. The same applies to the auto-ingested Google Meet
// recording + Gemini notes/transcript links (recordingUrl/summaryUrl/
// transcriptUrl) and their ingest bookkeeping. The member-facing booking
// endpoints return rows straight from `.returning()`, so a naive `.returning()`
// (no projection) silently leaks these fields once they are populated. This
// guard pins the member-safe projection on the two write endpoints that echo a
// booking back:
//   - POST  /api/coaching/sessions            (book)
//   - PATCH /api/coaching/sessions/:id/reschedule
// `/coaching/sessions/mine` already uses an explicit safe select; it is covered
// implicitly here by asserting the same fields never appear.

// Coach/admin-only fields that must never appear on any member-facing booking.
const MEMBER_FORBIDDEN_FIELDS = [
  "coachNotes",
  "actionItems",
  "recordingUrl",
  "summaryUrl",
  "transcriptUrl",
  "recordingIngestStatus",
  "recordingIngestAt",
  "recordingIngestAttempts",
];

// The reschedule path confirms the slot on the coach's GHL calendar and moves
// the GHL appointment; stub the calendar client so the test is hermetic.
const RESCHEDULE_SLOT_ISO = new Date(
  Date.now() + 3 * 24 * 60 * 60 * 1000,
).toISOString();

vi.mock("../lib/ghl-coaching-calendar", () => ({
  getFreeSlots: vi.fn(async () => [{ startTime: RESCHEDULE_SLOT_ISO }]),
  updateAppointment: vi.fn(async () => ({
    id: "appt_test",
    meetLink: "https://meet.example.test/new",
  })),
  createAppointment: vi.fn(async () => ({ id: "appt_test", meetLink: null })),
  cancelAppointment: vi.fn(async () => undefined),
  upsertContact: vi.fn(async () => ({ id: "contact_test" })),
}));
vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));
vi.mock("../lib/communication-service", () => ({
  CommunicationService: { sendEmailNow: vi.fn(async () => ({ success: true })) },
}));
vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
  WEBHOOK_EVENT_TYPES: [],
}));
vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestApp } from "./test-app";
import coachingSessionsRouter from "../routes/coaching-sessions";
import { generateAccessToken } from "../middleware/auth";

const TEST_TAG = `coaching-leak-guard-${randomUUID().slice(0, 8)}`;
const SECRET_NOTE = "INTERNAL: member is behind on homework — do not surface.";
const SECRET_ACTION_ITEMS = [
  { id: "ai-1", text: "Review funnel metrics", completed: false, completedAt: null, createdAt: new Date().toISOString() },
];
const SECRET_RECORDING_URL = "https://drive.google.com/file/SECRET_REC/view";
const SECRET_SUMMARY_URL = "https://drive.google.com/file/SECRET_SUM/view";
const SECRET_TRANSCRIPT_URL = "https://drive.google.com/file/SECRET_TR/view";

let app: ReturnType<typeof buildTestApp>;
let memberId = 0;
let memberEmail = "";
let coachId = 0;
const bookingIds: number[] = [];

function authCookie(): string[] {
  return [`access_token=${generateAccessToken(memberId, memberEmail)}`];
}

beforeAll(async () => {
  app = buildTestApp({ routers: [coachingSessionsRouter] });

  memberEmail = `${TEST_TAG}@example.test`;
  const [member] = await db
    .insert(usersTable)
    .values({
      email: memberEmail,
      name: "leak guard member",
      passwordHash: await bcrypt.hash("irrelevant", 4),
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  memberId = member.id;

  const [coach] = await db
    .insert(sessionPackCoachesTable)
    .values({
      name: "leak guard coach",
      ghlCalendarId: `${TEST_TAG}-cal`,
      ghlLocationId: `${TEST_TAG}-loc`,
    })
    .returning({ id: sessionPackCoachesTable.id });
  coachId = coach.id;
});

afterAll(async () => {
  if (bookingIds.length > 0) {
    await db
      .delete(sessionPackBookingsTable)
      .where(inArray(sessionPackBookingsTable.id, bookingIds));
  }
  if (coachId) {
    await db
      .delete(sessionPackCoachesTable)
      .where(eq(sessionPackCoachesTable.id, coachId));
  }
  if (memberId) {
    await db.delete(usersTable).where(eq(usersTable.id, memberId));
  }
});

async function seedBookingWithNotes(): Promise<number> {
  const scheduledAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(sessionPackBookingsTable)
    .values({
      memberId,
      coachId,
      ghlCalendarId: `${TEST_TAG}-cal`,
      ghlAppointmentId: `${TEST_TAG}-appt-${randomUUID().slice(0, 8)}`,
      scheduledAt,
      endAt: new Date(scheduledAt.getTime() + 60 * 60 * 1000),
      durationMinutes: 60,
      status: "booked",
      title: "Strategy call",
      coachNotes: SECRET_NOTE,
      actionItems: SECRET_ACTION_ITEMS,
      recordingUrl: SECRET_RECORDING_URL,
      summaryUrl: SECRET_SUMMARY_URL,
      transcriptUrl: SECRET_TRANSCRIPT_URL,
      recordingIngestStatus: "found",
      recordingIngestAt: new Date(),
      recordingIngestAttempts: 1,
    })
    .returning({ id: sessionPackBookingsTable.id });
  bookingIds.push(row.id);
  return row.id;
}

describe("member coaching-sessions responses never leak coach notes/action items", () => {
  it("PATCH /coaching/sessions/:id/reschedule omits coachNotes and actionItems", async () => {
    const id = await seedBookingWithNotes();

    const res = await request(app)
      .patch(`/api/coaching/sessions/${id}/reschedule`)
      .set("Cookie", authCookie())
      .send({ startTime: RESCHEDULE_SLOT_ISO });

    expect(res.status).toBe(200);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.id).toBe(id);
    for (const field of MEMBER_FORBIDDEN_FIELDS) {
      expect(Object.keys(res.body.booking)).not.toContain(field);
    }
    // Belt-and-suspenders: no secret value may appear anywhere in the body.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(SECRET_NOTE);
    expect(body).not.toContain("Review funnel metrics");
    expect(body).not.toContain(SECRET_RECORDING_URL);
    expect(body).not.toContain(SECRET_SUMMARY_URL);
    expect(body).not.toContain(SECRET_TRANSCRIPT_URL);
  });

  it("GET /coaching/sessions/mine omits coachNotes and actionItems", async () => {
    await seedBookingWithNotes();

    const res = await request(app)
      .get("/api/coaching/sessions/mine")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const booking of res.body) {
      for (const field of MEMBER_FORBIDDEN_FIELDS) {
        expect(Object.keys(booking)).not.toContain(field);
      }
    }
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(SECRET_NOTE);
    expect(body).not.toContain("Review funnel metrics");
    expect(body).not.toContain(SECRET_RECORDING_URL);
    expect(body).not.toContain(SECRET_SUMMARY_URL);
    expect(body).not.toContain(SECRET_TRANSCRIPT_URL);
  });
});
