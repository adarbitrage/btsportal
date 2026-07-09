---
name: possible_member_name false-positive control
description: How the review-panel member-name heuristic suppresses terminology without weakening real-name detection
---

Rule: false positives in the `possible_member_name` advisory heuristic (kb-review-risk) are suppressed ONLY via exact, case-insensitive pair allowlists or explicit word stopwords — never blanket structural rules.

**Why:** a blanket -ing suffix rule was rejected because it suppresses real surnames (King, Sterling, Harding); similarly, broad word-level suppression would swallow real First Last names. Exact pairs can only collide if a member is literally named e.g. "Unit Economics".

**How to apply:** the vocabulary is now self-maintaining — `analyzeDraftForReview(content, vocab)` takes a `NameFlagVocab` param (default = baseline seed). The derived vocab (kb-name-flag-vocab, 5-min TTL cache, fails soft to last snapshot) merges: seed phrases, house terms (the ONLY word-level source — closed hand-curated set), tool-tag triggers/glossary/curated titles (PHRASE-ONLY: tool tags contain generic first-name words like "claude" that would hide real people if word-suppressed), corpus-frequent capitalized pairs (≥4 distinct docs), and reviewer "Not a name" dismissals persisted in `kb_name_flag_dismissals` (admin UI chip + undo list). Safety rail: `isPrivacyProtectedPair` (staff-surname privacy patterns, e.g. Bruce Clark / Shepherd variants) is enforced BEFORE any vocab suppression AND at dismissal-insert time — those pairs can never be suppressed. Test landmines: sentence-initial capitalized words form spurious pairs in fixtures (start test sentences lowercase); some plausible fixture pairs are already baseline-suppressed.
