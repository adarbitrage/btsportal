---
name: KB truth-doc content campaign seed pattern
description: How per-home-root truth-doc content campaigns are authored, published, and tested.
---

# KB truth-doc content campaign seed pattern

Member-facing truth-doc campaigns (one per KB home root — e.g. Operations, Concepts,
Process) are authored as **TypeScript boot-seeds**, NOT pushed through the live staging
triage UI.

**Why:** member-facing KB has a human gate (no machine auto-publish). Authoring curated
docs in code puts the human review in code review, and a boot-time seed is the only write
path that reaches the prod KB (the agent cannot write prod directly). Each new campaign
mirrors the first one (`seed-operations-kb.ts`) so the whole set stays consistent.

**How to apply (mirror the Operations seed):**
- A pure builder fn returns the doc array (what the test imports) + a seeder fn does the
  boot-time upsert. Docs are `curated`/`overview`, `audience='member'`, homed under a real
  registry node with registry-controlled tags.
- Stamp every doc with a **single fixed** verified-at constant, never `new Date()`. Fixed =
  immediately citable AND the doc-aging clock never resets on re-run (re-running is a no-op).
- Upsert is idempotent `ON CONFLICT (title) DO UPDATE ... WHERE <field> IS DISTINCT FROM`,
  and must NOT overwrite `last_verified`. Run all content through the existing privacy
  scrubber on title+content before insert.
- Wire the seeder into the critical boot prerequisites path (awaited try/catch, pushing the
  fn name onto the missing/error list on throw), next to the sibling seeds.
- Add a content test asserting taxonomy validity (node in the right root, valid
  ceiling/handoff, citable doc_class, tags ⊆ registry), unique slugs/titles, full node
  coverage, ceiling/handoff semantics, and no legacy-brand leakage.

**Concept-root specifics:** all concept docs use `ceiling='conceptual'` + `handoff='coaching'`
with an explicit in-body coaching-handoff line (concepts have a depth ceiling). Tool tags
ride **relationally** only — added to a concept doc just when the concept genuinely
references that tool. Concept content is mined from the coaching-transcripts KB file and
rewritten into current brand voice — never transcript verbatim, no coach/member names.
