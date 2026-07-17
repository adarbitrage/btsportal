---
name: Blitz lesson 3.7 title/content mispairing
description: The one known mistitled Blitz reference doc and how to audit the corpus for more
---

Blitz reference docs were mined with titles from the curriculum outline but bodies from video transcripts. Lesson 3.7 ("Hero Shot Selection and Creation Training") was paired with video `x2mY7I97jV5eakzw`, which is actually a SECOND copy-blocks headline training call — so `blitz_lessons` 3.7, `ai_source_documents` #18, and `kb_staging_docs` #1423 all carry a hero-shot title over copy-blocks content. Corpus audit (all 96 docs) found this is the ONLY true mispairing.

**Why:** The mining step trusted the curriculum's lesson→video assignment; it never cross-checked that the transcript topic matched the lesson title.

**How to apply:**
- Ground truth for "what a video actually covers" = `exports/heygen-scripts/manifest.json` (videoId → content-derived title, 97 entries). Cross-check `blitz_lessons.source_video_id` against it to audit.
- Fuzzy title differences (paraphrases like "Choose Your Affiliate Network" vs "Choosing Your Offer Network") are normal; only zero-overlap is a real swap.
- Fixing: edit the staging row (edited_content/title), NOT the ai_source title — exact-title idempotency in blitz-reference-import would create a duplicate on re-import.
- Member Blitz guide section numbers (1–23) ≠ internal lesson ids (e.g. 3.7 → member section 6, Creative Assets); admin notes cite internal ids.
