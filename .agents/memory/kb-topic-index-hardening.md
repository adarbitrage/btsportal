---
name: KB topic-index hardening
description: Durable run reports, honest outcomes, self-healing reruns, and the classifier-variance lesson for the topic-index pipeline.
---

# Topic-index classifier hardening

- Classifier is **gpt-5 with max_completion_tokens 6000**. The original silent-degradation bug was reasoning-token starvation at a low ceiling: 200 OK, EMPTY content, finish_reason=length → JSON.parse fail → silent lexical fallback. `parseClassifyResponse` now throws on empty/unparseable content; a failure is never a "no nodes fit" verdict.
- Per-source outcomes are durable in `kb_topic_index_source_state`: `llm` / `llm_none` (deliberate no-topic, respected on reruns) / `lexical` / `failed` / `excluded`. force=false runs re-attempt only lexical/failed/unlinked sources — the index self-heals.
- Run reports live in `kb_topic_index_runs` (progress counters, failures jsonb, duplicate flags, quality-check report). Admin UI (KnowledgeBaseReview) polls `/topic-index-status` and shows the split.

**Why the quality-bar lesson matters:** a Jaccard node-agreement spot-check vs stored links measures **run-to-run classifier variance as much as model quality** — gpt-5 vs its OWN stored links scored only ~67%, barely above gpt-5-mini's ~61%. Don't treat <85% agreement as proof a cheaper model is worse without first measuring the incumbent's self-agreement baseline.

**How to apply:** rate limits (429) need their own retry budget (5 attempts, 5s→60s backoff) — the generic 1s/3s backoff converts transient 429 bursts into lexical degradation. Keep classification fan-out low (2 sources × 4 windows); 3×4 tripped sustained 429s on the AI-integrations proxy.

Validation reruns with real secrets: temp console workflow running `npx tsx src/scripts/topic-index-rerun.ts` logging to /tmp with an EXIT_CODE marker (script kept in repo).
