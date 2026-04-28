# Flexy auto-login (one-time login URL) verification

## TL;DR

**GoHighLevel does not expose a public "log in as user" endpoint.** We
verified this end-to-end against the live Cherrington agency in April 2026.
The `mintFlexyLoginUrl` helper in `src/lib/ghl-agency-client.ts` is therefore
disabled by default (`GHL_LOGIN_TOKEN_PATH` defaults to `""`), and every
"Open Flexy" click falls through to the white-label Flexy login page exactly
as it did before this work.

The plumbing is left in place so that if GHL ever ships such an endpoint, an
operator can drop in `GHL_LOGIN_TOKEN_PATH=/users/{userId}/whatever` and the
mint will start working without a code change.

## Decision (April 2026)

**We will keep showing the white-label Flexy login page to members
indefinitely. We will NOT pursue any non-API auto-login workaround.**

Concretely this means:

1. `mintFlexyLoginUrl` stays disabled by default (`GHL_LOGIN_TOKEN_PATH=""`).
   `resolveFlexyOpenUrl` returns the standard portal URL, and the member
   types their email + password (or uses Flexy's "Forgot password" flow on
   first open) on the white-label login page. Subsequent clicks are silent
   because GHL sets a session cookie on `dashboard.getflexy.app`.
2. We will NOT persist the GHL staff password (the
   `providerStaffPasswordEncrypted` column stays null on every install),
   and we will NOT add a "regenerate password on every open" cycle. See the
   tradeoffs below.
3. The "Hide the Flexy email panel..." follow-up is **superseded by this
   decision**: members need a way to know which email to log in with, so the
   `GET /apps/flexy/credentials` endpoint stays, and any future Flexy card
   UI work should surface the staff email (read-only — no password column).
4. Re-probe trigger: this decision is revisited if any future run of
   `probe-flexy-sso.ts` / `probe-flexy-sso2.ts` returns a `200`/`201`
   response, OR if GoHighLevel publishes a "log in as user" / "mint
   one-time login URL" endpoint in their public API changelog. Operators
   should re-run both scripts after every GHL release notes update that
   touches the Users API or the agency dashboard.

### Why we rejected each non-API alternative

| Option | Rejected because |
| --- | --- |
| Persist the GHL staff password at provision time and replay it via a hidden form post against `dashboard.getflexy.app/login` | (a) Requires storing GHL passwords plaintext-recoverable; we deliberately do not. (b) Breaks the moment a member changes their password inside Flexy. (c) The GHL login page is a SPA that POSTs JSON to an internal endpoint with CSRF/session protections — a static form replay would not survive the next frontend release. (d) Almost certainly violates GHL's ToS for white-label integrations. |
| Generate a fresh password on every "Open" click and rotate via `updateStaffUserPassword`, then auto-fill it | (a) Every click silently invalidates the password the member is using inside Flexy at that moment, breaking their own session if they have one open. (b) Race condition between rotate-and-redirect: there is no atomic "log in as this newly-set password" step. (c) Same SPA fragility as the form-replay option. |
| Reuse the agency JWT's `firebaseToken` against `services.msgsndr.com` | The current decoded `GHL_CHERRINGTON_AGENCY_JWT` does not contain a `firebaseToken` field (`hasFirebase=false`). Even if we re-extracted one from the agency dashboard cookies, it would be short-lived, tied to a specific operator session, and rotates on every agency login — not safe for production. |
| Scrape / drive the GHL agency UI server-side (puppeteer, etc.) | Brittle, slow, defeats the purpose of "click and land", and explicitly against GHL's ToS. |

### What "good" UX looks like under this decision

- The Flexy card on the member-facing Apps page should display the member's
  Flexy email next to the **Open** button (read-only, with a copy button),
  with a one-line hint: *"First time opening Flexy? Click 'Forgot
  password' on the Flexy login screen to set your password."*
- After the first successful login, the GHL session cookie carries the
  member; subsequent **Open** clicks land directly in the dashboard.
