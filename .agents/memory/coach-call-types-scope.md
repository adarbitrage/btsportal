---
name: coach_call_calendars call-type scope
description: Why KNOWN_CALL_TYPES is intentionally limited to private_coaching + one_on_one_va (onboarding is future, not missing)
---
`coach_call_calendars` is deliberately a generic per-(coach,callType) table, but the
live call types are intentionally limited to `private_coaching` and `one_on_one_va`.
The coach row gets exactly one new capability flag: `doesOneOnOneVaCalls`.

**Why:** the table was designed extensible so an onboarding (or other) call type can be
added LATER — that is the meaning of the "e.g. a VA running both 1-on-1 VA calls and,
later, onboarding" comment in the schema file. Onboarding *calls* are NOT in scope for
the VA-coach-type work. (Note: the unrelated member "onboarding flow" — welcome/documents/
profile pages — is a different feature entirely.) A code review may flag onboarding as
"missing"; it is a future addition, not a dropped requirement.

**How to apply:** do not add a `doesOnboardingCalls` flag or an `onboarding` call type
unless a task explicitly asks for it. Extending later only requires: a new KNOWN_CALL_TYPES
entry + a capability flag + admin editor toggle/calendar-pair fields; the table/migration
already support arbitrary callType strings.
