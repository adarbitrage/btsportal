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
  for (let dow = 0; dow < 7; dow++) {
    await db.insert(coachAvailabilityTable).values({
      coachId,
      dayOfWeek: dow,
      startTime: "09:00",
      endTime: "17:00",
      timezone: TZ,
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
});
