# Blitz AI Knowledge — Roadmap

> **Naming key — read first.** The umbrella effort is **Blitz AI Knowledge**. It has exactly three workstreams, referenced everywhere by these **stable codenames**:
>
> 1. **Blitz Identity Reconciliation** — *this task; the foundation.* Builds the code-owned crosswalk from every AI Source Knowledge reference doc to its canonical member-facing Blitz section + Process node.
> 2. **Concept Layer Synthesis** — build the concept/process truth-doc layer via topic index + node synthesis.
> 3. **Lesson Layer Publish** — publish the ~90 lesson docs into Live AI Documents (light reformat + crosslinks), stamped with the member-facing `blitz_section`.
>
> **Do NOT rename these to "Phase 1/2/3."** The Blitz curriculum already uses build/test/scale "phases" (and a three-phase member narrative); numbering these workstreams would collide with that vocabulary and confuse both people and future retrieval content. Always reference a workstream by its codename.

## Goal of the initiative

The AI assistant (chat + voice) should know the Blitz program's **processes and concepts** AND link **bidirectionally** between concepts and specific member-facing Blitz sections:

- "What is section 8 about?" → explain the concept behind *Create Your Landing Page Assets — Media Mavens*.
- "How do I write headlines?" → explain the concept **and** point the member to the relevant Blitz section (Round 1 headline testing, §16).

Members only ever see the **23-section guide** (`@workspace/blitz-curriculum`). Any pointer the assistant emits must resolve to one of those sections, never to internal `3.x` lesson numbers.

## Architecture facts (as they stand today)

- **`ai_source_documents` ("AI Source Knowledge")** is *mining input only*. It is **never read at answer-time**. It's the raw corpus that synthesis and publish workstreams consume.
- **`ai_live_documents`** is the **only** corpus that chat + voice retrieve from, via the shared `kb-retrieval` path (`artifacts/api-server/src/lib/kb-retrieval.ts`).
- **Citable gate:** a Live doc is retrievable only when `doc_class IN ('curated','overview') AND last_verified IS NOT NULL AND audience <> 'admin'`.
- **Supported citable-publish paths:** (a) **synthesis push-approved** and (b) the **legacy mirror** (citable legacy docs → `ai_live_documents`, upsert-and-prune in one tx). The direct **"New Document" button is a dead stub** that gets pruned on boot — do not build on it.
- **Identity numbering is internal.** The `3.x` / `3.18b` codes in the source-doc titles and `blitz_lessons.lesson_id` are internal only and are never surfaced to members. The member-facing identity is the 23-section curriculum (`id`, `phase`, `step`, `title`, `sectionAnchor`, `courseId`).

## The two-layer target design

