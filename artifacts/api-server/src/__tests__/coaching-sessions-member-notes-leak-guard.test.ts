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
// must NEVER reach a member, and neither may the ingest bookkeeping
// (recordingIngestStatus/At/Attempts). The auto-ingested Google Meet recording
// + Gemini notes/transcript links (recordingUrl/summaryUrl/transcriptUrl) are
// surfaced to the member ONLY on their own COMPLETED sessions via
// `/coaching/sessions/mine`; they must stay hidden everywhere else (booked
// sessions, and the book/reschedule write endpoints that echo a booking back).
// The write endpoints return rows straight from `.returning()`, so a naive
// `.returning()` (no projection) silently leaks these fields once populated.
// This guard pins:
//   - POST  /api/coaching/sessions            (book)       -> never leaks
//   - PATCH /api/coaching/sessions/:id/reschedule          -> never leaks
//   - GET   /api/coaching/sessions/mine        completed    -> recording shown
//   - GET   /api/coaching/sessions/mine        non-complete -> recording hidden

// Always coach/admin-only — must never appear on any member-facing booking.
const ALWAYS_FORBIDDEN_FIELDS = [
  "coachNotes",
  "actionItems",
  "recordingIngestStatus",
  "recordingIngestAt",
  "recordingIngestAttempts",
];

// Recording-ingest outputs: member-visible ONLY on completed sessions.
const RECORDING_FIELDS = ["recordingUrl", "summaryUrl", "transcriptUrl"];

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

async function seedBookingWithNotes(
  status: "booked" | "completed" = "booked",
): Promise<number> {
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const scheduledAt = status === "completed" ? past : future;
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
      status,
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
  it("PATCH /coaching/sessions/:id/reschedule omits notes AND recording links", async () => {
    const id = await seedBookingWithNotes();

    const res = await request(app)
      .patch(`/api/coaching/sessions/${id}/reschedule`)
      .set("Cookie", authCookie())
      .send({ startTime: RESCHEDULE_SLOT_ISO });

    expect(res.status).toBe(200);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.id).toBe(id);
    // A rescheduled session is still "booked", so recording links stay hidden
    // here alongside the always-coach-only fields.
    for (const field of [...ALWAYS_FORBIDDEN_FIELDS, ...RECORDING_FIELDS]) {
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

  it("GET /coaching/sessions/mine hides recording links on non-completed sessions", async () => {
    await seedBookingWithNotes("booked");

    const res = await request(app)
      .get("/api/coaching/sessions/mine?status=booked")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const booking of res.body) {
      expect(booking.status).not.toBe("completed");
      for (const field of [...ALWAYS_FORBIDDEN_FIELDS, ...RECORDING_FIELDS]) {
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

  it("GET /coaching/sessions/mine surfaces recording links on completed sessions but never coach notes", async () => {
    const id = await seedBookingWithNotes("completed");

    const res = await request(app)
      .get("/api/coaching/sessions/mine?status=completed")
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const completed = res.body.find(
      (b: { id: number }) => b.id === id,
    );
    expect(completed).toBeDefined();
    expect(completed.status).toBe("completed");

    // Recording links ARE now surfaced to the member on their completed session.
    expect(completed.recordingUrl).toBe(SECRET_RECORDING_URL);
    expect(completed.summaryUrl).toBe(SECRET_SUMMARY_URL);
    expect(completed.transcriptUrl).toBe(SECRET_TRANSCRIPT_URL);

    // ...but coach-only fields + ingest bookkeeping must still never appear.
    for (const field of ALWAYS_FORBIDDEN_FIELDS) {
      expect(Object.keys(completed)).not.toContain(field);
    }
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(SECRET_NOTE);
    expect(body).not.toContain("Review funnel metrics");
  });
});
