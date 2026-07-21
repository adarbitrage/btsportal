---
name: Synthesis zombie run rows
description: Unfinished kb_synthesis_runs rows from killed/duplicate launches and how they're superseded
---

Durable run-report rows written by fire-and-forget jobs can be orphaned (finished_at NULL forever) when the process is killed right after the insert — including duplicate workflow launches that spawn two processes microseconds apart (the in-memory `_state.running` guard is process-local).

**Why:** a zombie latest-row made the admin status card report "interrupted at 0/N" even though a later run completed all nodes, and misled the operator into thinking work was lost.

**How to apply:** `synthesizeNodesBackground` now closes stale unfinished rows (heartbeat `updated_at` older than the card's 90-min staleness threshold) with an explicit interruption error before inserting a new run row. Keep the threshold in lockstep with the status card. "Incremental scope → no nodes match" after a completed run is correct behavior, not a bug. There is still NO cross-process mutual exclusion for synthesis runs.
