-- Flexy app provisioning via GoHighLevel agency Marketplace OAuth.
-- Note: this project syncs schema via `drizzle-kit push`; this file is an
-- audit-trail companion to the schema changes in
-- lib/db/src/schema/member-app-instances.ts and ghl-oauth-tokens.ts.

ALTER TABLE "member_app_instances"
  ADD COLUMN IF NOT EXISTS "provider_location_id" text,
  ADD COLUMN IF NOT EXISTS "provider_staff_user_id" text;

CREATE TABLE IF NOT EXISTS "ghl_oauth_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "scope" text NOT NULL DEFAULT 'agency',
  "company_id" text,
  "location_id" text,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "user_type" text,
  "scopes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by_id" integer
);

CREATE UNIQUE INDEX IF NOT EXISTS "ghl_oauth_tokens_scope_unique"
  ON "ghl_oauth_tokens" ("scope");
