import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  db,
  coachesTable,
  coachAvailabilityTable,
  coachAvailabilityOverridesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { getAvailableSlots } from "../lib/slot-engine";

// Regression guard for the slot engine's day-override handling.
//
// The slot generator once read a non-existent column when deciding whether
// a day was "blocked", so blocked days silently stayed bookable. There were
// no automated tests over the slot engine, so the bug was invisible. These
// tests exercise the two override shapes the engine has to honour:
//
//   - overrideType "blocked"  -> the whole day must produce zero slots
//   - overrideType "extra"    -> a custom availability window must produce
//                                slots, replacing the recurring schedule.
//
// The engine works entirely off the real DB, so the suite seeds a coach
// with recurring availability and inspects the slots it returns. Coach and
// member timezone are kept identical (America/New_York) so date matching
// stays unambiguous.

const TZ = "America/New_York";
let coachId = 0;

beforeAll(async () => {
  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: "slot-engine-overrides fixture coach",
      bio: "fixture",
      specialties: "fixture",
      timezone: TZ,
      oneOnOneEnabled: true,
      maxDailySessions: 10,
    })
    .returning({ id: coachesTable.id });
  coachId = coach.id;

  // Recurring availability on every day of the week, 09:00-17:00, so that
  // whichever calendar date the tests land on has a baseline schedule.
  // Session length / buffer are pinned to 60/0 explicitly (rather than the
  // schema defaults of 60/15) so slot-count assertions stay deterministic and
  // so a fallback-to-recurring inheritance is distinguishable from the schema
  // default buffer of 15.
  for (let dow = 0; dow < 7; dow++) {
    await db.insert(coachAvailabilityTable).values({
      coachId,
      dayOfWeek: dow,
      startTime: "09:00",
      endTime: "17:00",
      timezone: TZ,
      sessionDurationMinutes: 60,
      bufferMinutes: 0,
    });
  }
});

afterEach(async () => {
  await db
    .delete(coachAvailabilityOverridesTable)
    .where(eq(coachAvailabilityOverridesTable.coachId, coachId));
});

afterAll(async () => {
  if (!coachId) return;
  await db
    .delete(coachAvailabilityOverridesTable)
    .where(eq(coachAvailabilityOverridesTable.coachId, coachId));
  await db
    .delete(coachAvailabilityTable)
    .where(eq(coachAvailabilityTable.coachId, coachId));
  await db.delete(coachesTable).where(eq(coachesTable.id, coachId));
});

// A date far enough in the future to clear the engine's 120-minute minimum
// booking lead time regardless of when the suite runs.
function targetDateStr(): string {
  return format(addDays(new Date(), 30), "yyyy-MM-dd");
}

describe("getAvailableSlots day overrides", () => {
  it("returns a baseline of slots on a normal day (sanity check)", async () => {
    const date = targetDateStr();
    const slots = await getAvailableSlots(coachId, date, date, TZ);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.coachId === coachId)).toBe(true);
  });

  it("returns no slots on a day with a 'blocked' override", async () => {
    const date = targetDateStr();

    // Confirm slots exist before the block so the assertion is meaningful.
    const before = await getAvailableSlots(coachId, date, date, TZ);
    expect(before.length).toBeGreaterThan(0);

    await db.insert(coachAvailabilityOverridesTable).values({
      coachId,
      overrideDate: date,
      overrideType: "blocked",
      reason: "blocked-day regression test",
    });

    const after = await getAvailableSlots(coachId, date, date, TZ);
    expect(after).toHaveLength(0);
  });

  it("uses the custom window from an 'extra' override instead of the recurring schedule", async () => {
    const date = targetDateStr();

    // Custom afternoon window: 14:00-17:00 -> 14:00, 15:00, 16:00 starts.
    await db.insert(coachAvailabilityOverridesTable).values({
      coachId,
      overrideDate: date,
      overrideType: "extra",
      startTime: "14:00",
      endTime: "17:00",
      reason: "extra-availability regression test",
    });

    const slots = await getAvailableSlots(coachId, date, date, TZ);

    expect(slots).toHaveLength(3);

    // The custom window's slots must appear...
    const localStartHours = slots.map((s) =>
      new Date(s.startTime).toLocaleString("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: TZ,
      }),
    );
    expect(localStartHours).toEqual(["14", "15", "16"]);

    // ...and the recurring morning slots (09:00) must NOT, proving the
    // custom window replaced the recurring schedule.
    expect(localStartHours).not.toContain("09");
  });

  it("inherits session length / buffer from the recurring window when the override leaves them unset", async () => {
    const date = targetDateStr();

    // Custom window 14:00-17:00 with no session/buffer set. The recurring
    // window for this coach is 60-minute sessions with a 0-minute buffer, so
    // the override should inherit those and produce 14:00, 15:00, 16:00.
    // (If it had fallen back to the schema default buffer of 15 instead, the
    // 75-minute increment would yield only 14:00 and 15:15.)
    await db.insert(coachAvailabilityOverridesTable).values({
      coachId,
      overrideDate: date,
      overrideType: "extra",
      startTime: "14:00",
      endTime: "17:00",
      reason: "override-inherits-recurring regression test",
    });

    const slots = await getAvailableSlots(coachId, date, date, TZ);

    const localStartHours = slots.map((s) =>
      new Date(s.startTime).toLocaleString("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: TZ,
      }),
    );
    expect(localStartHours).toEqual(["14", "15", "16"]);
  });

  it("uses a non-60-minute session length and a non-zero buffer set on the override", async () => {
    const date = targetDateStr();

    // 30-minute sessions with a 15-minute buffer => a 45-minute increment.
    // Window 14:00-16:00 yields starts at 14:00 (ends 14:30), 14:45 (ends
    // 15:15) and 15:30 (ends 16:00). The next start, 16:15, would end past
    // 16:00 and is dropped.
    await db.insert(coachAvailabilityOverridesTable).values({
      coachId,
      overrideDate: date,
      overrideType: "extra",
      startTime: "14:00",
      endTime: "16:00",
      sessionDurationMinutes: 30,
      bufferMinutes: 15,
      reason: "override-custom-session-buffer regression test",
    });

    const slots = await getAvailableSlots(coachId, date, date, TZ);

    const localStarts = slots.map((s) =>
      new Date(s.startTime).toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: TZ,
      }),
    );
    expect(localStarts).toEqual(["14:00", "14:45", "15:30"]);

    // Each emitted slot is exactly the override's 30-minute session long.
    for (const s of slots) {
      const durationMinutes =
        (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) /
        60000;
      expect(durationMinutes).toBe(30);
    }
  });
});

