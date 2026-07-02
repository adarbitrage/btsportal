import { db, partnersTable, kickoffCoachesTable } from "@workspace/db";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";

// Accountability-partner headshots hosted as portal static assets (same
// convention as /coaching-photos/*). Keyed by EXACT display_name. Myco is
// included even though his row is inactive — arming his reveal card for when
// his calendar lands. Jean intentionally has no photo yet, so she is absent
// here (her photo_url stays NULL, no placeholder).
export const PARTNER_PHOTO_PATHS: Record<string, string> = {
  Mikha: "/partner-photos/mikha.jpg",
  Myco: "/partner-photos/myco.jpg",
  John: "/partner-photos/john.jpg",
  Neil: "/partner-photos/neil.png",
};

// Kickoff-coach headshots, same static-asset convention, keyed by EXACT
// display_name on kickoff_coaches (a separate roster from `coaches` — the
// strategic-coach Bruce/Todd photos under /coaching-photos/ are untouched).
export const KICKOFF_COACH_PHOTO_PATHS: Record<string, string> = {
  Bruce: "/kickoff-photos/bruce.jpg",
  Mark: "/kickoff-photos/mark.jpg",
  Todd: "/kickoff-photos/todd.jpg",
};

// Idempotent boot hook: set photo_url for the mapped roster rows wherever
// they exist, ONLY where photo_url IS NULL — never clobbers a non-null value,
// so an admin-uploaded replacement survives restarts. No-ops safely when a
// row is absent (e.g. a fresh dev DB with empty tables); never inserts rows
// and never touches is_active or any other field.
async function seedRosterPhotos(
  table: typeof partnersTable | typeof kickoffCoachesTable,
  photoPaths: Record<string, string>,
  label: string,
): Promise<void> {
  const names = Object.keys(photoPaths);
  const rows = await db
    .select({ id: table.id, displayName: table.displayName })
    .from(table)
    .where(and(inArray(table.displayName, names), isNull(table.photoUrl)));

  if (rows.length === 0) {
    console.log(`[Seed] ${label} photos: no rows need a photo (already set or rows absent), skipping`);
    return;
  }

  for (const row of rows) {
    const photoUrl = photoPaths[row.displayName];
    if (!photoUrl) continue;
    // Re-check photo_url IS NULL in the UPDATE itself so a concurrent admin
    // edit between the select and this write is never clobbered.
    await db
      .update(table)
      .set({ photoUrl, updatedAt: sql`now()` })
      .where(and(eq(table.id, row.id), isNull(table.photoUrl)));
  }
  console.log(
    `[Seed] ${label} photos set for: ${rows.map((r) => r.displayName).join(", ")}`,
  );
}

export async function seedPartnerPhotos(): Promise<void> {
  await seedRosterPhotos(partnersTable, PARTNER_PHOTO_PATHS, "Partner");
  await seedRosterPhotos(kickoffCoachesTable, KICKOFF_COACH_PHOTO_PATHS, "Kickoff coach");
}
