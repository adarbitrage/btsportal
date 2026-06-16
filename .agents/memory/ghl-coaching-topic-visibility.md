---
name: GHL coaching discussion-topic visibility
description: Where the member's 1-on-1 booking "what to discuss" topic must be written in GHL so the coach actually sees it on the appointment.
---

The member's discussion topic for a 1-on-1 "session pack" booking must land in the
**coaching sub-account** (COACHING_LOCATION_ID `JI6HzFwkNIr5VA2QUWUL`), the same GHL
location where the appointment + its contact live — NOT the main BTS location.

**Why:** the original code wrote it via `queueGHLSync({action:"add_note", userId})`,
which resolves the contact in the MAIN location. The appointment is created by
`createAppointment` in the coaching sub-account with its own `contactId`, so a
main-location note is in a different GHL location entirely and never shows near the
appointment. Booking via API also means GHL's "Form Submission" panel can't be
populated (that panel only fills from real GHL booking-form submissions), so parity
with the old form-based flow isn't possible.

**How to apply:** surface the topic two ways, both in the coaching sub-account:
1. Append a ≤60-char preview to the GHL appointment **title** (`buildGhlTitle`) so it
   shows directly on the calendar event. Keep the DB `title` clean (member-facing).
2. Write the full topic as a **contact note** via `addContactNote(contactId, body)`
   (POST `/contacts/{id}/notes`; location implied by the location-scoped token, which
   has `contacts.write`). Fire-and-forget after COMMIT.
Reschedule (`updateAppointment`) must REAPPLY `buildGhlTitle(existing.title,
existing.discussionTopic)` — otherwise it overwrites the event title with the clean DB
title and the preview is lost. Keep `discussionTopic` in the reschedule select.
