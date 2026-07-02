---
name: Per-row GHL location for partners/kickoff coaches
description: Why accountability-partner and kickoff-coach calendars carry their own GHL location id, and the test-isolation trap this creates in shared dev DB round-robin tests.
---

## The rule

`partners` and `kickoff_coaches` each have a `ghl_location_id` column
(`text not null default "JI6HzFwkNIr5VA2QUWUL"` — the private/group coaching
sub-account). Every call-bookings route resolves the location per-row
(`row.ghlLocationId ?? COACHING_LOCATION_ID`) instead of assuming the single
hardcoded coaching location.

**Why:** the accountability-partner and kickoff-coach calendars actually live
in a *different* GHL sub-account ("Build Test Scale", location
`7XrT9sAfQ4rSyuk5QhhC`) than the private/group coaching calendars. Hardcoding
one location for all bookings silently pointed partner/kickoff free-slots and
appointment-creation calls at the wrong sub-account.

The real verified roster (Jean/Mikha/John/Neil as partners; Todd/Mark/Bruce as
kickoff coaches, all at the BTS location) is seeded via an idempotent boot
hook keyed on `displayName` (update-if-exists/insert-if-missing), so it also
reaches production on the next deploy without a manual migration. Myco is
seeded as an inactive partner with no calendar (none exists in the agency).

## How to apply

Because the roster boot-seed runs in the shared dev DB, tests that assert
round-robin "least-loaded" partner/coach selection (e.g.
`assignRoundRobin`, kickoff coach selection) can no longer assume they are the
only active rows in the table — the real roster rows (0 assignments each) tie
with fresh test fixtures and make the pick non-deterministic.

Fix: before asserting a specific least-loaded pick, snapshot every other
currently-active partner/kickoff-coach id, deactivate them for the duration of
the test, and restore `isActive` in a `finally` block. Don't just deactivate a
single known test fixture id — deactivate whatever is actually active at test
start, since the specific seeded names can change over time.
