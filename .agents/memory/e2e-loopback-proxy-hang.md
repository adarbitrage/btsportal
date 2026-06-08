---
name: E2E loopback proxy hang on valid logins
description: Why Playwright auth calls stall and how to make them reliable in this repo
---

In `artifacts/portal` Playwright e2e specs, authenticating against the API can stall
for the request's entire timeout — but only for **successful** logins (ones that
return a `Set-Cookie`); invalid logins return fast. The stall is NOT CPU saturation
(repros at load avg ~0.15).

Root cause (confirmed by probing explicit hosts from inside the test runner):
- The dev-server (vite) proxy over the **IPv4 loopback** `127.0.0.1:<portalPort>`
  hangs on the first call. `[::1]` is refused (vite not on IPv6). `localhost` races
  both and is unreliable on the first cold call after browser launch.
- The **API server directly** at `http://127.0.0.1:8080` answers in ~100ms.
- Playwright's standalone `request` fixture is also flaky here; plain Node global
  `fetch` (undici) is reliable.

**How to apply:** For raw auth/API calls in portal e2e specs, use global `fetch`
(not the `request` fixture) and target the API server directly
(`E2E_AUTH_URL` default `http://127.0.0.1:8080`), not the proxy. The returned
access_token cookie is host-agnostic — inject it into the browser context for the
browser's `localhost` BASE_URL origin. Add a one-shot retry for cold-start. The
browser UI itself still goes through the proxy/baseURL fine.

Note: existing specs like `admin-member-unlock.spec.ts` use the proxy + `request`
fixture and exhibit the same intermittent timeout; `admin-create-staff.spec.ts`
uses the fetch+direct-API pattern instead.
