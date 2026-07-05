---
name: Onboarding SMS/phone validation gate + revisit-save idempotency
description: How the "SMS-on + no-phone" state is prevented, and why re-saving a passed onboarding step must not 400.
---

## SMS/phone gate

A member must never be left with the master `smsOptIn` flag true and an empty
phone — text reminders would silently never send. The single authoritative gate
lives in `PATCH /members/me/profile` (`artifacts/api-server/src/routes/onboarding.ts`):
it fetches the current row, merges incoming fields over it, and rejects if the
**resulting** phone is empty while the **resulting master `smsOptIn`** is true.

**Why gate on the master flag only, not per-category flags:** every actual SMS
send site (`scheduled-comms.ts`, `webhook-handler.ts`, `tickets.ts`, etc.) checks
`smsOptIn && <categoryFlag>` before sending — a category flag alone is inert.
Per-category flags also default to `true` in the schema, so gating on "any
category flag" would reject nearly every no-phone member's unrelated saves.

**How to apply:** both the onboarding Profile step and the post-onboarding
Account page mirror this exact client-side check (same message: "Add a phone
number to receive text reminders — or uncheck SMS notifications") purely for
UX; the server call above is the real enforcement point and is shared by both
surfaces since they both PATCH the same endpoint. The admin panel's
member-editing surface was NOT checked/gated (see proposed follow-up task).

## Revisit-save idempotency (Back → edit → Save & Continue)

`PATCH /members/me/onboarding` used to 400 any request where `step !==
user.onboardingStep`, in BOTH directions. That broke a legitimate flow: member
clicks Back to re-edit an already-passed step (e.g. Profile), saves via the
*separate* profile endpoint (which always succeeds, independent of onboarding
step), then the step-completion PATCH re-fires for the step they just edited —
which is now behind their real step. The fix splits the check: `step <
currentStep` is an idempotent no-op success returning the member's real
current step (so the client can navigate forward correctly); `step >
currentStep` still 400s (can't skip ahead). The member's edits were never lost
in the old bug — the profile PATCH had already committed before the step PATCH
threw; the bug was only in the step-advancement response confusing the client.
