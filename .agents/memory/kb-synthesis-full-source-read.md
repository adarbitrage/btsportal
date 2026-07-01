---
name: KB Synthesis full-source read + extract cache
description: Synthesis reads the WHOLE of every source (windowed) and folds in ALL linked sources; per-(source,node) extract cache keeps re-runs cheap.
---

# KB Synthesis Engine — full-source read

The Synthesis Engine must read the **whole** of every source and consolidate
**every** linked source per node. Completeness is deliberately chosen over
speed/cost; the extract cache is the tradeoff that makes it affordable.

## Durable rules (do not regress)

- **No truncation, no caps — anywhere in the pipeline.** Both topic-index
  classification and the synthesis map phase walk the whole source in overlapping
  windows (never a truncated prefix), and the reduce phase folds in every usable
  linked source (never a top-N slice). A per-window "at most N" only mirrors the
  classify prompt; the cross-window merged link set is uncapped. Never
  reintroduce a per-source link cap or a per-node source cap — that silently drops
  material the truth-doc needs.
  **Why:** long transcripts covered topics past the old cutoffs and had sources
  dropped past the top-12, so truth-docs missed real content.

- **Classification is fault-tolerant per window.** One window's LLM failure must
  return empty and let the other windows still merge; only a total failure/empty
  result falls back to the lexical scorer. A per-source throw collapses the whole
  doc to lexical and loses coverage.

- **Reduce is hierarchical.** When combined extracts exceed a single call's budget
  (chars or source count), fold in batches then consolidate the partials again
  (recurses). Never silently drop a source under context pressure.

- **Extract cache invalidation is content-addressed.** Cache is keyed on
  (source, node) AND a content fingerprint (hash of source content at extraction
  time). A hit needs both to match, so a changed source re-extracts. Empty
  verdicts are cached (as a sentinel marker) so they aren't recomputed. This is
  what keeps incremental re-runs cheap now that the map reads whole sources.
  Cache read/write are best-effort — a cache failure must never block synthesis.

## Gotcha

- The cache table shipped WITH a committed companion `.sql` + post-merge step, so
  migration-drift needed **no** baseline change (companion .sql ⇒ no onlyInPush
  drift). The "schema-only new table fails drift" rule only bites when there's no
  committed .sql.
