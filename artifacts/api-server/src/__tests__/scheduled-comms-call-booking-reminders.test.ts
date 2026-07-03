import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  callBookingsTable,
  kickoffCoachesTable,
  partnersTable,
} from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

// Same mocking strategy as scheduled-comms-coaching-content-sms-prefs.test.ts:
// mock CommunicationService + the dedup store so this test exercises ONLY the
// call-booking reminder logic (24h email + 1h SMS, dedup, opt-out, staleness,
// timezone, kickoff-vs-partner variant) without touching Redis or Twilio.
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

import { processCallBookingReminders } from "../lib/scheduled-comms";
import { formatInMemberTimezone, MEMBER_TIMEZONE_FALLBACK } from "../lib/member-timezone";

const TAG = `call-booking-sched-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededBookingIds: number[] = [];
let seededKickoffCoachId = 0;
let seededPartnerId = 0;

interface SeedMemberOpts {
  smsOptIn?: boolean;
  partnerCallSmsOptIn?: boolean;
  phone?: string | null;
  timezone?: string | null;
}

async function seedMember(suffix: string, opts: SeedMemberOpts = {}): Promise<number> {
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
      phone: opts.phone === undefined ? "+15555550601" : opts.phone,
      smsOptIn: opts.smsOptIn ?? true,
      partnerCallSmsOptIn: opts.partnerCallSmsOptIn ?? true,
      timezone: opts.timezone === undefined ? null : opts.timezone,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(user.id);
  return user.id;
}

interface SeedBookingOpts {
  type: "kickoff" | "partner";
  staffId: number;
  memberId: number;
  scheduledAt: Date;
  status?: string;
}

async function seedBooking(opts: SeedBookingOpts): Promise<number> {
  const [booking] = await db
    .insert(callBookingsTable)
    .values({
      memberId: opts.memberId,
      staffType: opts.type === "kickoff" ? "kickoff_coach" : "partner",
      staffId: opts.staffId,
      type: opts.type,
      ghlCalendarId: `${TAG}-calendar`,
      scheduledAt: opts.scheduledAt,
      endAt: new Date(opts.scheduledAt.getTime() + 30 * 60 * 1000),
      status: opts.status ?? "booked",
    })
    .returning({ id: callBookingsTable.id });
  seededBookingIds.push(booking.id);
  return booking.id;
}

function smsCallsFor(templateSlug: string, userId: number) {
  return queueSmsMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as { templateSlug: string; userId: number };
    return arg.templateSlug === templateSlug && arg.userId === userId;
  });
}

function emailCallsFor(templateSlug: string, userId: number) {
  return queueEmailMock.mock.calls.filter((c: unknown[]) => {
    const arg = c[0] as { templateSlug: string; userId: number };
    return arg.templateSlug === templateSlug && arg.userId === userId;
  });
}

beforeAll(async () => {
  const [kickoffCoach] = await db
    .insert(kickoffCoachesTable)
    .values({ displayName: `${TAG} Kickoff Coach` })
    .returning({ id: kickoffCoachesTable.id });
  seededKickoffCoachId = kickoffCoach.id;

  const [partner] = await db
    .insert(partnersTable)
    .values({ displayName: `${TAG} Partner` })
    .returning({ id: partnersTable.id });
  seededPartnerId = partner.id;
});

afterAll(async () => {
  if (seededBookingIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.id, seededBookingIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededKickoffCoachId) {
    await db.delete(kickoffCoachesTable).where(eq(kickoffCoachesTable.id, seededKickoffCoachId));
  }
  if (seededPartnerId) {
    await db.delete(partnersTable).where(eq(partnersTable.id, seededPartnerId));
  }
});

beforeEach(() => {
  queueSmsMock.mockClear();
  queueEmailMock.mockClear();
  checkAndRecordSendMock.mockClear();
  sentKeys.clear();
  sentChannels.length = 0;
});

describe("processCallBookingReminders — 24h email + kickoff vs partner variant", () => {
  it("sends the kickoff_call_reminder email (not partner_call_reminder) for a kickoff booking inside the 24h window", async () => {
    const memberId = await seedMember("kickoff-email");
    const bookingId = await seedBooking({
      type: "kickoff",
      staffId: seededKickoffCoachId,
      memberId,
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    await processCallBookingReminders();

    expect(emailCallsFor("kickoff_call_reminder", memberId)).toHaveLength(1);
    expect(emailCallsFor("partner_call_reminder", memberId)).toHaveLength(0);

    const key = `call_booking_reminder_24h_email_${bookingId}`;
    const recorded = sentChannels.find((c) => c.sendKey === key);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("email");
  });

  it("sends the partner_call_reminder email (not kickoff_call_reminder) for a partner booking inside the 24h window", async () => {
    const memberId = await seedMember("partner-email");
    await seedBooking({
      type: "partner",
      staffId: seededPartnerId,
      memberId,
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    await processCallBookingReminders();

    expect(emailCallsFor("partner_call_reminder", memberId)).toHaveLength(1);
    expect(emailCallsFor("kickoff_call_reminder", memberId)).toHaveLength(0);
  });

  it("dedups the 24h email across repeated scheduler runs", async () => {
    const memberId = await seedMember("dedup-email");
    await seedBooking({
      type: "kickoff",
      staffId: seededKickoffCoachId,
      memberId,
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    await processCallBookingReminders();
    await processCallBookingReminders();

    expect(emailCallsFor("kickoff_call_reminder", memberId)).toHaveLength(1);
  });

  it("suppresses a stale 24h email reminder when the booking is canceled between reservation and send", async () => {
    const memberId = await seedMember("canceled-email");
    const bookingId = await seedBooking({
      type: "kickoff",
      staffId: seededKickoffCoachId,
      memberId,
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    // Simulate the real race: the booking is still "booked" when the
    // scheduler's initial SELECT runs, but gets canceled during the dedup
    // reservation call — i.e. strictly between the initial query and the
    // fresh-status recheck the implementation performs right before send.
    checkAndRecordSendMock.mockImplementationOnce(async (sendKey: string, channel: string) => {
      sentChannels.push({ sendKey, channel });
      await db
        .update(callBookingsTable)
        .set({ status: "canceled", cancelledAt: new Date() })
        .where(eq(callBookingsTable.id, bookingId));
      sentKeys.add(sendKey);
      return "recorded";
    });

    await processCallBookingReminders();

    expect(emailCallsFor("kickoff_call_reminder", memberId)).toHaveLength(0);
  });

  it("renders the reminder in the member's own timezone (falls back to America/New_York when unset)", async () => {
    const laMemberId = await seedMember("la-tz", { timezone: "America/Los_Angeles" });
    const noTzMemberId = await seedMember("no-tz", { timezone: null });

    const scheduledAt = new Date(Date.now() + 3 * 60 * 60 * 1000);

    await seedBooking({
      type: "kickoff",
      staffId: seededKickoffCoachId,
      memberId: laMemberId,
      scheduledAt,
    });
    await seedBooking({
      type: "kickoff",
      staffId: seededKickoffCoachId,
      memberId: noTzMemberId,
      scheduledAt,
    });

    await processCallBookingReminders();

    const laCalls = emailCallsFor("kickoff_call_reminder", laMemberId);
    const noTzCalls = emailCallsFor("kickoff_call_reminder", noTzMemberId);
    expect(laCalls).toHaveLength(1);
    expect(noTzCalls).toHaveLength(1);

    const laCall = laCalls[0][0] as { variables: { call_time: string } };
    const noTzCall = noTzCalls[0][0] as { variables: { call_time: string } };

    const expectedLa = formatInMemberTimezone(scheduledAt, "America/Los_Angeles");
    const expectedFallback = formatInMemberTimezone(scheduledAt, null);

    expect(laCall.variables.call_time).toBe(expectedLa.time);
    expect(noTzCall.variables.call_time).toBe(expectedFallback.time);
    expect(MEMBER_TIMEZONE_FALLBACK).toBe("America/New_York");
    expect(laCall.variables.call_time).not.toBe(noTzCall.variables.call_time);
  });
});

describe("processCallBookingReminders — 1h SMS opt-out + dedup", () => {
  it("texts the fully-eligible member (master SMS + partnerCallSmsOptIn + phone) inside the 1h window", async () => {
    const memberId = await seedMember("sms-yes", { phone: "+15555550701" });
    const bookingId = await seedBooking({
      type: "partner",
      staffId: seededPartnerId,
      memberId,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    await processCallBookingReminders();

    const calls = smsCallsFor("partner_call_reminder", memberId);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      templateSlug: "partner_call_reminder",
      to: "+15555550701",
      userId: memberId,
    });

    const key = `call_booking_reminder_1h_sms_${bookingId}`;
    const recorded = sentChannels.find((c) => c.sendKey === key);
    expect(recorded).toBeDefined();
    expect(recorded!.channel).toBe("sms");
  });

  it("skips a member who turned off partnerCallSmsOptIn (master SMS still on)", async () => {
    const memberId = await seedMember("sms-category-off", { partnerCallSmsOptIn: false });
    await seedBooking({
      type: "partner",
      staffId: seededPartnerId,
      memberId,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    await processCallBookingReminders();

    expect(smsCallsFor("partner_call_reminder", memberId)).toHaveLength(0);
  });

  it("skips a member with master smsOptIn off (even though partnerCallSmsOptIn is on)", async () => {
    const memberId = await seedMember("sms-master-off", { smsOptIn: false });
    await seedBooking({
      type: "partner",
      staffId: seededPartnerId,
      memberId,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    await processCallBookingReminders();

    expect(smsCallsFor("partner_call_reminder", memberId)).toHaveLength(0);
  });

  it("skips a member with no phone on file", async () => {
    const memberId = await seedMember("sms-no-phone", { phone: null });
    await seedBooking({
      type: "partner",
      staffId: seededPartnerId,
      memberId,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    await processCallBookingReminders();

    expect(smsCallsFor("partner_call_reminder", memberId)).toHaveLength(0);
  });

  it("dedups the 1h SMS across repeated scheduler runs", async () => {
    const memberId = await seedMember("sms-dedup");
    await seedBooking({
      type: "kickoff",
      staffId: seededKickoffCoachId,
      memberId,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    await processCallBookingReminders();
    await processCallBookingReminders();

    expect(smsCallsFor("kickoff_call_reminder", memberId)).toHaveLength(1);
  });

  it("suppresses a stale 1h SMS reminder when the booking is canceled between reservation and send", async () => {
    const memberId = await seedMember("sms-canceled");
    const bookingId = await seedBooking({
      type: "kickoff",
      staffId: seededKickoffCoachId,
      memberId,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    // Same real-race simulation as the email test above, applied to the SMS
    // dedup reservation: cancellation lands strictly between the initial
    // SELECT and the fresh-status recheck.
    checkAndRecordSendMock.mockImplementationOnce(async (sendKey: string, channel: string) => {
      sentChannels.push({ sendKey, channel });
      await db
        .update(callBookingsTable)
        .set({ status: "canceled", cancelledAt: new Date() })
        .where(eq(callBookingsTable.id, bookingId));
      sentKeys.add(sendKey);
      return "recorded";
    });

    await processCallBookingReminders();

    expect(smsCallsFor("kickoff_call_reminder", memberId)).toHaveLength(0);
  });

  it("does not queue an SMS for a booking outside the 1h window (only the 24h email fires)", async () => {
    const memberId = await seedMember("outside-1h-window");
    await seedBooking({
      type: "kickoff",
      staffId: seededKickoffCoachId,
      memberId,
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    await processCallBookingReminders();

    expect(smsCallsFor("kickoff_call_reminder", memberId)).toHaveLength(0);
    expect(emailCallsFor("kickoff_call_reminder", memberId)).toHaveLength(1);
  });
});
