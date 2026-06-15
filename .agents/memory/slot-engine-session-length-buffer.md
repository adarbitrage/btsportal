---
name: Slot engine session length & buffer
description: How getAvailableSlots derives per-window slot length, spacing, and conflict padding.
---

The 1-on-1 slot generator (`artifacts/api-server/src/lib/slot-engine.ts`) once
hard-coded 60-min sessions on a 60-min grid, ignoring the
`sessionDurationMinutes` / `bufferMinutes` columns on `coach_availability`.

Now, for **recurring availability windows**:
- slot length = window `sessionDurationMinutes`
- consecutive slot starts are spaced `sessionDurationMinutes + bufferMinutes`
  apart (real gap between back-to-back calls)
- conflict checks pad the candidate slot by `bufferMinutes` on BOTH sides, so a
  new booking can't sit flush against an existing session/group call

**Why it matters:** `coach_availability_overrides` has NO duration/buffer
columns, so override days fall back to 60-min / 0-buffer
(DEFAULT_SESSION_DURATION / DEFAULT_OVERRIDE_BUFFER). Keeping override buffer at
0 is deliberate — it preserves the hourly 14/15/16 expectation in
slot-engine-overrides.test.ts.

**How to apply:** the limits test seeds coaches with `bufferMinutes:0` on
purpose so cap/conflict/lead-time stay on-the-hour; don't "fix" that to the
schema default (15) or those assertions break.
