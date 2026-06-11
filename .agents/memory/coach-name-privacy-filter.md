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
2. **System-prompt path now ALSO runs through the filter.** `routes/openai/knowledge-base.ts`
   `loadStaticPromptContent()` wraps the `qa-articles.txt` / `glossary.txt` reads in
   `scrubPrivateContent()` before caching, so the system prompt built by `getSystemPrompt()`
   (and re-built by `reloadKnowledgeBase()`) is scrubbed automatically — editing the raw files
   can no longer reintroduce a surname. (coaching-transcripts.txt is only DB-ingested, never read raw.)

**Why:** A coach last name leaked despite the filter because the source uses inconsistent
spellings (e.g. a doubled vs. single inner consonant); the filter only matched one spelling.
Coach surname patterns must tolerate such variants (optional/alternating characters in the regex).

**How to apply:** When asked to scrub a name from the assistant: (1) add/widen the filter rule
in content-privacy-filter.ts to cover spelling variants, (2) clean the raw source files read by
getSystemPrompt (qa-articles.txt, glossary.txt), and (3) re-scrub existing knowledgebase_docs rows
in the DB. Both content paths now run through the filter, so cleaning the raw files is no longer
strictly required for safety but recommended for tidiness and to ensure the leak-guard test passes.

**Re-scrub gotcha:** when re-scrubbing existing knowledgebase_docs rows, scrub the `content`
column ONLY — `title` has a UNIQUE constraint and scrubbing titles can collapse two distinct
rows onto the same title (the whitespace/"the the" cleanup rules), throwing 23505. A leak guard
test (kb-coach-name-leak-guard) scans qa-articles.txt + glossary.txt raw AND all DB rows with
variant-tolerant fuzzy matchers; the re-scrub one-shot lives at
scripts/rescrub-knowledgebase-docs.ts.
