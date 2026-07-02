---
name: Blitz change-monitoring foundation (dormant)
description: Where the OFF-by-default "Scan for changes" plumbing lives and why it must stay disabled
---

# Blitz change-monitoring foundation — DORMANT

Plumbing to detect when core-training source material (7 Pillars / Pillars→Blitz
prose + Blitz curriculum lessons) changed and PROPOSE AI-reference-doc revisions.
Intentionally OFF: no boot hook, no schedule. The ONLY entry point is a
`disabled` "Scan for changes" button in the AI Document Review synthesis toolbar
(`KnowledgeBaseReview.tsx`, next to the Coverage button).

**Rule:** keep the button disabled and add NO boot/scheduler caller unless a task
explicitly asks to turn it on.
**Why:** the feature is a foundation only; the human approval gate + supersede
model must stay unchanged until content push + topic-index work is ready.
**How to apply:** enabling = wire the button's onClick to the existing endpoint
(and optionally a scheduled job); do not build new revision machinery.

## Design constraints that aren't obvious from the code
- Detection compares a stored per-source content fingerprint (sha256) against a
  freshly rebuilt canonical source. The canonical source builder is the single
  source of truth shared by BOTH the boot seed and the scan — never let those
  two diverge, or the scan will flag phantom changes on every run.
- Significance filtering fails OPEN (treat as material on LLM error) so a broken
  model never silently swallows a real content change.
- Only nodes that already have a PUBLISHED live doc get a revision proposal; a
  material change to a node with no published doc is reported but produces no
  draft (revisions supersede, they don't create).
- Proposals reuse the EXISTING supersede path (an `update` draft carrying
  target_live_doc_id + update_summary) — do not add a parallel revision flow.

## Provenance trace gotcha
`kb_doc_provenance.sourceId` points at transcript sources and is NULL for
core-training material, so it CANNOT trace core-training sources to nodes — use
the `kb_source_node_links` (source→node) table instead.

## Schema
`ai_source_documents` gained additive nullable `content_hash` + `last_scanned_at`.
The companion migration backfills the hash via pgcrypto `digest(content,'sha256')`
so it matches the Node-side fingerprint; the boot seed stamps content_hash on
every new insert.