- No password is ever surfaced or persisted by the BTS portal.

This UX work is intentionally **not** done in this task — it lives in the
existing "Hide the Flexy email panel..." / Apps-card-polish task, which
this decision unblocks.

## What we tried

We probed every plausible path against a real installed Flexy staff user
on the Cherrington agency (specific staff user id and location id are
intentionally not recorded here — pull them from the DB at re-probe time
via `member_app_instances.providerStaffUserId` /
`providerLocationId` for any installed Flexy member). Both the
company-scoped OAuth JWT and the agency `apiKey` were tried as the bearer
where applicable.

### `services.leadconnectorhq.com` (v2 Marketplace API, `Version: 2021-07-28`)

| Method | Path                                        | Body                              | Result |
| ------ | ------------------------------------------- | --------------------------------- | ------ |
| POST   | `/users/{id}/login-token`                   | `{companyId, locationId}`         | 404    |
| POST   | `/users/{id}/login-token`                   | none                              | 404    |
| GET    | `/users/{id}/login-token`                   | —                                 | 404    |
| POST   | `/users/{id}/login`                         | `{companyId, locationId}`         | 404    |
| GET    | `/users/{id}/login`                         | —                                 | 404    |
| POST   | `/users/{id}/login-link`                    | `{companyId, locationId}`         | 404    |
| GET    | `/users/{id}/login-link`                    | —                                 | 404    |
| POST   | `/users/{id}/login-as`                      | `{companyId, locationId}`         | 404    |
| POST   | `/oauth/locationToken`                      | `{companyId, locationId}`         | 400 — *exists but wrong shape* |
| POST   | `/users/login-token`                        | `{companyId, locationId, userId}` | 404    |

`/oauth/locationToken` is the only adjacent endpoint that actually exists —
but it mints a backend-API JWT for the sub-account, not a browser session.
Calling it with the browser would not authenticate the user; it would just
hand them an API token.

### `services.msgsndr.com` (legacy app backend, agency `apiKey` Bearer)

All variants of `/users/{id}/login-token`, `/users/{id}/loginAsUser`, and
`/users/login-as` returned `404`.

### `rest.gohighlevel.com` (v1 API, agency `apiKey` Bearer)

```
GET /v1/users/{id} -> 401
{"msg":"Unauthorized, Switch to the new API token."}
```

The v1 API has been retired for company-scoped agency keys; the new keys
must use v2.

### `backend.leadconnectorhq.com`

`/users/{id}/login-token` → `404`.

## Reproducing

The probe scripts are checked in so this can be re-run after any GHL API
update without recreating them:

```bash
# Probes the v2 Marketplace API + /oauth/locationToken
pnpm --filter @workspace/api-server exec tsx \
  src/scripts/probe-flexy-sso.ts

# Probes services.msgsndr.com, rest.gohighlevel.com (v1), backend.leadconnectorhq.com
pnpm --filter @workspace/api-server exec tsx \
  src/scripts/probe-flexy-sso2.ts
```

Both scripts require explicit `STAFF_USER_ID` and `LOCATION_ID` env vars
(no production defaults — this is intentional so a re-run can't accidentally
target a real member without operator awareness):

```bash
STAFF_USER_ID=... LOCATION_ID=... pnpm --filter @workspace/api-server \
  exec tsx src/scripts/probe-flexy-sso.ts
```

Get a usable pair from the DB:

```sql
SELECT user_id, provider_staff_user_id, provider_location_id
FROM member_app_instances
WHERE app_name = 'flexy' AND status = 'installed'
LIMIT 1;
```

A non-404 (`200` or `201`) response from any future probe means GHL has
shipped an endpoint — set `GHL_LOGIN_TOKEN_PATH` to the working path
template (use `{userId}` as the staff user id placeholder) and Flexy
auto-login will start working in production immediately.

## Why we didn't fix this another way

See the "Decision (April 2026)" section at the top of this document for the
full rationale and the per-option rejection table.
