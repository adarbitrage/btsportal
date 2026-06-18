---
name: Cross-company coaching arbiter
description: Conflict-calendar mirror blocking for 1-on-1 coaching; why the mirror block is best-effort and how dormancy works.
---

# Cross-company coaching arbiter (1-on-1 session packs)

A coach can be booked in two companies: the BTS portal AND the legacy Cherrington
GHL widget. To stop double-booking, a coach row may carry a **Conflict calendar**
(the other company's calendar + location). When set, the portal (1) intersects
free slots across BOTH calendars and (2) mirrors every BTS booking as a busy
"block slot" onto the Conflict calendar, removing/moving it on cancel/reschedule.

## Dormancy (the safety contract)
- `coaches.conflictGhlCalendarId` null => `resolveCoachCalendars` returns no
  conflict, slot reads/bookings use the Booking calendar only, NO block is ever
  created. Behaves exactly as before the feature. This is the prod default.

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