// When an "extra" override omits its own session-duration / buffer, the slot
// engine inherits the weekday's recurring-window values (falling back to
// DEFAULT_SESSION_DURATION / DEFAULT_OVERRIDE_BUFFER only when the coach has no
// recurring window that day). The guard below seeds a coach whose recurring
// windows use deliberately non-default values (30-minute sessions, 30-minute
// buffer) and proves an override day with no length/buffer of its own inherits
// those 30-minute sessions rather than the fixed 60-minute default.
describe("getAvailableSlots override day inherits recurring session length and buffer", () => {
  let customCoachId = 0;

  beforeAll(async () => {
    const [coach] = await db
      .insert(coachesTable)
      .values({
        name: "slot-engine-override-defaults fixture coach",
        bio: "fixture",
        specialties: "fixture",
        timezone: TZ,
        oneOnOneEnabled: true,
        maxDailySessions: 10,
      })
      .returning({ id: coachesTable.id });
    customCoachId = coach.id;

    // Recurring availability on every day, 09:00-17:00, with NON-default
    // 30-minute sessions and a 30-minute buffer (the schema defaults are
    // 60 / 15). If the override day ever read these recurring values, the
    // assertions below would fail.
    for (let dow = 0; dow < 7; dow++) {
      await db.insert(coachAvailabilityTable).values({
        coachId: customCoachId,
        dayOfWeek: dow,
        startTime: "09:00",
        endTime: "17:00",
        timezone: TZ,
        sessionDurationMinutes: 30,
        bufferMinutes: 30,
      });
    }
  });

  afterEach(async () => {
    await db
      .delete(coachAvailabilityOverridesTable)
      .where(eq(coachAvailabilityOverridesTable.coachId, customCoachId));
  });

  afterAll(async () => {
    if (!customCoachId) return;
    await db
      .delete(coachAvailabilityOverridesTable)
      .where(eq(coachAvailabilityOverridesTable.coachId, customCoachId));
    await db
      .delete(coachAvailabilityTable)
      .where(eq(coachAvailabilityTable.coachId, customCoachId));
    await db.delete(coachesTable).where(eq(coachesTable.id, customCoachId));
  });

  it("inherits the recurring window's 30-minute length and buffer when the override leaves them unset", async () => {
    const date = targetDateStr();

    // Custom window 14:00-17:00 with no session/buffer of its own. The coach's
    // recurring windows are 30-minute sessions with a 30-minute buffer, so the
    // override inherits those: a 60-minute increment (30 + 30) yields starts at
    // 14:00, 15:00, 16:00, each session 30 minutes long.
    await db.insert(coachAvailabilityOverridesTable).values({
      coachId: customCoachId,
      overrideDate: date,
      overrideType: "extra",
      startTime: "14:00",
      endTime: "17:00",
      reason: "override-inherits-recurring length/buffer regression test",
    });

    const slots = await getAvailableSlots(customCoachId, date, date, TZ);

    // 30-min sessions on a 60-min stride across 14:00-17:00 -> exactly 3.
    expect(slots).toHaveLength(3);

    const localStartHours = slots.map((s) =>
      new Date(s.startTime).toLocaleString("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: TZ,
      }),
    );
    expect(localStartHours).toEqual(["14", "15", "16"]);

    // Each slot must be exactly 30 minutes long (inherited from the recurring
    // window), not the 60-minute override default.
    for (const slot of slots) {
      const durationMinutes =
        (new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime()) /
        60000;
      expect(durationMinutes).toBe(30);
    }

    // Consecutive starts must be exactly 60 minutes apart (30 session + 30
    // buffer, both inherited from the recurring window).
    const startMs = slots.map((s) => new Date(s.startTime).getTime());
    for (let i = 1; i < startMs.length; i++) {
      expect((startMs[i] - startMs[i - 1]) / 60000).toBe(60);
    }
  });
});
