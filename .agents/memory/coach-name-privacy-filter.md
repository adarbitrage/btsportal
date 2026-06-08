---
name: Coach-name privacy filter (first-names-only)
description: Two non-obvious paths the AI assistant uses for KB content, and the surname spelling-variant trap.
---

The AI assistant must only ever surface coach FIRST names. `lib/content-privacy-filter.ts`
(`scrubPrivateContent`) is the centralized scrubber that maps coach full names -> first names.

**Two distinct content paths — both must stay clean:**
1. DB ingestion path (seed-kb, admin-chat, knowledgebase-staging, backfill scripts) runs
   content through `scrubPrivateContent` before INSERT. Fixing the filter only fixes NEW
   ingestion; already-seeded `knowledgebase_docs` rows must be re-scrubbed by hand.
2. **System-prompt path bypasses the filter entirely.** `routes/openai/knowledge-base.ts`
   `getSystemPrompt()` / `loadStaticPromptContent()` read `qa-articles.txt` and `glossary.txt`
   RAW from disk and embed them directly. So those two source files must be physically clean —
   the filter does NOT protect them. (coaching-transcripts.txt is only DB-ingested, never read raw.)

**Why:** A coach last name leaked despite the filter because the source uses inconsistent
spellings — both "Wissbaum" (double-s) and "Wisbaum" (single-s); the filter only matched the
double-s. Coach surname patterns must tolerate variants (e.g. `Wiss?baum`, `Bob[iy]lev`).

**How to apply:** When asked to scrub a name from the assistant: (1) widen the filter rule to
cover spelling variants, (2) clean the raw source files read by getSystemPrompt (qa-articles.txt,
glossary.txt), and (3) re-scrub existing knowledgebase_docs rows in the DB.
