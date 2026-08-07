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

  // Task #2114: full-tier kickoff calls move to Mark ONLY — Todd and Bruce
  // are deactivated (rows preserved for historical booking joins, never
  // deleted). Neil's launchpad row is untouched.
  it("seeds Mark as the only ACTIVE 'full' tier coach, Todd/Bruce inactive-but-preserved, Neil active 'launchpad', with exactly one row per coach", async () => {
    await seedCallBookingRoster();

    const rows = await db
      .select({ displayName: kickoffCoachesTable.displayName, tier: kickoffCoachesTable.tier, isActive: kickoffCoachesTable.isActive })
      .from(kickoffCoachesTable)
      .where(
        eq(kickoffCoachesTable.displayName, "Todd"),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe("full");
    expect(rows[0].isActive).toBe(false);

    const all = await db
      .select({ displayName: kickoffCoachesTable.displayName, tier: kickoffCoachesTable.tier, isActive: kickoffCoachesTable.isActive })
      .from(kickoffCoachesTable);
    const byName = new Map(all.map((r) => [r.displayName, r]));
    expect(byName.get("Mark")?.tier).toBe("full");
    expect(byName.get("Mark")?.isActive).toBe(true);
    // Bio is seeded for Mark (IS NULL guard — admin edits always win over
    // seed; we just verify it is non-null after a fresh seed run).
    const markFull = await db
      .select({ bio: kickoffCoachesTable.bio })
      .from(kickoffCoachesTable)
      .where(eq(kickoffCoachesTable.displayName, "Mark"))
      .limit(1);
    expect(markFull[0]?.bio).toBeTruthy();
    expect(byName.get("Bruce")?.tier).toBe("full");
    expect(byName.get("Bruce")?.isActive).toBe(false);
    expect(byName.get("Neil")?.tier).toBe("launchpad");
    expect(byName.get("Neil")?.isActive).toBe(true);

    const nameCounts = new Map<string, number>();
    for (const r of all) {
      nameCounts.set(r.displayName, (nameCounts.get(r.displayName) ?? 0) + 1);
    }
    for (const [name, count] of nameCounts) {
      expect(count, `${name} should have exactly one row`).toBe(1);
    }
  });
});
