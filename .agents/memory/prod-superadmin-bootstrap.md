---
name: Prod super_admin bootstrap deadlock
description: How the first super_admin is minted in production, and why a dedicated endpoint exists for it.
---

# Production super_admin bootstrap

Production runs a **separate database** from dev (far fewer real users, and it
started with **zero** super_admins). `executeSql` against production is
read-only, so you cannot INSERT a super_admin from the tooling.

There is a chicken-and-egg deadlock: the in-app role-assignment endpoint is
itself super_admin-only, so with zero super_admins nothing in the running app
can create the first one.

**Resolution:** `POST /api/integrations/bootstrap-superadmin` (in
`artifacts/api-server/src/routes/integrations.ts`) mints the FIRST super_admin.

**Why it's safe to expose:**
- Gated by the machine shared secret (`MACHINE_PORTAL_SHARED_SECRET`, timing-safe
  compare via `verifyMachineSecret`) — added to `PUBLIC_PATHS` in
  `middleware/auth.ts` because it's secret-gated, not JWT-gated.
- **Self-disabling:** returns 409 `ALREADY_BOOTSTRAPPED` the instant any
  super_admin row exists. It can only ever create the very first one.
- Check+write run inside a transaction with `pg_advisory_xact_lock` to kill the
  TOCTOU race (two concurrent calls both seeing 0 super_admins).
- **Insert-only:** if the email already exists it returns 409 `EMAIL_EXISTS`
  rather than resetting a real account's password/role (avoids takeover on typo).

**How to apply:** must be **published/deployed** before it can run against prod
(the route lives in the api-server). After the first super_admin exists it is
inert; it can be removed in a follow-up publish if desired.
