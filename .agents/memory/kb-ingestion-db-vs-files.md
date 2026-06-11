---
name: KB ingestion — DB rows vs source files
description: Why editing knowledge-base source files is not enough to change what the AI assistant says
---

The AI assistant (`/api/ai-chat`) draws KB content from TWO independent places:
1. **System prompt** — built in `routes/openai/knowledge-base.ts` (`getSystemPrompt`): reads `qa-articles.txt` + a HARDCODED coaching-team list, cached in-process. Changing it requires editing the source AND restarting the api-server so the cache reloads.
2. **Full-text RAG** — `searchTranscripts()` queries the Postgres `knowledgebase_docs` table.

**Critical:** `seed-kb.ts` ingests with `ON CONFLICT (title) DO NOTHING`. So editing the `knowledge-base/*.txt` source files does **NOT** update already-seeded `knowledgebase_docs` rows. To change live RAG content you must run a direct `UPDATE` on `knowledgebase_docs` (content AND title — `searchTranscripts` emits `--- {title} ---` into the model context).

**Why:** A content scrub (e.g. removing coach surnames for privacy) silently fails to affect the assistant if you only edit files — the old DB rows keep serving stale text.

**How to apply:** For any KB content change, do BOTH: edit source files (so fresh seeds/new envs are correct) AND `UPDATE knowledgebase_docs`. Then restart api-server for the system-prompt cache. Remember production: its DB also won't auto-update on redeploy (same ON CONFLICT), so re-run the UPDATE against prod.

**Gotcha:** `knowledgebase_docs.title` has a UNIQUE constraint (`knowledgebase_docs_title_uniq`). Bulk title rewrites can collapse near-duplicate titles into collisions (duplicate coaching-call ingests like `... <coach>` vs `... <coach>(1)` vs `Call-` vs `Call -`). Dedupe by appending a discriminator (we used `[id]`) when a stripped title already exists.

Other AI-history surfaces to check when scrubbing names: `messages`, `chat_messages`, `chat_sessions.title`, `conversations.title`, `chat_prompts`, `chat_system_prompts` — prior conversation turns get replayed into the prompt as recent history.
