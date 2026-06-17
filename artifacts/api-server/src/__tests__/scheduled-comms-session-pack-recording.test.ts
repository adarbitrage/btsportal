import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  sessionPackCoachesTable,
  sessionPackBookingsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

// Exercise the 1-on-1 (session-pack) "recording ready" notification: recipient
// selection, the per-booking DEEP LINK into that booking's recording, the
// SMS category gate, and per-key dedup. Email/SMS senders + the Postgres dedup
// helper are mocked (in-memory Set keyed on sendKey) so repeated scheduler runs
// exercise dedup for real without Redis.
const { queueEmailMock, queueSmsMock, sentKeys, sentChannels, checkAndRecordSendMock } =
  vi.hoisted(() => {
    const sentKeys = new Set<string>();
    const sentChannels: Array<{ sendKey: string; channel: string }> = [];
    return {
      sentKeys,
      sentChannels,
      queueEmailMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
      queueSmsMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
      checkAndRecordSendMock: vi.fn(async (sendKey: string, channel: string) => {
        sentChannels.push({ sendKey, channel });
        if (sentKeys.has(sendKey)) return "duplicate";
        sentKeys.add(sendKey);
        return "recorded";
      }),
    };
  });

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
    queueSms: queueSmsMock,
  },
}));

vi.mock("../lib/comms-dedup", () => ({
  checkAndRecordSend: checkAndRecordSendMock,
  wasSent: vi.fn(async () => false),
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  QUEUE_REDIS_OPTIONS: {},
  makeThrottledRedisErrorLogger: () => () => undefined,
}));

import { processSessionPackRecordingReadyNotifications } from "../lib/scheduled-comms";

