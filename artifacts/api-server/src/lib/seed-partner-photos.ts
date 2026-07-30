import { db, partnersTable, kickoffCoachesTable } from "@workspace/db";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";

// Accountability-partner headshots hosted as portal static assets (same
// convention as /coaching-photos/*). Keyed by EXACT display_name. Myco is
// included even though his row is inactive — arming his reveal card for when
// his calendar lands. Jean's headshot arrived 2026-07-30 (Task #1898), so her
// person blocks now render a real photo instead of the "J" initials circle.
export const PARTNER_PHOTO_PATHS: Record<string, string> = {
  Jean: "/partner-photos/jean.jpg",
  Mikha: "/partner-photos/mikha.jpg",
  Myco: "/partner-photos/myco.jpg",
  John: "/partner-photos/john.jpg",
  Neil: "/partner-photos/neil.png",
};
export const KICKOFF_COACH_PHOTO_PATHS: Record<string, string> = {
  Bruce: "/kickoff-photos/bruce.jpg",
  Mark: "/kickoff-photos/mark.jpg",
  Todd: "/kickoff-photos/todd.jpg",
  // Task #1686: Neil's kickoff-coach row has no photo yet; reuse the already-
  // hosted headshot from his accountability-partner row rather than
  // uploading a new asset.
  Neil: "/partner-photos/neil.png",
};

// Partner welcome bios, keyed by EXACT display_name. Only Jean is seeded here
// for now — add others as they supply their blurbs. Each entry is applied
// only when the partner's bio column IS NULL (same never-clobber rule as photos).
export const PARTNER_BIOS: Record<string, string> = {
  Jean: "Hi, I'm Jean, the Operations Lead for the team.\n\nMy focus is ensuring that every member has an exceptional experience from the moment they join our program. I work closely with our Concierge Team, Marketing Coaches, and Customer Success teams to continuously improve our systems, processes, and support so you have everything you need to succeed.\n\nWhile my team handles the day-to-day coaching and implementation, I'm committed to making sure every part of your journey—from onboarding and technical implementation to ongoing support—is smooth, transparent, and results-driven. If there's ever an opportunity to improve your experience, know that your success is our top priority.\n\nOn behalf of our entire team, welcome to Build. Test. Scale. We're excited to partner with you and help you build, test, and scale your business with confidence.",
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

// Idempotent boot hook: set bio for the mapped partner rows, ONLY where bio
// IS NULL — never clobbers an admin-edited value.
async function seedPartnerBios(bios: Record<string, string>): Promise<void> {
  const names = Object.keys(bios);
  const rows = await db
    .select({ id: partnersTable.id, displayName: partnersTable.displayName })
    .from(partnersTable)
    .where(and(inArray(partnersTable.displayName, names), isNull(partnersTable.bio)));

  if (rows.length === 0) {
    console.log("[Seed] Partner bios: no rows need a bio (already set or rows absent), skipping");
    return;
  }

  for (const row of rows) {
    const bio = bios[row.displayName];
    if (!bio) continue;
    await db
      .update(partnersTable)
      .set({ bio, updatedAt: sql`now()` })
      .where(and(eq(partnersTable.id, row.id), isNull(partnersTable.bio)));
  }
  console.log(
    `[Seed] Partner bios set for: ${rows.map((r) => r.displayName).join(", ")}`,
  );
}

export async function seedPartnerPhotos(): Promise<void> {
  await seedRosterPhotos(partnersTable, PARTNER_PHOTO_PATHS, "Partner");
  await seedRosterPhotos(kickoffCoachesTable, KICKOFF_COACH_PHOTO_PATHS, "Kickoff coach");
  await seedPartnerBios(PARTNER_BIOS);
}
