// Shared member-timezone time formatter (Task #1625).
//
// `scheduled_at`/`scheduledAt` columns are stored as UTC timestamptz. Every
// surface that renders a call time must show it in the *member's* timezone
// (users.timezone, set during onboarding's Profile step) with a DST-correct
// zone abbreviation — never a hardcoded "CDT"/"CST" string, since the correct
// abbreviation depends on the date (derive it from Intl at render time).
//
// Falls back to the browser's local timezone when the member has none set
// (e.g. pre-Profile-step, or a partner/coach viewing their own dashboard).

import { getUsTimezoneLabel } from "@/lib/us-timezones";

export function getMemberTimezone(userTimezone?: string | null): string {
  if (userTimezone && userTimezone.trim()) return userTimezone;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Friendly label for an IANA zone (e.g. "Eastern Time (ET)"), falling back to
 * the raw IANA id for zones outside the curated US list (Task #1691). Use
 * this anywhere a member-facing surface prints their timezone.
 */
export function getFriendlyTimezoneLabel(ianaZone: string): string {
  return getUsTimezoneLabel(ianaZone) ?? ianaZone;
}

function toDate(date: Date | string): Date {
  return typeof date === "string" ? new Date(date) : date;
}

function zoneAbbreviation(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** "9:00 AM CDT" */
export function formatMemberTime(date: Date | string, timeZone: string): string {
  const d = toDate(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  const abbr = zoneAbbreviation(d, timeZone);
  return abbr ? `${time} ${abbr}` : time;
}

/** "Jul 3, 2026" */
export function formatMemberDate(date: Date | string, timeZone: string): string {
  const d = toDate(date);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** "Jul 3, 9:00 AM CDT" */
export function formatMemberDateTime(date: Date | string, timeZone: string): string {
  const d = toDate(date);
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(d);
  return `${datePart}, ${formatMemberTime(d, timeZone)}`;
}

/** "Wednesday, July 3, 2026 at 9:00 AM CDT" */
export function formatMemberFullDateTime(date: Date | string, timeZone: string): string {
  const d = toDate(date);
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
  return `${datePart} at ${formatMemberTime(d, timeZone)}`;
}

/** True when `date` falls on the current calendar day in the member's own timezone. */
export function isMemberToday(date: Date | string, timeZone: string): boolean {
  const d = toDate(date);
  const dayKey = (dt: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(dt);
  return dayKey(d) === dayKey(new Date());
}
