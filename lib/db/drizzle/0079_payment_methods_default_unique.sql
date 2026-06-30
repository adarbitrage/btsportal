-- NMI Tier 6.0: enforce at most one default payment method per user.
-- Idempotent — safe to re-run against an already-migrated database.

-- Step 1: Deduplicate any users that already have more than one is_default = true row.
-- Keep the most-recently-updated row as the default; clear the rest.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY updated_at DESC, id DESC
         ) AS rn
  FROM payment_methods
  WHERE is_default = true
)
UPDATE payment_methods
SET    is_default = false,
       updated_at = now()
WHERE  id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Step 2: Partial unique index — at most one default per user.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_methods_one_default_per_user"
  ON "payment_methods" (user_id)
  WHERE (is_default = true);
