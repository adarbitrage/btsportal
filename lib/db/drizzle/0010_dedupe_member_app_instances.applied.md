# 0010_dedupe_member_app_instances — production verification

This project uses `drizzle-kit push`, which only syncs schema (not data),
so the data-cleanup portion of `0010_dedupe_member_app_instances.sql` does
not get applied automatically. This note records the production state of
the cleanup so the work has an in-repo audit trail.

## Verification

Verified against the production database (read-only replica, served via
the platform's `executeSql({ environment: "production" })` interface) on
**2026-04-28T23:33:08Z**. Replication lag was not separately measured;
because the verified state is a *steady-state* property (no duplicates
present and the unique constraint exists), even an arbitrarily lagged
replica that reports zero duplicates implies the primary has zero
duplicates as well — the unique constraint would have rejected any new
duplicate write since at least the snapshot the replica has caught up to.

### 1. Zero `(user_id, app_name)` duplicates

```sql
SELECT user_id, app_name, COUNT(*) AS dup_count
FROM member_app_instances
GROUP BY user_id, app_name
HAVING COUNT(*) > 1
ORDER BY user_id, app_name;
```

Result: **0 rows.**

### 2. Unique constraint present

```sql
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.member_app_instances'::regclass
  AND contype = 'u';
```

Result:

```
conname                                | definition
member_app_instances_user_app_unique   | UNIQUE (user_id, app_name)
```

Backing index:

```
member_app_instances_user_app_unique
  CREATE UNIQUE INDEX member_app_instances_user_app_unique
    ON public.member_app_instances USING btree (user_id, app_name)
```

### 3. Originally-affected row (`user_id=11`, `app_name='flexy'`)

```sql
SELECT id, user_id, app_name, status,
       provider_staff_user_id, provider_location_id, updated_at
FROM member_app_instances
WHERE user_id = 11 AND app_name = 'flexy';
```

Result: **0 rows.** No remaining duplicates or stub rows for this pair, so
the admin Flexy lookup at `/api/admin/apps/flexy/lookup/11` will return a
clean "no install" result rather than the previous HTTP 500 caused by the
duplicate guard in `findMemberAppInstance`
(`artifacts/api-server/src/lib/member-app-instance-lookup.ts`).

## Outcome

All three acceptance criteria from the task are satisfied. The migration's
data-cleanup CTE and the idempotent `DO $$ ... $$` constraint-add block
would both be no-ops in production at this point, since:

- there are no duplicate `(user_id, app_name)` rows for the CTE to delete,
  and
- the `member_app_instances_user_app_unique` UNIQUE constraint already
  exists, so the `ALTER TABLE ... ADD CONSTRAINT` inside the `DO $$` block
  is short-circuited by the `IF NOT EXISTS` guard.

The migration file is intentionally retained in
`lib/db/drizzle/0010_dedupe_member_app_instances.sql` so any future
environment that still has the duplicate state can run it safely.
