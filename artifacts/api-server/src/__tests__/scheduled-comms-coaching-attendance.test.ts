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

import {
  processSessionFeedbackPrompts,
  processRecordingReadyNotifications,
} from "../lib/scheduled-comms";

// Both passes are OFF by default behind env flags (Task #1770). This suite
// verifies their recipient-selection logic, so it turns the flags on — and
// (in the "env-flag kill switches" describe below) proves the flag-off
// default sends nothing.
let prevFeedbackFlag: string | undefined;
let prevRecordingFlag: string | undefined;

beforeAll(() => {
  prevFeedbackFlag = process.env.SESSION_FEEDBACK_PROMPTS_ENABLED;
  prevRecordingFlag = process.env.GROUP_RECORDING_READY_ENABLED;
  process.env.SESSION_FEEDBACK_PROMPTS_ENABLED = "true";
  process.env.GROUP_RECORDING_READY_ENABLED = "true";
});

afterAll(() => {
  if (prevFeedbackFlag === undefined) delete process.env.SESSION_FEEDBACK_PROMPTS_ENABLED;
  else process.env.SESSION_FEEDBACK_PROMPTS_ENABLED = prevFeedbackFlag;
  if (prevRecordingFlag === undefined) delete process.env.GROUP_RECORDING_READY_ENABLED;
  else process.env.GROUP_RECORDING_READY_ENABLED = prevRecordingFlag;
});

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
// Registered for the attended call, master smsOptIn + coaching category on.
let smsRegisteredUserId = 0;
// Registered, master smsOptIn on but coaching category OFF (email-only).
let smsCategoryOffUserId = 0;

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

function smsCallsFor(templateSlug: string, userId: number) {
  return queueSmsMock.mock.calls.filter((c: unknown[]) => {
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
    })
    .returning({ id: coachesTable.id });
  seededCoachId = coach.id;

  registeredUserId = await seedUser("registered");
  viewerOnlyUserId = await seedUser("viewer");
  entitledNonAttendeeUserId = await seedUser("entitled-no-att");
  fallbackUserId = await seedUser("fallback");
  smsRegisteredUserId = await seedUser("sms-on", {
    phone: "+15555550101",
    smsOptIn: true,
    coachingSmsOptIn: true,
  });
  smsCategoryOffUserId = await seedUser("sms-cat-off", {
    phone: "+15555550102",
    smsOptIn: true,
    coachingSmsOptIn: false,
  });

  for (const uid of [
    registeredUserId,
    viewerOnlyUserId,
    entitledNonAttendeeUserId,
    smsRegisteredUserId,
    smsCategoryOffUserId,
  ]) {
    await grantEntitlement(uid, `att-${uid}`);
  }
  await grantEntitlement(fallbackUserId, `fb-${fallbackUserId}`);

  attendedCallId = await seedCall(`${TAG} attended call`, true);
  untrackedCallId = await seedCall(`${TAG} untracked call`, true);

  // Attendance for the attended call: registrants (incl. the two SMS cohorts)
  // plus one recording-only viewer.
  await db.insert(coachingCallAttendanceTable).values([
    { callId: attendedCallId, userId: registeredUserId, registeredAt: new Date() },
    { callId: attendedCallId, userId: viewerOnlyUserId, recordingViewedAt: new Date() },
    { callId: attendedCallId, userId: smsRegisteredUserId, registeredAt: new Date() },
    { callId: attendedCallId, userId: smsCategoryOffUserId, registeredAt: new Date() },
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
  queueSmsMock.mockClear();
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

  it("also texts an opted-in registrant (master + coaching category on)", async () => {
    await processRecordingReadyNotifications();
    // Still gets the email...
    expect(emailCallsFor("recording_ready", smsRegisteredUserId)).toHaveLength(1);
    // ...plus the SMS, on its own dedup key (channel "sms").
    const sms = smsCallsFor("recording_ready", smsRegisteredUserId);
    expect(sms).toHaveLength(1);
    expect(sms[0][0]).toMatchObject({
      templateSlug: "recording_ready",
      to: "+15555550101",
      userId: smsRegisteredUserId,
      variables: { call_title: `${TAG} attended call` },
    });
    const smsKey = `recording_ready_sms_${attendedCallId}_${smsRegisteredUserId}`;
    const recorded = sentChannels.find((c) => c.sendKey === smsKey);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("sms");
  });

  it("does NOT text a registrant who opted out of the coaching SMS category", async () => {
    await processRecordingReadyNotifications();
    // Email still sends (category gate only suppresses the text)...
    expect(emailCallsFor("recording_ready", smsCategoryOffUserId)).toHaveLength(1);
    // ...but no SMS.
    expect(smsCallsFor("recording_ready", smsCategoryOffUserId)).toHaveLength(0);
  });

  it("does NOT text a registrant with no SMS opt-in / no phone on file", async () => {
    await processRecordingReadyNotifications();
    expect(smsCallsFor("recording_ready", registeredUserId)).toHaveLength(0);
  });

  it("dedups the recording-ready SMS per member across repeated runs", async () => {
    await processRecordingReadyNotifications();
    await processRecordingReadyNotifications();
    expect(smsCallsFor("recording_ready", smsRegisteredUserId)).toHaveLength(1);
  });
});

describe("env-flag kill switches (Task #1770)", () => {
  it("processSessionFeedbackPrompts sends NOTHING when its flag is off", async () => {
    process.env.SESSION_FEEDBACK_PROMPTS_ENABLED = "false";
    try {
      await processSessionFeedbackPrompts();
      expect(queueEmailMock).not.toHaveBeenCalled();
      expect(queueSmsMock).not.toHaveBeenCalled();
      expect(checkAndRecordSendMock).not.toHaveBeenCalled();
    } finally {
      process.env.SESSION_FEEDBACK_PROMPTS_ENABLED = "true";
    }
  });

  it("processRecordingReadyNotifications sends NOTHING when its flag is off", async () => {
    process.env.GROUP_RECORDING_READY_ENABLED = "false";
    try {
      await processRecordingReadyNotifications();
      expect(queueEmailMock).not.toHaveBeenCalled();
      expect(queueSmsMock).not.toHaveBeenCalled();
      expect(checkAndRecordSendMock).not.toHaveBeenCalled();
    } finally {
      process.env.GROUP_RECORDING_READY_ENABLED = "true";
    }
  });

  it("both passes send NOTHING when the flags are simply unset (off-by-default)", async () => {
    delete process.env.SESSION_FEEDBACK_PROMPTS_ENABLED;
    delete process.env.GROUP_RECORDING_READY_ENABLED;
    try {
      await processSessionFeedbackPrompts();
      await processRecordingReadyNotifications();
      expect(queueEmailMock).not.toHaveBeenCalled();
      expect(queueSmsMock).not.toHaveBeenCalled();
    } finally {
      process.env.SESSION_FEEDBACK_PROMPTS_ENABLED = "true";
      process.env.GROUP_RECORDING_READY_ENABLED = "true";
    }
  });
});
