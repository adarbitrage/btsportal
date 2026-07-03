-- Task #1640: onboarding tier resolver (none/launchpad/full).
-- Additive column: idempotent, safe on a fresh or already-migrated DB.
-- Defaults to 'full' so every pre-existing member (who predates this
-- column) keeps the unchanged legacy 6-step flow.

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_variant text NOT NULL DEFAULT 'full';
