---
name: KB duplicate-draft delete is a soft delete
description: Why deleting a Possible-Duplicates draft flips status to 'deleted' instead of dropping the row, and how it stays gone.
---

Deleting a draft from the admin "Possible Duplicates" review tool is a SOFT delete
(flip `kb_staging_docs.status` to `'deleted'`), NOT a row DROP.

**Why:** the triage-audit table's FK to a staging doc is `onDelete: cascade`. A hard
row delete would cascade-erase that draft's entire triage audit trail — the exact
history a reviewer-audit feature exists to preserve. Soft delete keeps the row (and
its audit rows) while removing it from every reviewer surface.

**How to apply:**
- Every review surface filters to `needs_review` (duplicates list) or `merged`
  (merged-groups list), so a `deleted` row never reappears. There is intentionally
  NO restore path for deleted drafts (unlike unmerge, which is reversible). Don't
  add one unless asked.
- The delete endpoint only accepts a `needs_review` draft: already-`deleted` is an
  idempotent no-op success, anything else (approved/merged/rejected) is refused —
  those statuses have their own lifecycle (merged drafts are *restored*, not
  deleted). Reaching delete with one is misuse, not duplicate cleanup.
- The two-step "arm then confirm" guard lives only in the UI; the API deletes on a
  single authorized call.
