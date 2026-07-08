import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  coachesTable,
  coachingCallsTable,
  coachingCallAttendanceTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

// RSVP-driven morning-of coaching reminders (Task #1770).
//
// The clock is fully injectable, so every fixture below is anchored to a
// FIXED "now" instead of the wall clock — the suite is deterministic no
// matter when it runs:
//
//   NOW        = 2026-07-15T14:00:00Z  (9:00 AM America/Chicago)
//   CALL_TODAY = 2026-07-15T18:00:00Z  (1:00 PM Chicago, same local day)
//   CALL_NEXT  = 2026-07-16T10:00:00Z  (within 24h of NOW, but 5:00 AM
//                Chicago on the NEXT local day — must not remind yet)
//   RSVP_PRIOR = 2026-07-14T12:00:00Z  (the day BEFORE the call, Chicago)
//   RSVP_DAYOF = 2026-07-15T13:00:00Z  (8:00 AM Chicago on call day)
const NOW = new Date("2026-07-15T14:00:00Z");
const CALL_TODAY_AT = new Date("2026-07-15T18:00:00Z");
const CALL_NEXT_DAY_AT = new Date("2026-07-16T10:00:00Z");
const RSVP_PRIOR_DAY = new Date("2026-07-14T12:00:00Z");
const RSVP_DAY_OF = new Date("2026-07-15T13:00:00Z");

const { queueSmsMock, queueEmailMock, sentKeys, sentChannels, checkAndRecordSendMock } =
  vi.hoisted(() => {
    const sentKeys = new Set<string>();
    const sentChannels: Array<{ sendKey: string; channel: string }> = [];
    return {
      sentKeys,
      sentChannels,
      queueSmsMock: vi.fn(async (..._args: any[]) => ({ result: "queued" as const })),
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

vi.mock("../lib/portal-url-settings", () => ({
  getPortalUrl: vi.fn(async () => "https://portal.example.test"),
}));

import { processCoachingCallReminders } from "../lib/scheduled-comms";
import { generateUnsubscribeToken } from "../lib/unsubscribe-token";

const TAG = `rsvp-remind-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let seededCoachId = 0;
let callTodayId = 0;
let callNextDayId = 0;

interface MemberOpts {
  timezone?: string;
  smsOptIn?: boolean;
  coachingSmsOptIn?: boolean;
  coachingEmailOptIn?: boolean;
  phone?: string | null;
  // undefined = no attendance row at all
  rsvp?: { callId: () => number; registeredAt: Date } | null;
}

async function seedMember(suffix: string, opts: MemberOpts = {}): Promise<number> {
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
      timezone: opts.timezone ?? "America/Chicago",
      phone: opts.phone === undefined ? "+15555550600" : opts.phone,
      smsOptIn: opts.smsOptIn ?? true,
      coachingSmsOptIn: opts.coachingSmsOptIn ?? true,
      coachingEmailOptIn: opts.coachingEmailOptIn ?? true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(user.id);
  return user.id;
}

async function rsvp(userId: number, callId: number, registeredAt: Date) {
  await db.insert(coachingCallAttendanceTable).values({
    callId,
    userId,
    registeredAt,
  });
}

function emailsFor(userId: number) {
  return queueEmailMock.mock.calls.filter(
    (c: unknown[]) => (c[0] as { userId: number }).userId === userId,
  );
}

function smsFor(userId: number) {
  return queueSmsMock.mock.calls.filter(
    (c: unknown[]) => (c[0] as { userId: number }).userId === userId,
  );
}

let fullyEligible = 0; // RSVP'd yesterday, everything on -> email + SMS
let emailOptedOut = 0; // coachingEmailOptIn=false -> SMS only
let smsCategoryOff = 0; // coachingSmsOptIn=false -> email only
let masterSmsOff = 0; // smsOptIn=false -> email only
let noPhone = 0; // phone=null -> email only
let dayOfRsvp = 0; // RSVP'd on the call day -> nothing
let noRsvp = 0; // no attendance row -> nothing
let earlyMorningTz = 0; // Pacific/Honolulu: 4:00 AM local at NOW -> nothing yet
let nextDayCallRsvp = 0; // RSVP'd a call that is TOMORROW locally -> nothing yet

beforeAll(async () => {
  const [coach] = await db
    .insert(coachesTable)
    .values({ name: `${TAG} coach`, bio: "Test coach", specialties: "test" })
    .returning({ id: coachesTable.id });
  seededCoachId = coach.id;

  const [callToday] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} today call`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: coach.id,
      scheduledAt: CALL_TODAY_AT,
      durationMinutes: 60,
      requiredEntitlement: `coaching:test-${TAG}`,
    })
    .returning({ id: coachingCallsTable.id });
  callTodayId = callToday.id;

  const [callNext] = await db
    .insert(coachingCallsTable)
    .values({
      title: `${TAG} tomorrow call`,
      description: "Open Q&A",
      callType: "weekly_qa",
      coachId: coach.id,
      scheduledAt: CALL_NEXT_DAY_AT,
      durationMinutes: 60,
      requiredEntitlement: `coaching:test-${TAG}`,
    })
    .returning({ id: coachingCallsTable.id });
  callNextDayId = callNext.id;

  fullyEligible = await seedMember("full", { phone: "+15555550601" });
  emailOptedOut = await seedMember("email-off", {
    coachingEmailOptIn: false,
    phone: "+15555550602",
  });
  smsCategoryOff = await seedMember("sms-cat-off", {
    coachingSmsOptIn: false,
    phone: "+15555550603",
  });
  masterSmsOff = await seedMember("sms-master-off", {
    smsOptIn: false,
    phone: "+15555550604",
  });
  noPhone = await seedMember("no-phone", { phone: null });
  dayOfRsvp = await seedMember("day-of", { phone: "+15555550605" });
  noRsvp = await seedMember("no-rsvp", { phone: "+15555550606" });
  earlyMorningTz = await seedMember("early-tz", {
    timezone: "Pacific/Honolulu",
    phone: "+15555550607",
  });
  nextDayCallRsvp = await seedMember("next-day", { phone: "+15555550608" });

  for (const id of [fullyEligible, emailOptedOut, smsCategoryOff, masterSmsOff, noPhone, earlyMorningTz]) {
    await rsvp(id, callTodayId, RSVP_PRIOR_DAY);
  }
  await rsvp(dayOfRsvp, callTodayId, RSVP_DAY_OF);
  await rsvp(nextDayCallRsvp, callNextDayId, RSVP_PRIOR_DAY);
});

