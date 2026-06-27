-- Content Access Map: one row per gated page, holding the product slugs that
-- unlock it. No row = page is open to any authenticated member. Written
-- idempotently so re-running against an already-migrated database is a no-op.

CREATE TABLE IF NOT EXISTS "content_access_map" (
  "id"            serial PRIMARY KEY NOT NULL,
  "page_key"      text NOT NULL,
  "product_slugs" jsonb NOT NULL DEFAULT '[]',
  "updated_by"    text,
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"    timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_access_map_page_key_unique" UNIQUE("page_key")
);

CREATE INDEX IF NOT EXISTS "content_access_map_page_key_idx"
  ON "content_access_map" USING btree ("page_key");
