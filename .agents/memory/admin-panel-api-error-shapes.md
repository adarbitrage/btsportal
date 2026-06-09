---
name: Admin-panel-api error shapes
description: Why admin toasts showed "[object Object]" and how the client must parse two different API error body shapes.
---

The API returns error bodies in two different shapes:

- Route-level handlers (e.g. `POST /admin/members`, `/admin/staff` catch blocks)
  return a **string** under `error`: `{ error: "Failed to create member" }`.
- The shared `sendError` helper (`api-server/src/lib/api-errors.ts`) — used by the
  RBAC `requirePermission` middleware (`middleware/rbac.ts`) and the global
  `apiErrorHandler` — returns an **object**: `{ error: { code, message, requestId, details? } }`.

The portal client (`portal/src/lib/admin-panel-api.ts`) used to do
`throw new Error(data?.error || "...")`. When the failure came from the RBAC/sendError
layer (401 expired session, 403 insufficient permission), `data.error` was an object,
so `new Error(object)` produced the message `"[object Object]"` — which is exactly the
red toast users saw when an admin action was rejected at the auth gate.

**Fix / rule:** never read `data.error` as a string directly. Use `extractApiError(data)`
(added at top of admin-panel-api.ts) which handles both shapes (`error` string OR
`error.message`). Any new admin-panel-api method that surfaces an error must use it.

**How to apply:** if a swallowed/"[object Object]" admin error reappears, the culprit is
a call site reading `data.error` without `extractApiError`, hitting a sendError-shaped
response (almost always an auth/permission rejection, not the route body itself).
