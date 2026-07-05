---
name: Next-call panel source of truth
description: Persistent sidebar "next booked call" panel — why it queries call_bookings directly instead of the partner-assignment endpoint, and the kickoff+partner overlap edge case.
---

The persistent sidebar panel showing a member's next booked call (any type)
must source from a dedicated endpoint that queries `call_bookings` directly
(soonest `status='booked'`, `scheduled_at >= now()`, across BOTH
`type IN ('kickoff','partner')`), NOT from the partner-assignment endpoint
(`/partner/me` / `usePartnerPanel`). The partner endpoint returns null for
any member without an active `partner_assignments` row — which is by design
for the accountability-partner dashboard card, but would incorrectly hide a
LaunchPad member's kickoff call, since LaunchPad members never get a partner
assignment.

**Why:** confirmed against real prod data — a member can simultaneously have
an upcoming KICKOFF call AND an active partner assignment with its own
upcoming partner call (e.g. kickoff booked for day N, first partner call
booked for day N+2). Whichever call is sooner must be the panel's headline
(kickoff coach's name/photo in that case), while the partner relationship
line must always name the actual assigned partner — never assume the
headline staff member and the assigned partner are the same person.

**How to apply:** when combining "next call" and "partner relationship"
display data, always resolve the two independently (own name/photo per call
vs. per assignment) and only collapse them into a single line when the next
call's type is actually `partner` and its staff matches the assignment's
partner. Never redundantly show the same call info in more than one
always-visible UI surface — a top-of-page banner and a sidebar panel both
saying "your call is today, join now" is confusing; retire the older one
once a persistent surface supersedes it.
