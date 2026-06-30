---
name: Assistant Card Library KB unlink
description: Why the Card Library question generator is intentionally severed from the old KB and where it re-attaches in phase 2
---

The admin **Card Library** (assistant suggested-prompt cards: groups → cards → questions, routes under `/admin/assistant/groups`) lives in the **AI Knowledgebase** sidebar folder (moved out of its own former "AI Assistant" folder; icon MessageCircleQuestion).

The AI question **generator** (`questionGenerator.ts` + `assistant-generator.ts` route + `GenerateQuestionsModal`) reads the OLD `knowledgebase_docs` table. During the AI-KB rebuild this was deliberately **unlinked**: the "Generate with AI" UI is hidden, manual question authoring stays fully working. The backend generator endpoint + modal component are left **dormant** (not deleted).

**Why:** old `knowledgebase_docs` is being retired as the AI brain moves to `ai_live_documents`; generating prompts from soon-dead content is pointless. Pre-launch (no active users) so member impact is nil.

**How to apply:**
- Do NOT "fix" the missing Generate button — its absence is intentional.
- Do NOT drop the dormant columns on `assistant_card_questions` (`sourceKbDocIds`, `retrievalConfidence`, `generatedBy`); they get reused on re-tie.
- Phase-2 re-tie = point the generator/doc-picker at `ai_live_documents` (has id/title/content/category — sufficient) once that page is populated.
- Member-facing `/assistant/cards` only sends question TEXT; KB doc IDs are admin-side provenance only, never dereferenced for members.
