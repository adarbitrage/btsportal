---
name: e2e shared-redis login rate-limit (429)
description: Why repeated local portal e2e runs start failing login with HTTP 429, and how to clear it.
---

Portal Playwright e2e (`test:e2e`) uses `reuseExistingServer: true`, so it REUSES the
already-running `artifacts/api-server: API Server` workflow on PORT 8080 instead of
booting a fresh one. That workflow is wired to the persistent Upstash `REDIS_URL`.

**Symptom:** after several manual e2e runs in a row, logins start returning HTTP 429.
The per-IP login limiter (≈20 attempts / 15 min, all from 127.0.0.1) accumulates across
runs because the rate-limit state lives in shared Upstash, not in an ephemeral test DB.

**Why:** the limiter keys are `abuse-rate:login:*`. Real CI boots its own isolated
api-server/redis, so it never trips this — it only bites repeated local reruns.

**How to clear:** read `REDIS_URL` from the running api-server process env
(`/proc/<api pid>/environ`) — do NOT print it — and `redis-cli ... DEL` the
`abuse-rate:login:*` keys. Then rerun.

**Aside:** a full e2e run is ~1.5–1.7 min, which exceeds the 120s bash cap. Run it with
output redirected to a log file and read the log, rather than relying on the inline
return.
