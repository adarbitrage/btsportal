-- Task #1925: per-message retrieval trace (admin-only diagnostics) on assistant chat messages.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "retrieval_trace" jsonb;
