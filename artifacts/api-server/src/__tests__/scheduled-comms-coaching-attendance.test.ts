import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
} from "@workspace/db";
import { inArray } from "drizzle-orm";

// Exercise ONLY recipient selection + per-key dedup for the attendance-aware
// session-feedback prompt and the new "recording ready" notification. Email
// sender + the Postgres dedup helper are mocked (in-memory Set keyed on the
// sendKey) so repeated scheduler runs exercise dedup for real, no Redis.
const { queueEmailMock, sentKeys, sentChannels, checkAndRecordSendMock } =
  vi.hoisted(() => {
    const sentKeys = new Set<string>();
    const sentChannels: Array<{ sendKey: string; channel: string }> = [];
    return {
      sentKeys,
      sentChannels,
      queueEmailMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
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
    queueSms: vi.fn(async () => ({ result: "queued" as const })),
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
  processSessionFeedbackPrompts,
  processRecordingReadyNotifications,
} from "../lib/scheduled-comms";

const TAG = `sched-att-${randomUUID().slice(0, 8)}`;
const ENTITLEMENT = `coaching:test-${TAG}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededUserProductIds: number[] = [];
const seededCallIds: number[] = [];
let seededCoachId = 0;

// Call that is inside BOTH the session-feedback window (24-25h ago) and the
// recording-ready window (last 7d), with attendance rows.
let attendedCallId = 0;
// Call with NO attendance rows — feedback must fall back to entitlement audience.
let untrackedCallId = 0;

// attendedCall cohort.
let registeredUserId = 0; // registered for the live call
let viewerOnlyUserId = 0; // only opened the recording (never registered)
let entitledNonAttendeeUserId = 0; // entitled, but no attendance row
// untrackedCall cohort (entitled member, no attendance anywhere).
let fallbackUserId = 0;

async function seedUser(suffix: string): Promise<number> {
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
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(user.id);
  return user.id;
}

async function grantEntitlement(userId: number, suffix: string): Promise<void> {
  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TAG}-product-${suffix}`,
      name: `${suffix} product`,
      type: "backend",
      entitlementKeys: [ENTITLEMENT] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);
  const [up] = await db
    .insert(userProductsTable)
    .values({ userId, productId: product.id, status: "active", expiresAt: null })
    .returning({ id: userProductsTable.id });
  seededUserProductIds.push(up.id);
}

async function seedCall(title: string, recording: boolean): Promise<number> {
  const [call] = await db
    .insert(coachingCallsTable)
    .values({
      title,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: seededCoachId,
      scheduledAt: new Date(Date.now() - 24.5 * 60 * 60 * 1000),
      durationMinutes: 60,
      requiredEntitlement: ENTITLEMENT,
      recordingUrl: recording ? "https://example.test/recording.mp4" : null,
    })
    .returning({ id: coachingCallsTable.id });
  seededCallIds.push(call.id);
  return call.id;
}

function emailCallsFor(templateSlug: string, userId: number) {
  return queueEmailMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as { templateSlug: string; userId: number };
    return arg.templateSlug === templateSlug && arg.userId === userId;
  });
}

function emailCallsForCall(templateSlug: string, userId: number, callTitle: string) {
  return queueEmailMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as {
      templateSlug: string;
      userId: number;
      variables: { call_title: string };
    };
    return (
      arg.templateSlug === templateSlug &&
      arg.userId === userId &&
      arg.variables.call_title === callTitle
    );
  });
}

const ATTENDED_TITLE = `${TAG} attended call`;

beforeAll(async () => {
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

  registeredUserId = await seedUser("registered");
  viewerOnlyUserId = await seedUser("viewer");
  entitledNonAttendeeUserId = await seedUser("entitled-no-att");
  fallbackUserId = await seedUser("fallback");

  for (const uid of [registeredUserId, viewerOnlyUserId, entitledNonAttendeeUserId]) {
    await grantEntitlement(uid, `att-${uid}`);
  }
  await grantEntitlement(fallbackUserId, `fb-${fallbackUserId}`);

  attendedCallId = await seedCall(`${TAG} attended call`, true);
  untrackedCallId = await seedCall(`${TAG} untracked call`, true);

  // Attendance for the attended call: one registrant + one recording-only viewer.
  await db.insert(coachingCallAttendanceTable).values([
    { callId: attendedCallId, userId: registeredUserId, registeredAt: new Date() },
    { callId: attendedCallId, userId: viewerOnlyUserId, recordingViewedAt: new Date() },
  ]);
});

