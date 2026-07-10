---
name: Content-gap capture is inert by design
description: Unanswered member questions are captured (content_gap_questions) but deliberately NOT consumed by the retrieval self-test yet.
---

The unanswered-question capture pipeline (lib/content-gap-radar.ts → content_gap_questions) records every "no confident match" from the MEMBER chat + voice call sites only:
- Capture happens at the member routes (chat.ts / voice.ts), never inside the shared retrieval path or the self-test — kb-retrieval.ts and kb-retrieval-selftest.ts must NEVER import content-gap-radar (guard test: content-gap-capture.test.ts).
- Dedup is an upsert keyed by (surface, normalized_question); normalizeQuestion strips ALL punctuation — test tags/filters against normalized_question must be alphanumeric-only or LIKE never matches.
- Bounded retention: lib/content-gap-questions-cleanup.ts (boot job in app.ts) — age 180d on last_asked_at + 5000-row cap trimming least-recently-asked.
- The data is INERT: the retrieval self-test still uses generated questions. Selection/approval flow for using real questions is deliberately deferred until real member data exists.

**Why:** grounding the self-test in real member phrasing needs a selection design (frequency vs clustering) that can't be made without data; capture-only preserves the data loss-free until then.
**How to apply:** don't wire content_gap_questions into the self-test, review UI, or ranking without an explicit task; keep capture fire-and-forget (never throws into the answer path).
