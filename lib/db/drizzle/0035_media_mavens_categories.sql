CREATE TABLE IF NOT EXISTS "media_mavens_categories" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "media_mavens_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_mavens_categories_display_order_idx" ON "media_mavens_categories" ("display_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_mavens_categories_is_active_idx" ON "media_mavens_categories" ("is_active");
