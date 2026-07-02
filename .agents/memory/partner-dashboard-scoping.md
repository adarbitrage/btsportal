---
name: Partner dashboard scoping + shared mark-done
description: How the accountability-partner dashboard resolves "whose data am I looking at" and why call completion has one single entry point.
---

The partner dashboard (roster/today/mentee-detail/notes/cadence/mark-done)
resolves the acting partner via `resolvePartnerContext()`: a partner login
maps `partners.user_id = req.userId` (their own row only, 404 if unlinked);
an admin login with `partners:view` MUST pass `?partnerId=` explicitly —
there is no combined "all partners" view, and admins are 403'd on every
write endpoint (notes, cadence, mark-done) even though they can read.

**Why:** keeps partner-authored content (notes) and call-completion state
unambiguously attributable to a real partner, and keeps the admin surface
strictly an oversight/audit view, not a way to act as a partner.

`markPartnerCallDone()` (artifacts/api-server/src/lib/partner-call-completion.ts)
is the ONLY legitimate way a `call_bookings` row of type "partner" moves
booked -> completed. It is no-op-safe (wrong type/status/missing row all
return `updated: false`) and handles first-call onboarding advancement
internally.

**How to apply:** any new caller that can mark a partner call done (e.g. a
future webhook-driven completion confirming the call happened) must call
this same helper rather than writing its own UPDATE — otherwise the flip +
onboarding advancement logic will drift between call sites.
