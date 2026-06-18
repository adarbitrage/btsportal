---
name: Coaching calls API returns every future occurrence
description: Why the member Coaching page (and any weekly-cadence consumer) must dedup recurring calls
---

The `/api/coaching-calls?upcoming=true` endpoint returns **every future occurrence** of each recurring `weekly_qa` call, not one row per recurring series. A background top-up job generates each active recurring template many weeks into the future (LOOKAHEAD horizon), so a single weekly slot (e.g. "Saturday 3pm with Bruce") exists as dozens of distinct rows — all with unique `(template_id, scheduled_at)`, so there is **no DB-level duplication**.

**Rule:** any UI that presents these as a *weekly cadence* (showing weekday + time + coach, no date) MUST collapse to one row per recurring slot — key on `weekdayOrder + HH:mm + coachId` and keep the soonest upcoming occurrence. Otherwise identical-looking rows repeat per future week and read as "duplicates".

**Why:** member reported "way too many entries / duplicates" on the Coaching page; the cause was the recurring-schedule section rendering all future occurrences instead of deduping.

**How to apply:** the member Coaching page recurring section is fixed. Watch the **dashboard upcoming-calls preview** (`/api/dashboard`) and any future consumer — they read the same endpoint and could show the same visual duplication if they don't dedup. One-off call types (strategy/mastermind/vip_roundtable) show dates and are correctly listed per-instance.

Minor known edge: the dedup key uses local-time components, so a recurring series could split across a DST boundary (local hour shifts). Acceptable since the row also displays local time; not worth special-casing unless it surfaces.
