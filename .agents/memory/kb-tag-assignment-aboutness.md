---
name: KB taxonomy tags are aboutness tags, LLM-suggested only
description: Why staging-doc taxonomy tags must come from the triage LLM (0-4 aboutness tags), never from trigger-scanning document bodies.
---

**Rule:** taxonomy tags on KB staging/live docs mean "this doc is a primary
reference for X" (0–4 tags, picked by the triage AI analysis from the
controlled vocabulary). Never assign tags by running the query-trigger
detector (`detectTagsFromTriggers`) over a document body — that detector is
built for short member queries, and over a full doc it tags every tool
mentioned in passing (a Blitz import once produced up to 23 tags/doc,
avg 10).

**Why:** tags drive a BINARY retrieval boost tier — any one matching tag
lifts a doc above the whole non-tagged pool for that query. Over-tagged
docs crowd the boost tier for tool queries they don't answer, and the
retrieval self-test grades docs against tags they don't cover. Lexical
search already handles incidental mentions; tags are the precision layer.

**How to apply:** import scripts stage docs with `taxonomyTags: []` and run
`runAutoTriageOnDoc` right after. Because imported docs are staged FILED
(homeRoot/node/docClass set) with no tags, kb-triage's filed-but-untagged
path stores an advisory tag-only suggestion (placement preserved) that the
reviewer Applies — the human gate stays intact. Docs filed WITH tags keep
their suggestion frozen, so a bulk re-tag requires clearing tags first,
then re-running analysis. A rough health signal: >6 tags on one doc means
something mechanical tagged it.