afterAll(async () => {
  if (seededCallIds.length > 0) {
    await db
      .delete(coachingCallAttendanceTable)
      .where(inArray(coachingCallAttendanceTable.callId, seededCallIds));
    await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, seededCallIds));
  }
  if (seededCoachId) {
    await db.delete(coachesTable).where(inArray(coachesTable.id, [seededCoachId]));
  }
  if (seededUserProductIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.id, seededUserProductIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

beforeEach(() => {
  queueEmailMock.mockClear();
  checkAndRecordSendMock.mockClear();
  sentKeys.clear();
  sentChannels.length = 0;
});

describe("processSessionFeedbackPrompts — attendance-targeted", () => {
  it("emails the registrant and the recording viewer for a tracked call", async () => {
    await processSessionFeedbackPrompts();
    expect(
      emailCallsForCall("session_feedback", registeredUserId, ATTENDED_TITLE)
    ).toHaveLength(1);
    expect(
      emailCallsForCall("session_feedback", viewerOnlyUserId, ATTENDED_TITLE)
    ).toHaveLength(1);
  });

  it("does NOT email an entitled member who has no attendance row for the tracked call", async () => {
    await processSessionFeedbackPrompts();
    // entitledNonAttendeeUserId is entitled but never attended the attended call.
    // (It can still receive the untracked-call fallback below, so assert it gets
    // exactly one feedback email — from the fallback call — not two.)
    const keyForAttendedCall = `session_feedback_email_${attendedCallId}_${entitledNonAttendeeUserId}`;
    expect(sentChannels.some((c) => c.sendKey === keyForAttendedCall)).toBe(false);
  });

  it("falls back to the entitlement audience for a call with no attendance rows", async () => {
    await processSessionFeedbackPrompts();
    // fallbackUserId is entitled and the untracked call has no attendance rows.
    const key = `session_feedback_email_${untrackedCallId}_${fallbackUserId}`;
    expect(sentChannels.some((c) => c.sendKey === key)).toBe(true);
    expect(emailCallsFor("session_feedback", fallbackUserId)).toHaveLength(1);
  });

  it("dedups the feedback email per member across repeated runs", async () => {
    await processSessionFeedbackPrompts();
    await processSessionFeedbackPrompts();
    expect(
      emailCallsForCall("session_feedback", registeredUserId, ATTENDED_TITLE)
    ).toHaveLength(1);
    expect(
      emailCallsForCall("session_feedback", viewerOnlyUserId, ATTENDED_TITLE)
    ).toHaveLength(1);
  });
});

describe("processRecordingReadyNotifications", () => {
  it("emails registrants when the recording is ready", async () => {
    await processRecordingReadyNotifications();
    const calls = emailCallsFor("recording_ready", registeredUserId);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "recording_ready",
      to: `${TAG}-registered@example.test`,
      userId: registeredUserId,
      variables: { call_title: `${TAG} attended call` },
    });
    const key = `recording_ready_email_${attendedCallId}_${registeredUserId}`;
    const recorded = sentChannels.find((c) => c.sendKey === key);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("email");
  });

  it("does NOT email a recording-only viewer (no registration)", async () => {
    await processRecordingReadyNotifications();
    expect(emailCallsFor("recording_ready", viewerOnlyUserId)).toHaveLength(0);
  });

  it("does NOT email entitled members who never registered", async () => {
    await processRecordingReadyNotifications();
    expect(emailCallsFor("recording_ready", entitledNonAttendeeUserId)).toHaveLength(0);
    expect(emailCallsFor("recording_ready", fallbackUserId)).toHaveLength(0);
  });

  it("dedups the recording-ready email per member across repeated runs", async () => {
    await processRecordingReadyNotifications();
    await processRecordingReadyNotifications();
    expect(emailCallsFor("recording_ready", registeredUserId)).toHaveLength(1);
  });
});
