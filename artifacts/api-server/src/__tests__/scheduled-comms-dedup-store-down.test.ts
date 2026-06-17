import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  coachesTable,
  coachingCallsTable,
  coachingCallAttendanceTable,
  announcementsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

// Task #969 proved that processMentorshipExpirationWarnings and
// processSessionFeedbackPrompts skip-and-log-loudly when the Postgres-backed
// dedup store returns "error" (see
// scheduled-comms-mentorship-feedback-emails.test.ts). The SAME reserveSend
// failure branch backs the other scheduler passes — coaching reminders,
// new-content alerts, and recording-ready notifications — but those were never
// exercised against a down dedup store. A regression in any of them would
// silently suppress those emails/texts exactly like the original bug.
//
// This suite drives those three passes with REAL eligible recipients seeded and
// the dedup store mocked to always return "error", asserting each pass (a)
// queues NO email/SMS and (b) logs the loud
// "[Scheduled Comms] Dedup store unavailable ..." message — and that a genuine
// store ERROR (loud skip) is distinguished from a DUPLICATE (silent skip).
//
// Same seeding + mock pattern as the mentorship/feedback suite: mock the
// email/SMS sender, the dedup helper, and Redis so nothing touches Redis.
const { queueEmailMock, queueSmsMock, sentKeys, sentChannels, checkAndRecordSendMock } =
  vi.hoisted(() => {
    const sentKeys = new Set<string>();
    const sentChannels: Array<{ sendKey: string; channel: string }> = [];
    return {
      sentKeys,
      sentChannels,
      queueEmailMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
      queueSmsMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
      checkAndRecordSendMock: vi.fn(
        async (
          sendKey: string,
          channel: string,
        ): Promise<"recorded" | "duplicate" | "error"> => {
          sentChannels.push({ sendKey, channel });
          if (sentKeys.has(sendKey)) return "duplicate";
          sentKeys.add(sendKey);
          return "recorded";
        },
      ),
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

import {
  processCoachingCallReminders,
  processNewContentAlerts,
  processRecordingReadyNotifications,
} from "../lib/scheduled-comms";

const TAG = `sched-down-${randomUUID().slice(0, 8)}`;
// Unique entitlement so the coaching recipient queries match ONLY this test's
// seeded products, isolating it from any other coaching data in the shared DB.
const ENTITLEMENT = `coaching:test-${TAG}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let seededCoachId = 0;
let seededSmsCallId = 0;
let seededEmailCallId = 0;
let seededRecordingCallId = 0;
let seededAnnouncementId = 0;
const seededAttendanceIds: number[] = [];

// A single member who is fully eligible for ALL three passes: a member-role
// account with an active product carrying the call entitlement, master + both
// category SMS opt-ins, and a phone on file.
let eligibleUserId = 0;

async function seedEligibleMember(): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-eligible@example.test`,
      name: "Eligible Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      phone: "+15555550901",
      smsOptIn: true,
      coachingSmsOptIn: true,
      contentSmsOptIn: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(user.id);

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TAG}-product`,
      name: "Test Mentorship",
      type: "backend",
      entitlementKeys: [ENTITLEMENT] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);

  await db.insert(userProductsTable).values({
    userId: user.id,
    productId: product.id,
    status: "active",
  });

  return user.id;
}

beforeAll(async () => {
  eligibleUserId = await seedEligibleMember();

  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `${TAG} coach`,
      bio: "Test coach",
      specialties: "test",
      callTypes: ["weekly_qa"],
    })
    .returning({ id: coachesTable.id });
  seededCoachId = coach.id;

  // A call 30 minutes out lands inside the 1-hour SMS reminder window.
  const [smsCall] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} soon call`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: coach.id,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
      durationMinutes: 60,
      requiredEntitlement: ENTITLEMENT,
    })
    .returning({ id: coachingCallsTable.id });
  seededSmsCallId = smsCall.id;

  // A call ~3 hours out lands inside the 24-hour EMAIL reminder window (outside
  // the 1-hour SMS window) so processCoachingCallReminders also queues an email.
  const [emailCall] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} tomorrow call`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: coach.id,
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
      durationMinutes: 60,
      requiredEntitlement: ENTITLEMENT,
    })
    .returning({ id: coachingCallsTable.id });
  seededEmailCallId = emailCall.id;

  // A call ~1 day ago WITH a recording drives processRecordingReadyNotifications
  // for the registrant seeded below (registered_at set).
  const [recordingCall] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} finished call`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: coach.id,
      scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      durationMinutes: 60,
      requiredEntitlement: ENTITLEMENT,
      recordingUrl: "https://example.test/recording.mp4",
    })
    .returning({ id: coachingCallsTable.id });
  seededRecordingCallId = recordingCall.id;

  const [attendance] = await db
    .insert(coachingCallAttendanceTable)
    .values({
      callId: recordingCall.id,
      userId: eligibleUserId,
      registeredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    })
    .returning({ id: coachingCallAttendanceTable.id });
  seededAttendanceIds.push(attendance.id);

  // A just-created "new_content" announcement falls inside the 24-hour
  // content-alert window.
  const [announcement] = await db
    .insert(announcementsTable)
    .values({
      title: `${TAG} new lesson drop`,
      body: "A fresh lesson is live",
      type: "new_content",
    })
    .returning({ id: announcementsTable.id });
  seededAnnouncementId = announcement.id;
});

