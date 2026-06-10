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
`verify-email-recovery.spec.ts`) `test.skip()` themselves when `REDIS_URL` is
unset, because the abuse rate-limiter is a no-op without Redis. To include them,
just export `REDIS_URL` before running — it is inherited by both the API process
and the test runner:

```bash
REDIS_URL=redis://localhost:6379 pnpm --filter @workspace/portal run test:e2e
```

Start a local Redis first if you don't already have one (for example
`redis-server --daemonize yes`, or any Redis instance reachable at that URL).
Without `REDIS_URL` the suite still runs fully — the Redis-only cases simply skip
and report as skipped rather than failing.

## Running against servers you started by hand

If you already have the API (`8080`) and portal (`25265`) running yourself and
don't want Playwright to manage them, skip the auto-boot:

```bash
pnpm --filter @workspace/portal run test:e2e:manual
```

(Equivalent to setting `E2E_NO_WEBSERVER=1`.) You can also point the suite at
different origins with `E2E_BASE_URL` (portal) and `E2E_AUTH_URL` (API); the
config keeps the auto-booted ports in lockstep with those values.
