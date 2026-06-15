import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  coachesTable,
  coachAvailabilityTable,
  coachAvailabilityOverridesTable,
  coachingSessionsTable,
  coachingCallsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { getAvailableSlots } from "../lib/slot-engine";

// Regression guard for the slot engine's CROSS-TIMEZONE math.
//
// The slot-engine-limits suite deliberately keeps the coach and the member in
// the same timezone (America/New_York) so its date matching stays
// unambiguous. That leaves the engine's hardest behaviour untested: it
// converts a coach's local availability windows into the member's timezone and
// back, and groups the daily-session cap by the coach's *local* day. A
// regression there — slots landing on the wrong coach-local hour, or the cap
// leaking across a coach-day boundary because it was grouped by the member's
// day instead — would produce wrong-but-plausible slots that no existing test
// would catch.
//
// These tests pin coach and member to DIFFERENT offsets and assert the two
// invariants the engine promises:
//
//   1. Returned slots fall on the coach's local availability hours, regardless
//      of the member's offset (and, viewed in the member's timezone, are
//      shifted by exactly that offset — proving a conversion really happened).
//   2. The daily-session cap is grouped by the coach's local day even when the
//      coach's working day straddles the member's midnight, so bookings on one
//      member day count against slots that the member sees on the adjacent day.

const TAG = `slot-tz-${randomUUID().slice(0, 8)}`;

// America/New_York and America/Los_Angeles always sit exactly 3 hours apart
// (both observe DST in lockstep), so the absolute hour assertions in test 1
// hold on any date without DST bookkeeping.
const COACH_TZ_1 = "America/New_York";
const MEMBER_TZ_1 = "America/Los_Angeles";

// Asia/Tokyo (UTC+9, no DST) is far enough ahead of America/Los_Angeles that a
// 09:00-17:00 Tokyo working day straddles the member's local midnight: its
// early hours fall on the member's previous calendar day while its late hours
// roll over to the next. That split is exactly what the coach-day grouping in
// test 2 must survive.
const COACH_TZ_2 = "Asia/Tokyo";
const MEMBER_TZ_2 = "America/Los_Angeles";

const SPAN_CAP = 10; // effectively uncapped: the 09:00-17:00 window yields 8.
const TZ_CAP = 3;

let memberId = 0;
let hoursCoachId = 0; // NY coach viewed from an LA member.
let spanCoachId = 0; // Tokyo coach, high cap — exercises the day straddle.
let capCoachId = 0; // Tokyo coach, low cap — exercises coach-day grouping.
let overrideCoachId = 0; // Tokyo coach, high cap — exercises date overrides.

