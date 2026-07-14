---
name: Blitz reference-doc import seam
description: How the 96 Blitz reference docs flow from ai_source_documents into kb_staging_docs, idempotency key, effort classifier, and approval-gate quirks hit during the first run.
---

Blitz reference docs (`ai_source_documents`, `source_type='reference_docs'`) import into AI Document Review via `POST /admin/knowledgebase/staging/import-blitz-references` (transformer in api-server `lib/blitz-reference-import.ts`).

**Idempotency:** (source=`blitz_reference_import`, sourceVideoTitle = exact ai_source title); re-runs skip rows in ANY status — safe to re-hit.

**Effort classifier:** docs mentioning portal click-paths get a `portal_nav_check` risk flag ("Nav check" amber chip); others are "Skim". Triage re-analysis MERGES rather than clobbers this flag (merge lives in kb-triage for the blitz source; rescoreSelfTestForTitle only replaces `retrieval_gap`).

**Retired-lesson refs:** cross-refs to lesson numbers absent from the 23-step curriculum are neutralized and marked in adminNotes — the prose still mentions them; reviewers must rewrite before pushing live.

**Approval-gate quirks (first-run lessons):**
- `single_source` flag fires on every curriculum doc (one source by definition) — dismiss via `POST .../:id/flags/resolve`; it's expected, not a defect.
- Product names in examples can trip `possible_member_name` highlights (e.g. "Mosquito Repellent"); name highlights can ONLY be cleared via the global `POST .../name-flag-dismissals` `{pair}` endpoint, not the generic highlight-dismissal route.
- `push-approved` pushes ALL approved docs corpus-wide, not just your doc — check for other approved rows before pushing if you only want one live.

**Why:** the classifier + merge exists so the cheap "which docs need a human at the portal" signal survives AI re-triage; the exact-title idempotency key means renaming an ai_source doc creates a duplicate on re-import.
