---
name: Retell voice assistant wiring
description: How the voice assistant connects to Retell; the credentials it needs and a common gotcha.
---

# Retell voice assistant wiring

The voice feature is fully built in code; it only needs Retell credentials set as
Replit Secrets (global → available in both dev and prod):
- `RETELL_API_KEY` — account key.
- `RETELL_AGENT_ID` — MUST include the `agent_` prefix (e.g. `agent_4267...`). The
  Retell dashboard sometimes shows the bare id without the prefix; pasting it
  without `agent_` makes `client.agent.retrieve`/`createWebCall` return HTTP 404
  ("Item ... not found from agent") while the API key itself is fine.
- `RETELL_FUNCTION_SECRET` — shared Bearer secret for the server-to-server
  `POST /api/voice/kb-search` call Retell makes back into the portal API. Same value
  must be set as the Bearer token on the kb-search custom tool in the Retell agent.

**Why:** a valid key + wrong-format agent id produces a 404, not a 401, so it looks
like an auth/account problem when it's just the missing prefix.

**How to verify (read-only-ish):** instantiate `new Retell({apiKey})`,
`client.agent.list()` to find the right `agent_id`, then `client.call.createWebCall({agent_id})`
returns `{call_id, call_status:"registered", access_token}` — that's the exact path
`POST /api/voice/web-call` uses. Run the script from inside `artifacts/api-server`
so the workspace-hoisted `retell-sdk` resolves.

**Still user-side (Retell dashboard, not code):** point the agent's kb-search tool at
`POST <prod>/api/voice/kb-search` with the matching Bearer secret, and set the agent
webhook URL to `https://<prod-domain>/api/webhooks/retell`. Completed calls are logged
in `voice_calls`; the webhook updates status/duration/transcript.
