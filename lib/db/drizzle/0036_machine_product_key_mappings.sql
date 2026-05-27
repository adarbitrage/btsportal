-- Tables backing the machine-purchase receiver's portal_product_keys → portal
-- slug translation layer. See:
--   - lib/db/src/schema/machine-product-key-mappings.ts
--   - lib/db/src/schema/machine-unknown-product-keys.ts
--   - artifacts/api-server/src/lib/machine-product-key-mappings.ts
--   - artifacts/api-server/src/routes/integrations.ts (machine-purchase route)
--
-- Idempotent: tables and indexes use IF NOT EXISTS, and the UNIQUE
-- constraints are added via DO blocks so they are attached even when the
-- table already exists from `drizzle-kit push`. Shares idx 0036 with
-- 0036_member_app_instances_refresh_check_constraints.sql, which touches
-- disjoint objects.

BEGIN;

CREATE TABLE IF NOT EXISTS "machine_product_key_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "machine_key" text NOT NULL,
  "portal_slug" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text
);

DO $$ BEGIN
  ALTER TABLE "machine_product_key_mappings"
    ADD CONSTRAINT "machine_product_key_mappings_machine_key_unique" UNIQUE ("machine_key");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "machine_product_key_mappings_portal_slug_idx"
  ON "machine_product_key_mappings" ("portal_slug");

CREATE TABLE IF NOT EXISTS "machine_unknown_product_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "machine_key" text NOT NULL,
  "occurrences" integer DEFAULT 1 NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_external_order_id" text,
  "last_external_source" text,
  "dismissed_at" timestamp with time zone,
  "dismissed_by" text
);

DO $$ BEGIN
  ALTER TABLE "machine_unknown_product_keys"
    ADD CONSTRAINT "machine_unknown_product_keys_machine_key_unique" UNIQUE ("machine_key");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "machine_unknown_product_keys_last_seen_at_idx"
  ON "machine_unknown_product_keys" ("last_seen_at");

CREATE INDEX IF NOT EXISTS "machine_unknown_product_keys_dismissed_at_idx"
  ON "machine_unknown_product_keys" ("dismissed_at");

COMMIT;
