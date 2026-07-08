---
name: KB Synthesis Engine (taxonomy-driven truth-doc consolidation)
description: How AI truth-doc drafts are now produced — corpus-wide synthesis per taxonomy node, not 1-transcript-1-draft mining.
---

# KB Synthesis Engine

Truth-doc drafts are produced by consolidating the WHOLE `ai_source_documents`
corpus per taxonomy node into ONE draft, NOT by the old "1 transcript → 1 draft"
flat-file mining.

**Why:** flat-file mining produced fragmented, duplicative drafts with single-source
provenance and no corroboration signal; the taxonomy already defines the shelf/node
truth structure, so drafts should be node-anchored and multi-source.

**How to apply:**
- Two-phase: (1) build a topic index (LLM classification of each source doc → taxonomy
  node(s) with relevance, stored in link table `kb_source_node_links`), then (2) synthesize
  each node's linked sources into one draft via map-reduce (per-source node-relevant extract
  → single consolidated draft). Build the index BEFORE synthesizing.
- Draft carries `node` (= node slug), category/homeRoot = node.root, docType `truth_draft`,
  originType `ai_synthesized`, a `corroborationCount`, and multi-source provenance in the
  nullable jsonb `kb_staging_docs.synthesis_sources`.
- On push-approved, one `kb_doc_provenance` row is written per `synthesisSources` entry
  (falls back to a single legacy row when absent).
- Depth tier by root: process node → overview (checklist/roadmap), concept/operations → curated.
- The old flat-file mining routes (process-transcripts, process-single/:index,
  process-coaching-transcripts, process-coaching-retry) now return HTTP 410 (shared
  `retiredMining` helper). Do NOT resurrect them.
- Create-only + human gate UNCHANGED: nothing is citable/live until a human approves and
  publishes; publish/retrieval still flows through `ai_live_documents`.
- Refine chat on a draft is corpus-aware and patch-first (reuses `applyRefineEdits` from
  transcript-cleaner), threaded via `kb_triage_audit_log` (eventType 'refined'). Corpus-aware
  = the `/:id/refine` endpoint fetches the ACTUAL `ai_source_documents` content (by
  `synthesisSources[].sourceDocId`, strongest first, budget-split, privacy-scrubbed) and injects
  it as "ORIGINAL SOURCE MATERIAL" so the model can pull back into sources, not just reshuffle
  the draft. UI (`KnowledgeBaseReview`) drives it as a real chat: `runRefine` sends prior turns as
  `history`; `loadRefineThread` rehydrates on doc open by parsing the audit-log reasoning
  ("…per instruction: <instr> — <summary>"). The legacy `/redraft` endpoint still exists but the
  UI no longer calls it.
- synthesizeNode emits, beyond the one consolidated draft, up to 3 ATOMIC DEFINITION drafts
  ("What is <term>?", curated/conceptual) when the material actually defines a reusable term —
  each its own create-only needs_review draft inheriting the node's provenance. Returned via
  `SynthesizeResult.atomicDraftIds`; both bulk + single-node routes queue them for triage.
- Depth-ladder cross-links are DETERMINISTIC (not left to the LLM prose): `relatedTopicsMarkdown`
  appends a "## Related topics" section to every body — overview(process)→concept deep dives,
  curated(concept)→process stages + sibling concepts — so overview↔concept are always wired.
- Review UI drill-down is Shelf → Node (Node is the primary synthesis facet); Origin/Authority
  filters and the existing_doc type facet were removed as part of this realignment.

## Authority + screener-flag threading (2026-07)
- `AUTHORITY_RANK`: curriculum(3) > strategic_coach(2) > va(1) > internal(0) — curriculum
  OWNS covered foundations; coaching supplements (why/when/what-if); VA never drives
  strategy. Real co-equal conflicts must render the visible `SOURCE_CONFLICT_MARKER`
  blockquote for the reviewer, never be silently resolved.
- Screener flags travel TWO ways in parallel: inline text markers ([SITUATIONAL NUMBER…],
  [CONTEXT-BOUND WALKTHROUGH…], [SEGMENT ANOMALY…]) annotated onto kept passages so they
  survive LLM extraction (guarded by FLAG_PRESERVATION_GUARD in the map prompt), AND a
  structured `ScreeningFlags` object carried on `ConsolidateEntry` into consolidation
  source headers; `consolidateAll` batching must union flags (mergeScreeningFlags) or the
  hierarchical reduce drops them. Flags are recomputed per run, never cached with extracts.
- Any prompt change to the extract phase must bump `EXTRACT_PROMPT_VERSION` or cached
  extracts keep the old contract.
- No-member-names is an explicit prompt rule in consolidation + atomic-definition prompts
  (alongside no-coach-surnames).
