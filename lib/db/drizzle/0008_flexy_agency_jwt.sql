-- Flexy auth rewrite: switch from GHL Marketplace OAuth to a static Agency JWT.
-- The previous OAuth tokens table is no longer used by any code path.

ALTER TABLE "member_app_instances"
  ADD COLUMN IF NOT EXISTS "provider_staff_email" text,
  ADD COLUMN IF NOT EXISTS "provider_staff_password_encrypted" text;

DROP TABLE IF EXISTS "ghl_oauth_tokens";
