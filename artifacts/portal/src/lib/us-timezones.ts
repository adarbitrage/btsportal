// Curated US-first timezone list for the onboarding profile step (Task #1684).
//
// The raw `Intl.supportedValuesOf("timeZone")` list has hundreds of IANA
// identifiers, which is overwhelming for members. This module exposes seven
// friendly US options that map to the canonical IANA zone every downstream
// consumer expects (booking, reminders, the shared member-timezone
// formatter). Non-US members fall through to a searchable "Other" list of
// every IANA zone, so the stored value is always a valid IANA identifier
// regardless of which path a member takes.

export interface UsTimezoneOption {
  value: string;
  label: string;
}

export const US_TIMEZONES: UsTimezoneOption[] = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
];

export const US_TIMEZONE_VALUES = new Set(US_TIMEZONES.map((tz) => tz.value));

export const OTHER_TIMEZONE_VALUE = "__other__";

// Common alternate IANA identifiers that observe the same rules as one of
// the seven canonical US zones (same offset + DST behavior), so a browser
// reporting one of these should still land on the matching friendly option
// instead of being treated as "Other".
const US_TIMEZONE_ALIASES: Record<string, string> = {
  "America/Detroit": "America/New_York",
  "America/Indiana/Indianapolis": "America/New_York",
  "America/Indiana/Marengo": "America/New_York",
  "America/Indiana/Petersburg": "America/New_York",
  "America/Indiana/Vevay": "America/New_York",
  "America/Indiana/Vincennes": "America/New_York",
  "America/Indiana/Winamac": "America/New_York",
  "America/Kentucky/Louisville": "America/New_York",
  "America/Kentucky/Monticello": "America/New_York",
  "America/Indiana/Knox": "America/Chicago",
  "America/Indiana/Tell_City": "America/Chicago",
  "America/Menominee": "America/Chicago",
  "America/North_Dakota/Beulah": "America/Chicago",
  "America/North_Dakota/Center": "America/Chicago",
  "America/North_Dakota/New_Salem": "America/Chicago",
  "America/Boise": "America/Denver",
  "America/Juneau": "America/Anchorage",
  "America/Sitka": "America/Anchorage",
  "America/Metlakatla": "America/Anchorage",
  "America/Yakutat": "America/Anchorage",
  "America/Nome": "America/Anchorage",
};

/**
 * Maps an arbitrary IANA timezone (e.g. the browser-detected zone) to the
 * nearest canonical US option. Returns the canonical IANA value when a match
 * is found (either an exact canonical match or a known alias), otherwise
 * returns null so callers can fall back to the "Other / International" list.
 */
export function mapToUsTimezone(ianaZone: string | null | undefined): string | null {
  if (!ianaZone) return null;
  if (US_TIMEZONE_VALUES.has(ianaZone)) return ianaZone;
  return US_TIMEZONE_ALIASES[ianaZone] ?? null;
}

export function isUsTimezone(ianaZone: string | null | undefined): boolean {
  return mapToUsTimezone(ianaZone) !== null;
}

export function getUsTimezoneLabel(ianaZone: string): string | undefined {
  return US_TIMEZONES.find((tz) => tz.value === ianaZone)?.label;
}

export function getAllTimezones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}
