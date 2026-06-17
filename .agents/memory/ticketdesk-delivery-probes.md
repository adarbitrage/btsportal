---
name: TicketDesk delivery probes (three distinct signals)
description: Three TicketDesk health signals that look alike but mean different things — conflating them masks real outages.
---

There are THREE distinct TicketDesk health signals; treating them as one masks real outages:

1. **Widget-embed probe** (health key `liveChatEmbed`) — only proves the in-portal
   chat *widget* asset loads. Never exercises the programmatic origin gate.
2. **Stuck-backlog alerter** (health key `ticketDeskDelivery`) — watches for an
   undelivered ticket backlog *after* retries are exhausted (reactive).
3. **Delivery-gate probe** (health key `ticketDeskDeliveryGate`) — actively
   exercises the real delivery path to catch a 403 "Origin not allowed" *before*
   tickets pile up (proactive).

**Why:** tickets reach the agent inbox by POSTing the chat session with the portal
Origin; TicketDesk validates that Origin against an allowed-origins list. Drop the
portal domain and EVERY delivery 403s silently while the worker retries forever.
The widget probe cannot see this, and the backlog alerter only fires after damage.

**How to apply:**
- Keep the three health keys separate; `ticketDeskDeliveryGate` is NOT
  `ticketDeskDelivery`.
- A delivery-gate probe is only trustworthy if it stays faithful to the real
  delivery path (same Origin/session step) — otherwise its verdict won't match
  what members experience.
- Classification rule of thumb: only a definitive 403 "Origin not allowed" means
  blocked; transient/ambiguous results (5xx, network, timeout, non-origin 403)
  must be inconclusive so they never false-alarm; alert only after N consecutive
  blocked probes.
- The probe deliberately reuses ONE dedicated, clearly-labelled probe contact and
  posts no message, so runs don't spawn noisy live-inbox threads. Don't "fix" or
  delete that probe contact.
- Poll is prod-only by default (env override exists); tests drive the evaluate
  function directly with a stubbed fetch.

**No contact-side close/archive endpoint exists (verified against live TicketDesk).**
All candidates 404: POST `/chat/session/{resolve,close,archive,end}`, PATCH/DELETE
`/chat/session`, `/chat/threads/{id}/*`. Closing a thread is agent-side over the
WebSocket only — there is no REST way for the probe (a contact/external system) to
resolve its own thread. The probe thread therefore stays empty (no message posted)
and does not surface in the active agent queue, so auto-cleanup is best-effort/opt-in:
`archiveDeliveryProbeThread()` in ticketdesk-client.ts is a NO-OP unless
`TICKETDESK_DELIVERY_PROBE_RESOLVE_PATH` (+ optional `_RESOLVE_METHOD`, default POST)
is set, so it never spams 404s every poll against the live system. It never throws
and never affects the probe verdict. If TicketDesk later ships a real
contact-side resolve endpoint, just set that env var to enable cleanup — don't go
deleting the probe contact.
