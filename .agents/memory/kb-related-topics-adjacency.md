---
name: KB Related-topics scaffold removed (adjacency dormant)
description: Internal "## Related topics" taxonomy scaffolding is banned from member-facing AI answers; a chat-time sentinel is the durable guard.
---
Internal taxonomy scaffolding must NOT appear in member-facing AI answers: the
"## Related topics" section, bold taxonomy labels, and `(see <Topic>)` prose
cross-links were removed from the whole KB pipeline (synthesis output, analysis-time
auto-refill, and the retired `related_topics_mismatch` risk flag).

The durable guard is a single chat-time safety net (Rule 13 + a scaffolding sentinel
in the system prompt, boot-enforced), NOT per-doc auto-fix.

**Preserved — do NOT confuse with scaffolding:** legitimate nav grounding (portal
paths in prose, nav cross-link markdown) stays. If you ever reintroduce curated
cross-links, express them as nav grounding, never as a "## Related topics" taxonomy
dump — the chat sentinel strips the scaffold form regardless.

**Why:** the every-topic scaffold leaked internal KB structure into answers and
wasted assistant context; centralizing the guard at chat time (not per-doc) keeps it
robust to prompt/model changes.

**Dormant leftover:** `NODE_NEIGHBORS` / `relatedNodesFor` in kb-taxonomy have no
production callers anymore; safe to remove in a later cleanup.
