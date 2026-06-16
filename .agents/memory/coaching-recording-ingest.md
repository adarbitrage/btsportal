---
name: Pack 1-on-1 coaching recording ingest
description: How Meet recording + Gemini notes get auto-linked to a pack booking, and the coach/admin-only constraint.
---

# Pack 1-on-1 coaching recording ingest

Each `session_pack_bookings` row can carry `recordingUrl` / `summaryUrl` /
`transcriptUrl` plus ingest bookkeeping (`recordingIngestStatus` pending|found|
not_found|error, `recordingIngestAt`, `recordingIngestAttempts`). These are
**COACH/ADMIN-FACING ONLY** — they must never reach a member.

**Why:** members must never see their own call recordings/notes. The single
enforcement point is the `MEMBER_BOOKING_COLUMNS` allow-list in
`routes/coaching-sessions.ts`: it lists only member-safe columns, so any new
sensitive column is auto-excluded. Every member endpoint that echoes a booking
uses `.returning(MEMBER_BOOKING_COLUMNS)` (book + reschedule); cancel returns
only `{ok,refunded,balance}`. The leak guard test pins this.

**How to apply:** when adding any coach/admin field to the bookings table, do
NOT add it to `MEMBER_BOOKING_COLUMNS`, and extend the leak-guard test's
`MEMBER_FORBIDDEN_FIELDS` list.

## Member visibility is under product reconsideration
The coach/admin-only rule above is a *current* enforcement default, not a
settled product stance. There is an active request to design a **member-facing**
Past Sessions presentation that shows the recording + AI summary + action items.
A TEMPORARY frontend-only design preview lives in `SessionBooking.tsx`, gated to
one email (`DESIGN_PREVIEW_EMAIL`), injecting a mock completed session — it does
NOT change the backend allow-list. If the decision lands as "members can see
their own recording/summary", the member exposure must be added deliberately to
`MEMBER_BOOKING_COLUMNS` and the leak-guard test updated; until then keep the
preview frontend-only and remove it once real data flows. Don't treat the
coach-only note as immutable without checking the latest product decision.

## Drive access is pluggable + no-ops without creds
No Google Meet REST connector exists, so ingest scans Google **Drive** and
matches files by meeting title + scheduled-time window (pure matcher is
unit-testable, IO-free). Drive access is configured purely via env
(service-account JSON, optional domain-wide-delegation subjects, optional shared
drive id). `isDriveConfigured()` gates everything: with no creds the 15-min
ingest job is a complete no-op and the fields stay null (graceful degradation).
Real Google connection (topology: central vs per-coach Drive + creds) is blocked
on the user; the feature ships and starts backfilling automatically once
configured.

**Booking title format** is "1-on-1 Coaching with <Coach>"; the search needle is
derived from the "coaching" substring so Meet's "<title> (date)" filenames match.

## Manual override interacts with TWO ingest gates, not one
Coaches/admins can hand-paste recording links when auto-matching misses. The
ingest scheduler's eligibility is `recordingIngestStatus="pending" AND
recordingIngestAttempts < MAX_INGEST_ATTEMPTS` — **two** conditions, and the
manual flow must respect both:
- Setting any link → status "manual": there is no special case in the ingest
  job, the non-"pending" status alone is what stops the next pass from
  clobbering hand-entered links.
- Clearing every link → status back to "pending" **AND attempts reset to 0**.
  Resetting attempts is mandatory: real "no recording found" rows are usually
  `not_found` sitting at the attempts cap, so reverting status alone leaves them
  permanently ineligible and auto-ingest never resumes.

**Why:** this exact attempts-reset omission was caught in review — flipping only
the status looked correct but silently failed for the common (capped) case.
**How to apply:** any code path that re-enables auto-ingest for a booking must
clear BOTH gates (status + attempts), not just the status. Keep the status/
attempts computation single-sourced in `lib/pack-bookings.ts` so the coach and
admin PATCH routes can't drift. Still coach/admin-only — no member route exposes
the recording fields.
