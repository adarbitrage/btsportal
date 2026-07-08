// Shared server-side member-timezone formatter (Task #1628).
//
// The existing coaching-call reminder path (`CALL_DISPLAY_TIMEZONE` in
// scheduled-comms.ts) intentionally renders every recipient's reminder in one
// fixed product timezone because group coaching calls don't carry a per-member
// timezone concept. Kickoff and accountability-partner calls, by contrast, are
// 1:1 with a specific member, so their reminders should render in THAT
// member's own `users.timezone` — falling back to the product default when a
// member hasn't set one (or has an unrecognized/invalid IANA zone on file).
//
// This module is net-new and does NOT touch `CALL_DISPLAY_TIMEZONE` or
// `formatCallDateTime` in scheduled-comms.ts — those keep formatting group
// coaching reminders exactly as before.

export const MEMBER_TIMEZONE_FALLBACK = "America/New_York";

export interface MemberDateTimeParts {
  /** e.g. "Tuesday, July 8" */
  date: string;
  /** e.g. "2:00 PM EDT" — includes the timezone abbreviation. */
  time: string;
}

function formatWithZone(scheduledAt: Date, timeZone: string): MemberDateTimeParts {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(scheduledAt);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(scheduledAt);
  return { date, time };
}

/**
 * Format a UTC instant into a human-readable date + time in the given
 * member's own timezone (falling back to the product default when the member
 * has no timezone on file, or an invalid/unrecognized IANA zone string —
 * `Intl.DateTimeFormat` throws a RangeError on an unknown zone, which we
 * catch rather than let bubble up and drop the reminder entirely).
 */
export function formatInMemberTimezone(
  scheduledAt: Date,
  memberTimezone: string | null | undefined,
): MemberDateTimeParts {
  const timeZone = memberTimezone || MEMBER_TIMEZONE_FALLBACK;
  try {
    return formatWithZone(scheduledAt, timeZone);
  } catch {
    return formatWithZone(scheduledAt, MEMBER_TIMEZONE_FALLBACK);
  }
}

/**
 * Calendar date (YYYY-MM-DD) of a UTC instant as seen in the member's own
 * timezone. Used by the RSVP morning-of coaching reminder (Task #1770) to
 * decide "is the call today for THIS member?" and "did the member RSVP
 * before the call day?". en-CA yields ISO-ordered YYYY-MM-DD directly.
 * Falls back to the product default zone on an invalid/unknown IANA string.
 */
export function localDateInMemberTimezone(
  instant: Date,
  memberTimezone: string | null | undefined,
): string {
  const timeZone = memberTimezone || MEMBER_TIMEZONE_FALLBACK;
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  try {
    return fmt(timeZone);
  } catch {
    return fmt(MEMBER_TIMEZONE_FALLBACK);
  }
}

/**
 * Hour of day (0-23) of a UTC instant in the member's own timezone — drives
 * the "not before 7:00 AM local" gate of the RSVP morning-of reminder.
 */
export function localHourInMemberTimezone(
  instant: Date,
  memberTimezone: string | null | undefined,
): number {
  const timeZone = memberTimezone || MEMBER_TIMEZONE_FALLBACK;
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hourCycle: "h23",
    }).format(instant);
  try {
    return parseInt(fmt(timeZone), 10);
  } catch {
    return parseInt(fmt(MEMBER_TIMEZONE_FALLBACK), 10);
  }
}
