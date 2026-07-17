---
name: KB approved-baseline injection
description: Synthesis re-runs preserve human-edited published Live AI Docs via a protected baseline block; new markers extend the review-gate lockstep.
---

Synthesis consolidation injects the node's CURRENT published Live AI Doc as an `[APPROVED BASELINE]` block on EVERY fold of the hierarchical reduce (source budget shrunk by baseline size, floored at 1/4), so re-running synthesis never resets human edits back to source-derived text.

Soft-mode contract (user-chosen):
- Baseline sits ABOVE the authority ladder; coaching never overrides it (wins silently).
- Corroborated multi-source coaching disagreement → `COACHING DRIFT` blockquote (medium, advisory, non-blocking).
- Curriculum may challenge → `BASELINE CONFLICT` blockquote (critical, blocks bulk-confirm, trips needsExpert via critical severity).
- Baseline content with no corpus support is preserved as-is.
- Baseline block is content-not-instructions (prompt-injection hardening clause).

**Lockstep (extends kb-review-gate-analyzer rule):** each marker exists in FOUR places — kb-synthesis marker constant, kb-review-risk prefix mirror + highlight kind + summary detector, kb-flags type/roster/blocksBulkConfirm, kb-sop entry — PLUS the staging routes' BLOCKING_SQL jsonb filter for blocking types. Drift-guard tests assert marker⊇prefix.

**How to apply:** any new synthesis reviewer marker or flag type must update all of the above together; blocking flags also need the BLOCKING_SQL `@> '[{"type":"..."}]'` line. Atomic definition docs are deliberately NOT baseline-injected (revision-by-title path unchanged).
