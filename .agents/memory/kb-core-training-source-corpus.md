---
name: Core training → AI source corpus
description: How the 7 Pillars / Pillars-to-Blitz / Blitz curriculum get fed into ai_source_documents for the synthesis engine, and the tag-inventory ground truth.
---

# Feeding core training into the AI Source Knowledge corpus

`ai_source_documents` is the NON-CITABLE mining layer behind the synthesis
engine (distinct from legacy `knowledgebase_docs` and citable
`ai_live_documents`). Core BTS training is loaded via an idempotent boot seed
(`seed-core-training-sources.ts`, wired after `seedBlitzDocs()` in index.ts).

**Rule:** re-author the 7 Pillars + Pillars-to-Blitz prose as plain-text
constants in the seed (same pattern as `seed-process-kb.ts`) — the source prose
lives in React pages (`SevenPillars.tsx` / `PillarsToBlitz.tsx`) that CANNOT be
imported into the api-server. Brand tokens (`{brand.full}`) resolve to
"Build Test Scale".
**Why:** mining input, not citable, so verbatim fidelity is not required; the
engine consolidates it.

**Blitz body granularity:** file ONE `ai_source_documents` row PER
`blitz_lessons` row (not one giant concatenated body). The topic indexer
truncates each source to ~9k chars for LLM classification, so a single
concatenated Blitz body would drop most of the curriculum. Note: the task spec
says "23 Blitz lesson bodies" but `blitz_lessons` actually holds ~94 rows (the
lesson-hub library incl. per-network/per-publisher variants); the seed files all
non-rejected rows for full mining coverage.

Idempotency is keyed on `title` (no unique DB constraint) — skip any title
already present. All three bodies file into folder `reference_docs` with
authority role `curriculum`.

## Tag inventory ground truth (kb-taxonomy TOOL_TAGS / TAG_TRIGGERS)
Ground truth = PartnerTools.tsx + the "KEY TOOLS" line in the openai
knowledge-base route. Current product inventory tags:
- In-house: flexy, diytrax, metricmover, gifster, pixelpress, scrapebot, cropbot
- Partner tools: affiliate-cmo, freeadcopy, anstrex
- Ad publishers (source-protected code names): caterpillar, grasshopper, crane
- Networks: media-mavens, clickbank

**Excluded on purpose (retired):** NoEscape, LeiaPix/Immersity, MediaGo,
LiveIntent, and native networks Taboola/Outbrain/Revcontent/MGID. Don't "fix"
them back in. Every TAG_TRIGGERS key must be ∈ ALL_TAGS (guarded by
kb-surface-retrieval.test.ts).

**Out of scope in isolated env:** synthesis run / review / publish / coverage —
runtime + human-gated (need live LLM). Blitz video transcripts arrive as
`blitz_video` sources via the Transcript Cleaner, not this seed.
