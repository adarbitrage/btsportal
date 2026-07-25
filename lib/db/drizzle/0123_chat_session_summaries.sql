-- Companion migration for chatSessionSummariesTable (lib/db/src/schema/chat-sessions.ts).
-- Rolling per-session Conversation Continuity Summary (Task #1989). Idempotent.
CREATE TABLE IF NOT EXISTS "chat_session_summaries" (
        "id" serial PRIMARY KEY NOT NULL,
        "session_id" integer NOT NULL,
        "summary" text NOT NULL,
        "covered_through_message_id" integer NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_session_summaries" ADD CONSTRAINT "chat_session_summaries_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_session_summaries_session_id_unique" ON "chat_session_summaries" USING btree ("session_id");
