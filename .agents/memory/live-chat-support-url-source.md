---
name: Live-chat support URL single source
description: Where the TicketDesk live-chat default URL lives and which two consumers must stay pinned to it.
---

The default live-chat (TicketDesk) URL is single-sourced as `DEFAULT_TICKETDESK_URL`
in `@workspace/support-config` (`lib/support-config/src/index.ts`).

Two independent consumers import that constant for their fallback default:
- Portal embed: `artifacts/portal/src/config/support.ts` → `TICKETDESK_URL`
  (env override `VITE_TICKETDESK_URL`), rendered by `LiveChatLauncher.tsx`.
- Backend health probe: `artifacts/api-server/src/lib/live-chat-embed-probe.ts`
  → `getLiveChatEmbedProbeUrl()` (env override `LIVE_CHAT_EMBED_PROBE_URL`).

**Why:** before this, each side carried its own literal default. If the support
desk moved and only one was updated, System Health would probe a different URL
than members actually load — masking a real embed outage.

**How to apply:** to change the support destination, edit the single constant in
`@workspace/support-config`. Keep the per-runtime env overrides separate (they
resolve in different runtimes), but never reintroduce a hard-coded literal default
on either consumer. Lockstep is guarded by tests: api-server
`live-chat-embed-health.test.ts` (backend default === shared) and portal
`src/config/support.test.ts` (frontend default === shared).
