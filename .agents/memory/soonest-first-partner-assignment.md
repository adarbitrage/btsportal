---
name: Soonest-first kickoff/partner assignment
description: How merged-pool kickoff availability and soonest-first partner assignment (with never-block GHL fallback) are wired, for anyone touching call-bookings, partner-assignment, or the partner-escalation alert dispatcher again.
---

Kickoff booking no longer pre-selects one coach: the availability endpoint
fans out `getFreeSlots` in parallel to every active, calendar-configured
kickoff coach in the member's tier, tags each slot with its owning coach,
merges + sorts earliest-first, and the book request carries the chosen
slot's `coachId` (loaded + tier/active-validated at book time instead of
re-running round robin, which removed a latent coach-selection race).

Partner assignment (`assignRoundRobin`) tries a "soonest" probe first: query
every active, calendar-configured partner's next-7-days free slots in
parallel (day-cap-aware via the shared `filterSlotsByDailyCap`), pick the
partner with the earliest surviving slot, tie-broken by fewest active
assignments (then lowest id) only among partners whose earliest slot falls
on the same calendar day — a slightly-later-same-day slot from a lighter
partner still loses to an earlier slot on a different day. The whole probe
races against a ~3s budget (`SOONEST_PROBE_BUDGET_MS_DEFAULT`); on timeout,
ANY single per-partner GHL error/rejection (a partial result is discarded
wholesale, never chosen from among just the partners that succeeded), or
zero calendar-configured candidates, it falls back silently to the existing
fewest-active query. Which path produced the row is recorded in
`partner_assignments.assignment_method` (`soonest` | `fallback_fewest_active`).

**Why:** a purchase grant must never be delayed or fail because GHL is slow
or down — the fallback exists specifically so `assignRoundRobin` always
completes fast regardless of the probe's outcome.

**How to apply:**
- A GHL free-slots call is window-bounded (start/end args) — it will never
  return a slot past its own requested `endMs`. If the primary 7-day window
  probe comes back empty for every partner, that does NOT mean "nobody has
  a slot" — the query literally couldn't see further out. The probe widens
  to a longer second window (same shared wall-clock deadline) before
  falling back, so the real farthest-out soonest date is still found for
  both the assignment and the alert's date field. Any code path that adds a
  "probe next N days" query anywhere else needs this same widen-before-
  giving-up shape, or it silently misreports "no capacity" as far more dire
  than it is.
- The GHL probe runs entirely OUTSIDE any DB transaction; don't move it
  inside one even if it's tempting to make assignment "atomic" — only the
  final insert (guarded by the partial-unique-active-row index) needs
  transactional guarantees.
- `evaluateAssignmentDelay` (in `partner-escalation-alerter.ts`) is only
  invoked when the probe was "reliable" (ran to completion, no per-partner
  errors) — a GHL outage must never be indistinguishable from a genuine
  >7-day capacity crunch. It reuses the same dispatcher/dedup machinery as
  the existing no-show/vanish/80%-capacity alerts, as a fourth alert type
  (`assignment_delay`), NOT a modification of the existing 80% trailing
  fleet-capacity alert — those two triggers are deliberately independent.
- `reassignMember` (admin manual reassignment) intentionally still uses the
  old fewest-active-only round robin — it was explicitly out of scope and
  must not be touched when extending soonest-first logic.
- Test-only hooks: `__setSoonestProbeBudgetMsForTests` (shrink the 3s budget
  so timeout tests run fast) and `__setPartnerAssignmentFreeSlotsFnForTests`
  (stub GHL calls) in `partner-assignment.ts`.
