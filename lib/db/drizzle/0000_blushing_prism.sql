CREATE TABLE "tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"level" integer NOT NULL,
	"price_monthly" numeric(10, 2) NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb,
	"max_support_tickets" integer DEFAULT 3 NOT NULL,
	"call_access_level" text DEFAULT 'weekly_qa' NOT NULL,
	CONSTRAINT "tiers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"phone" text,
	"timezone" text DEFAULT 'America/New_York',
	"role" text DEFAULT 'member' NOT NULL,
	"source_product" text,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verify_token" text,
	"email_verify_expires" timestamp with time zone,
	"reset_token" text,
	"reset_token_expires" timestamp with time zone,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"member_since" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'frontend' NOT NULL,
	"thrivecart_product_id" text,
	"entitlement_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_days" integer,
	"price_display" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"thrivecart_order_id" text,
	"thrivecart_sub_id" text,
	"grace_expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	CONSTRAINT "entitlements_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"required_entitlement" text DEFAULT 'content:frontend' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"track_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" serial PRIMARY KEY NOT NULL,
	"module_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"video_url" text,
	"content_type" text DEFAULT 'video' NOT NULL,
	"text_content" text,
	"duration_minutes" integer DEFAULT 10 NOT NULL,
	"required_entitlement" text DEFAULT 'content:frontend' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"lesson_id" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bio" text NOT NULL,
	"photo_url" text,
	"specialties" text NOT NULL,
	"call_types" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"call_type" text DEFAULT 'weekly_qa' NOT NULL,
	"coach_id" integer NOT NULL,
	"meet_link" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"required_entitlement" text DEFAULT 'coaching:group' NOT NULL,
	"recording_url" text,
	"registered_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"sender_type" text DEFAULT 'member' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_number" text NOT NULL,
	"user_id" integer NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"type" text DEFAULT 'general' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"affiliate_code" text NOT NULL,
	"tier" text DEFAULT 'entry' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paypal_email" text,
	"tax_form_submitted" boolean DEFAULT false NOT NULL,
	"tax_form_url" text,
	"total_earnings" integer DEFAULT 0 NOT NULL,
	"total_paid" integer DEFAULT 0 NOT NULL,
	"pending_balance" integer DEFAULT 0 NOT NULL,
	"approved_balance" integer DEFAULT 0 NOT NULL,
	"lifetime_clicks" integer DEFAULT 0 NOT NULL,
	"lifetime_conversions" integer DEFAULT 0 NOT NULL,
	"fraud_flag" boolean DEFAULT false NOT NULL,
	"fraud_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliate_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "affiliate_profiles_affiliate_code_unique" UNIQUE("affiliate_code")
);
--> statement-breakpoint
CREATE TABLE "commission_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"product_id" integer NOT NULL,
	"rate_percent" numeric(5, 2) NOT NULL,
	"flat_bonus" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliate_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"slug" text NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"conversion_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_clicks" (
	"id" serial PRIMARY KEY NOT NULL,
	"referral_link_id" integer NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"referer" text,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliate_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"order_id" text NOT NULL,
	"customer_email" text NOT NULL,
	"sale_amount" integer NOT NULL,
	"commission_rate" numeric(5, 2) NOT NULL,
	"commission_amount" integer NOT NULL,
	"flat_bonus" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tier" text NOT NULL,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"payout_id" integer,
	"fraud_flag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliate_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"commission_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paypal_email" text,
	"paypal_transaction_id" text,
	"notes" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"content" text,
	"file_url" text,
	"thumbnail_url" text,
	"product_slug" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_products" ADD CONSTRAINT "user_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_products" ADD CONSTRAINT "user_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_calls" ADD CONSTRAINT "coaching_calls_coach_id_coaches_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_profiles" ADD CONSTRAINT "affiliate_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rates" ADD CONSTRAINT "commission_rates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_affiliate_id_affiliate_profiles_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliate_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_clicks" ADD CONSTRAINT "referral_clicks_referral_link_id_referral_links_id_fk" FOREIGN KEY ("referral_link_id") REFERENCES "public"."referral_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_affiliate_id_affiliate_profiles_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliate_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_affiliate_id_affiliate_profiles_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliate_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_affiliate_profiles_code" ON "affiliate_profiles" USING btree ("affiliate_code");--> statement-breakpoint
CREATE INDEX "idx_affiliate_profiles_user" ON "affiliate_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_affiliate_profiles_status" ON "affiliate_profiles" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_commission_rates_tier_product" ON "commission_rates" USING btree ("tier","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_referral_links_affiliate_product" ON "referral_links" USING btree ("affiliate_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_referral_links_slug" ON "referral_links" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_referral_clicks_link" ON "referral_clicks" USING btree ("referral_link_id");--> statement-breakpoint
CREATE INDEX "idx_referral_clicks_ip_time" ON "referral_clicks" USING btree ("ip_address","clicked_at");--> statement-breakpoint
CREATE INDEX "idx_commissions_affiliate" ON "commissions" USING btree ("affiliate_id");--> statement-breakpoint
CREATE INDEX "idx_commissions_status" ON "commissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_commissions_order" ON "commissions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_commissions_created" ON "commissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_commission_payouts_affiliate" ON "commission_payouts" USING btree ("affiliate_id");--> statement-breakpoint
CREATE INDEX "idx_commission_payouts_status" ON "commission_payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_affiliate_resources_type" ON "affiliate_resources" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_affiliate_resources_status" ON "affiliate_resources" USING btree ("status");