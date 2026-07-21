---
name: KB atomic-draft concept dedup
description: Why synthesis atomic "What is X?" drafts dedup by concept keys at insert time, and the human-edit precedence rule
---

Synthesis atomic drafts must dedup at CREATION time by concept keys (the same normalization the Possible-Duplicates surface uses), not exact titles — LLM phrasing drift ("LP event CPC" vs "Landing-Page Event CPC (LP Event CPC)") otherwise piles up N review drafts per concept across nodes/runs.

**Why:** a full-corpus run produced 11 duplicate clusters (20 redundant drafts) the reviewer would have had to sift manually; the exact-title live-doc match plus zero pending-draft check were the gaps.

**How to apply:** the atomic-draft loop in synthesis first looks for a pending same-concept draft (refresh in place; reviewer-edited drafts are never touched or duplicated — human edits always win), then a concept-key live-doc match (→ update draft, not new). Creation-time routing and the review-time duplicate detector must share one concept-key matcher (kb-duplicates.ts) so they can never disagree. One-off cleanup/retarget scripts exist in api-server scripts/ (dedup-atomic-drafts.ts, retarget-atomic-drafts.ts), both dry-run by default.
