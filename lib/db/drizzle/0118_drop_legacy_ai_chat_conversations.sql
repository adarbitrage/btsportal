-- Task #1922: retire the legacy /api/ai-chat (GPT-5) assistant stack.
-- The modern /api/chat backend persists to chat_sessions / chat_messages;
-- the legacy conversations / messages tables are unused and dropped here.
-- messages first (FK to conversations), both guarded so this is idempotent.
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