afterAll(async () => {
  if (seededAttendanceIds.length > 0) {
    await db
      .delete(coachingCallAttendanceTable)
      .where(inArray(coachingCallAttendanceTable.id, seededAttendanceIds));
  }
  const callIds = [seededSmsCallId, seededEmailCallId, seededRecordingCallId].filter(Boolean);
  if (callIds.length > 0) {
    await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, callIds));
  }
  if (seededCoachId) {
    await db.delete(coachesTable).where(inArray(coachesTable.id, [seededCoachId]));
  }
  if (seededAnnouncementId) {
    await db
      .delete(announcementsTable)
      .where(inArray(announcementsTable.id, [seededAnnouncementId]));
  }
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

describe("scheduled comms — other passes skip-and-log when dedup store is down", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queueEmailMock.mockClear();
    queueSmsMock.mockClear();
    checkAndRecordSendMock.mockClear();
    sentKeys.clear();
    sentChannels.length = 0;

    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Simulate a broken/unreachable comms_send_log: every reservation fails.
    checkAndRecordSendMock.mockImplementation(
      async (sendKey: string, channel: string): Promise<"recorded" | "duplicate" | "error"> => {
        sentChannels.push({ sendKey, channel });
        return "error";
      },
    );
  });

  afterEach(() => {
    errorSpy.mockRestore();
    // Restore the default in-memory dedup behavior (matches the vi.hoisted impl)
    // so a failing run here can't leak into other suites.
    checkAndRecordSendMock.mockImplementation(async (sendKey: string, channel: string) => {
      sentChannels.push({ sendKey, channel });
      if (sentKeys.has(sendKey)) return "duplicate";
      sentKeys.add(sendKey);
      return "recorded";
    });
  });

  it("processCoachingCallReminders queues NO email/SMS and logs the dedup-store-unavailable error", async () => {
    await processCoachingCallReminders();

    // The store failed for every reservation, so nothing is sent on either the
    // 24h email branch or the 1h SMS branch.
    expect(queueEmailMock).not.toHaveBeenCalled();
    expect(queueSmsMock).not.toHaveBeenCalled();

    // The reservation was attempted (not skipped before checking the store).
    expect(checkAndRecordSendMock).toHaveBeenCalled();

    // ...and the failure surfaced LOUDLY rather than being swallowed.
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[Scheduled Comms] Dedup store unavailable");
  });

  it("processNewContentAlerts queues NO email/SMS and logs the dedup-store-unavailable error", async () => {
    await processNewContentAlerts();

    expect(queueEmailMock).not.toHaveBeenCalled();
    expect(queueSmsMock).not.toHaveBeenCalled();
    expect(checkAndRecordSendMock).toHaveBeenCalled();

    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[Scheduled Comms] Dedup store unavailable");
  });

  it("processRecordingReadyNotifications queues NO email and logs the dedup-store-unavailable error", async () => {
    await processRecordingReadyNotifications();

    expect(queueEmailMock).not.toHaveBeenCalled();
    expect(checkAndRecordSendMock).toHaveBeenCalled();

    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[Scheduled Comms] Dedup store unavailable");
  });

  it("distinguishes a store ERROR (loud skip) from a DUPLICATE (silent skip)", async () => {
    // Re-point the store at the "duplicate" outcome: each pass must still queue
    // nothing, but WITHOUT the loud unavailable error — that message is reserved
    // for genuine store failures, not already-sent mail.
    checkAndRecordSendMock.mockImplementation(async (sendKey: string, channel: string) => {
      sentChannels.push({ sendKey, channel });
      return "duplicate";
    });

    await processCoachingCallReminders();
    await processNewContentAlerts();
    await processRecordingReadyNotifications();

    expect(queueEmailMock).not.toHaveBeenCalled();
    expect(queueSmsMock).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("Dedup store unavailable");
  });
});
