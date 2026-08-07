/**
 * Read-only probe of the calendar Sandy relayed for Mark's kickoff roster
 * row (Task #2112): "BTS Mentorship Onboarding Call With Mark", location
 * "Build Test Scale". Confirms calendarType, slotDuration, slotInterval, and
 * the calendar's actual owning locationId BEFORE the roster seed is armed
 * with it — makes no writes to GHL or the database.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/probe-mark-kickoff-calendar.ts
 */
import { getCalendarDetails, getFreeSlots } from "../lib/ghl-coaching-calendar";

const CALENDAR_ID = "hDgKQotAHrjq5iRLeDaV";
const BTS_LOCATION_ID = "7XrT9sAfQ4rSyuk5QhhC";

async function main(): Promise<void> {
  console.log(`Probing calendar ${CALENDAR_ID} under location ${BTS_LOCATION_ID}...`);
  const details = await getCalendarDetails(CALENDAR_ID, BTS_LOCATION_ID);
  console.log("Calendar details:", JSON.stringify(details, null, 2));

  // Verified 2026-08-07: name = "BTS Mentorship Onboarding Call With Mark"
  // (exact match to what Sandy relayed), calendarType = class_booking (unlike
  // the other kickoff calendars, which are `personal` — accepted here because
  // the name matches exactly and free-slots/duration reads both work),
  // slotDuration = 60, slotInterval = 60, location = BTS.
  if (details.calendarType && details.calendarType !== "class_booking") {
    console.warn(
      `[WARN] calendarType is "${details.calendarType}", expected "class_booking" (as verified 2026-08-07).`,
    );
  }
  if (details.locationId && details.locationId !== BTS_LOCATION_ID) {
    console.warn(
      `[WARN] calendar's actual locationId (${details.locationId}) differs from the expected BTS location (${BTS_LOCATION_ID}).`,
    );
  }

  const effectiveLocationId = details.locationId ?? BTS_LOCATION_ID;
  const now = Date.now();
  const windowEnd = now + 14 * 24 * 60 * 60 * 1000;
  console.log(`\nFetching free-slots (14-day window) via locationId=${effectiveLocationId}...`);
  const slots = await getFreeSlots(CALENDAR_ID, now, windowEnd, effectiveLocationId);
  console.log(`Free-slots result: ${slots.length} slot(s) returned.`);
  if (slots.length > 0) {
    console.log("Sample slots:", slots.slice(0, 5));
  } else {
    console.log(
      "Empty-but-valid response (no error) — availability hours may still need to be set in GHL.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[ERROR]", e);
    process.exit(1);
  });
