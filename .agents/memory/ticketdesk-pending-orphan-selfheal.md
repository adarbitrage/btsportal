---
name: TicketDesk pending-orphan self-heal
description: Why a delivered TicketDesk ticket can stay 'pending' and never sync agent replies, and the three-part fix that closes the gap.
---

# TicketDesk pending-orphan self-heal

A support ticket can be fully live in TicketDesk (conversation + opening message
created) yet stay at `deliveryStatus='pending'` in the portal, because the
delivery worker's `'delivered'` status write was lost (e.g. process restart
between the successful `createConversation` and the stamp). The portal poller
only syncs agent replies for **`delivered`** tickets, so such an orphan never
shows the agent's reply in Compliance Review "View Conversation".

## The three-part fix (all in artifacts/api-server/src/lib)

1. **Idempotent `createConversation` (ticketdesk-client.ts).** After get-or-create
   session, fetch thread messages; if any body already contains the
   `BTS Ticket: <num>` marker, skip re-posting the opening message. This is what
   makes BullMQ retries safe — a retry never duplicates the opening post.

2. **Reliable stamp + throw-to-retry (ticketdesk-queue.ts).** `updateDeliveryStatus`
   returns `Promise<boolean>`; `processJob` **awaits** the `'delivered'` stamp and
   **throws** on `false` so BullMQ retries the (now-idempotent) job instead of
   silently leaving `pending`. Never fire-and-forget the delivered stamp.

3. **`reconcilePendingDeliveries()` at top of `runPollCycle()` (ticketdesk-poller.ts).**
   Self-heal pass for orphans the retry window missed: query `pending` tickets
   older than `RECONCILE_STUCK_MINUTES` (default 30, > the ~15min 5-attempt
   back-off), within poll cutoff, non-null userId, limit 50. For each, probe the
   TicketDesk thread (agent message OR BTS marker present) and flip to
   `'delivered'`. Runs first so recovered tickets sync the same cycle.

**Why pending-only (not failed):** matches the product promise "failed delivery
keeps the email fallback". Genuinely-`failed` tickets are recovered manually via
the admin "Retry delivery" button (which is now idempotent too). Re-probing
`failed` every cycle would hammer the chat API for tickets that truly never
delivered.

**How to apply:** any new "deliver to external system then stamp local status"
flow needs the same shape — idempotent deliver + awaited stamp that retries on
write failure + a reconcile sweep keyed on the not-yet-stamped state. Don't add
the reconcile sweep to terminal/failed states unless asked.
