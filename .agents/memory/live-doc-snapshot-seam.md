---
name: Live-doc snapshot seam
description: Every ai_live_documents overwrite must snapshot into version history via one shared seam; fixtures are insert-only.
---

**Rule:** Any code path that overwrites the title/content/taxonomy of an existing `ai_live_documents` row must call the shared `snapshotLiveDocVersion` seam FIRST, in the same transaction. Never hard-delete live docs (version history cascades away — soft-delete only). The seam always re-reads the row under its own lock — never trust a caller-supplied row object to be fresh.

**Why:** A test fixture's title-keyed upsert against the shared dev DB silently reverted rich reviewed live docs to stubs with no snapshots to recover from; recovery had to be reconstructed from published staging rows via the exact push-time transform (`scrubPrivateContent(edited_content ?? content)`).

**How to apply:**
- Test fixtures seeding live docs must be insert-only with **targetless** `ON CONFLICT DO NOTHING` (covers every unique key, not just title). A corpus-fingerprint guard test enforces this — keep it in lockstep with any new fixture.
- Upsert-by-title paths need an advisory lock on the title (FOR UPDATE cannot lock an absent row), or a concurrent same-title insert gets overwritten unsnapshotted.
- Retrieval negative-probe tests must assert the three-state outcome (`no_match`), never raw fallback-pool titles — the loose word-OR pool drifts with the shared corpus.
