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

A few non-API approaches were considered and rejected:

- **Persist and replay the staff password.** Possible but would require
  storing GHL passwords (we deliberately don't) and would break if a member
  ever changes their password in Flexy.
- **Reuse the agency JWT's `firebaseToken`.** The current decoded JWT does
  not include one (`hasFirebase=false`).
- **Scrape the GHL agency UI.** Brittle and against ToS.

The pragmatic outcome is: keep the email/password panel visible so members
can copy their email and use Flexy's "Forgot password" flow on first login,
which is exactly what the existing UI already does.
