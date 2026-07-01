---
name: KB Synthesis durable state + coverage
description: How incremental synthesis decides which nodes are "affected", and why the depth-gap flag is advisory-only. Constraints future update/supersede work must respect.
---

# KB Synthesis — durable state, incremental runs, coverage

Admin control layered on the create-only synthesis engine: selective/incremental
runs + a depth-aware coverage view. The engine stays create-only — re-synthesis
produces new drafts and never updates/supersedes an approved doc (a later phase).

## Affected-node detection (the incremental invariant)
- Durable per-node state records the FULL set of currently-linked source ids at
  synthesis time, NOT just the top-N that got consolidated.
  **Why:** so any newly-linked source — even one that wouldn't crack the top-N —
  re-flags the node on the next incremental run. Recording only the consolidated
  subset would silently miss new material (a quiet data-quality regression).
- A node is **affected** when it has links now AND (never synthesized OR a current
  linked id is absent from the recorded set). This node-level id-set diff is the
  source of truth for incremental scope.
- The per-source "incorporated" marker is a SECONDARY display metric only ("new /
  never folded in"); it is global/coarser — do not use it as the affected signal.

## Depth-gap flag is ADVISORY, never a blocker
- Raised only when: node importance is high (a curated SUBSET of nodes, not all)
  AND source count clears a small threshold AND the node's expected depth tier
  isn't published in live docs.
  **Why:** flagging every node, or flagging thin nodes, is noise. Importance +
  source-count gating keeps it a nudge for the human reviewer.
  **How to apply:** it must never gate publishing; keep it out of any publish path.
- Expected tier is derived from the node's root (process→overview, otherwise
  curated); coverage counts live docs via the citable filter (curated/overview
  doc_class, verified, member-facing).

## Landing pattern
- Additive nullable column + new table landed via companion .sql mirroring the
  schema exactly + post-merge psql steps, so live-schema-drift stays green and the
  conditional push stays skipped (see additive-column-no-migration).
- There is NO "clear queue" guard in the engine — it is already create-only, so
  selective re-runs never wipe other nodes' pending drafts.
