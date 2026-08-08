---
name: Mark kickoff class_booking slot risk
description: Mark's kickoff calendar is class_booking with appointmentsPerSlot=100 — GHL free-slots does NOT hide booked slots, so double-booking is possible.
---

Mark's kickoff calendar ("BTS Mentorship Onboarding Call With Mark", `hDgKQotAHrjq5iRLeDaV`, BTS location `7XrT9sAfQ4rSyuk5QhhC`) is GHL type `class_booking` with `appoinmentPerSlot` (GHL's misspelling) = 100.

**Verified 2026-08-08** via controlled booking + immediate free-slots re-fetch (probe script `src/scripts/probe-mark-kickoff-slot-exclusivity.ts`, appointment cancelled after): a just-booked slot STILL appears in `getFreeSlots`. So the free-slots recheck inside `/onboarding/kickoff/book` cannot prevent two members landing on the same 1-on-1 slot for this calendar.

**Why:** `class_booking` calendars only stop offering a slot once attendee count reaches `appoinmentPerSlot`; every other kickoff calendar is `personal` (1 attendee) and self-excludes.

**How to apply:** either Sandy sets appointments-per-slot to 1 in GHL (preferred; re-run the probe to confirm), or the booking flow needs a server-side guard (e.g. `listCalendarBusyEvents` overlap check, or a local `call_bookings` per-coach-slot uniqueness check) for class_booking kickoff calendars. `getCalendarDetails` now exposes `appointmentsPerSlot`/`appointmentsPerDay`.
