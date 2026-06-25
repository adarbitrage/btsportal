---
name: TicketDesk two-way sync uses two different mechanisms
description: How portal↔TicketDesk text sync works in each direction, and the echo-loop guard that makes mirroring member replies safe.
---

# TicketDesk portal↔TicketDesk text sync

The two halves of the two-way text loop use **different** mechanisms — they are
not symmetric, so wiring one does not wire the other.

- **agent → member (inbound):** the 5-min `ticketdesk-poller.ts` re-creates the
  member's chat session (`createSessionForPolling`, get-or-create keyed by
  email+ticketNumber), fetches the thread, and appends only AGENT-side messages
  (`isAgentMessage`: types `chat_outbound`/`outbound`/`agent_message`) to the
  portal thread. Member-authored messages come back as `chat_inbound`/`inbound`
  and are filtered out.

- **member → agent (outbound):** must be pushed EXPLICITLY per member action.
  There is no outbound poller. `sendMemberReplyToTicketDesk` (client) wraps
  `createSessionForPolling` + `postMessageToThread`; `POST /tickets/:id/messages`
  fires it best-effort, gated on `deliveryStatus === "delivered"`. Member-marked
  resolution uses the sibling `signalResolutionToTicketDesk` from `/resolve`.

**Why the mirror is safe (no echo loop):** a member reply posted outbound
returns from TicketDesk as `chat_inbound`, so the poller's `isAgentMessage`
filter skips it — it is never re-appended to the same portal thread.

**How to apply:** any NEW portal-side action that should reach the support agent
(reply, resolve, future status changes) needs its own explicit outbound push;
do not assume the poller carries it. Always gate on `deliveryStatus ===
"delivered"` (a ticket that never reached TicketDesk has no thread to post into)
and keep it best-effort so a TicketDesk outage never blocks the DB write.

**Scope note:** outbound is TEXT-ONLY by design this pass — attachments are not
mirrored to TicketDesk.
