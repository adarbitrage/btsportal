---
name: KB Related-topics adjacency lockstep
description: Curated NODE_NEIGHBORS drives both synthesis Related-topics section and the analysis-time mismatch flag; keep them in lockstep.
---
The "## Related topics" section in synthesized KB drafts is built from the curated
NODE_NEIGHBORS adjacency in kb-taxonomy (relatedNodesFor), NOT every root sibling.
The analysis-time `related_topics_mismatch` risk flag (kb-flags, medium, non-blocking,
NOT in blocksBulkConfirm) validates drafts against the same map: allowed = doc's root
(+ process↔concepts pairing; operations stands alone) plus curated neighbors; also
detects the boilerplate full-root dump. Free-prose entries (non-taxonomy labels) are
deliberately ignored to avoid false positives.

**Why:** the old generic every-sibling dump wasted assistant context and cross-shelf
entries misled retrieval; both ends share one vocabulary so synthesis output can never
self-flag (drift-guarded in kb-related-topics.test.ts).

**How to apply:** adding/renaming a taxonomy node requires updating NODE_NEIGHBORS
(test enforces every node has ≥1 valid, non-self neighbor). Any change to the
relatedTopicsMarkdown format must keep parseRelatedTopicEntries parsing it.
