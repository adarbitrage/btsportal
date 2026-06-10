---
name: e2e one-command runner
description: How the admin Playwright e2e suite self-boots its API + portal, and the constraints that must hold.
---

# Admin e2e one-command runner

`pnpm --filter @workspace/portal run test:e2e` now boots everything itself via a
Playwright `webServer` array in `artifacts/portal/playwright.config.ts`:
the API server on **8080** (`tsx ./src/index.ts`) and the portal dev server on
**25265** (`vite`). No manual server startup is needed.

## Constraints (don't break these)

- **Three places share the ports** and must stay in lockstep: the `webServer`
  block (config), the vite `/api` proxy target (`vite.config.ts` → 8080), and
  `tests/e2e/auth.ts` (`AUTH_URL` 8080 / `E2E_BASE_URL` 25265). The config now
  derives the ports from `E2E_AUTH_URL` / `E2E_BASE_URL` so overrides stay in sync.
- **Run the API in `NODE_ENV=development`, never production.** The auth route
  only sets the `secure` flag on the login cookie under production; the e2e auth
  helper injects that cookie over plain http, so production mode silently drops
  it and every login-gated spec fails.
- `reuseExistingServer: true` — if you already have servers on those ports they
  are reused. `E2E_NO_WEBSERVER=1` (script `test:e2e:manual`) skips auto-boot
  entirely.

## Redis-backed flows

Some specs `test.skip()` when `REDIS_URL` is unset (abuse limiter is a no-op
without Redis). Export `REDIS_URL` before the command — it's inherited by both
the API process and the test runner. Without it the GHL worker logs harmless
`ECONNREFUSED 127.0.0.1:6379` chatter; ignore it.

## Validating in this environment

The Replit tool sandbox reaps detached/background processes at call boundaries
and caps bash at 120s, so a full self-booting run can't finish inside one bash
call. Cold boot alone (pnpm + tsx compile of the whole API + vite + browser) eats
much of that. To confirm auto-boot, launch detached and poll the log across
calls — you'll see "Server listening on port 8080", vite "ready", then
"Running N test(s)". Usage notes live in `artifacts/portal/tests/e2e/README.md`.
