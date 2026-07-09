# Live AI Documents — dev → prod content promotion runbook

`ai_live_documents` is the AI assistant's **citable corpus** — the only table the
chat / voice / RAG retrievers pull member-facing answers from. This runbook
covers how content changes made in **dev** reach **prod**, and how the lifecycle
controls (send-to-review, source-change flags, soft-delete/restore, direct edit)
behave across environments.

## Key facts

- **There is no boot mirror anymore (retired).** The legacy `knowledgebase_docs`
  table and `ai_live_documents` are fully decoupled: nothing at boot (or on
  legacy-KB admin writes) copies legacy docs into `ai_live_documents`. The only
  writers of `ai_live_documents` are the review → push-approved pipeline and the
  admin Live AI Documents editor. Edits and deletes are durable across restarts
  and deploys.
- **Schema changes travel via the Publish flow, not agent scripts.** The
  lifecycle columns (`deleted_at`, `flagged_stale_at`, `flagged_reason`) ship as
  an additive migration (schema field + companion `.sql`,
  `0104_ai_live_documents_lifecycle.sql`, all `ADD COLUMN IF NOT EXISTS`). Prod
  gets them when the post-merge `db push --force` (gated on the drift test) runs
  on merge, then a Publish. Never hand-run DDL against prod.
- **Content rows are DATA, not schema.** New/edited `ai_live_documents` rows made
  in dev do **not** automatically appear in prod. There is no content sync from
  dev → prod. Prod content is produced by the same authoring flow, run against
  prod. (A fresh/empty environment bootstrap strategy is deliberately deferred —
  there is no automatic seed of `ai_live_documents` anymore.)

## Editing paths (in order of preference)

1. **Send to review** (primary). Creates a `kb_staging_docs` revision draft
   (`status: needs_review`, `docType: existing_doc`, `updateKind: update`,
   `targetLiveDocId`) seeded with the live content. Edit + "Refine with AI" in
   the review queue, then **push-approved** performs the in-place supersede
   (writes new content, snapshots version history, and clears any stale flag).
   The live doc is untouched until approval.
2. **Propose update** (on a flagged doc). Re-synthesizes the doc's node from
   sources and routes the result through triage into the same review queue.
3. **Direct edit** (escape hatch). Writes the live row immediately, bypassing
   review and version history. Confirmation-gated in the UI. Use only for urgent
   typo-level fixes.

## Source-change flags

- **Scan for source changes** runs `scanCoreTrainingSourceChanges`, which
  refreshes stored source content hashes and reports which nodes' sources
  materially changed. Affected published live docs get `flagged_stale_at` +
  `flagged_reason` stamped ("Likely needs updating" badge in the UI).
- Because the scan refreshes the stored hash, the flag is **persisted on the doc**
  — re-scanning won't re-detect the same change. Resolve a flag by approving a
  revision (auto-clears) or **dismiss** it manually.
- The scan is manual (button). There is no scheduled/boot caller.

## Soft-delete / restore

- Delete is a **soft-delete**: sets `deleted_at`. Soft-deleted docs are excluded
  from retrieval (via `citableDocFilter()`, which now requires
  `deleted_at IS NULL`) and from the default admin list. Toggle **Deleted** to
  view/restore them. Restore clears `deleted_at`.

## Promoting content dev → prod (step by step)

1. **Author + verify in dev.** Make the change through the review flow (or escape
   hatch). Confirm the assistant cites the new content in dev (chat/voice).
2. **Merge.** The task merge runs post-merge setup; the additive migration lands
   the lifecycle columns in the prod schema on the gated `db push --force`.
3. **Publish.** Deploy so the new server code (routes, retrieval filter) is
   live in prod.
4. **Re-create the content in prod.** Content rows do not copy across
   environments. For each promoted doc, run the same authoring path against prod
   (send-to-review → approve, or the escape hatch). There is no boot mirror to
   seed a fresh table anymore.
5. **Verify in prod.** Ask the assistant a question the doc answers; confirm the
   citation and that soft-deleted/flagged docs behave as expected.

## Gotchas

- A live doc is only citable when `doc_class` is curated/overview, `last_verified
  IS NOT NULL`, **and** `deleted_at IS NULL`. A newly seeded doc with
  `last_verified NULL` is intentionally NOT citable until a human verifies it.
- Do not "fix" prod by running DDL or data scripts directly — make dev right and
  re-publish (schema) / re-author against prod (content).
- Editing the legacy member Knowledge Base has no effect on the assistant's
  corpus — the two systems are decoupled. To change what the assistant cites,
  edit through Live AI Documents (review flow or escape hatch).
