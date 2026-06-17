---
name: Session-pack recording-ready deep link
description: How the 1-on-1 (session pack) recording-ready email/SMS deep-links to a specific booking, and why a dedicated template was used.
---

The 1-on-1 (session pack) "recording ready" notification is SEPARATE from the
group-call one. Group uses template slug `recording_ready` (hardcoded
`/coaching`); 1-on-1 uses dedicated slug `session_recording_ready` (email + SMS)
whose body links to `{{portal_url}}{{recording_path}}`, and the caller passes
`recording_path = /coaching/book-session?recording=<bookingId>`. The portal page
SessionBooking.tsx reads the `recording` query param and auto-opens that
booking's recording dialog.

**Why a dedicated template, not a shared/variabilized one:**
- SMS templates have NO content-refresh on boot and `sms_templates` has no
  `starter_hash` column — so mutating an existing SMS body never reaches
  existing/prod DBs without a destructive full reseed. A brand-new slug, by
  contrast, can be safely INSERTED if missing.
- Email refresh works only for slugs in `REQUIRED_TEMPLATE_SLUGS`
  (`ensureRequiredEmailTemplates` on boot); `recording_ready` is marketing and
  NOT required, so its body wouldn't refresh either.
- Dedicated template also guarantees the group path is untouched.

**How propagation works now:** added `session_recording_ready` to
`REQUIRED_TEMPLATE_SLUGS` (email inserted on boot) and added a new
`ensureRequiredSmsTemplates()` (boot, app.ts) gated on `REQUIRED_SMS_TEMPLATE_SLUGS`
that ONLY inserts missing SMS rows (never overwrites — preserves admin edits).

**replaceVariables leaves unknown `{{tokens}}` literal**, so every caller of a
template MUST pass all its variables (recording_path is required by both callers
of the session-pack template; the group caller never touches it).
