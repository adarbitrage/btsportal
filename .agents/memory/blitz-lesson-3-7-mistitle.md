---
name: Blitz lesson 3.7 title/content mispairing
description: The one known mistitled Blitz reference doc and how to audit the corpus for more
---

Blitz reference docs were mined with titles from the curriculum outline but bodies from video transcripts. Lesson 3.7 ("Hero Shot Selection and Creation Training") was paired with a video that is actually a SECOND copy-blocks headline training call — so the 3.7 rows across blitz_lessons / ai_source_documents / kb_staging_docs carry a hero-shot title over copy-blocks content. Corpus audit (all 96 docs) found this is the ONLY true title/content mispairing. RESOLVED: the mistitled staging doc was soft-deleted after its unique content was merged into the 3.6 copy-blocks staging doc (which now frames copy blocks as network-agnostic, guide sections 8 and 9); the crosswalk keeps 3.7's title verbatim (drift contract) but files it under section 8.

**Why:** The mining step trusted the curriculum's lesson→video assignment; it never cross-checked that the transcript topic matched the lesson title.

**How to apply:**
- Ground truth for "what a video actually covers" = `exports/heygen-scripts/manifest.json` (videoId → content-derived title, 97 entries). Cross-check `blitz_lessons.source_video_id` against it to audit.
- Fuzzy title differences (paraphrases like "Choose Your Affiliate Network" vs "Choosing Your Offer Network") are normal; only zero-overlap is a real swap.
- Fixing: edit the staging row (edited_content/title), NOT the ai_source title — exact-title idempotency in blitz-reference-import would create a duplicate on re-import.
- Member Blitz guide section numbers (1–23) ≠ internal lesson ids; the code-owned crosswalk (blitz-identity-map.ts) is the authority for lesson→section, post-audit realigned against the live guide's getBlitzVideoMap(); admin notes cite internal ids.
- Audit method for crosswalk drift: match crosswalk titles against live-guide video slot titles from getBlitzVideoMap() (@workspace/blitz-curriculum barrel); confident title matches expose wrong sections, but adjudicate near-misses by hand (advertorial vs LP headlines etc. are false positives).
