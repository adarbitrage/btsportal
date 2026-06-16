---
name: 1-on-1 coach roster is boot-seeded
description: Why the standalone 1-on-1 (session-pack) coach roster lives in a startup seed, not migrations, and what the legacy placeholder names were.
---

The admin "1-on-1 Coaching" roster (PackCoaches UI / `/admin/coaching/roster`) reads from `session_pack_coaches`, the table for the NEW pack-based 1-on-1 system. This is a SEPARATE system from the OLD entitlement-gated group/mentorship coaching (`coachesTable`, seeded in `seed.ts`) whose admin page is not linked from the main sidebar.

The real coaches (Sasha, Bruce, Michael, Todd — GHL sub-account JI6HzFwkNIr5VA2QUWUL) are populated by an idempotent boot-time seed (`seed-session-pack-coaches.ts`, wired in `app.ts`), keyed by `ghl_calendar_id`. They originally existed only in dev (hand-inserted), so production kept showing legacy placeholder fakes **Sarah Mitchell / David Chen / Amara Williams** until the seed was added.

**Why a boot seed (not a migration):** publish migrates schema, not data; the seed is the only path data reaches prod. The seed removes the 3 placeholders BY EXACT NAME (delete if no bookings, else deactivate) — deliberately name-targeted so admin-added coaches are never wiped on reboot.

**How to apply:** to change the real roster, edit `REAL_COACHES` in the seed (it's the reproducible source of truth). Don't "fix" the placeholder fakes elsewhere — they only ever came from `session_pack_coaches` (now cleaned) or the unrelated `coachesTable` group system.
