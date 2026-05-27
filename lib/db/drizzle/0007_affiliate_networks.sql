-- Companion migration for `affiliate_networks`. The project syncs schema via
-- `drizzle-kit push`; this file exists to record the exact statements that
-- were applied for audit and to give operators a transactional script.
--
-- Idempotent: every CREATE has an IF NOT EXISTS guard, the UNIQUE constraint
-- is wrapped in a DO block, and the seed INSERT uses ON CONFLICT DO NOTHING,
-- so the file is safe to re-run against a DB created via `drizzle-kit push`
-- or against one that already has prior seed rows. Shares idx 0007 with
-- 0007_flexy_ghl_oauth.sql, which is independently idempotent.

CREATE TABLE IF NOT EXISTS "affiliate_networks" (
        "id" serial PRIMARY KEY NOT NULL,
        "slug" text NOT NULL,
        "name" text NOT NULL,
        "tagline" text DEFAULT '' NOT NULL,
        "description" text DEFAULT '' NOT NULL,
        "logo_url" text,
        "logo_bg" text DEFAULT 'bg-white' NOT NULL,
        "highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "publishers" text DEFAULT '' NOT NULL,
        "approval_label" text DEFAULT '' NOT NULL,
        "recommended_for_beginners" boolean DEFAULT false NOT NULL,
        "accent_preset" text DEFAULT 'emerald' NOT NULL,
        "accent_border" text DEFAULT 'border-emerald-300' NOT NULL,
        "accent_badge_bg" text DEFAULT 'bg-emerald-50' NOT NULL,
        "accent_badge_text" text DEFAULT 'text-emerald-800' NOT NULL,
        "accent_badge_border" text DEFAULT 'border-emerald-200' NOT NULL,
        "register_url" text,
        "login_url" text,
        "extra_cta_label" text,
        "extra_cta_href" text,
        "extra_cta_style" text DEFAULT 'default' NOT NULL,
        "display_order" integer DEFAULT 0 NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
        ALTER TABLE "affiliate_networks"
                ADD CONSTRAINT "affiliate_networks_slug_unique" UNIQUE ("slug");
EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN duplicate_table  THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "affiliate_networks_display_order_idx" ON "affiliate_networks" USING btree ("display_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "affiliate_networks_is_active_idx" ON "affiliate_networks" USING btree ("is_active");
--> statement-breakpoint
INSERT INTO "affiliate_networks" ("slug","name","tagline","description","logo_url","logo_bg","highlights","publishers","approval_label","recommended_for_beginners","accent_preset","accent_border","accent_badge_bg","accent_badge_text","accent_badge_border","extra_cta_label","extra_cta_href","extra_cta_style","display_order","is_active") VALUES
  ('media-mavens','Media Mavens','Our own in-house curated network — designed specifically for this system.','If you''re brand new, start here. Media Mavens is our in-house network, built specifically for the Build Test Scale system, which gives you several real advantages over public marketplaces right from the start. Simple to sign up — no approval required.','/logos/media-mavens.png','bg-white','["Higher commissions than comparable products on other networks","No chargebacks — if a customer returns a product, you keep your commission","Pre-made advertorials (landing pages) for many products — meaning less work to get started","Works with all three ad publishers (Caterpillar, Grasshopper, Crane)"]','Caterpillar, Grasshopper, Crane','Instant signup',true,'emerald','border-emerald-300','bg-emerald-50','text-emerald-800','border-emerald-200','View Products','/media-mavens','emerald',0,true),
  ('clickbank','ClickBank','A large public marketplace with thousands of products to promote.','The next easiest entry point after Media Mavens. ClickBank is a large public marketplace — simple to sign up, no approval required. You''ll create your own landing pages using the product''s video as your source material.','/logos/clickbank.jpg','bg-white','["Instant signup — no approval required","Thousands of products across many verticals","Works with Caterpillar and Grasshopper publishers","Requires building your own jump pages from scratch"]','Caterpillar, Grasshopper','Instant signup',false,'amber','border-amber-300','bg-amber-50','text-amber-800','border-amber-200',NULL,NULL,'default',1,true),
  ('affiliati','Affiliati','A curated network with many strong offers.','Affiliati is a curated network with many strong offers. It requires account approval and proof of revenue generated from previous affiliate campaigns before you can get started. Please check with a coach before attempting to apply for an Affiliati account.','/logos/affiliati.png','bg-white','["Requires account approval and proof of revenue from previous affiliate campaigns","Check with a coach before applying","Pre-made advertorials available for select products","Works with Caterpillar and Grasshopper publishers"]','Caterpillar, Grasshopper','Approval + proof of revenue',false,'violet','border-violet-300','bg-violet-50','text-violet-800','border-violet-200',NULL,NULL,'default',2,true),
  ('maxweb','MaxWeb','A curated network with quality offers.','MaxWeb is a curated network with quality offers. It requires account approval and proof of revenue generated from previous affiliate campaigns before you can get started. Please check with a coach before attempting to apply for a MaxWeb account.','/logos/maxweb.jpg','bg-white','["Requires account approval and proof of revenue from previous affiliate campaigns","Check with a coach before applying","Dedicated Account Representative listed on your MaxWeb Dashboard once approved","Works with Caterpillar and Grasshopper publishers"]','Caterpillar, Grasshopper','Approval + proof of revenue',false,'orange','border-orange-300','bg-orange-50','text-orange-800','border-orange-200',NULL,NULL,'default',3,true)
ON CONFLICT ("slug") DO NOTHING;
