---
name: Coach archive vs delete semantics
description: Policy for removing coaches — archive-only history, upcoming-only cleanup
---

Policy: archiving a coach must hide them from EVERY member-facing surface at read time — including already-generated upcoming calls in member call lists and dashboard previews — while their past calls stay visible as history. Coach call history is immutable — past `coaching_calls` are never reassigned, cancelled, or deleted by any admin cleanup flow. A coach with any past calls can only be archived (deactivated), never hard-deleted. Bulk reassign/cancel flows and the "blocking calls" listing operate on UPCOMING calls only; reassign also moves recurring templates (the source of future occurrences) in the same transaction. Archived coaches must be rejected by every write path that assigns a coach to a call or template, and excluded from scheduling dropdowns and the auto top-up job.

**Why:** two code-review rejections — the first for rewriting history on reassign and leaving scheduling open to archived (member-invisible) coaches; the second because the cancel flow could still erase past calls and make a history-bearing coach deletable.

**How to apply:** any new coach-cleanup or coach-assignment feature must scope destructive/moving operations to `scheduledAt >= now` and gate assignment on the coach being active; treat "past-only calls" as archive-only, not cleanup work.
