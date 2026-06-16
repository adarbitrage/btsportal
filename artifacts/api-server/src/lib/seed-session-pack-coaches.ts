import { db, sessionPackCoachesTable, sessionPackBookingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { COACHING_LOCATION_ID } from "./ghl-coaching-calendar";

// The real standalone 1-on-1 coaching roster. These rows are keyed by their
// GoHighLevel calendar id (sub-account JI6HzFwkNIr5VA2QUWUL). They were added
// to the development database by hand, so there was no reproducible path for
// them to reach production (publish migrates schema, not data). Codifying them
// here as an idempotent boot-time seed ensures production picks up the real
// roster on the next deploy and that a dev DB reset restores it too.
const REAL_COACHES: Array<{ name: string; ghlCalendarId: string; sortOrder: number }> = [
  { name: "Sasha", ghlCalendarId: "BdBxOw8kL1aF7VfJR5cc", sortOrder: 1 },
  { name: "Bruce", ghlCalendarId: "0feHbG6YfH2apzvdmR3U", sortOrder: 2 },
  { name: "Michael", ghlCalendarId: "JF7LYxF5KRQImZpvSrHo", sortOrder: 3 },
  { name: "Todd", ghlCalendarId: "JiTLouUKzGeYrsPtEmK5", sortOrder: 4 },
];

// Legacy placeholder profiles that were seeded into the roster before the real
// coaches existed. Targeted by exact name so admin-added coaches are never
// touched. Removed when they carry no bookings; otherwise deactivated.
const LEGACY_PLACEHOLDER_NAMES = ["Sarah Mitchell", "David Chen", "Amara Williams"];

export async function seedSessionPackCoaches(): Promise<void> {
  const existing = await db
    .select({
      id: sessionPackCoachesTable.id,
      ghlCalendarId: sessionPackCoachesTable.ghlCalendarId,
    })
    .from(sessionPackCoachesTable);

  const existingCalendarIds = new Set(existing.map((c) => c.ghlCalendarId));
  const toInsert = REAL_COACHES.filter((c) => !existingCalendarIds.has(c.ghlCalendarId)).map((c) => ({
    name: c.name,
    ghlCalendarId: c.ghlCalendarId,
    ghlLocationId: COACHING_LOCATION_ID,
    sortOrder: c.sortOrder,
    isActive: true,
  }));

  if (toInsert.length > 0) {
    // onConflictDoNothing keyed on the unique ghl_calendar_id so two cold-boot
    // instances racing on the same insert don't throw a unique violation.
    await db
      .insert(sessionPackCoachesTable)
      .values(toInsert)
      .onConflictDoNothing({ target: sessionPackCoachesTable.ghlCalendarId });
    console.log(
      `[Seed] Inserted ${toInsert.length} real session-pack coach(es): ${toInsert.map((c) => c.name).join(", ")}`,
    );
  }

  const placeholders = await db
    .select({ id: sessionPackCoachesTable.id, name: sessionPackCoachesTable.name })
    .from(sessionPackCoachesTable)
    .where(inArray(sessionPackCoachesTable.name, LEGACY_PLACEHOLDER_NAMES));

  for (const placeholder of placeholders) {
    const [booking] = await db
      .select({ id: sessionPackBookingsTable.id })
      .from(sessionPackBookingsTable)
      .where(eq(sessionPackBookingsTable.coachId, placeholder.id))
      .limit(1);

    if (booking) {
      await db
        .update(sessionPackCoachesTable)
        .set({ isActive: false })
        .where(eq(sessionPackCoachesTable.id, placeholder.id));
      console.log(
        `[Seed] Deactivated legacy session-pack coach "${placeholder.name}" (has bookings, kept for history)`,
      );
    } else {
      await db.delete(sessionPackCoachesTable).where(eq(sessionPackCoachesTable.id, placeholder.id));
      console.log(`[Seed] Removed legacy session-pack coach "${placeholder.name}"`);
    }
  }

  if (toInsert.length === 0 && placeholders.length === 0) {
    console.log("[Seed] Session-pack coaches already reconciled, skipping");
  }
}
