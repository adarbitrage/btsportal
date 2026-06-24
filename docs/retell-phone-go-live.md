# Retell Voice Assistant — Toll-Free Phone Go-Live

This document covers the operator steps required to connect a toll-free number
to the BTS voice assistant and verify end-to-end call handling.

## Prerequisites

The following secrets must be set in the Replit environment and a **republish**
must be triggered before any phone call will work:

| Secret name | Where to get it | Purpose |
|---|---|---|
| `RETELL_API_KEY` | Retell dashboard → Settings → API Keys | Server-side API calls (health probe, agent setup) |
| `RETELL_AGENT_ID` | Retell dashboard → Agents → your agent | Must keep the `agent_` prefix exactly as shown |
| `RETELL_FUNCTION_SECRET` | Set a long random string; configure the same value in Retell agent → Functions → Authentication | Authenticates `/api/webhooks/retell` and `/api/voice/escalate` calls |

## 1. Provision the toll-free number in Retell

1. Log into **app.retellai.com**.
2. Navigate to **Phone Numbers** → **Buy number** → select a toll-free number (`+1 800 / 888 / 877 / …`).
3. Under **Inbound settings** for the number, set the **Agent** to the shared BTS voice agent (`RETELL_AGENT_ID`).
4. Save.

## 2. Configure the inbound webhook

In the Retell dashboard → **Agents** → your agent → **Webhooks**:

| Field | Value |
|---|---|
| Webhook URL | `https://<your-production-domain>/api/webhooks/retell` |
| Events | `call_started`, `call_ended`, `call_analyzed` (all three) |
| Authentication | HMAC-SHA256 signature via `RETELL_API_KEY` (Retell sends `x-retell-signature`; the server verifies it automatically) |

The webhook handler at `/api/webhooks/retell`:
- Creates / upserts a `voice_calls` row tagged `call_type = 'phone_call'` on `call_started`.
- Looks up the caller's phone number against `users.phone` to associate the call with a member.
- Records transcript and summary on `call_ended` / `call_analyzed`.

## 3. Register the escalation tool

The `retell-agent-setup.ts` boot hook automatically pushes the `escalate_to_support`
tool to the Retell LLM on every server start if the fingerprint is stale. No manual
step is needed, but you can force it by restarting the API server after a republish.

The escalation tool calls `POST /api/voice/escalate` (also protected by
`RETELL_FUNCTION_SECRET`). When triggered the API:
1. Looks up the caller's phone number to find the member (if any).
2. Creates a `tickets` row (`source = 'voice_call'`; `user_id` is nullable for
   unrecognised callers).
3. Routes the ticket via `autoRouteTicket` (base-tier rules apply for anonymous callers).
4. Queues delivery via the TicketDesk pipeline; fires `sendSupportFallbackEmail`
   immediately if the queue is unavailable.

## 4. Verify after go-live

```bash
# Check that the agent is healthy and both tools are registered:
curl -s https://<prod-domain>/api/admin/system-health \
  -H "Cookie: <admin-session-cookie>" | jq '.voice'

# Expected: { "status": "ok", "kbSearchTool": true, "escalationTool": true }
```

Call the toll-free number from a test phone. The `voice_calls` table should gain
a new row with `call_type = 'phone_call'` and `caller_phone` set to your number.

If you ask the assistant something it cannot answer, it should invoke the
escalation tool, which creates a ticket visible in the admin support queue.

## 5. Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| No `voice_calls` row created | Webhook URL wrong or `RETELL_FUNCTION_SECRET` mismatch | Double-check webhook URL + bearer token in Retell dashboard |
| `voice.status = "misconfigured"` in health check | `RETELL_AGENT_ID` missing `agent_` prefix or `RETELL_API_KEY` invalid | Fix the secret and republish |
| Escalation tool not found in health check | Agent setup skipped (fingerprint not updated) | Restart the API server; check logs for `[RetellSetup]` |
| Anonymous ticket created but no support email | `SENDGRID_API_KEY` not set or TicketDesk queue misconfigured | Set `SENDGRID_API_KEY` + `SUPPORT_EMAIL`; republish |
