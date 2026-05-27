-- Baseline the tables, indexes, FKs, and check constraints that previously
-- only existed because operators ran `drizzle-kit push` against the schema.
-- Without these statements, a fresh database built from `lib/db/drizzle/*.sql`
-- alone would be missing dozens of tables (admin_notes, assistant_cards,
-- audit_log, coach_availability, coaching_sessions, kb_staging_docs,
-- member_health_scores, revenue_*, system_settings, tool_*, vault_*,
-- win_milestones, wins, and more). See task #554 / #549 for context.
--
-- Every statement is idempotent (CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, DO blocks that swallow duplicate_object on
-- constraint adds) so re-running this file against an already-pushed
-- database is a no-op.

-- =====================================================================
-- admin_notes
-- =====================================================================
CREATE TABLE IF NOT EXISTS "admin_notes" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "author_id" integer NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_author_id_users_id_fk"
    FOREIGN KEY ("author_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- assistant_card_groups / assistant_cards / assistant_card_questions
-- =====================================================================
CREATE TABLE IF NOT EXISTS "assistant_card_groups" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "description" text,
  "icon" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_card_groups_sort_idx"
  ON "assistant_card_groups" ("sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_card_groups_active_idx"
  ON "assistant_card_groups" ("is_active");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "assistant_cards" (
  "id" serial PRIMARY KEY,
  "group_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "icon" text,
  "entitlement_key" text,
  "upgrade_product_id" integer,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_cards_group_idx"
  ON "assistant_cards" ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_cards_sort_idx"
  ON "assistant_cards" ("sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_cards_active_idx"
  ON "assistant_cards" ("is_active");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "assistant_cards" ADD CONSTRAINT "assistant_cards_group_id_assistant_card_groups_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "assistant_card_groups"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "assistant_cards" ADD CONSTRAINT "assistant_cards_upgrade_product_id_products_id_fk"
    FOREIGN KEY ("upgrade_product_id") REFERENCES "products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "assistant_card_questions" (
  "id" serial PRIMARY KEY,
  "card_id" integer NOT NULL,
  "body" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "generated_by" text DEFAULT 'manual' NOT NULL,
  "retrieval_confidence" real,
  "source_kb_doc_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_card_questions_card_idx"
  ON "assistant_card_questions" ("card_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_card_questions_sort_idx"
  ON "assistant_card_questions" ("sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_card_questions_active_idx"
  ON "assistant_card_questions" ("is_active");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "assistant_card_questions" ADD CONSTRAINT "assistant_card_questions_card_id_assistant_cards_id_fk"
    FOREIGN KEY ("card_id") REFERENCES "assistant_cards"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- audit_log (the keyset index is also created by 0013, kept idempotent)
-- =====================================================================
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" serial PRIMARY KEY,
  "actor_id" integer,
  "actor_email" text,
  "action_type" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "description" text NOT NULL,
  "change_diff" jsonb,
  "ip_address" text,
  "user_agent" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_at_id_idx"
  ON "audit_log" ("created_at", "id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- chat_rate_limits
-- =====================================================================
CREATE TABLE IF NOT EXISTS "chat_rate_limits" (
  "id" serial PRIMARY KEY,
  "tier" text NOT NULL,
  "daily_limit" integer NOT NULL,
  "max_output_tokens" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_rate_limits_tier_unique" UNIQUE("tier")
);
--> statement-breakpoint

-- =====================================================================
-- coach_availability / coach_availability_overrides
-- =====================================================================
CREATE TABLE IF NOT EXISTS "coach_availability" (
  "id" serial PRIMARY KEY,
  "coach_id" integer NOT NULL,
  "day_of_week" integer NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  "timezone" text DEFAULT 'America/New_York' NOT NULL,
  "session_duration_minutes" integer DEFAULT 60 NOT NULL,
  "buffer_minutes" integer DEFAULT 15 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coach_availability_coach"
  ON "coach_availability" ("coach_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coach_availability" ADD CONSTRAINT "coach_availability_coach_id_coaches_id_fk"
    FOREIGN KEY ("coach_id") REFERENCES "coaches"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "coach_availability_overrides" (
  "id" serial PRIMARY KEY,
  "coach_id" integer NOT NULL,
  "override_date" date NOT NULL,
  "override_type" text DEFAULT 'blocked' NOT NULL,
  "start_time" time,
  "end_time" time,
  "reason" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coach_override_coach_date"
  ON "coach_availability_overrides" ("coach_id", "override_date");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coach_availability_overrides" ADD CONSTRAINT "coach_availability_overrides_coach_id_coaches_id_fk"
    FOREIGN KEY ("coach_id") REFERENCES "coaches"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- coaching_sessions / coaching_action_items / coaching_ratings
-- =====================================================================
CREATE TABLE IF NOT EXISTS "coaching_sessions" (
  "id" serial PRIMARY KEY,
  "coach_id" integer NOT NULL,
  "member_id" integer NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "duration_minutes" integer DEFAULT 60 NOT NULL,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "meet_link" text,
  "coach_notes" text,
  "member_notes" text,
  "rating" integer,
  "action_items" jsonb DEFAULT '[]'::jsonb,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" text,
  "cancellation_reason" text,
  "credit_returned" boolean DEFAULT false NOT NULL,
  "rescheduled_from_id" integer,
  "rescheduled_to_id" integer,
  "reminder_24h_sent" boolean DEFAULT false NOT NULL,
  "reminder_1h_sent" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coaching_session_coach"
  ON "coaching_sessions" ("coach_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coaching_session_member"
  ON "coaching_sessions" ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coaching_session_scheduled"
  ON "coaching_sessions" ("scheduled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coaching_session_status"
  ON "coaching_sessions" ("status");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_action_items_is_array"
    CHECK ("action_items" IS NULL OR jsonb_typeof("action_items") = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_coach_id_coaches_id_fk"
    FOREIGN KEY ("coach_id") REFERENCES "coaches"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_member_id_users_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "coaching_action_items" (
  "id" serial PRIMARY KEY,
  "session_id" integer NOT NULL,
  "text" text NOT NULL,
  "due_date" date,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coaching_action_items" ADD CONSTRAINT "coaching_action_items_session_id_coaching_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "coaching_sessions"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "coaching_ratings" (
  "id" serial PRIMARY KEY,
  "session_id" integer NOT NULL,
  "coach_id" integer NOT NULL,
  "member_id" integer NOT NULL,
  "rating" integer NOT NULL,
  "comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_coaching_rating_session" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coaching_rating_coach"
  ON "coaching_ratings" ("coach_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coaching_ratings" ADD CONSTRAINT "coaching_ratings_session_id_coaching_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "coaching_sessions"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coaching_ratings" ADD CONSTRAINT "coaching_ratings_coach_id_coaches_id_fk"
    FOREIGN KEY ("coach_id") REFERENCES "coaches"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "coaching_ratings" ADD CONSTRAINT "coaching_ratings_member_id_users_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- conversations / messages
-- =====================================================================
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "title" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "messages" (
  "id" serial PRIMARY KEY,
  "conversation_id" integer NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- course_progress
-- =====================================================================
CREATE TABLE IF NOT EXISTS "course_progress" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "course_id" text NOT NULL,
  "completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "course_progress_user_course_idx"
  ON "course_progress" ("user_id", "course_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- email_change_history
-- =====================================================================
CREATE TABLE IF NOT EXISTS "email_change_history" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "old_email" text NOT NULL,
  "new_email" text NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_change_history_old_email_idx"
  ON "email_change_history" ("old_email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_change_history_user_id_idx"
  ON "email_change_history" ("user_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "email_change_history" ADD CONSTRAINT "email_change_history_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- kb_staging_docs (+ knowledgebase_docs missing title unique index)
-- =====================================================================
CREATE TABLE IF NOT EXISTS "kb_staging_docs" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "category" text DEFAULT 'curriculum' NOT NULL,
  "content" text NOT NULL,
  "tags" text DEFAULT '' NOT NULL,
  "source_video_title" text,
  "source_video_id" text,
  "status" text DEFAULT 'pending_review' NOT NULL,
  "admin_notes" text,
  "edited_content" text,
  "reviewed_by" integer,
  "reviewed_at" timestamp with time zone,
  "merged_into_id" integer,
  "source" text,
  "phase" text,
  "module" text,
  "lesson_id" text,
  "lesson_type" text,
  "network_path" text,
  "publisher_path" text,
  "blitz_order" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_staging_status_idx" ON "kb_staging_docs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_staging_source_idx" ON "kb_staging_docs" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_staging_phase_idx" ON "kb_staging_docs" ("phase");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_staging_search_idx"
  ON "kb_staging_docs" USING gin (to_tsvector('english'::regconfig, ((title || ' '::text) || content)));
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "kb_staging_docs" ADD CONSTRAINT "kb_staging_docs_reviewed_by_users_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "knowledgebase_docs_title_uniq"
  ON "knowledgebase_docs" ("title");
--> statement-breakpoint

-- =====================================================================
-- member_health_scores
-- =====================================================================
CREATE TABLE IF NOT EXISTS "member_health_scores" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "score" integer NOT NULL,
  "risk_level" text NOT NULL,
  "login_frequency_score" numeric(5, 2),
  "training_progress_score" numeric(5, 2),
  "coaching_attendance_score" numeric(5, 2),
  "community_engagement_score" numeric(5, 2),
  "tool_usage_score" numeric(5, 2),
  "support_ticket_score" numeric(5, 2),
  "recency_score" numeric(5, 2),
  "signals" jsonb,
  "previous_score" integer,
  "trend" text,
  "churn_probability" numeric(5, 4),
  "upgrade_probability" numeric(5, 4),
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_health_scores_user"
  ON "member_health_scores" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_health_scores_risk"
  ON "member_health_scores" ("risk_level");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_health_scores_computed"
  ON "member_health_scores" ("computed_at");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "member_health_scores" ADD CONSTRAINT "member_health_scores_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- revenue_manual_entries / revenue_metrics_cache
-- =====================================================================
CREATE TABLE IF NOT EXISTS "revenue_manual_entries" (
  "id" serial PRIMARY KEY,
  "metric" text NOT NULL,
  "period" text NOT NULL,
  "value" numeric(18, 4) NOT NULL,
  "source" text,
  "notes" text,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_manual_entries_unique"
  ON "revenue_manual_entries" ("metric", "period");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "revenue_metrics_cache" (
  "id" serial PRIMARY KEY,
  "metric_key" text NOT NULL,
  "period" text NOT NULL,
  "value" numeric(18, 4) NOT NULL,
  "breakdown" jsonb,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_revenue_metrics_unique"
  ON "revenue_metrics_cache" ("metric_key", "period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_revenue_metrics_computed"
  ON "revenue_metrics_cache" ("computed_at");
--> statement-breakpoint

-- =====================================================================
-- system_settings
-- =====================================================================
CREATE TABLE IF NOT EXISTS "system_settings" (
  "id" serial PRIMARY KEY,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "category" text DEFAULT 'general' NOT NULL,
  "description" text,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint

-- =====================================================================
-- tool_categories / tools / tool_user_data / tool_usage_log / tool_daily_usage
-- =====================================================================
CREATE TABLE IF NOT EXISTS "tool_categories" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "icon" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_categories_name_unique" UNIQUE("name"),
  CONSTRAINT "tool_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tools" (
  "id" serial PRIMARY KEY,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "short_description" text NOT NULL,
  "long_description" text,
  "category_id" integer NOT NULL,
  "type" text DEFAULT 'builtin' NOT NULL,
  "required_entitlement" text DEFAULT 'software:base' NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "icon" text,
  "status" text DEFAULT 'active' NOT NULL,
  "is_featured" integer DEFAULT 0 NOT NULL,
  "is_new" boolean DEFAULT false NOT NULL,
  "is_beta" boolean DEFAULT false NOT NULL,
  "badge" text,
  "total_launches" integer DEFAULT 0 NOT NULL,
  "help_doc_url" text,
  "video_tutorial_url" text,
  "rate_limit_per_day" integer,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tools_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_category_idx" ON "tools" ("category_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_status_idx" ON "tools" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_sort_idx" ON "tools" ("sort_order");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tools" ADD CONSTRAINT "tools_category_id_tool_categories_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "tool_categories"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tool_user_data" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "tool_id" integer NOT NULL,
  "data_key" text NOT NULL,
  "data_value" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_user_data_unique"
  ON "tool_user_data" ("user_id", "tool_id", "data_key");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tool_user_data" ADD CONSTRAINT "tool_user_data_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tool_user_data" ADD CONSTRAINT "tool_user_data_tool_id_tools_id_fk"
    FOREIGN KEY ("tool_id") REFERENCES "tools"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tool_usage_log" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "tool_id" integer NOT NULL,
  "action" text NOT NULL,
  "entitlement_tier" text,
  "ai_tokens_used" integer,
  "ai_cost_cents" integer,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_usage_log_tool_idx" ON "tool_usage_log" ("tool_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_usage_log_user_idx" ON "tool_usage_log" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_usage_log_created_idx" ON "tool_usage_log" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_usage_log_action_idx" ON "tool_usage_log" ("action");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tool_usage_log" ADD CONSTRAINT "tool_usage_log_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tool_usage_log" ADD CONSTRAINT "tool_usage_log_tool_id_tools_id_fk"
    FOREIGN KEY ("tool_id") REFERENCES "tools"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tool_daily_usage" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "tool_id" integer NOT NULL,
  "usage_date" date NOT NULL,
  "generation_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_daily_usage_unique"
  ON "tool_daily_usage" ("user_id", "tool_id", "usage_date");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tool_daily_usage" ADD CONSTRAINT "tool_daily_usage_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tool_daily_usage" ADD CONSTRAINT "tool_daily_usage_tool_id_tools_id_fk"
    FOREIGN KEY ("tool_id") REFERENCES "tools"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =====================================================================
-- vault_*
-- =====================================================================
CREATE TABLE IF NOT EXISTS "vault_collections" (
  "id" serial PRIMARY KEY,
  "parent_id" integer,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "icon" text,
  "cover_image_url" text,
  "required_entitlement" text DEFAULT 'content:frontend',
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vault_collections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vault_resources" (
  "id" serial PRIMARY KEY,
  "collection_id" integer,
  "title" text NOT NULL,
  "description" text,
  "long_description" text,
  "resource_type" text DEFAULT 'document' NOT NULL,
  "file_url" text,
  "file_name" text,
  "file_size" integer,
  "file_type" text,
  "preview_image_url" text,
  "content_html" text,
  "external_url" text,
  "video_url" text,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "required_entitlement" text DEFAULT 'content:frontend',
  "is_featured" boolean DEFAULT false NOT NULL,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "is_new" boolean DEFAULT true NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "version" text,
  "update_note" text,
  "download_count" integer DEFAULT 0 NOT NULL,
  "favorite_count" integer DEFAULT 0 NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vault_resources" ADD CONSTRAINT "vault_resources_tags_is_array"
    CHECK ("tags" IS NULL OR jsonb_typeof("tags") = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vault_resources" ADD CONSTRAINT "vault_resources_collection_id_vault_collections_id_fk"
    FOREIGN KEY ("collection_id") REFERENCES "vault_collections"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vault_favorites" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "resource_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vault_favorites_user_id_resource_id_unique" UNIQUE("user_id", "resource_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vault_favorites" ADD CONSTRAINT "vault_favorites_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vault_favorites" ADD CONSTRAINT "vault_favorites_resource_id_vault_resources_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "vault_resources"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vault_resource_relations" (
  "id" serial PRIMARY KEY,
  "resource_id" integer NOT NULL,
  "related_resource_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vault_resource_relations" ADD CONSTRAINT "vault_resource_relations_resource_id_vault_resources_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "vault_resources"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vault_resource_relations" ADD CONSTRAINT "vault_resource_relations_related_resource_id_vault_resources_id_fk"
    FOREIGN KEY ("related_resource_id") REFERENCES "vault_resources"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vault_resource_downloads" (
  "id" serial PRIMARY KEY,
  "resource_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "downloaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vault_resource_downloads" ADD CONSTRAINT "vault_resource_downloads_resource_id_vault_resources_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "vault_resources"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vault_resource_favorites" (
  "id" serial PRIMARY KEY,
  "resource_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vault_resource_favorites" ADD CONSTRAINT "vault_resource_favorites_resource_id_vault_resources_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "vault_resources"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vault_resource_lesson_relations" (
  "id" serial PRIMARY KEY,
  "resource_id" integer NOT NULL,
  "lesson_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "vault_resource_lesson_relations" ADD CONSTRAINT "vault_resource_lesson_relations_resource_id_vault_resources_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "vault_resources"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vault_search_queries" (
  "id" serial PRIMARY KEY,
  "query" text NOT NULL,
  "result_count" integer DEFAULT 0 NOT NULL,
  "user_id" integer,
  "searched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- =====================================================================
-- win_milestones / wins
-- =====================================================================
CREATE TABLE IF NOT EXISTS "win_milestones" (
  "id" serial PRIMARY KEY,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "icon" text,
  "category" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "xp_reward" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "win_milestones_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "wins" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "milestone_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "revenue_amount" numeric(12, 2),
  "metric_label" text,
  "metric_value" text,
  "proof_image_url" text,
  "proof_image_2_url" text,
  "proof_verified" boolean DEFAULT false NOT NULL,
  "win_date" date NOT NULL,
  "share_to_community" boolean DEFAULT true NOT NULL,
  "community_post_id" integer,
  "allow_testimonial" boolean DEFAULT false NOT NULL,
  "allow_public_name" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'published' NOT NULL,
  "featured_at" timestamp with time zone,
  "featured_by" integer,
  "testimonial_requested" boolean DEFAULT false NOT NULL,
  "testimonial_text" text,
  "testimonial_approved" boolean DEFAULT false NOT NULL,
  "testimonial_approved_by" integer,
  "testimonial_approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wins_user_created_idx"
  ON "wins" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wins_milestone_created_idx"
  ON "wins" ("milestone_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wins_status_created_idx"
  ON "wins" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wins_testimonial_featured_idx"
  ON "wins" ("testimonial_approved", "featured_at");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wins" ADD CONSTRAINT "wins_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wins" ADD CONSTRAINT "wins_milestone_id_win_milestones_id_fk"
    FOREIGN KEY ("milestone_id") REFERENCES "win_milestones"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wins" ADD CONSTRAINT "wins_community_post_id_community_posts_id_fk"
    FOREIGN KEY ("community_post_id") REFERENCES "community_posts"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wins" ADD CONSTRAINT "wins_featured_by_users_id_fk"
    FOREIGN KEY ("featured_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wins" ADD CONSTRAINT "wins_testimonial_approved_by_users_id_fk"
    FOREIGN KEY ("testimonial_approved_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
