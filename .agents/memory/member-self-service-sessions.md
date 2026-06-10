---
name: Member self-service active-device sessions
description: How members list/revoke their own sessions on /account, and why current-session detection works via the refresh cookie.
---

# Member-facing active devices ("Where you're signed in")

Members manage their own active sessions on the portal `/account` page, reusing
the same `sessions` table/columns as the admin device feature.

## Current-session detection hinges on cookie path scoping
**Rule:** The endpoints flag/spare the caller's *current* device by hashing the
`refresh_token` cookie (sha256) and matching it against `refreshTokenHash`. This
only works because the `refresh_token` cookie is scoped to path `/api/auth`, so
it IS sent to `/api/auth/sessions*`. The JWT `access_token` authenticates
(sets `req.userId`); the refresh cookie is used solely to identify "this device".

**Why:** Without the refresh cookie there is no way to tell which session row is
the browser making the request. `revoke-others` returns **400** when the refresh
cookie is absent (can't safely decide what to keep); the list endpoint just marks
nothing as current.

**How to apply:** If you ever move/rename the refresh cookie or change its path,
member current-session detection and "sign out everywhere except this device"
silently break. Keep the path at `/api/auth`.

## Conventions
- Member routes live in `artifacts/api-server/src/routes/auth.ts` (after `/auth/me`)
  and use the generated `@workspace/api-client-react` hooks (orval from
  `lib/api-spec/openapi.yaml`). Admin equivalents use hand-written
  `admin-panel-api.ts` — different client, don't conflate.
- No audit logging for member self-service (member acting on own account);
  admin revokes DO log via `logAdminAction`. Intentional asymmetry.
- Portal Account unit tests `vi.mock("@workspace/api-client-react", ...)` with an
  explicit allow-list of hooks — adding a new hook to Account.tsx REQUIRES adding
  it to every Account test mock or those tests crash at render.
