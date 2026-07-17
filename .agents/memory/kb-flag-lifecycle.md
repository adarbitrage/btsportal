---
name: KB review flag lifecycle
description: Contracts for highlight dismissals, risk-flag resolutions, and the approval gate on kb_staging_docs review.
---

# KB review flag lifecycle contracts

- Passage-highlight dismissals are GLOBAL (kind + normalized excerpt), not per-doc, so they survive re-synthesis regenerating the draft.
- **Why:** re-synthesis rewrites docs and would orphan per-doc dismissals. (The former `possible_member_name` advisory flag and its "Not a name" vocab dismissals were removed entirely in July 2026 — transcript cleaning owns member-name privacy.)
- Doc-level risk-flag resolutions are keyed by a flag fingerprint (type + normalized message), so a re-triage that reproduces the same flag stays resolved, but a materially different flag re-blocks.
- The approval gate fires ONLY on the transition to approved (single PATCH and bulk-approve both call `getDocOutstanding`); non-approval PATCHes must never be blocked. 409 body carries `outstanding: { flags, highlights }`.
- `needsExpert` is recomputed (never hand-set) whenever a resolution changes: it clears only when zero critical flags remain active.
- Content edits re-run `computeRiskFlags` deterministically (retriageDocFlags) — flags come from code, not stored LLM output, so "removing" a flag means resolving/dismissing or editing the text.
- **How to apply:** any new outstanding-work signal must be wired into `getDocOutstanding` (api-server `lib/kb-flag-lifecycle.ts`) or the gate won't see it; frontend `updateDoc` returns a boolean and 409s keep the doc in the queue.
