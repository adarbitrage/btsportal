
## 21 Day Blitz rename (2026-07-09)
- Day-count Blitz patterns (21-day/21 day/21day, case-insens) → "the Blitz" live in OLD_BRAND_REPLACEMENT_RULES; a `(?<!YSE[-\s])` lookbehind protects the REAL external product "YSE 21-Day Blitz". Never add 14-day here — a separate bootstrap TTS rule rewrites "14-Day Blitz"→"Fourteen-Day Blitz" in knowledgebase_docs.
- Synthesized-output tables (kb_staging_docs, ai_live_documents) are NOT covered by the boot source backfill; a one-off script (scripts/rename-21-day-blitz.ts) rewrote them. Future synthesis inherits the rules via the source-table boot backfill.
