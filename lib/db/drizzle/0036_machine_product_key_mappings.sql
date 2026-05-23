-- Tables backing the machine-purchase receiver's portal_product_keys → portal
-- slug translation layer. See:
--   - lib/db/src/schema/machine-product-key-mappings.ts
--   - lib/db/src/schema/machine-unknown-product-keys.ts
--   - artifacts/api-server/src/lib/machine-product-key-mappings.ts
--   - artifacts/api-server/src/routes/integrations.ts (machine-purchase route)
--
-- Each statement is idempotent so re-running this script against an already-
-- migrated database is a safe no-op. `pnpm --filter db push` against the
-- drizzle schema declaration produces an equivalent result; this file exists
-- to record the exact statements that were applied for audit.

BEGIN;

CREATE TABLE IF NOT EXISTS "machine_product_key_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "machine_key" text NOT NULL,
  "portal_slug" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "machine_product_key_mappings_machine_key_unique" UNIQUE ("machine_key")
);

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
  "dismissed_by" text,
  CONSTRAINT "machine_unknown_product_keys_machine_key_unique" UNIQUE ("machine_key")
);

CREATE INDEX IF NOT EXISTS "machine_unknown_product_keys_last_seen_at_idx"
  ON "machine_unknown_product_keys" ("last_seen_at");

CREATE INDEX IF NOT EXISTS "machine_unknown_product_keys_dismissed_at_idx"
  ON "machine_unknown_product_keys" ("dismissed_at");

COMMIT;
