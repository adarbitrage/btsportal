---
name: Pack booking member-facing leak
description: coachNotes/actionItems on session_pack_bookings must never reach members; member write endpoints must project, not raw .returning()
---

# Pack booking coach-only fields leak via raw `.returning()`

`session_pack_bookings.coachNotes` and `.actionItems` are COACH/ADMIN-FACING
ONLY. The member-facing write endpoints in
`artifacts/api-server/src/routes/coaching-sessions.ts` (book =
`POST /coaching/sessions`, reschedule = `PATCH /coaching/sessions/:id/reschedule`)
echo the booking row back to the member. A bare `.returning()` (no column list)
returns the FULL row, so once a coach writes notes/action-items they silently
leak to the member on the next reschedule response.

**Rule:** any member-facing `.returning()` / select on this table must use the
explicit `MEMBER_BOOKING_COLUMNS` projection (defined at top of
coaching-sessions.ts) that omits `coachNotes` + `actionItems`. The
`/coaching/sessions/mine` list already used an explicit safe select; keep it
that way. Guard test:
`src/__tests__/coaching-sessions-member-notes-leak-guard.test.ts`.

**Recording links are member-visible ONLY on completed sessions.** The
ingest outputs `recordingUrl`/`summaryUrl`/`transcriptUrl` are surfaced to the
member through `/coaching/sessions/mine`, but ONLY on rows where
`status === "completed"` (mapped/stripped in the route after the select). They
are deliberately NOT in `MEMBER_BOOKING_COLUMNS`, so the book/reschedule write
endpoints (which operate on non-completed bookings) never echo them. The ingest
bookkeeping (`recordingIngestStatus`/`recordingIngestAt`/`recordingIngestAttempts`)
stays coach/admin-only everywhere. Guard test splits ALWAYS_FORBIDDEN_FIELDS vs
RECORDING_FIELDS and asserts the completed-vs-booked behavior.

**Why:** caught in code review — additive coach-only columns are invisible in
the member UI but ride along in raw row responses. New coach-only columns on
this table must be added to the projection's exclusion set, not just trusted to
"not be rendered."

**How to apply:** when adding any coach/admin-only column to
session_pack_bookings, confirm every member-facing response uses an explicit
projection; never return the raw row.
