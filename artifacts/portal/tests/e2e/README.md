# Admin end-to-end (Playwright) tests

These specs drive the real portal SPA against the real API server and the real
database. Unlike the component tests under `src/**/__tests__`, they exercise full
wiring (routes, cookies, limiter response shapes, DB side-effects).

## One command to run the whole suite

```bash
pnpm --filter @workspace/portal run test:e2e
```

That's it. The Playwright config (`playwright.config.ts`) has a `webServer`
block that automatically:

- boots the **API server** on port `8080` (`tsx ./src/index.ts`,
  `NODE_ENV=development`), and
- boots the **portal dev server** on port `25265` (`vite`),

waits for both to be reachable, runs every spec, then shuts both down. No manual
server startup needed.

### Requirements

- `DATABASE_URL` must be set — `global-setup.ts` seeds an admin + member fixture
  and `global-teardown.ts` deletes it again. (Both servers and the test runner
  inherit your shell environment, so the same `DATABASE_URL` is used everywhere.)
- The system Chromium is used on Replit/NixOS; override with
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if needed.

## Running the Redis-backed flows

A few specs (e.g. the verify-email rate-limit case in
`verify-email-recovery.spec.ts`) need a live Redis, because the abuse
rate-limiter is a no-op without it.

**This now happens automatically.** When the one-command run boots the servers
itself, it also provisions a throwaway local Redis (a `redis-server` daemon on
port `6399`, no persistence), sets `REDIS_URL` for both the auto-booted API
process and the Playwright test runner, and shuts it down when the run finishes.
So the Redis-gated specs execute on a default run — no manual setup:

```bash
pnpm --filter @workspace/portal run test:e2e
```

The auto-provisioning is best-effort. If Redis can't be located or started
(e.g. `redis-server` isn't installed, or the port is taken), the run continues
and the Redis-only specs fall back to skipping cleanly rather than failing.

Knobs:

- `REDIS_URL=redis://host:port …` — point the suite at an existing Redis
  instead of provisioning one. The given instance is used as-is.
- `E2E_REDIS_PORT=6400 …` — change the port used for the provisioned Redis
  (default `6399`).
- `E2E_NO_REDIS=1 …` — disable auto-provisioning entirely; the Redis-gated
  specs then skip (unless you also set `REDIS_URL`).

## Running against servers you started by hand

If you already have the API (`8080`) and portal (`25265`) running yourself and
don't want Playwright to manage them, skip the auto-boot:

```bash
pnpm --filter @workspace/portal run test:e2e:manual
```

(Equivalent to setting `E2E_NO_WEBSERVER=1`.) You can also point the suite at
different origins with `E2E_BASE_URL` (portal) and `E2E_AUTH_URL` (API); the
config keeps the auto-booted ports in lockstep with those values.