- **Lesson layer** — the ~90 Blitz lesson docs, published as **lesson-anchored citable Live docs**: a light AI reformat to a consistent structure + crosslinks, each stamped with the member-facing `blitz_section` (resolved via this task's identity map). Fine-grained, "how do I do X" answers.
- **Concept layer** — **node synthesis** producing concept/process truth docs (one per taxonomy node), with crosslinks. Consolidates knowledge *across* many source docs into "what is this / how does this work" answers.

Together they give the assistant both the concept ("what is a jump page") and the pointer ("…covered in Blitz section 6").

---

## Workstream: Concept Layer Synthesis

- **Codename:** Concept Layer Synthesis (never "Phase 2").
- **Goal (one line):** Index every source doc to taxonomy nodes, run node synthesis across the *full* corpus, review, and publish the concept/process truth layer to `ai_live_documents`.
- **Start this when…** the AI Source Knowledge corpus (`ai_source_documents`) is **reasonably complete** — i.e. the source docs that will exist have been captured. Synthesis consolidates per node across *all* sources, so starting on a partial corpus guarantees rework.
- **Dependencies (must exist first):**
  - This **Blitz Identity Reconciliation** map (so synthesized concept docs can carry correct member-facing `blitz_section` pointers).
  - The taxonomy nodes + `BLITZ_SECTION_TO_NODE` (`artifacts/api-server/src/lib/kb-taxonomy.ts`).
  - A populated `ai_source_documents` corpus.
- **Inputs:** all `ai_source_documents` reference docs; the taxonomy node set; the identity crosswalk.
- **Outputs:** concept/process **truth docs** (one per node) written to `ai_live_documents` as `doc_class` `curated`/`overview`, with crosslinks and member-facing section pointers, published via the **synthesis push-approved** path.
- **Human review gate:** synthesis drafts/flags only; a human approves each node's truth doc before it becomes citable (`last_verified` stamped on approval). No machine auto-publish.

## Workstream: Lesson Layer Publish

- **Codename:** Lesson Layer Publish (never "Phase 3").
- **Goal (one line):** Reformat the ~90 lesson docs to a consistent structure, inject crosslinks, and publish them to `ai_live_documents` stamped with the real member-facing `blitz_section`.
- **Start this when…** **Concept Layer Synthesis** has published enough concept/process docs that lesson crosslinks have real targets to point at. (Lessons can be reformatted earlier, but crosslinks depend on the concept layer existing.)
- **Dependencies (must exist first):**
  - This **Blitz Identity Reconciliation** map (the source of each lesson's canonical `blitz_section`).
  - **Concept Layer Synthesis** docs (crosslink targets).
- **Inputs:** the ~90 lesson source docs; the identity crosswalk; the published concept-layer docs.
- **Outputs:** lesson-anchored citable Live docs in `ai_live_documents` (light AI reformat + crosslinks), each stamped with its member-facing `blitz_section`.
- **Human review gate:** reformatted lessons are reviewed and approved before publish; publish uses a supported citable path, never the dead "New Document" stub.

---

## Sequencing rationale + decisions already made

- **Why the concept layer waits for a complete corpus:** node synthesis consolidates *all* sources for a node into one truth doc. Running it on a partial corpus produces docs that must be re-synthesized as more sources land — pure rework. Wait for a reasonably complete corpus.
- **Why crosslinks depend on the concept layer existing first:** a lesson doc's crosslinks point at concept/process truth docs. Those targets must exist before the lesson layer can reference them, so Concept Layer Synthesis precedes (or at least leads) Lesson Layer Publish.
- **Why this identity map is a prerequisite for any pointer:** every member-facing pointer must resolve to one of the 23 canonical sections. Without the reconciliation crosswalk there is no reliable source-doc → section mapping, so neither future workstream can stamp `blitz_section` correctly. This is the foundation, built first.
- **Reformat approach:** "**light AI reformat + crosslinks**," not a rewrite — preserve the original lesson substance, normalize structure, add pointers.
- **Member-facing identity is the 23-section guide:** internal `3.x`/`lesson_id` numbering is never surfaced; all pointers use the curriculum section (`id`/`sectionAnchor`/`title`).

## Pointers back into the code

- **This reconciliation map:** `artifacts/api-server/src/lib/blitz-identity-map.ts` — the crosswalk (`BLITZ_IDENTITY_CROSSWALK`), lookups (`resolveBlitzSourceDoc`, `resolveBlitzLessonId`), coverage (`BLITZ_SECTION_COVERAGE`, `BLITZ_SECTIONS_WITHOUT_SOURCES`, `BLITZ_SECTIONS_WITH_THIN_COVERAGE`), collisions (`BLITZ_ORDER_COLLISIONS`), and the shared title contract (`blitzSourceDocTitle`).
- **Drift guard:** `artifacts/api-server/src/__tests__/blitz-identity-map-drift.test.ts`.
- **Gap/collision report:** `docs/blitz-identity-reconciliation-report.md`.
- **Canonical member curriculum:** `lib/blitz-curriculum/src/index.ts` (23 sections), `lib/blitz-curriculum/src/blitz-body-html.ts`, `lib/blitz-curriculum/src/blitz-video-map.ts`.
- **Taxonomy + Process nodes:** `artifacts/api-server/src/lib/kb-taxonomy.ts` (`BLITZ_SECTION_TO_NODE` ~L514–551, `isProcessNode`, `PROCESS_NODES`); pattern test `artifacts/api-server/src/__tests__/kb-taxonomy-blitz-drift.test.ts`.
- **Source-doc seeding:** `artifacts/api-server/src/lib/seed-core-training-sources.ts` (uses `blitzSourceDocTitle`, exports `CORE_TRAINING_PROSE_TITLES`).
- **Schema:** `lib/db/src/schema/ai-source-documents.ts`, `lib/db/src/schema/blitz-lessons.ts`, `lib/db/src/schema/ai-live-documents.ts`.
- **Retrieval path (do not touch in these workstreams):** `artifacts/api-server/src/lib/kb-retrieval.ts`.
- **Prior context:** `docs/ai-assistant-remediation-plan.md`.
