---
name: Session-pack call vs calendar block
description: Pack 1-on-1 sessions are 1-hour calls but reserve a 30-min buffer on the coach calendar.
---

In `artifacts/api-server/src/routes/coaching-sessions.ts` the pack booking + reschedule paths
distinguish two durations:
- `CALL_DURATION_MINUTES = 60` — the actual meeting length. Stored as `endAt` (= start+60) and
  `durationMinutes` on `session_pack_bookings`; this is what the member sees.
- `BLOCK_DURATION_MINUTES = 90` (call + `BUFFER_MINUTES = 30`) — used ONLY for the GHL appointment
  `endTime`. A 1pm booking therefore blocks 1:00–2:30pm on the coach's GHL calendar even though the
  call runs 1:00–2:00pm.

**Why:** coaches need a 30-min gap between calls. The appointment `endTime` is the only buffer lever
we control from code — GHL's free-slot endpoint excludes slots that overlap an existing appointment,
so storing 90-min appointments makes consecutive bookings respect the buffer automatically.
**How to apply:** never set the GHL `endTime` to the call end; always use `blockEndAt` (start +
BLOCK_DURATION_MINUTES). Keep `endAt`/`durationMinutes` on the call length (60). Slot spacing the
member is *offered* still comes from GHL calendar config, not this code. Pre-existing test-account
bookings keep their old 30-min values; no migration (pre-launch).
