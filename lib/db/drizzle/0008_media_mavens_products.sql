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
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "media_mavens_products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_mavens_products_display_order_idx" ON "media_mavens_products" USING btree ("display_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_mavens_products_is_active_idx" ON "media_mavens_products" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_mavens_products_category_idx" ON "media_mavens_products" USING btree ("category");
