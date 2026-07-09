---
name: possible_member_name false-positive control
description: How the review-panel member-name heuristic suppresses terminology without weakening real-name detection
---

Rule: false positives in the `possible_member_name` advisory heuristic (kb-review-risk) are suppressed ONLY via exact, case-insensitive pair allowlists (nav-label phrases, human-verified TERMINOLOGY_PHRASES) or explicit stopwords — never blanket structural rules.

**Why:** a blanket -ing suffix rule was rejected because it suppresses real surnames (King, Sterling, Harding); similarly, word-level suppression of common vocabulary would swallow real First Last names. Exact pairs can only collide if a member is literally named e.g. "Unit Economics".

**How to apply:** when reviewers report new terminology false positives, audit ALL current hits across the needs_review queue (flags are computed live, nothing persisted — "removing" a flag means extending the analyzer vocabulary), human-verify each pair is not a name, then append to TERMINOLOGY_PHRASES with matching tests (terminology suppressed + real name still flags amid it).
