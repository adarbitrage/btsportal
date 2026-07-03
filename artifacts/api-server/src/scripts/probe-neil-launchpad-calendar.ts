/**
 * Read-only probe of the calendar Sandy relayed for Neil's LaunchPad kickoff
 * roster row (Task #1655). Confirms calendarType, slotDuration, slotInterval,
 * and the calendar's actual owning locationId BEFORE the roster seed is
 * armed with it — makes no writes to GHL or the database.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/probe-neil-launchpad-calendar.ts
 */
import { getCalendarDetails, getFreeSlots } from "../lib/ghl-coaching-calendar";

const CALENDAR_ID = "oU93ZehoQfngqPQYVB7n";
const BTS_LOCATION_ID = "7XrT9sAfQ4rSyuk5QhhC";

async function main(): Promise<void> {
  console.log(`Probing calendar ${CALENDAR_ID} under location ${BTS_LOCATION_ID}...`);
  const details = await getCalendarDetails(CALENDAR_ID, BTS_LOCATION_ID);
  console.log("Calendar details:", JSON.stringify(details, null, 2));

  if (details.calendarType && details.calendarType !== "personal") {
    console.error(
      `[STOP] calendarType is "${details.calendarType}", not "personal". This looks like the wrong calendar was relayed again. No roster change should be made.`,
    );
    process.exit(2);
  }

  if (details.slotDuration !== 45) {
    console.warn(`[WARN] slotDuration is ${details.slotDuration}, expected 45.`);
  }
  if (details.slotInterval !== 30) {
    console.warn(`[WARN] slotInterval is ${details.slotInterval}, expected 30.`);
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
      "Empty-but-valid response (no error) — Sandy likely still needs to set Neil's availability hours in GHL.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[ERROR]", e);
    process.exit(1);
  });
