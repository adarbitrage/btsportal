-- Native Creative Drive (Task #1943): folders (self-nesting) + files stored
-- in object storage. Written idempotently so re-running is a harmless no-op.

CREATE TABLE IF NOT EXISTS "creative_drive_folders" (
  "id"         serial PRIMARY KEY NOT NULL,
  "name"       text NOT NULL,
  "parent_id"  integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "creative_drive_folders"
    ADD CONSTRAINT "creative_drive_folders_parent_id_creative_drive_folders_id_fk"
    FOREIGN KEY ("parent_id") REFERENCES "creative_drive_folders"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "creative_drive_folders_parent_idx"
  ON "creative_drive_folders" ("parent_id");

CREATE TABLE IF NOT EXISTS "creative_drive_files" (
  "id"          serial PRIMARY KEY NOT NULL,
  "folder_id"   integer,
  "name"        text NOT NULL,
  "object_path" text NOT NULL,
  "mime_type"   text DEFAULT '' NOT NULL,
  "size_bytes"  bigint DEFAULT 0 NOT NULL,
  "sort_order"  integer DEFAULT 0 NOT NULL,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"  timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "creative_drive_files"
    ADD CONSTRAINT "creative_drive_files_folder_id_creative_drive_folders_id_fk"
    FOREIGN KEY ("folder_id") REFERENCES "creative_drive_folders"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "creative_drive_files_folder_idx"
  ON "creative_drive_files" ("folder_id");
