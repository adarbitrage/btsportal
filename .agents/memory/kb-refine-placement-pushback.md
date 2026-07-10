---
name: KB refine placement pushback
description: The KB review "refine" chat has a 4th response mode and the leave-note action targets two different columns.
---

The truth-doc review refine chat (`/admin/knowledgebase/staging/:id/refine`) can
return FOUR response modes, not the original three:
- `discussion` — answered, draft untouched
- `patch` / `rewrite` — draft edited
- `placement` — NEW: advice-only pushback when the reviewer asks to add subject
  matter outside the draft's filed shelf/node/doc-class charter. Draft untouched;
  payload carries `{verdict, target}` where target is a validated live/staging
  candidate to optionally leave a note on.

**Why:** placement pushback makes a SECOND LLM call after the first refine call
returns `{placementCheck:{query,summary,concern}}`, then runs retrieval
(`retrieveSurfaceAware`) + a lexical staging `to_tsvector` search to answer
"already covered / belongs elsewhere / genuine gap". The reviewer can override by
acknowledging the mismatch in the chat, which routes back to a normal edit.

**How to apply:** any future work touching the refine endpoint or its frontend
`sendRefine` MUST handle `mode:"placement"` (don't treat it as an edit and don't
touch the draft). The AI's `target.id` is validated against retrieved candidate
ids — never trust a hallucinated id.

**Leave-note dual column:** the opt-in "leave a note on the target" action
(`/:id/leave-note`) writes to `ai_live_documents.reviewer_notes` for LIVE targets
but `kb_staging_docs.admin_notes` for STAGING targets (live docs had no
admin_notes column; `reviewer_notes` was added additively). Append-only merge.

**Reviewer SOP:** `GET /:id/../reviewer-sop` (literal route, registered before
`/:id`) returns `buildReviewerSop()` from `lib/kb-sop.ts` — taxonomy/doc-class/
ceiling/handoff/flag listings are DERIVED from the registries (drift-guarded by
`__tests__/kb-sop.test.ts` + `RISK_FLAG_TYPES` exhaustiveness in kb-flags.ts);
only the prose SECTIONS are authored. Add a registry entry → the SOP + test
update automatically; add a new RiskFlagType → add it to RISK_FLAG_TYPES too.