afterAll(async () => {
  const callIds = [callTodayId, callNextDayId].filter(Boolean);
  if (seededUserIds.length > 0) {
    await db
      .delete(coachingCallAttendanceTable)
      .where(inArray(coachingCallAttendanceTable.userId, seededUserIds));
  }
  if (callIds.length > 0) {
    await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, callIds));
  }
  if (seededCoachId) {
    await db.delete(coachesTable).where(inArray(coachesTable.id, [seededCoachId]));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  queueSmsMock.mockClear();
  queueEmailMock.mockClear();
  checkAndRecordSendMock.mockClear();
  sentKeys.clear();
  sentChannels.length = 0;
});

describe("processCoachingCallReminders — RSVP-driven morning-of reminders", () => {
  it("sends email + SMS to a fully-eligible prior-day RSVP with the right template, variables, and dedup keys", async () => {
    await processCoachingCallReminders(NOW);

    const emails = emailsFor(fullyEligible);
    expect(emails).toHaveLength(1);
    const emailArg = emails[0][0] as any;
    expect(emailArg).toMatchObject({
      templateSlug: "coaching_rsvp_reminder",
      to: `${TAG}-full@example.test`,
      userId: fullyEligible,
    });
    expect(emailArg.variables.call_title).toBe(`${TAG} today call`);
    // Call time rendered in the MEMBER's timezone (1:00 PM Chicago).
    expect(emailArg.variables.call_time).toMatch(/1:00\s?PM/i);
    // One-click coaching-only unsubscribe link with a valid HMAC token.
    const email = `${TAG}-full@example.test`;
    expect(emailArg.variables.coaching_unsubscribe_url).toBe(
      `https://portal.example.test/api/email/unsubscribe-coaching?email=${encodeURIComponent(email)}&token=${generateUnsubscribeToken(email)}`,
    );

    const texts = smsFor(fullyEligible);
    expect(texts).toHaveLength(1);
    expect(texts[0][0]).toMatchObject({
      templateSlug: "coaching_rsvp_reminder",
      to: "+15555550601",
      userId: fullyEligible,
      variables: { call_title: `${TAG} today call` },
    });

    const emailKey = `coaching_rsvp_reminder_email_${callTodayId}_${fullyEligible}`;
    const smsKey = `coaching_rsvp_reminder_sms_${callTodayId}_${fullyEligible}`;
    expect(sentChannels.find((c) => c.sendKey === emailKey)?.channel).toBe("email");
    expect(sentChannels.find((c) => c.sendKey === smsKey)?.channel).toBe("sms");
  });

  it("skips the email (but still texts) a member who unsubscribed from coaching emails", async () => {
    await processCoachingCallReminders(NOW);
    expect(emailsFor(emailOptedOut)).toHaveLength(0);
    expect(smsFor(emailOptedOut)).toHaveLength(1);
  });

  it("skips the SMS (but still emails) when the coaching SMS category is off", async () => {
    await processCoachingCallReminders(NOW);
    expect(emailsFor(smsCategoryOff)).toHaveLength(1);
    expect(smsFor(smsCategoryOff)).toHaveLength(0);
  });

  it("skips the SMS (but still emails) when master SMS is off, even with the category on", async () => {
    await processCoachingCallReminders(NOW);
    expect(emailsFor(masterSmsOff)).toHaveLength(1);
    expect(smsFor(masterSmsOff)).toHaveLength(0);
  });

  it("skips the SMS (but still emails) a member with no phone on file", async () => {
    await processCoachingCallReminders(NOW);
    expect(emailsFor(noPhone)).toHaveLength(1);
    expect(smsFor(noPhone)).toHaveLength(0);
  });

  it("sends nothing to a member who RSVP'd on the day of the call", async () => {
    await processCoachingCallReminders(NOW);
    expect(emailsFor(dayOfRsvp)).toHaveLength(0);
    expect(smsFor(dayOfRsvp)).toHaveLength(0);
  });

  it("sends nothing to a member without an RSVP (the blanket blast is gone)", async () => {
    await processCoachingCallReminders(NOW);
    expect(emailsFor(noRsvp)).toHaveLength(0);
    expect(smsFor(noRsvp)).toHaveLength(0);
  });

  it("holds the reminder while it is still before 7:00 AM in the member's timezone", async () => {
    // At NOW it is 4:00 AM in Honolulu — nothing yet…
    await processCoachingCallReminders(NOW);
    expect(emailsFor(earlyMorningTz)).toHaveLength(0);
    expect(smsFor(earlyMorningTz)).toHaveLength(0);

    // …but the 7:00 AM Honolulu pass (17:00Z) delivers it.
    await processCoachingCallReminders(new Date("2026-07-15T17:00:00Z"));
    expect(emailsFor(earlyMorningTz)).toHaveLength(1);
    expect(smsFor(earlyMorningTz)).toHaveLength(1);
  });

  it("does not remind about a call that is tomorrow in the member's timezone, even inside the 24h window", async () => {
    await processCoachingCallReminders(NOW);
    expect(emailsFor(nextDayCallRsvp)).toHaveLength(0);
    expect(smsFor(nextDayCallRsvp)).toHaveLength(0);
  });

  it("dedups both channels across repeated scheduler passes", async () => {
    await processCoachingCallReminders(NOW);
    await processCoachingCallReminders(new Date(NOW.getTime() + 15 * 60 * 1000));
    expect(emailsFor(fullyEligible)).toHaveLength(1);
    expect(smsFor(fullyEligible)).toHaveLength(1);
  });
});
