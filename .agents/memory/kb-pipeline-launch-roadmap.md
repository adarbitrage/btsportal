---
name: KB pipeline launch roadmap
description: The agreed dev-vs-prod strategy and remaining step order for getting synthesized KB truth docs live. Check here before planning any synthesis or promotion work.
---

# KB pipeline launch roadmap (agreed with user)

**Decision: Path A — run the whole pipeline in dev, promote only OUTPUTS to prod.**
Publishing ships code, never DB rows; both inputs (ai_source_documents, screenings) and outputs (drafts, live docs) are dev-DB rows. The user once considered migrating inputs to prod and running synthesis there (to dodge merge interruptions of a ~4–6h run), but that was superseded: the hardened pipeline is durable/resumable/self-healing, so dev interruptions are cheap. Prod NEVER runs the pipeline — it receives finished, human-approved content in one deliberate data migration.

**Why:** avoids paying the ~$100/5h run twice, avoids iterating on pipeline bugs through merge+publish cycles, keeps drafts away from the member-facing assistant, and preserves the human review gate in dev.

**Remaining step order:**
1. ~~Topic-index hardening + healing rerun~~ DONE (index: 325/328 llm-classified, 0 lexical-only; see kb-topic-index-hardening.md).
2. **Synthesis hardening** — fix the cousin flaw: failed map/extract LLM calls silently cache a raw-window fallback and the fingerprint cache never retries them. Apply the same pattern as the indexer: loud durable failures, rate-limit-aware retries, never cache a failure as success, honest outcomes, self-healing reruns. Pilot on a few nodes in dev; report timing.
3. **Full synthesis run in dev** (~4–6h cold, resumable) from the admin KB Review page.
4. **Human review pass** — user approves drafts into Live AI Documents (absolute gate).
5. **One-time dev→prod promotion** — copy approved Live AI Documents + supporting data the live assistant needs into the prod DB, then publish. (A runbook for this was a deliverable of the live-docs lifecycle work.)

**How to apply:** if a task proposes running index/synthesis in prod or re-running after promotion, it contradicts this decision — flag it.
