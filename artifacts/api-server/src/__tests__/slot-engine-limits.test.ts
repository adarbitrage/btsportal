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

const CAP = 3;

async function insertFullWeekCoach(
  suffix: string,
  maxDailySessions: number,
): Promise<number> {
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

  // Recurring availability on every day of the week, 09:00-17:00, so that
  // whichever calendar date the tests land on has a baseline schedule.
  for (let dow = 0; dow < 7; dow++) {
    await db.insert(coachAvailabilityTable).values({
      coachId: coach.id,
      dayOfWeek: dow,
      startTime: "09:00",
      endTime: "17:00",
      timezone: TZ,
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
});

afterEach(async () => {
  for (const id of [capCoachId, conflictCoachId, leadCoachId]) {
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
  for (const id of [capCoachId, conflictCoachId, leadCoachId]) {
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