async function insertFullWeekCoach(
  suffix: string,
  timezone: string,
  maxDailySessions: number,
): Promise<number> {
  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: `${TAG} ${suffix}`,
      bio: "fixture",
      specialties: "fixture",
      timezone,
      oneOnOneEnabled: true,
      maxDailySessions,
    })
    .returning({ id: coachesTable.id });

  // Recurring availability on every day of the week, 09:00-17:00 in the
  // coach's own timezone, so whichever date the tests land on has a baseline
  // schedule. Session length is pinned to 60 minutes with a 0-minute buffer
  // (the schema defaults to a 15-minute buffer) so the window yields exactly
  // 8 clean hourly slots — the spacing math is exercised elsewhere; these
  // tests are about the timezone conversion.
  for (let dow = 0; dow < 7; dow++) {
    await db.insert(coachAvailabilityTable).values({
      coachId: coach.id,
      dayOfWeek: dow,
      startTime: "09:00",
      endTime: "17:00",
      timezone,
      sessionDurationMinutes: 60,
      bufferMinutes: 0,
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
      name: "slot-tz fixture member",
      passwordHash,
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  memberId = member.id;

  hoursCoachId = await insertFullWeekCoach("hours", COACH_TZ_1, SPAN_CAP);
  spanCoachId = await insertFullWeekCoach("span", COACH_TZ_2, SPAN_CAP);
  capCoachId = await insertFullWeekCoach("cap", COACH_TZ_2, TZ_CAP);
  overrideCoachId = await insertFullWeekCoach("override", COACH_TZ_2, SPAN_CAP);
});

afterEach(async () => {
  for (const id of [hoursCoachId, spanCoachId, capCoachId, overrideCoachId]) {
    if (id) {
      await db
        .delete(coachingSessionsTable)
        .where(eq(coachingSessionsTable.coachId, id));
      await db
        .delete(coachingCallsTable)
        .where(eq(coachingCallsTable.coachId, id));
      await db
        .delete(coachAvailabilityOverridesTable)
        .where(eq(coachAvailabilityOverridesTable.coachId, id));
    }
  }
});

afterAll(async () => {
  for (const id of [hoursCoachId, spanCoachId, capCoachId, overrideCoachId]) {
    if (!id) continue;
    await db
      .delete(coachingSessionsTable)
      .where(eq(coachingSessionsTable.coachId, id));
    await db
      .delete(coachingCallsTable)
      .where(eq(coachingCallsTable.coachId, id));
    await db
      .delete(coachAvailabilityOverridesTable)
      .where(eq(coachAvailabilityOverridesTable.coachId, id));
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

// The two-digit start hours of each slot, rendered in a given timezone.
function startHoursIn(slots: { startTime: string }[], tz: string): string[] {
  return slots.map((s) => formatInTimeZone(new Date(s.startTime), tz, "HH"));
}

// The set of distinct calendar days the slots fall on, in a given timezone.
function distinctDays(slots: { startTime: string }[], tz: string): Set<string> {
  return new Set(
    slots.map((s) => formatInTimeZone(new Date(s.startTime), tz, "yyyy-MM-dd")),
  );
}

describe("getAvailableSlots cross-timezone hours", () => {
  it("returns slots on the coach's local hours, offset for the member", async () => {
    const date = targetDateStr();

    // Coach is in New_York; the member requests from Los_Angeles (3h behind).
    const slots = await getAvailableSlots(
      hoursCoachId,
      date,
      date,
      MEMBER_TZ_1,
    );

    // The 09:00-17:00 coach window yields 8 hourly slots starting 09..16.
    expect(slots).toHaveLength(8);

    // Viewed in the COACH's timezone the slots sit on exactly the configured
    // availability hours — the conversion did not drift the schedule.
    expect(startHoursIn(slots, COACH_TZ_1)).toEqual([
      "09",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
    ]);

    // Viewed in the MEMBER's timezone the same instants are shifted back by
    // exactly the 3-hour offset (06..13) — proving a real timezone conversion
    // happened rather than the coach hours being echoed verbatim.
    expect(startHoursIn(slots, MEMBER_TZ_1)).toEqual([
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
      "13",
    ]);
  });
});

describe("getAvailableSlots cross-timezone daily cap", () => {
  it("keeps a coach working day intact when it straddles the member's midnight", async () => {
    const date = targetDateStr();

    // High-cap Tokyo coach so the cap never trims: we want to see the whole
    // 8-slot working day.
    const slots = await getAvailableSlots(
      spanCoachId,
      date,
      date,
      MEMBER_TZ_2,
    );
    expect(slots).toHaveLength(8);

    // All 8 belong to a SINGLE coach-local day...
    expect(distinctDays(slots, COACH_TZ_2).size).toBe(1);
    // ...even though, in the member's timezone, that day straddles midnight
    // and the slots land on TWO different calendar days.
    expect(distinctDays(slots, MEMBER_TZ_2).size).toBe(2);
  });

  it("groups the daily cap by the coach's local day across the member boundary", async () => {
    const date = targetDateStr();

    // With nothing booked, the low-cap Tokyo coach offers exactly TZ_CAP slots
    // for the coach-local day — the cap is applied per coach day, not per
    // member day.
    const before = await getAvailableSlots(capCoachId, date, date, MEMBER_TZ_2);
    expect(before).toHaveLength(TZ_CAP);
    expect(distinctDays(before, COACH_TZ_2).size).toBe(1);

    // Book a session at 16:00 in the coach's timezone. In the member's
    // timezone that instant lands on a DIFFERENT calendar day than the early
    // slots above (which the member sees on the previous day).
    const bookingAt = fromZonedTime(`${date} 16:00:00`, COACH_TZ_2);
    await db.insert(coachingSessionsTable).values({
      coachId: capCoachId,
      memberId,
      scheduledAt: bookingAt,
      durationMinutes: 60,
      status: "scheduled",
    });

    const bookingMemberDay = formatInTimeZone(
      bookingAt,
      MEMBER_TZ_2,
      "yyyy-MM-dd",
    );

    const after = await getAvailableSlots(capCoachId, date, date, MEMBER_TZ_2);

    // The booking consumed one of the coach day's cap slots, so one fewer slot
    // is offered — even though the booking and the remaining slots fall on
    // different member-local days. This only holds if the cap is grouped by
    // the coach's local day.
    expect(after).toHaveLength(TZ_CAP - 1);

    // Sanity: the remaining slots really are on a different member day than the
    // booking, so the reduction above genuinely crossed the member boundary.
    const afterMemberDays = distinctDays(after, MEMBER_TZ_2);
    expect(afterMemberDays.has(bookingMemberDay)).toBe(false);

    // And all remaining slots are still the one coach-local day.
    expect(distinctDays(after, COACH_TZ_2).size).toBe(1);
  });
});

// Date-specific overrides (a blocked day or custom hours for one calendar
// date) are matched against the COACH's local day inside the engine. The
// override-only suite keeps coach and member in the same timezone, so a
// regression where the override landed on the wrong calendar day for an
// out-of-timezone member would slip past it. These tests pin the coach to
// Asia/Tokyo and the member to America/Los_Angeles (whose offset is large
// enough that a Tokyo working day straddles the member's midnight) and assert
// the override applies to the coach-local date — not the member-local date.
describe("getAvailableSlots cross-timezone date overrides", () => {
  // Three consecutive coach-local dates. With the X->X member/coach day
  // mapping the engine uses for this offset, querying the member range
  // [prev, next] builds exactly these three coach-local days.
  function overrideDates() {
    return {
      prev: format(addDays(new Date(), 29), "yyyy-MM-dd"),
      mid: format(addDays(new Date(), 30), "yyyy-MM-dd"),
      next: format(addDays(new Date(), 31), "yyyy-MM-dd"),
    };
  }

  it("blocks the coach-local override date without affecting neighbouring days", async () => {
    const { prev, mid, next } = overrideDates();

    // Baseline: all three coach-local days produce their full 8-slot schedule
    // for the out-of-timezone member before anything is blocked.
    const before = await getAvailableSlots(
      overrideCoachId,
      prev,
      next,
      MEMBER_TZ_2,
    );
    expect(distinctDays(before, COACH_TZ_2)).toEqual(
      new Set([prev, mid, next]),
    );

    // Block the MIDDLE coach-local day.
    await db.insert(coachAvailabilityOverridesTable).values({
      coachId: overrideCoachId,
      overrideDate: mid,
      overrideType: "blocked",
      reason: `${TAG} blocked-day cross-tz`,
    });

    const after = await getAvailableSlots(
      overrideCoachId,
      prev,
      next,
      MEMBER_TZ_2,
    );

    // The blocked coach-local day produces no slots at all...
    const afterCoachDays = distinctDays(after, COACH_TZ_2);
    expect(afterCoachDays.has(mid)).toBe(false);
    // ...while the neighbouring coach-local days keep their full schedule,
    // proving the block was scoped to a single coach-local calendar date and
    // not smeared onto the wrong day by the member's offset.
    expect(afterCoachDays).toEqual(new Set([prev, next]));
    for (const day of [prev, next]) {
      const onDay = after.filter(
        (s) => formatInTimeZone(new Date(s.startTime), COACH_TZ_2, "yyyy-MM-dd") === day,
      );
      expect(onDay).toHaveLength(8);
    }
  });

  it("applies a custom-hours override on the coach-local date for an out-of-timezone member", async () => {
    const { mid } = overrideDates();

    // Custom afternoon window in the COACH's timezone: 13:00-15:00 with the
    // 60-minute override default yields 13:00 and 14:00 starts.
    await db.insert(coachAvailabilityOverridesTable).values({
      coachId: overrideCoachId,
      overrideDate: mid,
      overrideType: "extra",
      startTime: "13:00",
      endTime: "15:00",
      reason: `${TAG} custom-hours cross-tz`,
    });

    const slots = await getAvailableSlots(
      overrideCoachId,
      mid,
      mid,
      MEMBER_TZ_2,
    );

    // Exactly the two custom-window slots, on the coach's local 13:00/14:00...
    expect(slots).toHaveLength(2);
    expect(startHoursIn(slots, COACH_TZ_2)).toEqual(["13", "14"]);
    // ...and the recurring 09:00-17:00 morning window is gone, proving the
    // override replaced the recurring schedule for that day only.
    expect(startHoursIn(slots, COACH_TZ_2)).not.toContain("09");

    // The override hours are anchored to the COACH's local date even though,
    // in the member's timezone, that Tokyo afternoon falls on the PREVIOUS
    // member calendar day — a real conversion happened, not a verbatim echo.
    expect(distinctDays(slots, COACH_TZ_2)).toEqual(new Set([mid]));
    const memberDays = distinctDays(slots, MEMBER_TZ_2);
    expect([...memberDays].every((d) => d < mid)).toBe(true);
  });
});
