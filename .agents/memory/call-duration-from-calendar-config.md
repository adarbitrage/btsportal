---
name: Call duration from GHL calendar config
description: How kickoff/partner call appointment duration is derived from GHL calendar config, not slot spacing, and a test-mock pitfall to avoid.
---

Appointment duration (how long the meeting block is) must come from the GHL
calendar's own configured `slotDuration` field (read via `GET
/calendars/{calendarId}`), fetched through a small short-TTL in-memory cache
keyed by `locationId:calendarId`. It must NEVER be inferred from the
free-slot grid spacing returned by the availability/free-slots endpoint —
that spacing is a separate GHL field (`slotInterval`, i.e. how far apart
bookable start times are) and can differ from the actual meeting length
configured on the calendar.

**Why:** kickoff calls were silently booked as 30 minutes (a hardcoded
constant) when the real GHL calendar was configured for 45 minutes, because
GHL's appointment-create call takes an explicit `endTime` that the booking
code computed from the wrong source. Partner calendars happen to be
configured for 30 minutes, so the bug was invisible there — but the fix must
be the same generic calendar-config read for both call types, no
special-casing by call type.

**How to apply:** if a calendar's config fetch fails, the booking or
availability call must fail explicitly (502) — there is no safe silent
default duration to fall back to. When testing this with a mocked config
function, count the exact number of times the function is called per test
before queuing `mockImplementationOnce` values — an extra unconsumed queued
implementation silently leaks into the next test and makes it produce the
wrong duration without an obvious error at the leaking test itself.
