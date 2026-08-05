-- Grandfather audit marker column. (The one-time backfill that wrote it was
-- retired unrun in Aug 2026 — pre-launch, nothing to grandfather.)
-- Additive column: idempotent, safe on a fresh or already-migrated DB.
-- Defaults to false; nothing writes it true anymore (the retired backfill
-- would have set it for members pre-dating the tiered onboarding contract).

ALTER TABLE users ADD COLUMN IF NOT EXISTS grandfathered boolean NOT NULL DEFAULT false;
