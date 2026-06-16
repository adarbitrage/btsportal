---
name: Coaching attendance-targeted emails
description: How session-feedback / recording-ready emails pick recipients via per-call attendance, and why feedback keeps an entitlement fallback.
---

# Coaching attendance targeting

`coaching_call_attendance` (UNIQUE(call_id,user_id), `registered_at` + `recording_viewed_at` both nullable) is the per-call recipient source for the scheduled comms emails.

- **session-feedback**: targets members with ANY attendance row for the call (registered OR viewed). If a call has ZERO attendance rows it FALLS BACK to the old entitlement audience.
- **recording-ready** (new): targets ONLY registrants (`registered_at` set), no fallback; bounded to calls finished in the last 7 days.

**Why the feedback fallback exists:** the portal `Coaching.tsx` is fully static and does NOT call the coaching-calls API, so nothing populates attendance yet. Without the fallback, every existing call (no rows) would silently send zero feedback emails — a regression. Remove the fallback only once the portal is dynamic and reliably records attendance.

**How to apply:** attendance is written by `POST /coaching-calls/:id/attendance` and `/recording-view` (entitlement-gated). `registered_count` on the call is bumped only when the attendance insert creates a brand-new row (detect via `registered_at === created_at`). Dedup keys: `session_feedback_email_<callId>_<memberId>`, `recording_ready_email_<callId>_<memberId>` — per member per call.
