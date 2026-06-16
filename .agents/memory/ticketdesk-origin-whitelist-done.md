---
name: TicketDesk origin whitelist done — delivery confirmed live
description: The one-time TicketDesk allowed-origins setup is complete; portal->TicketDesk chat-session delivery works against the live instance.
---

The TicketDesk programmatic delivery path (portal support ticket -> TicketDesk
agent inbox) is **confirmed working live** as of 2026-06-16.

**State fact (not derivable from code):** the account owner has added
`https://portal.buildtestscale.com` to the TicketDesk workspace's allowed-origins
list (Settings -> Chat Config). The previous 403 "Origin not allowed" block that
made delivery impossible is gone.

**How it was verified:** direct curl to the live instance, mirroring exactly what
`createConversation` in `artifacts/api-server/src/lib/ticketdesk-client.ts` sends:
- `POST https://tickets.buildtestscale.com/api/chat/session` with header
  `Origin: https://portal.buildtestscale.com` -> HTTP 201 (returns sessionToken,
  sessionId, threadId, contactId). No 403.
- `POST /api/chat/messages` with `Authorization: Bearer <sessionToken>` -> HTTP 201;
  the thread message body carries the `BTS Ticket: BTS-XXXXXX` line + `Portal URL:`
  link, which is what the inbound-webhook parser matches replies against.

**Implication:** the BullMQ worker's `processJob` now succeeds, so
`delivery_status` flips `pending -> delivered`. Don't re-investigate the 403 path
or treat the whitelisting as an open blocker unless a fresh probe starts returning
403 again (which would mean the origin was removed or the portal domain changed).

**Still requires a human / prod to observe directly (code is in place, not a bug):**
a real prod ticket's `delivery_status` row flip in the prod DB, and a live agent
reply firing the inbound webhook to the prod endpoint.
