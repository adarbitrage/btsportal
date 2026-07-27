---
name: Chat E2E via throwaway member
description: How to exercise the member AI assistant end-to-end from a script (auth, entitlement, SSE parsing, FK-safe cleanup)
---

To ask the member assistant real questions from a script (e.g. verifying KB content changes):

1. Insert a temp user (`role='member'`, `email_verified`, `onboarding_complete`, bcrypt hash) and grant an active `user_products` row for a `chat:*`-bearing product — `launchpad` is the cheapest `chat:full` slug. Without a grant, `/api/chat` 403s ("upgrade your plan"); there is no admin bypass for entitlements.
2. Login `POST 127.0.0.1:8080/api/auth/login`, forward the Set-Cookie pairs as a `cookie` header (e2e loopback pattern).
3. `/api/chat` responds as an SSE stream (`data: {...}` lines) — concatenate `token` payloads; capture `sessionId` for follow-ups. Note follow-ups in-session may be answered with "I just answered that" — ask a fresh, fully-specified question instead.
4. Cleanup order matters: delete `chat_messages` by session, then `chat_sessions`, then EVERY table with an FK to `users` (enumerate via information_schema, don't hand-list — `chat_daily_usage`, `ghl_sync_log`, etc. will bite), then the user.

**Why:** KB retrieval reads the DB at query time, so this validates DB content edits end-to-end after an API-server restart (restart also triggers the embedding boot backfill after nulling embedding columns).
