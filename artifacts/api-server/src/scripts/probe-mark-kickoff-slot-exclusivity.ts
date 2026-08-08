/**
 * Task #2113: verify two members can't book the same kickoff slot on Mark's
 * class_booking calendar ("BTS Mentorship Onboarding Call With Mark").
 *
 * 1. Reads the calendar config, reporting the appointments-per-slot setting
 *    (GHL spells the field "appoinmentPerSlot").
 * 2. Controlled booking test: books the LAST free slot in a 14-day window
 *    for a throwaway probe contact (toNotify: false, so no emails fire),
 *    immediately re-fetches free-slots to confirm the slot vanished, then
 *    cancels and confirms the slot reappears.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/probe-mark-kickoff-slot-exclusivity.ts
 */
import {
  getCalendarDetails,
  getFreeSlots,
  upsertContact,
  createAppointment,
  cancelAppointment,
} from "../lib/ghl-coaching-calendar";

const CALENDAR_ID = "hDgKQotAHrjq5iRLeDaV";
const BTS_LOCATION_ID = "7XrT9sAfQ4rSyuk5QhhC";
const PROBE_EMAIL = "bts-slot-exclusivity-probe@example.com";

async function main(): Promise<void> {
  const details = await getCalendarDetails(CALENDAR_ID, BTS_LOCATION_ID);
  console.log("Calendar details:", JSON.stringify(details, null, 2));
  const locationId = details.locationId ?? BTS_LOCATION_ID;

  if (details.appointmentsPerSlot === undefined) {
    console.log("[INFO] Config did not expose appoinmentPerSlot — relying on booking test.");
  } else if (details.appointmentsPerSlot > 1) {
    console.log(
      `[RISK] appointmentsPerSlot = ${details.appointmentsPerSlot} — calendar allows MULTIPLE attendees per slot.`,
    );
  } else {
    console.log(`[OK] appointmentsPerSlot = ${details.appointmentsPerSlot}.`);
  }

  const now = Date.now();
  const windowEnd = now + 14 * 24 * 60 * 60 * 1000;
  const slots = await getFreeSlots(CALENDAR_ID, now, windowEnd, locationId);
  console.log(`Free slots in 14-day window: ${slots.length}`);
  if (slots.length === 0) {
    console.log("[ABORT] No free slots to test against — booking test skipped.");
    return;
  }

  // Use the LAST slot (least likely to collide with a real member booking).
  const target = slots[slots.length - 1].startTime;
  const durationMinutes = details.slotDuration ?? 60;
  const end = new Date(Date.parse(target) + durationMinutes * 60000);
  const offsetMatch = target.match(/(Z|[+-]\d{2}:\d{2})$/);
  const offset = offsetMatch ? offsetMatch[0] : "Z";
  let endIso: string;
  if (offset === "Z") {
    endIso = end.toISOString().slice(0, 19) + "Z";
  } else {
    const sign = offset[0] === "-" ? -1 : 1;
    const oh = parseInt(offset.slice(1, 3), 10);
    const om = parseInt(offset.slice(4, 6), 10);
    endIso = new Date(end.getTime() + sign * (oh * 60 + om) * 60000).toISOString().slice(0, 19) + offset;
  }
  console.log(`\nBooking probe appointment at ${target} (duration ${durationMinutes}m)...`);

  const contactId = await upsertContact({
    email: PROBE_EMAIL,
    firstName: "Slot",
    lastName: "ExclusivityProbe",
    locationId,
  });
  const appt = await createAppointment({
    calendarId: CALENDAR_ID,
    contactId,
    startTime: target,
    endTime: endIso,
    title: "[PROBE] Slot exclusivity test — safe to delete",
    toNotify: false,
    locationId,
  });
  console.log(`Created probe appointment ${appt.id}.`);

  try {
    const after = await getFreeSlots(CALENDAR_ID, now, windowEnd, locationId);
    const stillFree = after.some((s) => Date.parse(s.startTime) === Date.parse(target));
    if (stillFree) {
      console.log(
        "[FAIL] Slot STILL appears free after booking — two members COULD book the same kickoff slot.",
      );
    } else {
      console.log("[PASS] Slot no longer appears in free-slots after one booking.");
    }
  } finally {
    await cancelAppointment(appt.id, locationId);
    console.log("Probe appointment cancelled.");
  }

  const restored = await getFreeSlots(CALENDAR_ID, now, windowEnd, locationId);
  const backFree = restored.some((s) => Date.parse(s.startTime) === Date.parse(target));
  console.log(
    backFree
      ? "[OK] Slot reappeared after cancellation — calendar state restored."
      : "[WARN] Slot did not reappear after cancellation (may be GHL propagation delay).",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[ERROR]", e);
    process.exit(1);
  });
