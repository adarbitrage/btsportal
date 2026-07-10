---
name: KB analysis judges filed placement, not suggestions
description: Triage/self-test/flags must evaluate a staging doc as FILED; AI taxonomy suggestions are advisory-only fallbacks; nav grounding orders by doc_class priority.
---

Rule: in KB analysis, every judging path (retrieval self-test, risk flags,
related-topics fix) evaluates the doc with its FILED placement
(docClassTarget/homeRoot/node). The AI's per-run taxonomy suggestion is used
only as a per-field fallback when the doc has never been filed. Docs with any
filed placement also LOCK the stored taxonomy suggestion (mirrors the
ai_title_decision title lock) so re-analysis never churns contradictions of
intentional synthesis filings.

**Why:** a fresh "transcript" suggestion once demoted a curated-filed draft
below the curated tier inside the shared ranking, producing a false 5/5
retrieval self-test failure and a bogus retrieval_gap flag; flags were judged
against a filed/suggested hybrid matching neither reality.

**How to apply:** any new judging path added to triage must consume the single
effective placement resolved in runAutoTriageOnDoc — never read suggested*
fields directly. Also: nav-grounding lookup orders by doc_class priority
(navigation > overview > rest, then id) because per-node synthesis satellites
share the operations/navigation filing; note the real Portal Navigation Map
doc is filed doc_class='overview', not 'navigation'.
