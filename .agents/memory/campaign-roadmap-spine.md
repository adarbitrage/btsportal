---
name: Campaign roadmap spine
description: 17-step campaign chronology lib + runtime prompt spine — id stability and injection seam rules
---

**Rule:** The BTS 17-step campaign chronology lives in `@workspace/campaign-roadmap` (shared lib, side-effect-free). The chat route appends `renderCampaignSpine()` to the system prompt at assembly time on EVERY request (both confident and no-match retrieval branches). The spine block is NOT DB-stored — deliberately, so roadmap edits ship with deploys; only the Rule 1 spine-context/precedence language lives in the DB-stored base prompt (guarded by CAMPAIGN_SPINE_SENTINEL).

**Why:** Ordering/branching facts are unreliable via retrieval; and per-member checklist progress (follow-up task) will persist keyed by `substepId`, so step `id`/`substepId` values are stable keys — wording edits or reordering must NEVER change existing ids, and nothing may key off display text or array index.

**How to apply:** Editing the roadmap = edit the lib only; the drift-guard test in the lib asserts the rendered spine contains every title/description/substep in order and stays under a token band. Precedence contract: spine wins on ORDERING questions, KB articles win on depth/how-to. Rendered spine is ~850 est. tokens (locked verbatim wording made the ~500–600 target infeasible).
