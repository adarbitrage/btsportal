import { sql, type SQL } from "drizzle-orm";
import { coachAwayPeriodsTable, coachesTable } from "@workspace/db";
import { COACHING_TIMEZONE } from "./ghl-coaching-calendar";

// Self-managed coach "away" periods gate visibility + bookability. A coach is
// considered away on a given calendar DAY (interpreted in the coaching
// timezone) when that day falls within any of their away periods, inclusive of
// both endpoints. Because the check is purely date-driven the coach is
// auto-restored once the period passes — no background job flips anything back.

// Format an instant as a YYYY-MM-DD calendar date in the coaching timezone.
// "en-CA" yields ISO-ordered date parts (2026-07-04), matching the `date`
// column storage so string comparison against start/end is well-defined.
export function coachingDateString(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COACHING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

// A SQL predicate that is TRUE when the coach (the `coaches` row in the
// surrounding query) is NOT currently away. Add it to the WHERE of any query
// that lists / resolves bookable coaches so an away coach drops out exactly
// while the away period is active. `today` defaults to the current coaching
// date; pass an explicit value to reason about a specific day.
export function notCurrentlyAway(today: string = coachingDateString()): SQL {
  return sql`not exists (
    select 1 from ${coachAwayPeriodsTable}
    where ${coachAwayPeriodsTable.coachId} = ${coachesTable.id}
      and ${coachAwayPeriodsTable.startDate} <= ${today}
      and ${coachAwayPeriodsTable.endDate} >= ${today}
  )`;
}

// True when `dateStr` (YYYY-MM-DD) falls within an away period, inclusive.
export function isDateWithinAwayPeriods(
  periods: { startDate: string; endDate: string }[],
  dateStr: string,
): boolean {
  return periods.some((p) => p.startDate <= dateStr && p.endDate >= dateStr);
}
