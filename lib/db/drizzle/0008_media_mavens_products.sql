-- Companion migration for `media_mavens_products`. The project syncs schema
-- via `drizzle-kit push`; this file exists for audit / manual replay.
--
-- Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS and the UNIQUE
-- constraint is added via a DO block, so the file is safe to re-run against
-- a DB created via `drizzle-kit push` or against one that already has the
-- table from a prior run. Shares idx 0008 with 0008_flexy_agency_jwt.sql,
-- which touches disjoint objects and is independently idempotent.

CREATE TABLE IF NOT EXISTS "media_mavens_products" (
        "id" serial PRIMARY KEY NOT NULL,
        "slug" text NOT NULL,
        "name" text NOT NULL,
        "tagline" text DEFAULT '' NOT NULL,
        "category" text DEFAULT 'Health' NOT NULL,
        "image_url" text,
        "description" text DEFAULT '' NOT NULL,
        "cost_to_consumer" text DEFAULT '' NOT NULL,
        "affiliate_commission" text DEFAULT '' NOT NULL,
        "sales_page_url" text DEFAULT '' NOT NULL,
        "logo_drive_url" text DEFAULT '' NOT NULL,
        "affiliate_link" text DEFAULT '' NOT NULL,
        "display_order" integer DEFAULT 0 NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
        ALTER TABLE "media_mavens_products"
                ADD CONSTRAINT "media_mavens_products_slug_unique" UNIQUE ("slug");
EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN duplicate_table  THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_mavens_products_display_order_idx" ON "media_mavens_products" USING btree ("display_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_mavens_products_is_active_idx" ON "media_mavens_products" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_mavens_products_category_idx" ON "media_mavens_products" USING btree ("category");
