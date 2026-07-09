---
name: Universal pitch-slot exclusion list
description: The {{pitch_block_html}} layout seam gates on an explicit security-slug exclusion list, not on email category, and is authoritative over caller-supplied values.
---

`resolvePitchBlockHtmlForSend` (in `communication-service.ts`) decides whether
to populate `{{pitch_block_html}}` in an outgoing lifecycle email.

- It no longer skips by `category === "marketing"`. It skips ONLY for a
  fixed 3-slug exclusion set: `password_reset`, `email_verification`,
  `flexy_password_reset`. Any new security-sensitive transactional template
  must be added to that set explicitly, or it will start carrying a pitch.
- Whenever a `userId` is resolvable, the seam's own resolved pitch stack is
  authoritative — it overrides any caller-supplied `pitch_block_html`
  variable rather than deferring to it. Only when no `userId` can be
  resolved does a caller-supplied value (or absence) pass through.
- `queueBroadcastEmail` intentionally suppresses the pitch slot entirely via
  an internal `__suppressPitchForBroadcast` flag — broadcast blasts are not
  routed through per-member pitch resolution.

**Why:** the previous category-based skip accidentally excluded ~18
lifecycle templates (streak_milestone, onboarding drips, session_feedback,
reminders, etc.) from ever showing a pitch, and also let a caller's own
`pitch_block_html` variable double-stack alongside the seam's — both were
unintended per-template drift rather than deliberate design.

**How to apply:** when adding a new transactional/security template, decide
up front whether it belongs in `PITCH_EXCLUDED_TEMPLATE_SLUGS`; don't reach
for a category check. When wiring a new send site, always thread `userId`
if one exists — that's what makes the seam authoritative instead of
falling back to whatever the caller happened to pass.

**Gotcha (fixed):** don't merge the resolved pitch value into `variables`
only when it's `!== undefined`. The resolver legitimately returns
`undefined` for excluded slugs and for broadcast suppression, and skipping
the merge in that case lets a caller-supplied `variables.pitch_block_html`
leak straight through untouched — silently reopening the exclusion/
suppression hole. Whenever the seam has an opinion (userId resolvable, or
broadcast suppression active), force-overwrite `pitch_block_html` with
`resolved ?? ""`; only defer to the caller's value when there's no userId
and no suppression at all.
