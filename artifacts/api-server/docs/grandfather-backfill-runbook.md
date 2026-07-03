# Grandfather backfill runbook (Task #1643, TB2)

Marks every member who existed before the tiered onboarding flow (Task #1640)
as `onboardingComplete = true` + `grandfathered = true`, so no pre-existing
member is ever routed into the new onboarding wizard. One-time and idempotent
— it can only ever execute once, guarded by a `system_settings` marker row
(`grandfather_backfill_completed_at`).

No expected counts are stated anywhere in this runbook. The dev DB drifts
continuously with test activity and production is a completely different
dataset — always read the LIVE numbers a pre-flight report gives you, don't
compare them against a number from a prior run or environment.

## Sequence: report → confirm → execute

### 1. Deploy

Ship this change (the `grandfathered` column + the backfill logic) normally.
Deploying does **not** write anything by itself — the boot hook only ever
*reports*, never executes, until explicitly armed (step 3 below).

### 2. Read the pre-flight report

On every boot, until the backfill has run, the server logs a live report to
the deploy log that looks like:

```
[GrandfatherBackfill] Pre-flight report (live counts, nothing written):
[GrandfatherBackfill]   free_frontend / complete: <n>
[GrandfatherBackfill]   launchpad / mid_flight: <n>
[GrandfatherBackfill]   3month_plus / not_started: <n>
...
[GrandfatherBackfill] TOTAL that would be marked complete + grandfathered: <n>
[GrandfatherBackfill] Not armed — waiting for an admin to PUT /admin/settings/grandfather_backfill_armed ...
```

Check the production deployment logs after the deploy in step 1 finishes and
read this report. Buckets are tier (`free_frontend` / `launchpad` /
`3month_plus`, by highest active product rank) x onboarding state
(`not_started` / `mid_flight` / `complete`).

If the total is 0, STOP — do not arm. A 0 total on a production database with
real members means the bucket query is broken (e.g. mis-pointed at the wrong
database), not that there is nothing to do.

### 3. Confirm (arm it)

Once the reported counts look right, an admin with `settings:manage` arms the
backfill via the existing generic settings endpoint:

```
PUT /admin/settings/grandfather_backfill_armed
{ "value": true, "category": "onboarding" }
```

This alone does **not** execute anything — it only flips the flag the boot
hook checks on its *next* boot.

### 4. Execute

Restart/redeploy the app (or otherwise trigger another boot). On that boot,
the hook sees `grandfather_backfill_armed = true` and the marker still absent,
so it executes: every currently-ungrandfathered member is set
`onboardingComplete = true`, `grandfathered = true`, and the
`grandfather_backfill_completed_at` marker is written. The deploy log will
show:

```
[GrandfatherBackfill] Armed — executing now.
[GrandfatherBackfill] Grandfathered <n> pre-existing member(s): onboardingComplete=true, grandfathered=true.
```

From this point on, the backfill can never run again — the marker blocks it
on every future boot, even if `grandfather_backfill_armed` is left `true`.

### 5. Post-run verification

Run read-only queries against production (see the `database` skill,
production environment) to confirm:

```sql
-- Should be 0: no pre-existing (now-grandfathered) member sitting in onboarding.
SELECT COUNT(*) FROM users WHERE grandfathered = true AND onboarding_complete = false;

-- Sanity: how many were grandfathered, split by tier bucket is only available
-- via the pre-flight report at the time it ran (see the deploy log from step 4).
SELECT COUNT(*) FROM users WHERE grandfathered = true;

-- Should be 0: the backfill is scoped to role='member' only. Admins, coaches,
-- and partner staff must never be stamped grandfathered.
SELECT COUNT(*) FROM users WHERE grandfathered = true AND role <> 'member';
```

Also spot-check that a fresh signup created **after** step 4 is NOT
grandfathered and correctly enters (or skips) onboarding per its resolved
tier — see `applyCreationTimeOnboardingDefaults` in `lib/onboarding-variant.ts`.

## Alternative: manual CLI invocation

If you have direct `DATABASE_URL` access to an environment (e.g. dev, or a
one-off maintenance shell with the production `DATABASE_URL` set), the same
report → confirm → execute sequence can be run directly instead of via the
armed boot hook:

```bash
# Pre-flight only — writes nothing.
pnpm --filter @workspace/api-server run grandfather-backfill:preflight

# Execute — only after reviewing the pre-flight output above.
pnpm --filter @workspace/api-server run grandfather-backfill:execute
```
