---
name: Kickoff/partner call reminders
description: How the 24h-email + 1h-SMS reminders for call_bookings (kickoff + accountability partner) are gated, deduped, and timezone-rendered.
---

- One SMS opt-in category (`users.partnerCallSmsOptIn`) covers BOTH kickoff and partner call variants — `call_bookings.type` ("kickoff" | "partner") only selects the template slug, not the opt-in gate. Don't split into two categories.
- `call_bookings.staffId` is polymorphic (no FK): resolve the display name against `kickoff_coaches` or `partners` based on `staffType`, never assume one table.
- Email reminders render in the MEMBER'S OWN timezone (`users.timezone`, fallback `America/New_York`) via a new `formatInMemberTimezone` helper — deliberately separate from the existing `CALL_DISPLAY_TIMEZONE`/`formatCallDateTime` used by group coaching-call reminders (which have no per-member timezone concept). Never merge these two formatters.
- Dedup keys are per-booking (`call_booking_reminder_24h_email_{id}` / `_1h_sms_{id}`), not per-member — a call booking is already 1:1 with a single member, unlike group coaching calls.
- Recheck `status === "booked"` on the live row AFTER reserving the dedup slot (both email and SMS paths) so a cancellation racing the scheduler suppresses the send instead of firing a stale reminder.
