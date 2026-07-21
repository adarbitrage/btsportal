---
name: KB tag preserve-if-empty + tagging policy
description: Publish flow tag-wipe guard and the house policy for assigning taxonomy tags to KB docs.
---

**Rule 1 — preserve-if-empty:** The staging→live publish flow writes the draft's `taxonomyTags` over the live doc's `tags`. Both the in-place update path AND the title-upsert path in the publish tx carry a preserve-if-empty guard: empty draft tags keep the live doc's existing tags; non-empty always wins. Regression-tested in the push-approved suite.
**Why:** Tags drive a binary tier-jump in retrieval; approving untagged update drafts silently wiped tags on live docs and degraded answer ranking.
**How to apply:** Any new publish/upsert path that writes `tags` must replicate the guard.

**Rule 2 — "satisfying answer" tagging test:** Assign tag X (concept or tool) only if a member asking about X would be genuinely helped by landing on this doc. Multi-tool walkthroughs legitimately carry many tool tags; name-drop mentions never get a tag. Wrong tags actively hurt (tier-jump above better answers), so precision beats coverage.
**Why:** The tag boost is absolute tier ordering before relevance blend — over-tagging surfaces partial answers above the real one.

**Rule 3 — inherit for update drafts:** An update draft for a tagged live doc can inherit the live tags verbatim (same topic by construction) — but review against any content that was trimmed out of the draft; a tag for a removed topic is stale.
Support/membership/coaching-hours docs conventionally carry `troubleshooting` (the only fitting concept tag for account/routing content).
