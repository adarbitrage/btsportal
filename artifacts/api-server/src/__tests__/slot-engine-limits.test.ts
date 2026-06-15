import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  coachesTable,
  coachAvailabilityTable,
  coachingSessionsTable,
  coachingCallsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { getAvailableSlots } from "../lib/slot-engine";

// Regression guard for the slot engine's booking-limit rules.
//
// The slot generator enforces three rules that previously had no test
// coverage — exactly the class of invisible failure that let blocked days
// stay bookable:
//
//   - maxDailySessions  -> a coach never offers more sessions in a day than
//                          their cap, and sessions ALREADY on the calendar
//                          count toward that cap.
//   - conflict hiding   -> slots overlapping an existing scheduled 1-on-1
//                          session or a group call are not returned.
//   - 120-min lead time -> slots starting sooner than the minimum booking
//                          lead time (now + 120 minutes) are not returned.
//
// The engine works entirely off the real DB, so the suite seeds coaches with
// recurring availability and inspects the slots it returns. Coach and member
// timezone are kept identical (America/New_York) so date matching stays
// unambiguous.

const TZ = "America/New_York";
const TAG = `slot-limits-${randomUUID().slice(0, 8)}`;

let memberId = 0;
let capCoachId = 0;
let conflictCoachId = 0;
let leadCoachId = 0;
let durationCoachId = 0;
let bufferCoachId = 0;

const CAP = 3;

