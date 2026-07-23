---
name: TicketDesk status contract sync
description: How BTS consumes TicketDesk chat-API thread status (open/in_progress/resolved + resolvedAt) and the fail-open-to-unknown rule
---

**Rule:** All TicketDesk thread-status interpretation goes through `parseThreadStatus` in ticketdesk-client (normalizeStatusValue alias map, "closed"→"resolved"). An ABSENT or unrecognised status must parse as `null` (unknown) and cause NO ticket status transition — never treat missing status as closed/resolved.

**Why:** TicketDesk shipped the status field after BTS; until (and whenever) responses lack the field, guess-based closing caused false resolves. The poller relies on unknown = no-op to stay safe against contract drift.

**How to apply:**
- Resolve: remote `resolvedAt ?? now`, clear awaitingMemberReply. Auto-reopen: status back to in_progress, resolvedAt nulled, SLA resumed. open→in_progress promotion on first agent activity.
- `awaitingMemberReply` is inferred per poll cycle (last directional message agent-authored && not resolved); unknown message types carry no direction.
- Member notifications on poller-path agent replies go through sendTicketReplyNotification (per-category SMS gate still applies).
- Admin `awaiting_response` write path retired but the enum value remains for legacy rows; portal renders it via needsMemberReply/support-config labels.
- detectThreadClosed survives only as a thin wrapper; webhook closure parsing also routes through normalizeStatusValue.
