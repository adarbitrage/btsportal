---
name: Kickoff + partner call booking (GHL)
description: Native GHL-backed booking system for kickoff calls and recurring partner calls; caps, pre-kickoff gating, step advancement, portal reschedule UX.
---
- `call_bookings` table + `ghl_calendar_id` on partners/kickoff_coaches + `cadence_per_week` on partner_assignments.
- Kickoff booking is round-robin across kickoff_coaches; booking advances onboarding step 4→5 idempotently (repeat book returns the existing row, never double-inserts or double-advances).
- Partner call booking: first booking for a member is blocked from preceding their kickoff call time (pre-kickoff cutoff); restriction lifts once any booking exists. Cap is 5 bookings/day per coach; cap frees immediately on cancel (slots reappear in availability).
- Backend reschedule = cancel existing booking + create a new one (no in-place time update). Cancel always sets status="canceled", never "completed"; repeat-cancel on an already-canceled booking is a 400.
- Step 5→6 advancement is no-op-safe like step 4→5 — must only fire once even if the booking endpoint is hit multiple times.
- Ongoing (post-onboarding) partner-call management lives at portal route `/coaching/partner-calls` (sidebar: Coaching > Accountability Partner), reusing the same onboarding page component (`pages/onboarding/BookPartnerCall.tsx`) gated by `user.onboardingComplete` for layout only — don't assume the onboarding-only route is the sole entry point when extending this flow.
- GHL cancel calls in the cancel/reschedule endpoints must fail closed: if `cancelAppointment` throws, return an error response (502) and do NOT mutate/proceed the local row — swallowing the error and continuing causes local/GHL desync (reschedule case is worse: it can silently create a second real GHL appointment while the old one is still live).
- Kickoff booking's double-submit guard needs an advisory lock keyed on the member (not just the coach) PLUS an in-transaction re-check for an existing non-canceled kickoff booking; a pre-transaction check alone races under concurrent identical requests from the same member.