const TAG = `sched-sp-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededBookingIds: number[] = [];
let seededCoachId = 0;

// completed booking WITH a recording (no SMS opt-in) — email only.
let completedBookingId = 0;
// completed booking WITH a recording, SMS master + coaching category ON.
let smsBookingId = 0;
let smsMemberId = 0;
// completed booking WITH a recording, SMS master ON but coaching category OFF.
let smsCategoryOffBookingId = 0;
let smsCategoryOffMemberId = 0;
// completed booking but NO recording yet — must NOT notify.
let noRecordingBookingId = 0;
// booking WITH a recording but still status "booked" — must NOT notify.
let notCompletedBookingId = 0;
// completed booking whose SESSION is >7 days old but whose recording was
// INGESTED recently (within the window) — must STILL notify.
let lateIngestBookingId = 0;
let lateIngestMemberId = 0;
// completed booking WITH a recording whose ingest is >7 days old — must NOT
// notify (no back-catalogue blast).
let staleIngestBookingId = 0;
let staleIngestMemberId = 0;

let emailOnlyMemberId = 0;

async function seedUser(
  suffix: string,
  sms?: { phone: string; smsOptIn: boolean; coachingSmsOptIn: boolean }
): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      ...(sms
        ? {
            phone: sms.phone,
            smsOptIn: sms.smsOptIn,
            coachingSmsOptIn: sms.coachingSmsOptIn,
          }
        : {}),
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(user.id);
  return user.id;
}

async function seedBooking(opts: {
  memberId: number;
  status: string;
  recording: boolean;
  scheduledAt?: Date;
  recordingIngestAt?: Date | null;
}): Promise<number> {
  const scheduledAt = opts.scheduledAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const endAt = new Date(scheduledAt.getTime() + 60 * 60 * 1000);
  // When a recording is present, default its ingest time to ~1h ago (inside the
  // 7-day notification window) unless the caller overrides it. The query now
  // bounds on recordingIngestAt, so this must be set for recording bookings.
  const recordingIngestAt = opts.recording
    ? opts.recordingIngestAt !== undefined
      ? opts.recordingIngestAt
      : new Date(Date.now() - 60 * 60 * 1000)
    : null;
  const [booking] = await db
    .insert(sessionPackBookingsTable)
    .values({
      memberId: opts.memberId,
      coachId: seededCoachId,
      ghlCalendarId: `${TAG}-cal`,
      scheduledAt,
      endAt,
      durationMinutes: 60,
      status: opts.status,
      title: `${TAG} 1-on-1`,
      recordingUrl: opts.recording ? "https://drive.google.com/file/d/abc123/view" : null,
      recordingIngestStatus: opts.recording ? "found" : "pending",
      recordingIngestAt,
    })
    .returning({ id: sessionPackBookingsTable.id });
  seededBookingIds.push(booking.id);
  return booking.id;
}

function emailCallsFor(templateSlug: string, userId: number) {
  return queueEmailMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as { templateSlug: string; userId: number };
    return arg.templateSlug === templateSlug && arg.userId === userId;
  });
}

function smsCallsFor(templateSlug: string, userId: number) {
  return queueSmsMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as { templateSlug: string; userId: number };
    return arg.templateSlug === templateSlug && arg.userId === userId;
  });
}

beforeAll(async () => {
  const [coach] = await db
    .insert(sessionPackCoachesTable)
    .values({
      name: `${TAG} coach`,
      ghlCalendarId: `${TAG}-cal`,
      ghlLocationId: `${TAG}-loc`,
    })
    .returning({ id: sessionPackCoachesTable.id });
  seededCoachId = coach.id;

  emailOnlyMemberId = await seedUser("email-only");
  smsMemberId = await seedUser("sms-on", {
    phone: "+15555550201",
    smsOptIn: true,
    coachingSmsOptIn: true,
  });
  smsCategoryOffMemberId = await seedUser("sms-cat-off", {
    phone: "+15555550202",
    smsOptIn: true,
    coachingSmsOptIn: false,
  });
  lateIngestMemberId = await seedUser("late-ingest");
  staleIngestMemberId = await seedUser("stale-ingest");

  completedBookingId = await seedBooking({
    memberId: emailOnlyMemberId,
    status: "completed",
    recording: true,
  });
  smsBookingId = await seedBooking({
    memberId: smsMemberId,
    status: "completed",
    recording: true,
  });
  smsCategoryOffBookingId = await seedBooking({
    memberId: smsCategoryOffMemberId,
    status: "completed",
    recording: true,
  });
  noRecordingBookingId = await seedBooking({
    memberId: emailOnlyMemberId,
    status: "completed",
    recording: false,
  });
  notCompletedBookingId = await seedBooking({
    memberId: emailOnlyMemberId,
    status: "booked",
    recording: true,
  });
  // Session 30 days ago, but the recording was ingested only 2 days ago — the
  // late-arriving case this task fixes. Must still notify.
  lateIngestBookingId = await seedBooking({
    memberId: lateIngestMemberId,
    status: "completed",
    recording: true,
    scheduledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    recordingIngestAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  });
  // Recording ingested 30 days ago (outside the window) — must NOT notify, so a
  // freshly-populated column can't blast the back-catalogue.
  staleIngestBookingId = await seedBooking({
    memberId: staleIngestMemberId,
    status: "completed",
    recording: true,
    scheduledAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    recordingIngestAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  });
});

afterAll(async () => {
  if (seededBookingIds.length > 0) {
    await db
      .delete(sessionPackBookingsTable)
      .where(inArray(sessionPackBookingsTable.id, seededBookingIds));
  }
  if (seededCoachId) {
    await db
      .delete(sessionPackCoachesTable)
      .where(inArray(sessionPackCoachesTable.id, [seededCoachId]));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  queueEmailMock.mockClear();
  queueSmsMock.mockClear();
  checkAndRecordSendMock.mockClear();
  sentKeys.clear();
  sentChannels.length = 0;
});

describe("processSessionPackRecordingReadyNotifications", () => {
  it("emails the member with a deep link into THAT booking's recording", async () => {
    await processSessionPackRecordingReadyNotifications();
    const calls = emailCallsFor("session_recording_ready", emailOnlyMemberId);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "session_recording_ready",
      to: `${TAG}-email-only@example.test`,
      userId: emailOnlyMemberId,
      variables: {
        recording_path: `/coaching/book-session?recording=${completedBookingId}`,
      },
    });
    const key = `session_pack_recording_ready_email_${completedBookingId}`;
    const recorded = sentChannels.find((c) => c.sendKey === key);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("email");
  });

  it("does NOT notify a completed booking that has no recording yet", async () => {
    await processSessionPackRecordingReadyNotifications();
    const key = `session_pack_recording_ready_email_${noRecordingBookingId}`;
    expect(sentChannels.some((c) => c.sendKey === key)).toBe(false);
  });

  it("does NOT notify a booking with a recording that is not completed", async () => {
    await processSessionPackRecordingReadyNotifications();
    const key = `session_pack_recording_ready_email_${notCompletedBookingId}`;
    expect(sentChannels.some((c) => c.sendKey === key)).toBe(false);
  });

  it("dedups the email per booking across repeated runs", async () => {
    await processSessionPackRecordingReadyNotifications();
    await processSessionPackRecordingReadyNotifications();
    expect(emailCallsFor("session_recording_ready", emailOnlyMemberId)).toHaveLength(1);
  });

  it("also texts an opted-in member with the deep link (master + category on)", async () => {
    await processSessionPackRecordingReadyNotifications();
    expect(emailCallsFor("session_recording_ready", smsMemberId)).toHaveLength(1);
    const sms = smsCallsFor("session_recording_ready", smsMemberId);
    expect(sms).toHaveLength(1);
    expect(sms[0][0]).toMatchObject({
      templateSlug: "session_recording_ready",
      to: "+15555550201",
      userId: smsMemberId,
      variables: {
        recording_path: `/coaching/book-session?recording=${smsBookingId}`,
      },
    });
    const smsKey = `session_pack_recording_ready_sms_${smsBookingId}`;
    const recorded = sentChannels.find((c) => c.sendKey === smsKey);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("sms");
  });

  it("does NOT text a member who opted out of the coaching SMS category", async () => {
    await processSessionPackRecordingReadyNotifications();
    expect(emailCallsFor("session_recording_ready", smsCategoryOffMemberId)).toHaveLength(1);
    expect(smsCallsFor("session_recording_ready", smsCategoryOffMemberId)).toHaveLength(0);
  });

  it("does NOT text a member with no SMS opt-in / no phone", async () => {
    await processSessionPackRecordingReadyNotifications();
    expect(smsCallsFor("session_recording_ready", emailOnlyMemberId)).toHaveLength(0);
  });

  it("dedups the SMS per booking across repeated runs", async () => {
    await processSessionPackRecordingReadyNotifications();
    await processSessionPackRecordingReadyNotifications();
    expect(smsCallsFor("session_recording_ready", smsMemberId)).toHaveLength(1);
  });

  it("STILL notifies when the recording was ingested >7 days after the session", async () => {
    await processSessionPackRecordingReadyNotifications();
    const calls = emailCallsFor("session_recording_ready", lateIngestMemberId);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "session_recording_ready",
      userId: lateIngestMemberId,
      variables: {
        recording_path: `/coaching/book-session?recording=${lateIngestBookingId}`,
      },
    });
  });

  it("does NOT notify when the recording was ingested outside the 7-day window", async () => {
    await processSessionPackRecordingReadyNotifications();
    expect(emailCallsFor("session_recording_ready", staleIngestMemberId)).toHaveLength(0);
    const key = `session_pack_recording_ready_email_${staleIngestBookingId}`;
    expect(sentChannels.some((c) => c.sendKey === key)).toBe(false);
  });
});
