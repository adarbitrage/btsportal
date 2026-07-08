-- Task: ground KB truth docs in current portal navigation.
-- Nav-map version stamp on synthesized drafts + stored nav-map snapshots for
-- the boot-time drift scan. Idempotent companion to the drizzle-kit push.
ALTER TABLE "kb_staging_docs" ADD COLUMN IF NOT EXISTS "nav_map_version" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_nav_map_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_nav_map_versions_version_unique" UNIQUE("version")
);
