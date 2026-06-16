---
name: Slot engine session length & buffer
description: How getAvailableSlots derives per-window slot length, spacing, and conflict padding (recurring + override days).
---

The 1-on-1 slot generator (`artifacts/api-server/src/lib/slot-engine.ts`) once
hard-coded 60-min sessions on a 60-min grid, ignoring the
`sessionDurationMinutes` / `bufferMinutes` columns on `coach_availability`.

Now, for **any availability window** (recurring or custom-hours override):
- slot length = window `sessionDurationMinutes`
- consecutive slot starts are spaced `sessionDurationMinutes + bufferMinutes`
  apart (real gap between back-to-back calls)
- conflict checks pad the candidate slot by `bufferMinutes` on BOTH sides, so a
  new booking can't sit flush against an existing session/group call

**Override days now have their own length/buffer.**
`coach_availability_overrides` carries nullable `session_duration_minutes` /
`buffer_minutes` columns. Resolution order for a custom ("extra") override
window: the override's own value → the weekday's recurring window value →
schema fallback (`DEFAULT_SESSION_DURATION=60` / `DEFAULT_OVERRIDE_BUFFER=15`,
mirroring the `coach_availability` column defaults). The old "override always
falls back to 60/0" contract is GONE; the regression test that pinned it was
rewritten to assert the override's own values win over the recurring window.

Admin plumbing: create/edit endpoints in `admin-coaching.ts` validate +
persist the two fields (session must be a positive int, buffer non-negative;
blank = null = inherit). The portal override dialog
(`CoachingOverrides.tsx`) only shows the time + session/buffer inputs for the
"extra" type and clears them when switched back to "blocked".

**How to apply:** in slot-engine-overrides.test.ts the recurring fixture is
pinned to 60/0 on purpose (distinguishable from the schema default buffer 15)
so inheritance vs fallback stays observable; don't "fix" it to the schema
default or those assertions break.
