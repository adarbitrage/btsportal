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
