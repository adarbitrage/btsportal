import { describe, it, expect } from "vitest";
import { db, kickoffCoachesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { seedCallBookingRoster } from "../lib/seed-call-booking-roster";

// Task #1641: the kickoff-coach roster seed is keyed on displayName and runs
// on every boot. It must be a true no-op on repeat runs (no duplicate rows)
// and must never let its own placeholder (null) ghlCalendarId clobber a real
// calendar ID entered later through the admin editor.
describe("seed-call-booking-roster kickoff coach idempotency (Task #1641)", () => {
  it("re-running the seed does not duplicate Neil's launchpad row and does not clobber a real ghlCalendarId with the seed's null placeholder", async () => {
    await seedCallBookingRoster();

    const before = await db
      .select()
      .from(kickoffCoachesTable)
      .where(eq(kickoffCoachesTable.displayName, "Neil"));
    expect(before).toHaveLength(1);
    expect(before[0].tier).toBe("launchpad");
    const originalGhlCalendarId = before[0].ghlCalendarId;

    try {
      // Simulate an admin having entered Neil's real calendar ID after the
      // seed's placeholder was applied.
      await db
        .update(kickoffCoachesTable)
        .set({ ghlCalendarId: "REAL_LAUNCHPAD_CALENDAR_ID" })
        .where(eq(kickoffCoachesTable.id, before[0].id));

      await seedCallBookingRoster();

      const after = await db
        .select()
        .from(kickoffCoachesTable)
        .where(eq(kickoffCoachesTable.displayName, "Neil"));

      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(before[0].id);
      expect(after[0].tier).toBe("launchpad");
      expect(after[0].ghlCalendarId).toBe("REAL_LAUNCHPAD_CALENDAR_ID");
    } finally {
      // Restore the shared dev-DB roster row to its pre-test state (the seed
      // itself will never do this, by design — see the no-clobber comment in
      // seed-call-booking-roster.ts) so other test files that assume Neil's
      // "not yet configured" placeholder state are unaffected.
      await db
        .update(kickoffCoachesTable)
        .set({ ghlCalendarId: originalGhlCalendarId })
        .where(eq(kickoffCoachesTable.id, before[0].id));
    }
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
