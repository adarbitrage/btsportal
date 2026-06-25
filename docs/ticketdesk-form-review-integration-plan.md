# Form Reviews → TicketDesk: Integration Plan

How the Compliance Review and Concierge form-submission flow ties into the
TicketDesk support platform — what already works, the real gaps, and a phased
plan to finish the tie-in.

Scope note: the temporary front-end-only "preview cards" that were shown only to
`sasha@cherringtonmedia.com` have been removed. Both pages now render exclusively
from the live ticket API, so what a member sees is what the backend actually has.

---

## 1. What already exists (do NOT rebuild)

The plumbing is substantially built and running. Confirmed in code:

**Intake → ticket**
- `POST /tickets/compliance` and `POST /tickets/concierge`
  (`artifacts/api-server/src/routes/tickets.ts`) create a `tickets` row
  (`category = compliance_review | concierge_task`) plus an initial member
  message holding the formatted form fields, and persist uploaded files as
  `ticket_attachments` rows in object storage.

**Outbound mirror → TicketDesk**
- Each create calls `queueTicketDeskDelivery(...)` (fire-and-forget) →
  BullMQ queue (`ticketdesk-queue.ts`) → `createConversation(...)`
  (`ticketdesk-client.ts`), which uses the **public chat-session API** (the same
  one the live-chat widget uses): `POST /api/chat/session` then
  `POST /api/chat/messages`. No REST conversation API exists on the instance.
- Reliability is already handled: 5 retries w/ exponential backoff, a
  `delivery_status` lifecycle on the ticket (`pending → delivered | skipped |
  failed`), a fallback support-inbox email on skip/fail, an admin "retry
  delivery" action, and a startup backfill for pre-tracking tickets.

**Inbound replies → portal (this is POLLING, not webhooks)**
- `ticketdesk-poller.ts` (started at `app.ts:204`) periodically re-opens each
  thread by `(email, externalId=BTS-number)` and pulls new **agent** messages,
  appends them to the portal thread as `admin` messages, advances status
  (`in_progress` / `resolved`), and notifies the member (email + optional SMS),
  deduping via `webhook_logs`.
- `POST /api/webhooks/ticketdesk` exists as a **ready fallback** (HMAC-verified
  with `TICKETDESK_WEBHOOK_SECRET`) for if/when TicketDesk ever supports outbound
  webhook registration. It is not the active path today.

**Health monitoring**
- `ticketDeskDeliveryGate` (origin-whitelist probe), `ticketDeskDelivery` (stuck
  pending/failed alerter), `liveChatEmbed` (widget.js reachability) — all surface
  on System Health and page on-call.

**Conclusion:** the end-to-end loop (member submits → mirrors to TicketDesk →
agent replies → member sees it) is already wired. The remaining work is about
**closing gaps, verifying it actually runs in production, and making the agent
side usable for review** — not building the pipe.

---

## 2. The real gaps

### Gap A — Creatives don't reach the agent (the big one)
The outbound payload (`TicketDeskConversationInput`) carries **text only**
(`body`). The chat-message API accepts only `bodyText`. So a compliance agent in
TicketDesk sees the form fields and a list of **filenames** plus a portal deep
link — but **not the actual creative files** they're meant to review (zips,
PDFs, banner images). Compliance review is fundamentally about looking at the
creative, so this is the central limitation.

Sub-issue: the deep link is `…/support/tickets/{BTS-number}`, a **member-scoped**
portal URL. A TicketDesk agent who has no portal account can't open it. Need to
decide how agents actually access the assets.

### Gap B — Production configuration unverified
No `TICKETDESK_*` values appear in the project secrets. Defaults cover the
workspace id and origin, and the origin whitelist was previously confirmed live,
but this should be re-verified against the running deployment rather than
assumed. `TICKETDESK_WEBHOOK_SECRET` is unset (only matters if the webhook
fallback is ever activated).

### Gap C — No end-to-end proof on real data
With preview cards removed, there are currently **zero** compliance/concierge
tickets in the DB. The full loop has never been exercised here against a real
submission. We need one real round-trip to prove delivery + reply ingestion.

### Gap D — Two-way field fidelity
Outbound sends a flat text blob. Agents replying in TicketDesk works, but there's
no structured status mapping beyond reply/resolved (e.g. an "approved" vs
"changes requested" compliance outcome is just prose). Decide whether the review
*outcome* needs to be structured.

---

## 3. Phased plan

### Phase 0 — Verify the live loop (no code)
1. Confirm the API server is running the poller and queue (logs:
   `[TicketDesk Worker] Started`, `[TicketDesk Poller] …`).
2. Confirm prod env: `TICKETDESK_API_URL`, `TICKETDESK_WORKSPACE_ID`,
   `TICKETDESK_CHAT_ORIGIN` resolve correctly and the origin is whitelisted
   (the delivery-gate probe should read `ok`).
3. Submit one real compliance + one real concierge ticket end-to-end; watch it
   reach `delivered`, reply from the TicketDesk agent side, and confirm the reply
   lands back in the portal thread + the member notification fires.
   *Output: a checklist of what passed/failed. This decides how much of the rest
   is actually needed.*

### Phase 1 — Close the creatives gap (Gap A) — highest value
Decide the asset-access model, in preference order:
1. **Signed-URL links in the body (lowest effort):** at delivery time, generate
   short-lived signed object-storage URLs for each attachment and append them to
   the mirrored message so agents can download directly from TicketDesk. Needs:
   an agent-facing download route or signed-URL generator, link expiry policy,
   and access-logging.
2. **Agent portal access (if links aren't acceptable):** give the support team a
   scoped admin view of the ticket (the existing `AdminTicketDetail` already
   renders attachments) and make the deep link point there instead of the
   member-scoped URL.
3. **Native TicketDesk upload (only if the API supports it):** investigate
   whether the chat API accepts attachments; today it appears text-only.
   *Recommendation: start with option 1; it's the smallest change that makes the
   agent side actually reviewable.*

### Phase 2 — Production hardening (Gaps B, C)
- Lock in the verified env values; document them.
- Add the one real round-trip from Phase 0 as a documented smoke test.
- Confirm the stuck-delivery + delivery-gate alerts fire to a monitored inbox.

### Phase 3 — Structured review outcome (Gap D) — only if needed
- If compliance needs a machine-readable verdict (approved / changes requested /
  rejected), map specific agent actions or reply tokens to a portal-side status
  and surface it on the member's card. Otherwise leave as prose and skip.

---

## 4. What requires human/account-owner action vs. code
- **Account-owner (TicketDesk admin):** confirm/maintain the origin whitelist;
  decide the agent asset-access model (links vs. portal access); decide whether a
  structured review outcome is required.
- **Ops/secrets:** set/verify `TICKETDESK_*` in the deployment; (optionally)
  `TICKETDESK_WEBHOOK_SECRET` if the webhook fallback is ever used.
- **Code:** the signed-URL attachment links (Phase 1), any deep-link retarget,
  and the optional outcome mapping (Phase 3). Everything else already exists.

---

## 5. Risks / watch-items
- **Signed URLs in a third-party system** leak access if long-lived — keep expiry
  short and log downloads.
- **Polling cadence vs. expectation:** replies are pulled on an interval, not
  instant; confirm the cadence is acceptable for review turnaround.
- **Origin whitelist is a silent single point of failure** — if the portal domain
  falls off the TicketDesk allowed-origins list, every delivery 403s and piles up
  (the delivery-gate probe is the early warning; keep it monitored).
- **Member-scoped deep link** is currently the only pointer agents get to the
  assets; don't ship Phase 1 assuming agents can open it.
