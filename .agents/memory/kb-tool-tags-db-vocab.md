---
name: KB tool-tag DB vocabulary
description: How the assistant's TOOL-tag vocabulary became DB-managed while concept/troubleshooting tags stay code-defined; the merged "effective vocab" contract.
---

# KB tool-tag vocabulary is DB-managed; concept + troubleshooting stay in code

TOOL tags live in `kb_tool_tags` (admin CRUD + enable/disable, protected flag) with an
AI-proposal queue in `kb_proposed_tool_tags`. Concept tags + the single `troubleshooting`
tag remain code-defined in `kb-taxonomy.ts` and are NEVER written to the DB.

Retrieval + triage read a **merged effective vocab** = enabled DB tool tags + code concept
+ troubleshooting. The merge lives in `artifacts/api-server/src/lib/kb-tool-tags.ts`
(in-memory `cache`, seeded to a code baseline at module load so it works pre-DB and never
collapses on a DB error). Call `refreshToolTagCache()` after every admin mutation and once
on boot after `seedToolTags()`.

**Why:** admins needed to add tools (Poe/Claude/ChatGPT/Grok/Kling/Nano Banana/Midjourney/
Qwen/Canva/ezgif, etc.) with no deploy, but concept/troubleshooting tags are structural and
shouldn't be user-editable.

**How to apply:**
- Never re-add a module-const `TAG_SET` in kb-triage — read `getEffectiveTagSet()` at call
  time. suggestedTags stay ≤4. The triage prompt is now `buildTriagePrompt(tagList)`.
- The AI-proposes path: triage emits an `observedTools` array → `recordProposedToolTag()`
  (fire-and-forget). Proposals are never live tags until a human approves.
- `kb-taxonomy.detectQueryTags` still exists (code baseline) and delegates to the pure
  `detectTagsFromTriggers(query, tags, triggers)`; retrieval imports `detectQueryTags` from
  kb-tool-tags (the merged one), NOT kb-taxonomy.
- Ad-publisher code names (caterpillar/grasshopper/crane) are `protected` — cannot be
  disabled/deleted (enforced in routes AND UI switch/delete disabled).
- Subset invariant (every trigger key ∈ effective tag set) is guarded in
  `kb-surface-retrieval.test.ts`.
- Synthesis does NOT import tag vocab — verified, no change needed despite the task naming it.
- Tables land via boot DDL (`runKbToolTagsMigration` in bootstrap) + companion
  `0097_kb_tool_tags.sql` wired into post-merge.sh (new tables → drift gate fires push-force,
  but the idempotent .sql is belt-and-suspenders).
