-- NMI Tier 4a: payment_methods table (NMI Customer Vault saved cards)
-- Idempotent — safe to re-run against an already-migrated database.
-- vault_id is a server-side credential; it is NEVER returned to the browser.

CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "vault_id"    text NOT NULL,
  "last4"       text NOT NULL,
  "brand"       text NOT NULL,
  "exp_month"   integer NOT NULL,
  "exp_year"    integer NOT NULL,
  "is_default"  boolean NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payment_methods_user_id_idx"
  ON "payment_methods" USING btree ("user_id");
