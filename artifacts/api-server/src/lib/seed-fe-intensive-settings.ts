import { db, systemSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

/**
 * Idempotent, non-clobbering boot seed for the FE-Intensive advisor-call
 * booking calendar ("BTS Strategy Session Welcome Call - Coach Ash").
 *
 * Calendar verified read-only on 2026-08-06 (Task #2084):
 *   calendarType = personal, slotDuration = 30 mins, slotInterval = 30 mins,
 *   locationId = 7XrT9sAfQ4rSyuk5QhhC (Build Test Scale sub-account).
 *
 * ONLY fills when the key is absent. A later admin edit via the AdminSettings
 * card (PUT /api/admin/settings, audit-logged) always wins — this seed never
 * overwrites a row that is already present.
 */
export async function seedFeIntensiveSettings(): Promise<void> {
  const DEFAULTS: { key: string; value: string }[] = [
    { key: "fe_intensive_calendar_id", value: "UIdjBPBBpqQTU3wsPlKt" },
    { key: "fe_intensive_location_id", value: "7XrT9sAfQ4rSyuk5QhhC" },
  ];

  const existingRows = await db
    .select({ key: systemSettingsTable.key })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, DEFAULTS.map((d) => d.key)));

  const existingKeys = new Set(existingRows.map((r) => r.key));

  for (const { key, value } of DEFAULTS) {
    if (existingKeys.has(key)) {
      // Row is already present — do not overwrite (admin edit wins).
      continue;
    }
    await db.insert(systemSettingsTable).values({ key, value }).onConflictDoNothing();
    console.log(`[FeIntensive] Boot-seeded setting ${key} = ${value}`);
  }
}
