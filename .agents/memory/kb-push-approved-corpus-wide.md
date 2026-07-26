---
name: KB push-approved is corpus-wide
description: The staging publish endpoint publishes every approved row, not a selected set — preflight before calling.
---

The KB staging publish flow ("push approved") is corpus-wide: it publishes EVERY `kb_staging_docs` row in status `approved`, with no id/source scoping.

**Why:** Calling it to publish one curated set will silently ride along any other approved rows a reviewer left sitting.

**How to apply:** Before invoking it, query all rows with status `approved` and confirm they are exactly the intended set. Related operational facts: `runAutoTriageOnDoc` self-persists (flags + retrieval self-test + status→needs_review); the self-test payload verdict field is `results[].passed`; the flag approval gate is intentionally disabled (flags are informational), so a critical `conflict` flag on an `updateKind='update'` draft is expected — the push supersedes the target live doc in place with a version snapshot. Dev seed admin login works for driving these admin endpoints in dev.