async function insertFullWeekCoach(
  suffix: string,
  maxDailySessions: number,
  opts: {
    sessionDurationMinutes?: number;
    bufferMinutes?: number;
    startTime?: string;
    endTime?: string;
  } = {},
): Promise<number> {
  const {
    // Default to hourly, buffer-free windows so the cap/conflict/lead-time
    // suites keep their original on-the-hour expectations. The session-length
    // and buffer behavior is exercised by dedicated coaches below.
    sessionDurationMinutes = 60,
    bufferMinutes = 0,
    startTime = "09:00",
    endTime = "17:00",
  } = opts;

  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `${TAG} ${suffix}`,
      bio: "fixture",
      specialties: "fixture",
      timezone: TZ,
      oneOnOneEnabled: true,
      maxDailySessions,
    })
    .returning({ id: coachesTable.id });

  // Recurring availability on every day of the week so that whichever calendar
  // date the tests land on has a baseline schedule.
  for (let dow = 0; dow < 7; dow++) {
    await db.insert(coachAvailabilityTable).values({
      coachId: coach.id,
      dayOfWeek: dow,
      startTime,
      endTime,
      timezone: TZ,
      sessionDurationMinutes,
      bufferMinutes,
    });
  }
  return coach.id;
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}@example.test`,
      name: "slot-limits fixture member",
      passwordHash,
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  memberId = member.id;

  capCoachId = await insertFullWeekCoach("cap", CAP);
  conflictCoachId = await insertFullWeekCoach("conflict", 10);
  leadCoachId = await insertFullWeekCoach("lead", 10);

  // Honors a 30-minute session length over a narrow 09:00-11:00 window.
  durationCoachId = await insertFullWeekCoach("duration", 10, {
    sessionDurationMinutes: 30,
    bufferMinutes: 0,
    startTime: "09:00",
    endTime: "11:00",
  });

  // 60-minute sessions with a 30-minute gap between them.
  bufferCoachId = await insertFullWeekCoach("buffer", 10, {
    sessionDurationMinutes: 60,
    bufferMinutes: 30,
  });
});

afterEach(async () => {
  for (const id of [
    capCoachId,
    conflictCoachId,
    leadCoachId,
    durationCoachId,
    bufferCoachId,
  ]) {
    if (id) {
      await db
        .delete(coachingSessionsTable)
        .where(eq(coachingSessionsTable.coachId, id));
      await db
        .delete(coachingCallsTable)
        .where(eq(coachingCallsTable.coachId, id));
    }
  }
});

afterAll(async () => {
  for (const id of [
    capCoachId,
    conflictCoachId,
    leadCoachId,
    durationCoachId,
    bufferCoachId,
  ]) {
    if (!id) continue;
    await db
      .delete(coachingSessionsTable)
      .where(eq(coachingSessionsTable.coachId, id));
    await db
      .delete(coachingCallsTable)
      .where(eq(coachingCallsTable.coachId, id));
    await db
      .delete(coachAvailabilityTable)
      .where(eq(coachAvailabilityTable.coachId, id));
    await db.delete(coachesTable).where(eq(coachesTable.id, id));
  }
  if (memberId) {
    await db.delete(usersTable).where(eq(usersTable.id, memberId));
  }
});

// A date far enough in the future to clear the engine's 120-minute minimum
// booking lead time regardless of when the suite runs.
function targetDateStr(): string {
  return format(addDays(new Date(), 30), "yyyy-MM-dd");
}

// The coach-local start hour ("09", "14", ...) of each returned slot.
function localStartHours(slots: { startTime: string }[]): string[] {
  return slots.map((s) => formatInTimeZone(new Date(s.startTime), TZ, "HH"));
}

async function insertScheduledSession(
  coachId: number,
  dateStr: string,
  localTime: string,
): Promise<void> {
  await db.insert(coachingSessionsTable).values({
    coachId,
    memberId,
    scheduledAt: fromZonedTime(`${dateStr} ${localTime}:00`, TZ),
    durationMinutes: 60,
    status: "scheduled",
  });
}

async function insertGroupCall(
  coachId: number,
  dateStr: string,
  localTime: string,
): Promise<void> {
  await db.insert(coachingCallsTable).values({
    coachId,
    title: `${TAG} group call`,
    description: "fixture",
    scheduledAt: fromZonedTime(`${dateStr} ${localTime}:00`, TZ),
    durationMinutes: 60,
  });
}

// The coach-local "HH:mm" start of each returned slot.
function localStartTimes(slots: { startTime: string }[]): string[] {
  return slots.map((s) => formatInTimeZone(new Date(s.startTime), TZ, "HH:mm"));
}

// The length in minutes of a returned slot (end - start).
function slotDurationMinutes(slot: { startTime: string; endTime: string }): number {
  return (
    (new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime()) /
    60000
  );
}

describe("getAvailableSlots session length", () => {
  it("uses the window's sessionDurationMinutes for slot length and spacing", async () => {
    const date = targetDateStr();
    // 09:00-11:00 with 30-minute sessions and no buffer -> four slots, each
    // 30 minutes long and spaced 30 minutes apart.
    const slots = await getAvailableSlots(durationCoachId, date, date, TZ);

    expect(localStartTimes(slots)).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ]);
    // Every offered slot is exactly the configured 30-minute length, not the
    // legacy hard-coded 60 minutes.
    for (const slot of slots) {
      expect(slotDurationMinutes(slot)).toBe(30);
    }
  });
});

describe("getAvailableSlots buffer between sessions", () => {
  it("spaces slots by session + buffer so back-to-back calls keep a gap", async () => {
    const date = targetDateStr();
    // 09:00-17:00 with 60-minute sessions and a 30-minute buffer -> starts
    // every 90 minutes: 09:00, 10:30, 12:00, 13:30, 15:00 (16:30 would end at
    // 17:30, past the window).
    const slots = await getAvailableSlots(bufferCoachId, date, date, TZ);

    expect(localStartTimes(slots)).toEqual([
      "09:00",
      "10:30",
      "12:00",
      "13:30",
      "15:00",
    ]);
    // Each slot is still a full 60-minute session...
    for (const slot of slots) {
      expect(slotDurationMinutes(slot)).toBe(60);
    }
    // ...and consecutive starts are 90 minutes apart (60 session + 30 buffer).
    for (let i = 1; i < slots.length; i++) {
      const gap =
        (new Date(slots[i].startTime).getTime() -
          new Date(slots[i - 1].startTime).getTime()) /
        60000;
      expect(gap).toBe(90);
    }
  });

  it("pads conflict checks by the buffer so a new slot can't sit flush against a booking", async () => {
    const date = targetDateStr();

    // Baseline: 12:00 and 13:30 are both offered before anything is booked.
    const before = localStartTimes(
      await getAvailableSlots(bufferCoachId, date, date, TZ),
    );
    expect(before).toContain("12:00");
    expect(before).toContain("13:30");

    // A group call from 12:30-13:30 directly overlaps the 12:00 slot and sits
    // flush against the start of the 13:30 slot. With a 30-minute buffer, both
    // must disappear: 13:30 would otherwise survive without padding.
    await insertGroupCall(bufferCoachId, date, "12:30");

    const after = localStartTimes(
      await getAvailableSlots(bufferCoachId, date, date, TZ),
    );
    expect(after).not.toContain("12:00"); // direct overlap
    expect(after).not.toContain("13:30"); // removed only because of the buffer
    // Slots a full buffer clear of the booking remain available.
    expect(after).toContain("10:30");
    expect(after).toContain("15:00");
  });
});

describe("getAvailableSlots maxDailySessions cap", () => {
  it("never returns more slots in a day than the coach's cap", async () => {
    const date = targetDateStr();
    // The 09:00-17:00 window yields 8 hourly slots, well above the cap of 3.
    const slots = await getAvailableSlots(capCoachId, date, date, TZ);
    expect(slots).toHaveLength(CAP);
  });

  it("counts already-booked sessions toward the daily cap", async () => {
    const date = targetDateStr();

    // With no bookings the coach offers exactly `CAP` slots.
    const before = await getAvailableSlots(capCoachId, date, date, TZ);
    expect(before).toHaveLength(CAP);

    // One session already on the calendar must consume one of the cap's
    // slots, so the coach now offers one fewer bookable slot.
    await insertScheduledSession(capCoachId, date, "09");

    const after = await getAvailableSlots(capCoachId, date, date, TZ);
    expect(after).toHaveLength(CAP - 1);

    // The existing booking (1) plus the still-bookable slots must not exceed
    // the cap, proving booked sessions count against the limit.
    expect(1 + after.length).toBe(CAP);

    // And the booked 09:00 slot itself is never offered.
    expect(localStartHours(after)).not.toContain("09");
  });
});

describe("getAvailableSlots conflict hiding", () => {
  it("does not return slots overlapping an existing session or group call", async () => {
    const date = targetDateStr();

    // Baseline: the conflicting hours are bookable before anything is booked.
    const before = await getAvailableSlots(conflictCoachId, date, date, TZ);
    const beforeHours = localStartHours(before);
    expect(beforeHours).toContain("11");
    expect(beforeHours).toContain("14");

    // Book a 1-on-1 session at 11:00 and a group call at 14:00.
    await insertScheduledSession(conflictCoachId, date, "11");
    await insertGroupCall(conflictCoachId, date, "14");

    const after = await getAvailableSlots(conflictCoachId, date, date, TZ);
    const afterHours = localStartHours(after);

    // Both conflicting hours disappear...
    expect(afterHours).not.toContain("11");
    expect(afterHours).not.toContain("14");
    // ...while neighbouring, non-conflicting hours remain bookable.
    expect(afterHours).toContain("10");
    expect(afterHours).toContain("13");
    expect(afterHours).toContain("15");
  });
});

describe("getAvailableSlots minimum booking lead time", () => {
  // Pin "now" so the 120-minute lead-time boundary is deterministic. Only the
  // Date global is faked (timers stay real) so DB I/O keeps working.
  // 2026-09-15T14:00:00Z is 10:00 in America/New_York (EDT, no DST edge),
  // which makes the minimum booking time exactly 12:00 local.
  const fakeNow = new Date("2026-09-15T14:00:00.000Z");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("excludes slots sooner than the 120-minute lead time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fakeNow);

    const date = formatInTimeZone(fakeNow, TZ, "yyyy-MM-dd"); // 2026-09-15
    const slots = await getAvailableSlots(leadCoachId, date, date, TZ);

    // Non-vacuous: same-day slots beyond the lead time must still appear.
    expect(slots.length).toBeGreaterThan(0);

    const minBookingMs = fakeNow.getTime() + 120 * 60 * 1000;
    for (const slot of slots) {
      expect(new Date(slot.startTime).getTime()).toBeGreaterThanOrEqual(
        minBookingMs,
      );
    }

    const hours = localStartHours(slots);
    // 11:00 is in the future but inside the 120-minute window -> excluded,
    // proving the lead time (not merely "in the past") is enforced.
    expect(hours).not.toContain("11");
    // 12:00 is exactly the lead-time boundary -> the earliest bookable slot.
    expect(hours).toContain("12");
    expect(hours[0]).toBe("12");
  });
});
