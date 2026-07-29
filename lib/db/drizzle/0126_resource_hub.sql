-- Resource Hub (Task #2028): curation layer over the existing creative-drive
-- storage + human-reviewed glossary. Idempotent so re-running is a no-op.

CREATE TABLE IF NOT EXISTS "resource_hub_items" (
  "id"              serial PRIMARY KEY NOT NULL,
  "slug"            text NOT NULL,
  "section"         text NOT NULL,
  "kind"            text NOT NULL,
  "file_id"         integer,
  "external_url"    text,
  "parent_id"       integer,
  "sub_group_label" text,
  "display_title"   text NOT NULL,
  "blurb"           text DEFAULT '' NOT NULL,
  "note_line"       text,
  "sort_order"      integer DEFAULT 0 NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"      timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "resource_hub_items"
    ADD CONSTRAINT "resource_hub_items_file_id_creative_drive_files_id_fk"
    FOREIGN KEY ("file_id") REFERENCES "creative_drive_files"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "resource_hub_items"
    ADD CONSTRAINT "resource_hub_items_parent_id_resource_hub_items_id_fk"
    FOREIGN KEY ("parent_id") REFERENCES "resource_hub_items"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "resource_hub_items_slug_unq"
  ON "resource_hub_items" ("slug");
CREATE INDEX IF NOT EXISTS "resource_hub_items_section_idx"
  ON "resource_hub_items" ("section");
CREATE INDEX IF NOT EXISTS "resource_hub_items_parent_idx"
  ON "resource_hub_items" ("parent_id");

CREATE TABLE IF NOT EXISTS "resource_hub_glossary" (
  "id"                serial PRIMARY KEY NOT NULL,
  "term"              text NOT NULL,
  "definition"        text DEFAULT '' NOT NULL,
  "status"            text DEFAULT 'draft' NOT NULL,
  "last_generated_at" timestamp with time zone,
  "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"        timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "resource_hub_glossary_term_unq"
  ON "resource_hub_glossary" ("term");
CREATE INDEX IF NOT EXISTS "resource_hub_glossary_status_idx"
  ON "resource_hub_glossary" ("status");
