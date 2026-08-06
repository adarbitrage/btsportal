-- Swipe Resource Bank (Task #2104 Phase 1): taxonomy + items.
-- Idempotent: safe to replay (CREATE TABLE IF NOT EXISTS / IF NOT EXISTS indexes).

CREATE TABLE IF NOT EXISTS "swipe_bank_verticals" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "swipe_bank_sub_verticals" (
  "id" serial PRIMARY KEY NOT NULL,
  "vertical_id" integer NOT NULL REFERENCES "swipe_bank_verticals"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "swipe_bank_sub_verticals_vertical_idx"
  ON "swipe_bank_sub_verticals" ("vertical_id");

CREATE TABLE IF NOT EXISTS "swipe_bank_angles" (
  "id" serial PRIMARY KEY NOT NULL,
  "sub_vertical_id" integer NOT NULL REFERENCES "swipe_bank_sub_verticals"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "swipe_bank_angles_sub_vertical_idx"
  ON "swipe_bank_angles" ("sub_vertical_id");

CREATE TABLE IF NOT EXISTS "swipe_bank_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "item_type" text NOT NULL,
  "sub_vertical_id" integer NOT NULL REFERENCES "swipe_bank_sub_verticals"("id") ON DELETE CASCADE,
  "angle_id" integer REFERENCES "swipe_bank_angles"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "source_label" text DEFAULT '' NOT NULL,
  "object_path" text NOT NULL,
  "thumbnail_object_path" text,
  "mime_type" text DEFAULT '' NOT NULL,
  "size_bytes" bigint DEFAULT 0 NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "swipe_bank_items_sub_vertical_idx"
  ON "swipe_bank_items" ("sub_vertical_id");
CREATE INDEX IF NOT EXISTS "swipe_bank_items_angle_idx"
  ON "swipe_bank_items" ("angle_id");
