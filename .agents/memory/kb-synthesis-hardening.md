---
name: KB synthesis hardening
description: Loud/durable LLM failure handling, 429-aware retries, self-healing reruns in kb-synthesis
---
The synthesis engine mirrors the topic-index hardening pattern:
- callLLM throws on 200-with-empty-content (finish_reason=length); no call site may swallow it into a fallback. The old raw-window map fallback was removed — a failed window fails the source extract loudly.
- Cache reuse in kb_source_node_extracts requires fingerprint match AND status='ok'; failed rows are durable but retried on rerun (self-heal).
- kb_node_synthesis_state.last_error marks a node as affected for the next incremental run; failure writes never clobber sourceDocIds/lastSynthesizedAt, success clears last_error.
- kb_synthesis_runs holds durable per-run reports (per-node outcomes/failures/scope), returned as lastRun on /synthesis-status.
**Why:** silent fallbacks previously cached degraded raw-window "extracts" as good, poisoning consolidation invisibly.
**How to apply:** any new LLM call in synthesis must go through callLLMWithRetry and must throw (not default) on failure; never treat a failed extract row as a cache hit. Full-corpus run projection ≈13h for ~1244 links (upper bound; extract cache makes reruns much cheaper).
