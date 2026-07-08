---
name: Cross-company coaching arbiter
description: Conflict-calendar mirror blocking for 1-on-1 coaching; why the mirror block is best-effort and how dormancy works.
---

# Cross-company coaching arbiter (1-on-1 session packs)

A coach can be booked in two companies: the BTS portal AND the legacy Cherrington
GHL widget. To stop double-booking, a coach row may carry a **Conflict calendar**
(the other company's calendar + location). When set, the portal (1) subtracts the
conflict calendar's REAL busy events from the Booking calendar's free slots and
(2) mirrors every BTS booking as a busy "block slot" onto the Conflict calendar,
removing/moving it on cancel/reschedule.

## Availability read = busy-event SUBTRACTION, never free-slot intersection
**Rule:** `freeSlotsAcrossCalendars` reads free slots ONLY from the Booking
calendar; conflicts come from `listCalendarBusyEvents` (GET /calendars/events,
cancelled/canceled excluded via `extractBusyEvents`). A slot is dropped iff
[start, start+bookingCal slotDuration) overlaps a busy interval.

**Why:** Intersecting free slots let the conflict calendar's own availability
SCHEDULE mask BTS availability — a conflict calendar with narrow/no availability
wiped out perfectly free BTS times. Only real appointments should block.

**How to apply:** conflict fetch failure must throw (route returns 502 —
never silently show conflicted times as free); busy window is widened 24h back
/ one slot forward for straddling events; both slot listing AND the under-lock
booking recheck flow through this single helper.

## Dormancy (the safety contract)
- `coaches.conflictGhlCalendarId` null => `resolveCoachCalendars` returns no
  conflict, slot reads/bookings use the Booking calendar only, NO block is ever
  created. Behaves exactly as before the feature. This is the prod default.

## Persist booking-time GHL location on the booking, not just the coach
**Rule:** Cancel/reschedule (and the conflict-block delete) must use the location
ids captured ON THE BOOKING at booking time, never the live coach row.

**Why:** An admin can remap a coach's GHL location after a booking exists; the
appointment/block still live under the ORIGINAL location, so resolving location
from the current coach row makes the location-scoped GHL token wrong → 502s that
strand a member's existing booking. (Code review flagged this as blocking.)

**How to apply:** book persists ghlLocationId + conflictGhlLocationId on the
booking row; cancel/reschedule prefer booking-stored value → live coach row →
COACHING_LOCATION_ID (last fallback only for rows predating the columns).

## The mirror block MUST be best-effort — never roll back the appointment
**Rule:** In cancel/reschedule, the conflict-block delete/create is a secondary
GHL side effect. A block failure must NOT roll back the primary appointment
cancel/move, and must NOT 502 the request.

**Why:** The DB booking row is the source of truth and must track the *GHL
appointment*. If you cancel the appointment (or move it) first and then roll back
the DB because the block op failed, the DB says "booked"/old-time while GHL says
gone/new-time — a real divergence that a retry can't cleanly fix. A stale or
missing mirror block, by contrast, only ever conservatively over- or under-blocks
the OTHER company's calendar — it never causes a BTS double-booking and can be
cleared manually. (An earlier impl rolled back on block failure; code review
flagged it as severe DB↔GHL divergence.)

**How to apply:** cancel — delete the block in a try/catch that only logs; let the
COMMIT proceed. reschedule — on block-create failure, log and KEEP the old block
id (old hold lingers at the old time, safe) rather than rolling back the moved
appointment. Old-block delete is always best-effort.

## Lock ordering
book + reschedule take coach lock THEN member credit lock (same order) with an
in-tx recheck of both calendars; keep that order to avoid deadlocks and races.

## Testing notes
- Tests MUST mock `../lib/ghl-coaching-calendar` (and `../lib/redis`) — never fire
  live block-slot calls. `ghl_appointment_id` has a UNIQUE constraint, so the
  createAppointment mock must return globally-unique ids across tests (don't reset
  the seq in beforeEach) or persisted bookings collide.
- Coach fixtures MUST insert `coach_call_calendars` rows — the calendar loader
  reads that table, not the legacy coaches.ghl* columns; without them every
  slots/book call 404s and the whole suite silently fails at baseline.
- Mock `getCalendarDurationMinutes` too, and drive conflicts via a
  busyByCalendar map behind the `listCalendarBusyEvents` mock.
