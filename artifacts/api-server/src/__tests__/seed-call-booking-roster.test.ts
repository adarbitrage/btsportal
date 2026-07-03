import { describe, it, expect } from "vitest";
import { db, kickoffCoachesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { seedCallBookingRoster } from "../lib/seed-call-booking-roster";

// Task #1641/#1655: the kickoff-coach roster seed is keyed on displayName
// and runs on every boot. It must be a true no-op on repeat runs (no
// duplicate rows), and a seed entry with a real ghlCalendarId (which is now
// true for every roster row, including Neil as of Task #1655) always
// re-syncs the DB to that value — the no-clobber branch in
// seed-call-booking-roster.ts only guards a seed entry whose ghlCalendarId
// is null/placeholder, which no current row uses.
describe("seed-call-booking-roster kickoff coach idempotency (Task #1641/#1655)", () => {
  it("re-running the seed does not duplicate Neil's launchpad row and keeps it synced to the roster's real ghlCalendarId", async () => {
    await seedCallBookingRoster();

    const before = await db
      .select()
      .from(kickoffCoachesTable)
      .where(eq(kickoffCoachesTable.displayName, "Neil"));
    expect(before).toHaveLength(1);
    expect(before[0].tier).toBe("launchpad");
    expect(before[0].ghlCalendarId).toBe("oU93ZehoQfngqPQYVB7n");

    await seedCallBookingRoster();

    const after = await db
      .select()
      .from(kickoffCoachesTable)
      .where(eq(kickoffCoachesTable.displayName, "Neil"));

    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].tier).toBe("launchpad");
    expect(after[0].ghlCalendarId).toBe("oU93ZehoQfngqPQYVB7n");
  });

  it("seeds Todd, Mark, and Bruce as 'full' tier and Neil as 'launchpad' tier, with exactly one row per coach", async () => {
    await seedCallBookingRoster();

    const rows = await db
      .select({ displayName: kickoffCoachesTable.displayName, tier: kickoffCoachesTable.tier })
      .from(kickoffCoachesTable)
      .where(
        eq(kickoffCoachesTable.displayName, "Todd"),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe("full");

    const all = await db
      .select({ displayName: kickoffCoachesTable.displayName, tier: kickoffCoachesTable.tier })
      .from(kickoffCoachesTable);
    const byName = new Map(all.map((r) => [r.displayName, r.tier]));
    expect(byName.get("Mark")).toBe("full");
    expect(byName.get("Bruce")).toBe("full");
    expect(byName.get("Neil")).toBe("launchpad");

    const nameCounts = new Map<string, number>();
    for (const r of all) {
      nameCounts.set(r.displayName, (nameCounts.get(r.displayName) ?? 0) + 1);
    }
    for (const [name, count] of nameCounts) {
      expect(count, `${name} should have exactly one row`).toBe(1);
    }
  });
});
