---
name: Coaching-call reslot is active-only by design
description: Why template day/time edits don't re-slot future occurrences while a schedule is paused
---

Editing a recurring coaching-call template's day/time/coach re-slots its future
un-reserved generated occurrences (delete safe future rows + regenerate on the new
grid) ONLY when the template is `active`. Paused templates are intentionally skipped.

**Why:** Three existing design decisions are mutually consistent and must stay so:
1. Pause/resume never rewrites the calls already on the schedule (deliberate).
2. The top-up job selects `active = true` only — paused schedules generate nothing.
3. Therefore the reslot path also gates on `active`; touching a paused schedule's
   occurrences (especially regenerating a fresh batch) would contradict 1 & 2 and
   leave watermark semantics ambiguous.

The acceptance criteria target the active-edit flow ("editing day/time moves
upcoming un-booked calls; booked ones stay"), which works correctly. The cost is a
narrow edge case: if an admin edits day/time *while paused*, the member-visible
future instances stay on the OLD day until the template is resumed and edited (or
naturally rolls forward). Natural admin flow (resume, then adjust) avoids it.

**How to apply:** Don't naively remove the `updated.active &&` gate in
`admin-coaching-calls.ts` — a paused template would then get a fresh future batch.
Properly supporting paused edits needs delete-only + watermark reset logic, which is
out of scope unless explicitly requested.

Separately: the reslot watermark query must use `desc(scheduledAt).limit(1)` to read
the FURTHEST existing occurrence (an earlier `asc` version silently read the earliest).
