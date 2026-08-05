import { db, systemSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

/**
 * Runtime configuration for the FE-Intensive booking calendar (the Welcome
 * page's native booking surface for front-end/funnel buyers).
 *
 * The GHL calendar id (and optionally a location id) are admin-configurable
 * via system_settings — pending from the owner's team. Until the calendar id
 * is set, the feature is DORMANT: /fe-intensive routes report
 * `configured: false` and the Welcome page keeps its pending state.
 *
 * Convention (see lib/oncall-settings.ts): DB value wins, process.env is the
 * fallback, blank/whitespace counts as unset.
 */

export const FE_INTENSIVE_CALENDAR_SETTING_KEY = "fe_intensive_calendar_id";
export const FE_INTENSIVE_LOCATION_SETTING_KEY = "fe_intensive_location_id";

export interface FeIntensiveBookingConfig {
  calendarId: string;
  /** Optional GHL sub-account; undefined = the default coaching location. */
  locationId?: string;
}

function normalize(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Returns the booking config, or null when the calendar id is unset
 * (feature dormant). Never throws — a settings-read failure logs and
 * reports dormant rather than surfacing a broken grid.
 */
export async function getFeIntensiveBookingConfig(): Promise<FeIntensiveBookingConfig | null> {
  let dbCalendarId: string | undefined;
  let dbLocationId: string | undefined;
  try {
    const rows = await db
      .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(
        inArray(systemSettingsTable.key, [
          FE_INTENSIVE_CALENDAR_SETTING_KEY,
          FE_INTENSIVE_LOCATION_SETTING_KEY,
        ]),
      );
    for (const row of rows) {
      if (row.key === FE_INTENSIVE_CALENDAR_SETTING_KEY) dbCalendarId = normalize(row.value);
      if (row.key === FE_INTENSIVE_LOCATION_SETTING_KEY) dbLocationId = normalize(row.value);
    }
  } catch (err) {
    console.error("[FeIntensive] Failed to read booking settings:", err);
    return null;
  }

  const calendarId = dbCalendarId ?? normalize(process.env.FE_INTENSIVE_CALENDAR_ID);
  if (!calendarId) return null;
  const locationId = dbLocationId ?? normalize(process.env.FE_INTENSIVE_LOCATION_ID);
  return { calendarId, locationId };
}
