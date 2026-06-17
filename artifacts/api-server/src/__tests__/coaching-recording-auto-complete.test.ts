import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  sessionPackBookingsTable,
  sessionPackCoachesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// When the recording ingest links a Meet recording to a booking we have strong
// evidence the call happened, so the booking is auto-completed — but guarded to
// booked -> completed only and idempotent (an existing terminal status is never
// overridden). A past booking with no recording is surfaced as "likely no-show"
// for coach review, NOT auto-set to no_show (which would refund a credit).

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

// Decouple from the (separately tested) Drive search + filename matcher: we
// drive the match result directly so we can assert the completion behaviour.
const hoisted = vi.hoisted(() => ({
  match: {
    recordingUrl: null as string | null,
    summaryUrl: null as string | null,
    transcriptUrl: null as string | null,
  },
}));
vi.mock("../lib/coaching-recording-matcher", () => ({
  matchBookingFiles: () => hoisted.match,
}));
vi.mock("../lib/google-drive-client", () => ({
  searchDriveFiles: async () => [],
  hasAnyDriveSource: async () => true,
}));

import { ingestBookingRecording } from "../lib/coaching-recording-ingest";
import { queryPackBookings } from "../lib/pack-bookings";

const TAG = `pack-autocomplete-${randomUUID().slice(0, 8)}`;
const REC_URL = "https://drive.google.com/file/AUTO_REC/view";

const userIds: number[] = [];
const coachIds: number[] = [];
const bookingIds: number[] = [];

let memberId: number;
let coachId: number;

async function insertUser(role: string, suffix: string): Promise<number> {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${suffix}@example.test`,
      name: `User ${suffix}`,
      passwordHash: "x",
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

async function insertBooking(opts: {
  status?: string;
  recordingIngestStatus?: string;
  recordingUrl?: string | null;
  attempts?: number;
  endOffsetMs?: number;
}): Promise<number> {
  const now = Date.now();
  const endOffset = opts.endOffsetMs ?? -86_400_000; // default: ended yesterday
  const [row] = await db
    .insert(sessionPackBookingsTable)
    .values({
      memberId,
      coachId,
      ghlCalendarId: `${TAG}-cal`,
      scheduledAt: new Date(now + endOffset - 1_800_000),
      endAt: new Date(now + endOffset),
      status: opts.status ?? "booked",
      title: "Coaching with Sasha",
      recordingUrl: opts.recordingUrl ?? null,
      recordingIngestStatus: opts.recordingIngestStatus ?? "pending",
      recordingIngestAttempts: opts.attempts ?? 0,
    })
    .returning({ id: sessionPackBookingsTable.id });
  bookingIds.push(row.id);
  return row.id;
}

async function readBooking(id: number) {
  const [row] = await db
    .select({
      status: sessionPackBookingsTable.status,
      outcomeAt: sessionPackBookingsTable.outcomeAt,
      recordingUrl: sessionPackBookingsTable.recordingUrl,
      recordingIngestStatus: sessionPackBookingsTable.recordingIngestStatus,
    })
    .from(sessionPackBookingsTable)
    .where(eq(sessionPackBookingsTable.id, id));
  return row;
}

beforeAll(async () => {
  memberId = await insertUser("member", "member");
  const [coach] = await db
    .insert(sessionPackCoachesTable)
    .values({
      name: "Sasha",
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

describe("recording ingest auto-completes a booking", () => {
  it("a found recording flips a booked session to completed with outcomeAt", async () => {
    hoisted.match = { recordingUrl: REC_URL, summaryUrl: null, transcriptUrl: null };
    const id = await insertBooking({ status: "booked" });

    const status = await ingestBookingRecording({
      id,
      title: "Coaching with Sasha",
      scheduledAt: new Date(Date.now() - 86_400_000 - 1_800_000),
      endAt: new Date(Date.now() - 86_400_000),
      recordingIngestAttempts: 0,
    });
    expect(status).toBe("found");

    const row = await readBooking(id);
    expect(row.status).toBe("completed");
    expect(row.outcomeAt).not.toBeNull();
    expect(row.recordingUrl).toBe(REC_URL);
    expect(row.recordingIngestStatus).toBe("found");
  });

  it("never overrides an existing terminal status (idempotent, manual outcome wins)", async () => {
    hoisted.match = { recordingUrl: REC_URL, summaryUrl: null, transcriptUrl: null };
    const id = await insertBooking({ status: "no_show" });

    const status = await ingestBookingRecording({
      id,
      title: "Coaching with Sasha",
      scheduledAt: new Date(Date.now() - 86_400_000 - 1_800_000),
      endAt: new Date(Date.now() - 86_400_000),
      recordingIngestAttempts: 0,
    });
    expect(status).toBe("found");

    const row = await readBooking(id);
    // Status stays no_show; only the links are still attached for reference.
    expect(row.status).toBe("no_show");
    expect(row.recordingUrl).toBe(REC_URL);
  });

  it("does not complete when no recording is found", async () => {
    hoisted.match = { recordingUrl: null, summaryUrl: null, transcriptUrl: null };
    const id = await insertBooking({ status: "booked" });

    await ingestBookingRecording({
      id,
      title: "Coaching with Sasha",
      scheduledAt: new Date(Date.now() - 86_400_000 - 1_800_000),
      endAt: new Date(Date.now() - 86_400_000),
      recordingIngestAttempts: 0,
    });

    const row = await readBooking(id);
    expect(row.status).toBe("booked");
    expect(row.outcomeAt).toBeNull();
  });
});

describe("likelyNoShow derived flag", () => {
  it("flags a past booked session whose ingest finished without a recording", async () => {
    const id = await insertBooking({
      status: "booked",
      recordingIngestStatus: "not_found",
      recordingUrl: null,
    });
    const result = await queryPackBookings({ q: TAG, limit: 200 });
    const row = result.bookings.find((b) => b.id === id);
    expect(row?.likelyNoShow).toBe(true);
  });

  it("does not flag while ingest is still pending (not done looking yet)", async () => {
    const id = await insertBooking({
      status: "booked",
      recordingIngestStatus: "pending",
      recordingUrl: null,
    });
    const result = await queryPackBookings({ q: TAG, limit: 200 });
    const row = result.bookings.find((b) => b.id === id);
    expect(row?.likelyNoShow).toBe(false);
  });

  it("does not flag a future booked session", async () => {
    const id = await insertBooking({
      status: "booked",
      recordingIngestStatus: "not_found",
      recordingUrl: null,
      endOffsetMs: 86_400_000,
    });
    const result = await queryPackBookings({ q: TAG, limit: 200 });
    const row = result.bookings.find((b) => b.id === id);
    expect(row?.likelyNoShow).toBe(false);
  });

  it("does not flag a completed session with a recording", async () => {
    const id = await insertBooking({
      status: "completed",
      recordingIngestStatus: "found",
      recordingUrl: REC_URL,
    });
    const result = await queryPackBookings({ q: TAG, limit: 200 });
    const row = result.bookings.find((b) => b.id === id);
    expect(row?.likelyNoShow).toBe(false);
  });
});
