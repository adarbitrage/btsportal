---
name: GHL coaching discussion-topic visibility
description: Where the member's 1-on-1 booking "what to discuss" topic must be written in GHL so the coach actually sees it on the appointment.
---

The member's discussion topic for a 1-on-1 "session pack" booking must land in the
**coaching sub-account** (COACHING_LOCATION_ID `JI6HzFwkNIr5VA2QUWUL`), the same GHL
location where the appointment + its contact live — NOT the main BTS location.

**Why:** the original code wrote it via `queueGHLSync({action:"add_note", userId})`,
which resolves the contact in the MAIN location, a different GHL location entirely, so
it never showed near the appointment. Two later approaches (topic appended to the GHL
appointment **title**, and a standalone **contact note**) were both rejected by the
user — the title looked cluttered and a free-floating contact note isn't where a coach
looks. The accepted home is the appointment's **Internal Notes**.

**How to apply:** write the topic as an appointment note via
`createAppointmentNote(appointmentId, body)` →
`POST /calendars/appointments/{appointmentId}/notes` body `{ body }` (≤5000 chars).
- Scope `calendars/events.write` (coaching token already has it); the existing
  `Version: 2021-07-28` header works (verified live: GET 200, POST 201). Docs also
  accept `v3`, but don't change the header — the date version is fine.
- Call it **fire-and-forget after COMMIT** in the book handler using `appointment.id`
  (the same value stored as `ghlAppointmentId`). Never block the booking on it.
- **Reschedule needs NO note logic** — same appointment id, the note persists. The
  reschedule path restores the clean DB title (`existing.title`) on the GHL event; do
  NOT re-stuff the topic into the title, and the reschedule select no longer needs
  `discussionTopic`.

**Self-labeling note body (required):** GHL auto-mirrors every appointment note onto
the linked Contact/Opportunity/Conversation (unavoidable platform behavior — user
accepted this). So multiple bookings pile up on the contact timeline. Format each note
to identify its own session:
```
1-on-1 with {coach.name} — {Mon, Jun 22, 12:00 PM CDT}
What the member wants to discuss:
{discussionTopic}
```
Build the time string with `toLocaleString("en-US", { timeZone: COACHING_TIMEZONE,
weekday/month/day/hour/minute + timeZoneName: "short" })` — do NOT combine `dateStyle`/
`timeStyle` with `timeZoneName` (throws).

GHL's "Form Submission" panel is NOT API-writable (only GHL's hosted booking-form
fills it), so parity with the old form-based flow isn't possible — Internal Notes is
the closest equivalent.
